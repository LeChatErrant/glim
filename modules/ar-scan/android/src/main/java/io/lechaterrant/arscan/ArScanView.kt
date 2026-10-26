package io.lechaterrant.arscan

import android.app.Activity
import android.app.Application
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.opengl.Matrix
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.WindowManager
import com.google.ar.core.ArCoreApk
import com.google.ar.core.Config
import com.google.ar.core.Coordinates2d
import com.google.ar.core.DepthPoint
import com.google.ar.core.Frame
import com.google.ar.core.Plane
import com.google.ar.core.Point
import com.google.ar.core.Session
import com.google.ar.core.TrackingState
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin

/** A point on the floor, in ARCore world coordinates (meters). */
data class FloorPoint(val x: Float, val z: Float)

data class Polyline(val points: List<FloorPoint>, val closed: Boolean, val color: Int)

/**
 * `edge`: when off screen, show an arrow at the screen edge pointing to it.
 * `kind`: "corner" (diamond + number) or "light" (jewel + name pill).
 */
data class Marker(val p: FloorPoint, val color: Int, val label: String?, val edge: Boolean = false, val kind: String = "light")

/** A marker projected on screen. */
data class ScreenMarker(val x: Float, val y: Float, val color: Int, val label: String?, val kind: String)

data class EdgeArrow(val x: Float, val y: Float, val angle: Float, val color: Int, val label: String?)

/**
 * Camera feed + ARCore tracking. Finds the floor (lowest horizontal plane), casts a
 * reticle from the screen center onto it, and draws the JS-provided overlay
 * (room outlines, light markers) projected onto the floor. In "object" aim mode the
 * center ray also hits real surfaces (depth), to place a light by pointing at it.
 */
class ArScanView(context: Context, appContext: AppContext) : ExpoView(context, appContext), GLSurfaceView.Renderer {
  override val shouldUseAndroidLayout = true

  private val onStatus by EventDispatcher()
  private val onError by EventDispatcher()

  private val surfaceView = GLSurfaceView(context)
  private val overlayView = OverlayView(context)

  private var session: Session? = null
  private var installRequested = false
  private var resumed = false
  private val background = BackgroundRenderer()

  // Shared between GL thread (writer) and UI/JS threads (readers).
  @Volatile private var floorY: Float? = null
  @Volatile private var reticle: FloorPoint? = null
  @Volatile private var snapped: FloorPoint? = null
  /** Which snap moved the target: "close", "corner", "wall", "wallAngle", "angle", or null. */
  @Volatile private var snapKind: String? = null
  @Volatile private var closesShape = false
  /** Object mode: the 3D point (x, y, z) the center ray hits, or null. */
  @Volatile private var objectHit: FloatArray? = null
  @Volatile private var polylines: List<Polyline> = emptyList()
  @Volatile private var markers: List<Marker> = emptyList()
  @Volatile private var activeIndex = -1
  /** Last captured point and when, for the "placed" ripple on the floor. */
  @Volatile private var pulse: Pair<FloorPoint, Long>? = null
  @Volatile var snapEnabled = true
  /** "floor": aim at the floor. "object": aim at anything (a light), it lands on the floor below. */
  @Volatile var aimMode = AIM_FLOOR
    set(value) { field = value; if (value != AIM_OBJECT) objectHit = null }

  private var lastStatusAt = 0L
  private var lastStatusKey = ""

  private val viewMatrix = FloatArray(16)
  private val projMatrix = FloatArray(16)
  private val viewProj = FloatArray(16)

  init {
    surfaceView.preserveEGLContextOnPause = true
    surfaceView.setEGLContextClientVersion(2)
    surfaceView.setEGLConfigChooser(8, 8, 8, 8, 16, 0)
    surfaceView.setRenderer(this)
    surfaceView.renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
    addView(surfaceView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    addView(overlayView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  // ---- Lifecycle -------------------------------------------------------------

  private val lifecycle = object : Application.ActivityLifecycleCallbacks {
    override fun onActivityResumed(activity: Activity) { if (activity == appContext.currentActivity) resume() }
    override fun onActivityPaused(activity: Activity) { if (activity == appContext.currentActivity) pause() }
    override fun onActivityCreated(a: Activity, b: Bundle?) {}
    override fun onActivityStarted(a: Activity) {}
    override fun onActivityStopped(a: Activity) {}
    override fun onActivitySaveInstanceState(a: Activity, b: Bundle) {}
    override fun onActivityDestroyed(a: Activity) {}
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    appContext.currentActivity?.application?.registerActivityLifecycleCallbacks(lifecycle)
    appContext.currentActivity?.window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    resume()
  }

  override fun onDetachedFromWindow() {
    appContext.currentActivity?.application?.unregisterActivityLifecycleCallbacks(lifecycle)
    appContext.currentActivity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    pause()
    session?.close()
    session = null
    super.onDetachedFromWindow()
  }

  private fun resume() {
    if (resumed) return
    val activity = appContext.currentActivity ?: return
    try {
      if (session == null) {
        when (ArCoreApk.getInstance().requestInstall(activity, !installRequested)) {
          ArCoreApk.InstallStatus.INSTALL_REQUESTED -> { installRequested = true; return }
          ArCoreApk.InstallStatus.INSTALLED -> {}
          null -> {}
        }
        val s = Session(activity)
        val config = Config(s).apply {
          planeFindingMode = Config.PlaneFindingMode.HORIZONTAL
          focusMode = Config.FocusMode.AUTO
          updateMode = Config.UpdateMode.LATEST_CAMERA_IMAGE
          lightEstimationMode = Config.LightEstimationMode.DISABLED
          // Depth lets the center ray hit lights and furniture, not only detected planes.
          if (s.isDepthModeSupported(Config.DepthMode.AUTOMATIC)) depthMode = Config.DepthMode.AUTOMATIC
        }
        s.configure(config)
        session = s
      }
      session?.resume()
      surfaceView.onResume()
      resumed = true
    } catch (e: Exception) {
      onError(mapOf("message" to (e.message ?: e.javaClass.simpleName), "kind" to e.javaClass.simpleName))
    }
  }

  private fun pause() {
    if (!resumed) return
    resumed = false
    surfaceView.onPause()
    session?.pause()
  }

  // ---- JS API ----------------------------------------------------------------

  fun setOverlay(json: String) {
    try {
      val o = JSONObject(json)
      val lines = mutableListOf<Polyline>()
      o.optJSONArray("polylines")?.let { arr ->
        for (i in 0 until arr.length()) {
          val pl = arr.getJSONObject(i)
          val pts = pl.getJSONArray("points")
          lines += Polyline(
            (0 until pts.length()).map { j -> pts.getJSONObject(j).let { FloorPoint(it.getDouble("x").toFloat(), it.getDouble("z").toFloat()) } },
            pl.optBoolean("closed", false),
            parseColor(pl.optString("color"), Color.WHITE),
          )
        }
      }
      val marks = mutableListOf<Marker>()
      o.optJSONArray("markers")?.let { arr ->
        for (i in 0 until arr.length()) {
          val m = arr.getJSONObject(i)
          marks += Marker(
            FloorPoint(m.getDouble("x").toFloat(), m.getDouble("z").toFloat()),
            parseColor(m.optString("color"), Color.YELLOW),
            m.optString("label").ifEmpty { null },
            m.optBoolean("edge", false),
            m.optString("kind").ifEmpty { "light" },
          )
        }
      }
      polylines = lines
      markers = marks
      activeIndex = o.optInt("activeIndex", -1)
    } catch (e: Exception) {
      onError(mapOf("message" to "Bad overlay: ${e.message}", "kind" to "overlay"))
    }
  }

  fun capture(): Map<String, Any>? {
    // Object mode: the light goes on the floor plan right below the point aimed at.
    if (aimMode == AIM_OBJECT) objectHit?.let { o ->
      placed(FloorPoint(o[0], o[2]))
      return mapOf("x" to o[0], "z" to o[2], "rawX" to o[0], "rawZ" to o[2], "closesShape" to false)
    }
    val p = (if (snapEnabled) snapped else null) ?: reticle ?: return null
    val raw = reticle ?: p
    placed(p)
    return mapOf("x" to p.x, "z" to p.z, "rawX" to raw.x, "rawZ" to raw.z, "closesShape" to closesShape)
  }

  /** Feedback for every captured point: a ripple on the floor and a short buzz. */
  private fun placed(p: FloorPoint) {
    pulse = p to SystemClock.uptimeMillis()
    post {
      performHapticFeedback(if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY)
    }
  }

  private fun parseColor(s: String, fallback: Int) = try { if (s.isEmpty()) fallback else Color.parseColor(s) } catch (_: Exception) { fallback }

  // ---- GL renderer -----------------------------------------------------------

  override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
    GLES20.glClearColor(0f, 0f, 0f, 1f)
    background.create()
  }

  override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
    GLES20.glViewport(0, 0, width, height)
    @Suppress("DEPRECATION")
    val rotation = (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay.rotation
    session?.setDisplayGeometry(rotation, width, height)
  }

  override fun onDrawFrame(gl: GL10?) {
    GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT or GLES20.GL_DEPTH_BUFFER_BIT)
    val s = session ?: return
    try {
      s.setCameraTextureName(background.textureId)
      val frame = s.update()
      background.draw(frame)
      val camera = frame.camera
      if (camera.trackingState != TrackingState.TRACKING) {
        reticle = null
        snapped = null
        snapKind = null
        objectHit = null
        publish(camera.trackingState, camera.trackingFailureReason.name, null, null)
        overlayView.post { overlayView.update(null) }
        return
      }
      camera.getViewMatrix(viewMatrix, 0)
      camera.getProjectionMatrix(projMatrix, 0, 0.05f, 50f)
      Matrix.multiplyMM(viewProj, 0, projMatrix, 0, viewMatrix, 0)

      updateFloor(s)
      val pose = camera.displayOrientedPose
      val origin = floatArrayOf(pose.tx(), pose.ty(), pose.tz())
      val z = pose.zAxis // camera looks down -Z
      val dir = floatArrayOf(-z[0], -z[1], -z[2])
      val fy = floorY
      var hit: FloorPoint? = null
      if (fy != null && dir[1] < -0.08f) {
        val t = (fy - origin[1]) / dir[1]
        if (t in 0.1f..10f) hit = FloorPoint(origin[0] + dir[0] * t, origin[2] + dir[2] * t)
      }
      reticle = hit
      computeSnap(hit)
      objectHit = if (aimMode == AIM_OBJECT) hitObject(frame) else null
      val heading = atan2(dir[0].toDouble(), -dir[2].toDouble())
      publish(TrackingState.TRACKING, "NONE", FloorPoint(origin[0], origin[2]), heading)
      val scene = buildScene(s, pose)
      overlayView.post { overlayView.update(scene) }
    } catch (e: Exception) {
      // Transient errors (camera not available yet, session paused) are common; just skip the frame.
    }
  }

  /** The floor is the lowest tracked upward-facing plane of reasonable size. */
  private fun updateFloor(s: Session) {
    var lowest: Float? = null
    for (plane in s.getAllTrackables(Plane::class.java)) {
      if (plane.trackingState != TrackingState.TRACKING || plane.subsumedBy != null) continue
      if (plane.type != Plane.Type.HORIZONTAL_UPWARD_FACING) continue
      if (plane.extentX * plane.extentZ < 0.25f) continue
      val y = plane.centerPose.ty()
      if (lowest == null || y < lowest) lowest = y
    }
    if (lowest != null) {
      val prev = floorY
      // Only accept a higher plane if it's close (refinement), never jump up to a table.
      floorY = if (prev == null || lowest < prev || abs(lowest - prev) < 0.08f) lowest else prev
    }
  }

  /**
   * Snapping while tracing, strongest first: closing on the first corner, a corner of another
   * outline, then a right angle to the last wall (landing on another wall if it crosses one
   * nearby). Before there is a last wall, the target can still land on another wall.
   */
  private fun computeSnap(hit: FloorPoint?) {
    closesShape = false
    val line = polylines.getOrNull(activeIndex)
    if (hit == null || line == null) { snapped = hit; snapKind = null; return }
    val pts = line.points
    if (pts.size >= 3 && dist(hit, pts[0]) < CLOSE_RADIUS_M) {
      closesShape = true
      snapped = pts[0]
      snapKind = "close"
      return
    }
    if (!snapEnabled) { snapped = hit; snapKind = null; return }
    val others = polylines.filterIndexed { i, _ -> i != activeIndex }
    val corner = others.flatMap { it.points }.minByOrNull { dist(hit, it) }
    if (corner != null && dist(hit, corner) < CORNER_SNAP_M) { snapped = corner; snapKind = "corner"; return }
    val walls = others.flatMap { walls(it) }
    val axis = rightAngleAxis(pts, hit)
    if (axis == null) {
      val onWall = walls.map { (a, b) -> closestOnSegment(hit, a, b) }.minByOrNull { dist(hit, it) }
      if (onWall != null && dist(hit, onWall) < WALL_SNAP_M) { snapped = onWall; snapKind = "wall" }
      else { snapped = hit; snapKind = null }
      return
    }
    val (o, d) = axis
    val t = (hit.x - o.x) * d.x + (hit.z - o.z) * d.z
    val angled = FloorPoint(o.x + d.x * t, o.z + d.z * t)
    val crossing = walls.mapNotNull { (a, b) -> crossLine(o, d, a, b) }.minByOrNull { dist(angled, it) }
    if (crossing != null && dist(angled, crossing) < WALL_CROSS_M) { snapped = crossing; snapKind = "wallAngle" }
    else { snapped = angled; snapKind = "angle" }
  }

  /** The line the right-angle snap holds the target on: through the last corner, along or across the last wall. */
  private fun rightAngleAxis(pts: List<FloorPoint>, hit: FloorPoint): Pair<FloorPoint, FloorPoint>? {
    if (pts.size < 2) return null
    val last = pts.last()
    val prev = pts[pts.size - 2]
    val len = dist(last, prev)
    if (len < 1e-3f) return null
    val dx = (last.x - prev.x) / len
    val dz = (last.z - prev.z) / len
    val rx = hit.x - last.x
    val rz = hit.z - last.z
    val along = rx * dx + rz * dz
    val across = -rx * dz + rz * dx
    return last to (if (abs(along) > abs(across)) FloorPoint(dx, dz) else FloorPoint(-dz, dx))
  }

  private fun walls(line: Polyline): List<Pair<FloorPoint, FloorPoint>> {
    val pts = line.points
    val out = (0 until pts.size - 1).map { pts[it] to pts[it + 1] }
    return if (line.closed && pts.size > 2) out + (pts.last() to pts[0]) else out
  }

  private fun closestOnSegment(p: FloorPoint, a: FloorPoint, b: FloorPoint): FloorPoint {
    val ex = b.x - a.x; val ez = b.z - a.z
    val l2 = ex * ex + ez * ez
    if (l2 < 1e-6f) return a
    val s = (((p.x - a.x) * ex + (p.z - a.z) * ez) / l2).coerceIn(0f, 1f)
    return FloorPoint(a.x + ex * s, a.z + ez * s)
  }

  /** Where the line o + d·t crosses the wall a–b, or null (parallel, or outside the wall). */
  private fun crossLine(o: FloorPoint, d: FloorPoint, a: FloorPoint, b: FloorPoint): FloorPoint? {
    val ex = b.x - a.x; val ez = b.z - a.z
    val len = hypot(ex, ez)
    val denom = d.x * ez - d.z * ex
    if (len < 1e-3f || abs(denom) < 0.1f * len) return null // Nearly parallel.
    val wx = a.x - o.x; val wz = a.z - o.z
    val s = (wx * d.z - wz * d.x) / denom
    if (s !in 0f..1f) return null
    return FloorPoint(a.x + ex * s, a.z + ez * s)
  }

  private fun dist(a: FloorPoint, b: FloorPoint) = hypot(a.x - b.x, a.z - b.z)

  /** Object mode: the first real surface on the center ray (depth, feature point or plane), in world space. */
  private fun hitObject(frame: Frame): FloatArray? {
    for (hit in frame.hitTest(surfaceView.width / 2f, surfaceView.height / 2f)) {
      if (hit.distance !in 0.15f..8f) continue
      val ok = when (val t = hit.trackable) {
        is DepthPoint, is Point -> true
        is Plane -> t.isPoseInPolygon(hit.hitPose)
        else -> false
      }
      if (!ok) continue
      val p = hit.hitPose
      return floatArrayOf(p.tx(), p.ty(), p.tz())
    }
    return null
  }

  private fun publish(state: TrackingState, reason: String, cam: FloorPoint?, heading: Double?) {
    val now = SystemClock.uptimeMillis()
    val obj = objectHit
    val key = "$state|$reason|${floorY != null}|${reticle != null}|${obj != null}"
    if (key == lastStatusKey && now - lastStatusAt < 150) return
    lastStatusKey = key
    lastStatusAt = now
    val payload = mutableMapOf<String, Any>(
      "tracking" to state.name.lowercase(),
      "reason" to reason.lowercase(),
      "floorFound" to (floorY != null),
      "aimingAtFloor" to (reticle != null),
      "aimingAtObject" to (obj != null),
      "closesShape" to closesShape,
    )
    cam?.let { payload["camera"] = mapOf("x" to it.x, "z" to it.z) }
    heading?.let { payload["heading"] = it }
    val target = obj?.let { FloorPoint(it[0], it[2]) } ?: (if (snapEnabled) snapped else reticle)
    target?.let { payload["reticle"] = mapOf("x" to it.x, "z" to it.z) }
    post { onStatus(payload) }
  }

  // ---- Overlay projection ----------------------------------------------------

  /** Everything the overlay needs for one frame, already in screen pixels. */
  class Scene(
    val segments: List<Triple<FloatArray, FloatArray, Int>>,
    /** Rubber band from the last corner to the reticle (dashed), and its length ("2.4 m"). */
    val band: Pair<FloatArray, FloatArray>?,
    val bandLabel: String?,
    val corners: List<Pair<FloatArray, Int>>,
    val markers: List<ScreenMarker>,
    /** Dots of the floor grid, with their size factor (bigger when closer). */
    val floorDots: List<FloatArray>,
    /** Where a tap lands on the floor (snapped or not): the reticle ring. */
    val target: FloatArray?,
    val targetCloses: Boolean,
    /** Which snap moved the target ("ON CORNER"...), shown as a chip near it. */
    val chip: String?,
    /** The center ray has something to aim at: bright crosshair, else dimmed. */
    val aimed: Boolean,
    /** Object mode: the point aimed at, its plumb line to the floor, and the ring where it lands. */
    val objectMark: FloatArray?,
    val plumb: Pair<FloatArray, FloatArray>?,
    val landing: List<FloatArray>?,
    val landingCenter: FloatArray?,
    val arrows: List<EdgeArrow>,
    /** Ripple where the last point was placed: its ring on the floor, and how far it has faded (0..1). */
    val pulseRing: List<FloatArray>?,
    val pulseT: Float,
  )

  private fun buildScene(s: Session, cam: com.google.ar.core.Pose): Scene {
    val w = surfaceView.width.toFloat()
    val h = surfaceView.height.toFloat()
    val fy = floorY ?: 0f
    val segs = mutableListOf<Triple<FloatArray, FloatArray, Int>>()
    val corners = mutableListOf<Pair<FloatArray, Int>>()
    var band: Pair<FloatArray, FloatArray>? = null
    var bandLabel: String? = null

    val lines = polylines
    lines.forEachIndexed { i, line ->
      val pts = line.points
      for (k in 0 until pts.size - 1) segment(pts[k], pts[k + 1], fy, w, h)?.let { segs += Triple(it.first, it.second, line.color) }
      if (line.closed && pts.size > 2) segment(pts.last(), pts[0], fy, w, h)?.let { segs += Triple(it.first, it.second, line.color) }
      pts.forEach { p -> project(p.x, fy, p.z, w, h)?.let { corners += it to line.color } }
      val target = snapped
      if (i == activeIndex && target != null && pts.isNotEmpty()) {
        band = segment(pts.last(), target, fy, w, h)
        val len = dist(pts.last(), target)
        if (len >= 0.15f) bandLabel = String.format(java.util.Locale.US, "%.1f m", len)
      }
    }
    val arrows = mutableListOf<EdgeArrow>()
    val shown = mutableListOf<ScreenMarker>()
    val margin = 36 * resources.displayMetrics.density
    markers.forEach { m ->
      val sp = project(m.p.x, fy, m.p.z, w, h)
      val onScreen = sp != null && sp[0] in margin..(w - margin) && sp[1] in margin..(h - margin)
      if (onScreen || !m.edge) {
        sp?.let { shown += ScreenMarker(it[0], it[1], m.color, m.label, m.kind) }
      } else {
        edgeArrow(m, fy, w, h, margin)?.let { arrows += it }
      }
    }

    // A faint dot grid on the detected floor, as feedback that the floor is found.
    val dots = mutableListOf<FloatArray>()
    for (plane in s.getAllTrackables(Plane::class.java)) {
      if (plane.trackingState != TrackingState.TRACKING || plane.subsumedBy != null) continue
      if (plane.type != Plane.Type.HORIZONTAL_UPWARD_FACING) continue
      if (floorY != null && abs(plane.centerPose.ty() - fy) > 0.1f) continue
      val poly = plane.polygon
      val world = mutableListOf<FloorPoint>()
      var i = 0
      while (i + 1 < poly.limit()) {
        val p = plane.centerPose.transformPoint(floatArrayOf(poly.get(i), 0f, poly.get(i + 1)))
        world += FloorPoint(p[0], p[2])
        i += 2
      }
      if (world.size < 3) continue
      val minX = world.minOf { it.x }; val maxX = world.maxOf { it.x }
      val minZ = world.minOf { it.z }; val maxZ = world.maxOf { it.z }
      var gx = Math.floor((minX / GRID_M).toDouble()).toFloat() * GRID_M
      while (gx <= maxX && dots.size < 600) {
        var gz = Math.floor((minZ / GRID_M).toDouble()).toFloat() * GRID_M
        while (gz <= maxZ && dots.size < 600) {
          val d = hypot(gx - cam.tx(), gz - cam.tz())
          if (d < 4.5f && inside(gx, gz, world)) {
            project(gx, fy, gz, w, h)?.let { dots += floatArrayOf(it[0], it[1], (2.2f - d * 0.3f).coerceIn(0.8f, 2f)) }
          }
          gz += GRID_M
        }
        gx += GRID_M
      }
    }

    // Object mode: show the point hit, then drop it to the floor where the light lands on the map.
    val obj = if (aimMode == AIM_OBJECT) objectHit else null
    var plumb: Pair<FloatArray, FloatArray>? = null
    var landing: List<FloatArray>? = null
    var landingCenter: FloatArray? = null
    val realFloor = floorY
    if (obj != null && realFloor != null) {
      if (obj[1] - realFloor > 0.08f) plumb = segment3(obj, floatArrayOf(obj[0], realFloor, obj[2]), w, h)
      val ring = (0..32).map { k ->
        val a = k / 32f * 2f * Math.PI.toFloat()
        project(obj[0] + cos(a) * LANDING_RING_M, realFloor, obj[2] + sin(a) * LANDING_RING_M, w, h)
      }
      if (ring.all { it != null }) landing = ring.filterNotNull()
      landingCenter = project(obj[0], realFloor, obj[2], w, h)
    }

    // With an object hit, the floor ring replaces the reticle.
    val r = if (obj != null) null else (if (snapEnabled) snapped else null) ?: reticle
    val raw = reticle
    val chip = if (r == null || raw == null || !snapEnabled) null else when (snapKind) {
      "corner" -> "ON CORNER"
      "wall" -> "ON WALL"
      "wallAngle" -> "ON WALL · 90°"
      "angle" -> if (hypot(r.x - raw.x, r.z - raw.z) > 0.02f) "SNAPPED · 90°" else null
      else -> null
    }
    // A ring that grows and fades on the floor where the last point was placed.
    var pulseRing: List<FloatArray>? = null
    var pulseT = 1f
    pulse?.let { (p, at) ->
      pulseT = (SystemClock.uptimeMillis() - at) / PULSE_MS
      if (pulseT < 1f) {
        val rad = 0.08f + pulseT * 0.45f
        val ring = (0..32).map { k ->
          val a = k / 32f * 2f * Math.PI.toFloat()
          project(p.x + cos(a) * rad, fy, p.z + sin(a) * rad, w, h)
        }
        if (ring.all { it != null }) pulseRing = ring.filterNotNull()
      }
    }

    return Scene(
      segs, band, bandLabel, corners, shown, dots,
      r?.let { project(it.x, fy, it.z, w, h) }, closesShape && r != null, chip,
      aimed = r != null || obj != null,
      objectMark = obj?.let { project(it[0], it[1], it[2], w, h) },
      plumb = plumb, landing = landing, landingCenter = landingCenter,
      arrows = arrows,
      pulseRing = pulseRing, pulseT = pulseT,
    )
  }

  private fun inside(x: Float, z: Float, poly: List<FloorPoint>): Boolean {
    var c = false
    var j = poly.size - 1
    for (i in poly.indices) {
      val a = poly[i]; val b = poly[j]
      if ((a.z > z) != (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c
      j = i
    }
    return c
  }

  /** Places an arrow on the screen border, in the direction of an off-screen (or behind) point. */
  private fun edgeArrow(m: Marker, y: Float, w: Float, h: Float, margin: Float): EdgeArrow? {
    val v = FloatArray(4)
    Matrix.multiplyMV(v, 0, viewMatrix, 0, floatArrayOf(m.p.x, y, m.p.z, 1f), 0)
    // View space: x right, y up, -z forward. Screen: x right, y down.
    var dx = v[0]
    var dy = -v[1]
    if (v[2] > 0f && abs(dx) < 1e-3f) dx = 1e-3f // Straight behind: pick a side.
    val len = hypot(dx, dy)
    if (len < 1e-4f) return null
    dx /= len; dy /= len
    val cx = w / 2f; val cy = h / 2f
    val tx = if (abs(dx) > 1e-4f) (cx - margin) / abs(dx) else Float.MAX_VALUE
    val ty = if (abs(dy) > 1e-4f) (cy - margin) / abs(dy) else Float.MAX_VALUE
    val t = minOf(tx, ty)
    return EdgeArrow(cx + dx * t, cy + dy * t, atan2(dy, dx), m.color, m.label)
  }

  private fun project(x: Float, y: Float, z: Float, w: Float, h: Float): FloatArray? {
    val v = floatArrayOf(x, y, z, 1f)
    val out = FloatArray(4)
    Matrix.multiplyMV(out, 0, viewProj, 0, v, 0)
    if (out[3] <= 0.05f) return null
    val nx = out[0] / out[3]
    val ny = out[1] / out[3]
    return floatArrayOf((nx + 1f) / 2f * w, (1f - ny) / 2f * h)
  }

  /** Projects a floor segment, clipping it against the camera's near plane. */
  private fun segment(a: FloorPoint, b: FloorPoint, y: Float, w: Float, h: Float) =
    segment3(floatArrayOf(a.x, y, a.z), floatArrayOf(b.x, y, b.z), w, h)

  /** Projects a 3D segment (world x, y, z), clipping it against the camera's near plane. */
  private fun segment3(a: FloatArray, b: FloatArray, w: Float, h: Float): Pair<FloatArray, FloatArray>? {
    val va = FloatArray(4); val vb = FloatArray(4)
    Matrix.multiplyMV(va, 0, viewMatrix, 0, floatArrayOf(a[0], a[1], a[2], 1f), 0)
    Matrix.multiplyMV(vb, 0, viewMatrix, 0, floatArrayOf(b[0], b[1], b[2], 1f), 0)
    val near = -0.1f
    var pa = va; var pb = vb
    if (pa[2] > near && pb[2] > near) return null
    if (pa[2] > near || pb[2] > near) {
      val t = (near - pa[2]) / (pb[2] - pa[2])
      val clip = FloatArray(4) { i -> pa[i] + (pb[i] - pa[i]) * t }
      clip[3] = 1f
      if (pa[2] > near) pa = clip else pb = clip
    }
    fun toScreen(v: FloatArray): FloatArray? {
      val o = FloatArray(4)
      Matrix.multiplyMV(o, 0, projMatrix, 0, v, 0)
      if (o[3] <= 0f) return null
      return floatArrayOf((o[0] / o[3] + 1f) / 2f * w, (1f - o[1] / o[3]) / 2f * h)
    }
    val sa = toScreen(pa) ?: return null
    val sb = toScreen(pb) ?: return null
    return sa to sb
  }

  // ---- Overlay view ----------------------------------------------------------

  /** Draws the scene in the Nocturne look: ivory hairlines, diamond corners, jewel lights. */
  private class OverlayView(context: Context) : View(context) {
    private var scene: Scene? = null
    private val dp = context.resources.displayMetrics.density
    private val ink = Color.rgb(0xF3, 0xE3, 0xC3)
    private val champagne = Color.rgb(0xE9, 0xCF, 0x9F)
    private val ground = Color.rgb(0x05, 0x05, 0x06)
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 2 * dp; strokeCap = Paint.Cap.ROUND }
    private val band = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE; strokeWidth = 1.2f * dp; color = ink
      pathEffect = android.graphics.DashPathEffect(floatArrayOf(3 * dp, 6 * dp), 0f)
    }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; color = Color.argb(105, 0xF3, 0xE3, 0xC3) }
    private val number = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = ink; textSize = 15 * dp; typeface = android.graphics.Typeface.create("sans-serif-light", android.graphics.Typeface.NORMAL)
      setShadowLayer(4 * dp, 0f, 0f, Color.argb(200, 0, 0, 0))
    }
    private val pillText = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.rgb(0xF2, 0xE8, 0xD8); textSize = 11 * dp
      typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL)
    }
    /** Fixed crosshair at the screen center, where the ray is cast from. A dark halo keeps it readable on white walls. */
    private val cross = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE; strokeWidth = 1.5f * dp; strokeCap = Paint.Cap.ROUND
      setShadowLayer(3 * dp, 0f, 0f, Color.argb(150, 0, 0, 0))
    }
    /** Thin dashed lines: center → snapped target, and the plumb line from a light to the floor. */
    private val dashed = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE; strokeWidth = 1 * dp
      pathEffect = android.graphics.DashPathEffect(floatArrayOf(2 * dp, 4 * dp), 0f)
    }
    private val chipText = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = champagne; textSize = 9.5f * dp; letterSpacing = 0.2f
      typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL)
    }

    fun update(s: Scene?) { scene = s; invalidate() }

    private fun pill(cx: Float, top: Float, text: String, paint: Paint, border: Int, leftAligned: Boolean = false) {
      val tw = paint.measureText(text)
      val padX = 10 * dp
      val hgt = 24 * dp
      val left = if (leftAligned) cx else cx - tw / 2 - padX
      val rect = android.graphics.RectF(left, top, left + tw + padX * 2, top + hgt)
      fill.color = Color.argb(205, 5, 5, 6)
      canvas?.drawRoundRect(rect, hgt / 2, hgt / 2, fill)
      stroke.color = border; stroke.strokeWidth = 1 * dp
      canvas?.drawRoundRect(rect, hgt / 2, hgt / 2, stroke)
      canvas?.drawText(text, rect.left + padX, rect.centerY() - (paint.descent() + paint.ascent()) / 2, paint)
    }

    private var canvas: Canvas? = null

    override fun onDraw(c: Canvas) {
      val cx = width / 2f
      val cy = height / 2f
      val s = scene ?: return crosshair(c, cx, cy, false)
      canvas = c
      s.floorDots.forEach { d -> c.drawCircle(d[0], d[1], d[2] * dp * 0.7f, dot) }

      s.segments.forEach { (a, b, col) ->
        line.color = col
        line.setShadowLayer(5 * dp, 0f, 0f, col)
        c.drawLine(a[0], a[1], b[0], b[1], line)
      }
      line.clearShadowLayer()
      s.band?.let { (a, b) ->
        c.drawLine(a[0], a[1], b[0], b[1], band)
        s.bandLabel?.let { label -> pill((a[0] + b[0]) / 2f, (a[1] + b[1]) / 2f - 12 * dp, label, chipText, Color.argb(115, 0xE9, 0xCF, 0x9F)) }
      }
      s.pulseRing?.let { ring ->
        val path = Path()
        ring.forEachIndexed { i, p -> if (i == 0) path.moveTo(p[0], p[1]) else path.lineTo(p[0], p[1]) }
        val alpha = ((1f - s.pulseT) * 255).toInt().coerceIn(0, 255)
        stroke.color = Color.argb(alpha, 0xE9, 0xCF, 0x9F); stroke.strokeWidth = 2.5f * dp
        stroke.setShadowLayer(8 * dp, 0f, 0f, Color.argb(alpha, 0xE9, 0xCF, 0x9F))
        c.drawPath(path, stroke)
        stroke.clearShadowLayer()
      }
      // Outline corners: diamonds with a soft glow, so corners to snap to are easy to spot.
      s.corners.forEach { (p, col) -> diamond(c, p[0], p[1], 5.5f * dp, col, glow = true) }

      s.markers.forEach { m ->
        if (m.kind == "corner") {
          diamond(c, m.x, m.y, 6 * dp, m.color)
          m.label?.let { c.drawText(it, m.x + 11 * dp, m.y - 9 * dp, number) }
        } else {
          // Jewel: color core, dark gap, ivory ring, glow.
          fill.color = m.color
          fill.setShadowLayer(14 * dp, 0f, 0f, m.color)
          c.drawCircle(m.x, m.y, 5.5f * dp, fill)
          fill.clearShadowLayer()
          stroke.color = ground; stroke.strokeWidth = 2 * dp
          c.drawCircle(m.x, m.y, 6.5f * dp, stroke)
          stroke.color = Color.argb(220, 255, 246, 230); stroke.strokeWidth = 1 * dp
          c.drawCircle(m.x, m.y, 8 * dp, stroke)
          m.label?.let { pill(m.x, m.y + 14 * dp, it, pillText, Color.argb(110, 0xE9, 0xCF, 0x9F)) }
        }
      }

      s.arrows.forEach { a ->
        fill.color = Color.argb(215, 5, 5, 6)
        c.drawCircle(a.x, a.y, 17 * dp, fill)
        stroke.color = a.color; stroke.strokeWidth = 1.2f * dp
        c.drawCircle(a.x, a.y, 17 * dp, stroke)
        val cs = kotlin.math.cos(a.angle); val sn = kotlin.math.sin(a.angle)
        val path = Path()
        path.moveTo(a.x + cs * 9 * dp, a.y + sn * 9 * dp)
        path.lineTo(a.x - cs * 4 * dp - sn * 6 * dp, a.y - sn * 4 * dp + cs * 6 * dp)
        path.lineTo(a.x - cs * 4 * dp + sn * 6 * dp, a.y - sn * 4 * dp - cs * 6 * dp)
        path.close()
        fill.color = a.color
        c.drawPath(path, fill)
        a.label?.let { label ->
          val tw = pillText.measureText(label)
          c.drawText(label, a.x - tw / 2f - cs * 34 * dp, a.y + 4 * dp - sn * 30 * dp, pillText)
        }
      }

      // Object mode: plumb line from the point aimed at down to the ring where it lands on the map.
      s.plumb?.let { (a, b) ->
        dashed.color = champagne
        c.drawLine(a[0], a[1], b[0], b[1], dashed)
      }
      s.landing?.let { ring ->
        val path = Path()
        ring.forEachIndexed { i, p -> if (i == 0) path.moveTo(p[0], p[1]) else path.lineTo(p[0], p[1]) }
        stroke.color = champagne; stroke.strokeWidth = 1.5f * dp
        stroke.setShadowLayer(6 * dp, 0f, 0f, champagne)
        c.drawPath(path, stroke)
        stroke.clearShadowLayer()
      }
      s.landingCenter?.let { p ->
        fill.color = champagne
        c.drawCircle(p[0], p[1], 2.5f * dp, fill)
        pill(p[0], p[1] + 20 * dp, "ON THE MAP", chipText, Color.argb(115, 0xE9, 0xCF, 0x9F))
      }
      s.objectMark?.let { p ->
        fill.color = champagne
        fill.setShadowLayer(10 * dp, 0f, 0f, champagne)
        c.drawCircle(p[0], p[1], 3.5f * dp, fill)
        fill.clearShadowLayer()
        stroke.color = Color.argb(220, 255, 246, 230); stroke.strokeWidth = 1 * dp
        c.drawCircle(p[0], p[1], 6 * dp, stroke)
      }

      s.target?.let { p ->
        val col = if (s.targetCloses) champagne else ink
        // Snapped away from the center: a thin dashed link shows where the corner will land.
        val dx = p[0] - cx; val dy = p[1] - cy
        val d = hypot(dx, dy)
        if (d > 52 * dp) {
          dashed.color = Color.argb(190, 0xF3, 0xE3, 0xC3)
          c.drawLine(cx + dx / d * 18 * dp, cy + dy / d * 18 * dp, p[0] - dx / d * 32 * dp, p[1] - dy / d * 32 * dp, dashed)
        }
        stroke.color = col; stroke.strokeWidth = (if (s.targetCloses) 2f else 1f) * dp
        c.drawCircle(p[0], p[1], 34 * dp, stroke)
        // Under the visor, the ring alone reads as "locked on the floor"; snapped away, it gets its own ticks.
        if (d > 8 * dp) {
          stroke.strokeWidth = 1.5f * dp
          val r0 = 24 * dp; val r1 = 42 * dp
          c.drawLine(p[0], p[1] - r1, p[0], p[1] - r0, stroke)
          c.drawLine(p[0], p[1] + r0, p[0], p[1] + r1, stroke)
          c.drawLine(p[0] - r1, p[1], p[0] - r0, p[1], stroke)
          c.drawLine(p[0] + r0, p[1], p[0] + r1, p[1], stroke)
          fill.color = col
          c.drawCircle(p[0], p[1], 3 * dp, fill)
        }
        if (s.targetCloses) pill(p[0], p[1] + 46 * dp, "CLOSE ROOM", chipText, Color.argb(115, 0xE9, 0xCF, 0x9F))
        else s.chip?.let { pill(p[0] - 112 * dp, p[1] - 58 * dp, it, chipText, Color.argb(115, 0xE9, 0xCF, 0x9F), leftAligned = true) }
      }

      crosshair(c, cx, cy, s.aimed)
      canvas = null
    }

    /**
     * The visor: always drawn at the screen center, where the ray is cast from. A ring with
     * four ticks and a center dot; solid when the ray hits something to aim at, dashed and dim
     * when it doesn't (too high, no floor yet).
     */
    private fun crosshair(c: Canvas, x: Float, y: Float, aimed: Boolean) {
      val col = if (aimed) ink else Color.argb(130, 0xF3, 0xE3, 0xC3)
      cross.color = col
      cross.pathEffect = if (aimed) null else visorDash
      c.drawCircle(x, y, 20 * dp, cross)
      cross.pathEffect = null
      val r0 = 12 * dp; val r1 = 28 * dp
      c.drawLine(x, y - r1, x, y - r0, cross)
      c.drawLine(x, y + r0, x, y + r1, cross)
      c.drawLine(x - r1, y, x - r0, y, cross)
      c.drawLine(x + r0, y, x + r1, y, cross)
      fill.color = col
      fill.setShadowLayer(3 * dp, 0f, 0f, Color.argb(150, 0, 0, 0))
      c.drawCircle(x, y, 2 * dp, fill)
      fill.clearShadowLayer()
    }

    private val visorDash = android.graphics.DashPathEffect(floatArrayOf(3 * dp, 5 * dp), 0f)

    private fun diamond(c: Canvas, x: Float, y: Float, r: Float, col: Int, glow: Boolean = false) {
      val path = Path()
      path.moveTo(x, y - r); path.lineTo(x + r, y); path.lineTo(x, y + r); path.lineTo(x - r, y); path.close()
      // Dim outlines (saved rooms) keep dim walls, but their corners stay readable.
      fill.color = if (glow) Color.argb(maxOf(Color.alpha(col), 215), Color.red(col), Color.green(col), Color.blue(col)) else col
      if (glow) fill.setShadowLayer(7 * dp, 0f, 0f, Color.argb(140, Color.red(col), Color.green(col), Color.blue(col)))
      c.drawPath(path, fill)
      fill.clearShadowLayer()
      stroke.color = ground; stroke.strokeWidth = 1.5f * dp
      c.drawPath(path, stroke)
    }
  }
}

private const val CLOSE_RADIUS_M = 0.4f
/** Snap onto a corner of another outline within this distance. */
private const val CORNER_SNAP_M = 0.3f
/** Snap onto a wall of another outline within this distance (1st and 2nd corners). */
private const val WALL_SNAP_M = 0.15f
/** With a right angle, land on a wall it crosses this close to the snapped point. */
private const val WALL_CROSS_M = 0.25f
/** Radius of the ring drawn on the floor below an object aimed at. */
private const val LANDING_RING_M = 0.15f
/** How long the "placed" ripple lasts, in ms. */
private const val PULSE_MS = 700f

private const val AIM_FLOOR = "floor"
private const val AIM_OBJECT = "object"

/** Spacing of the floor dot grid. */
private const val GRID_M = 0.3f

/** Draws the camera image as a full-screen quad (ARCore's standard approach). */
private class BackgroundRenderer {
  var textureId = -1
    private set
  private var program = 0
  private var posAttr = 0
  private var texAttr = 0
  private val quad: FloatBuffer = floatBuffer(floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f))
  private val texCoords: FloatBuffer = floatBuffer(FloatArray(8))

  fun create() {
    val tex = IntArray(1)
    GLES20.glGenTextures(1, tex, 0)
    textureId = tex[0]
    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
    val vs = compile(GLES20.GL_VERTEX_SHADER, """
      attribute vec4 a_Position;
      attribute vec2 a_TexCoord;
      varying vec2 v_TexCoord;
      void main() { gl_Position = a_Position; v_TexCoord = a_TexCoord; }
    """.trimIndent())
    val fs = compile(GLES20.GL_FRAGMENT_SHADER, """
      #extension GL_OES_EGL_image_external : require
      precision mediump float;
      varying vec2 v_TexCoord;
      uniform samplerExternalOES sTexture;
      void main() { gl_FragColor = texture2D(sTexture, v_TexCoord); }
    """.trimIndent())
    program = GLES20.glCreateProgram()
    GLES20.glAttachShader(program, vs)
    GLES20.glAttachShader(program, fs)
    GLES20.glLinkProgram(program)
    posAttr = GLES20.glGetAttribLocation(program, "a_Position")
    texAttr = GLES20.glGetAttribLocation(program, "a_TexCoord")
  }

  fun draw(frame: Frame) {
    if (frame.hasDisplayGeometryChanged()) {
      quad.position(0); texCoords.position(0)
      frame.transformCoordinates2d(Coordinates2d.OPENGL_NORMALIZED_DEVICE_COORDINATES, quad, Coordinates2d.TEXTURE_NORMALIZED, texCoords)
    }
    if (frame.timestamp == 0L) return
    quad.position(0); texCoords.position(0)
    GLES20.glDisable(GLES20.GL_DEPTH_TEST)
    GLES20.glDepthMask(false)
    GLES20.glUseProgram(program)
    GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
    GLES20.glVertexAttribPointer(posAttr, 2, GLES20.GL_FLOAT, false, 0, quad)
    GLES20.glVertexAttribPointer(texAttr, 2, GLES20.GL_FLOAT, false, 0, texCoords)
    GLES20.glEnableVertexAttribArray(posAttr)
    GLES20.glEnableVertexAttribArray(texAttr)
    GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
    GLES20.glDisableVertexAttribArray(posAttr)
    GLES20.glDisableVertexAttribArray(texAttr)
    GLES20.glDepthMask(true)
    GLES20.glEnable(GLES20.GL_DEPTH_TEST)
  }

  private fun compile(type: Int, src: String): Int {
    val s = GLES20.glCreateShader(type)
    GLES20.glShaderSource(s, src)
    GLES20.glCompileShader(s)
    return s
  }

  companion object {
    fun floatBuffer(a: FloatArray): FloatBuffer =
      ByteBuffer.allocateDirect(a.size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().apply { put(a); position(0) }
  }
}
