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
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.view.WindowManager
import com.google.ar.core.ArCoreApk
import com.google.ar.core.Config
import com.google.ar.core.Coordinates2d
import com.google.ar.core.Frame
import com.google.ar.core.Plane
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

data class Marker(val p: FloorPoint, val color: Int, val label: String?)

/**
 * Camera feed + ARCore tracking. Finds the floor (lowest horizontal plane), casts a
 * reticle from the screen center onto it, and draws the JS-provided overlay
 * (room outlines, light markers) projected onto the floor.
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
  @Volatile private var closesShape = false
  @Volatile private var polylines: List<Polyline> = emptyList()
  @Volatile private var markers: List<Marker> = emptyList()
  @Volatile private var activeIndex = -1
  @Volatile var snapEnabled = true

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
    val p = (if (snapEnabled) snapped else null) ?: reticle ?: return null
    val raw = reticle ?: p
    return mapOf("x" to p.x, "z" to p.z, "rawX" to raw.x, "rawZ" to raw.z, "closesShape" to closesShape)
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
      val heading = atan2(dir[0].toDouble(), -dir[2].toDouble())
      publish(TrackingState.TRACKING, "NONE", FloorPoint(origin[0], origin[2]), heading)
      val scene = buildScene(s)
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

  /** Right-angle snapping relative to the last segment of the active outline, and closing. */
  private fun computeSnap(hit: FloorPoint?) {
    closesShape = false
    val line = polylines.getOrNull(activeIndex)
    if (hit == null || line == null || line.points.isEmpty()) { snapped = hit; return }
    val pts = line.points
    val last = pts.last()
    if (pts.size >= 3 && hypot(hit.x - pts[0].x, hit.z - pts[0].z) < 0.3f) {
      closesShape = true
      snapped = pts[0]
      return
    }
    if (pts.size < 2) { snapped = hit; return }
    val prev = pts[pts.size - 2]
    var dx = last.x - prev.x
    var dz = last.z - prev.z
    val len = hypot(dx, dz)
    if (len < 1e-3f) { snapped = hit; return }
    dx /= len; dz /= len
    val rx = hit.x - last.x
    val rz = hit.z - last.z
    val along = rx * dx + rz * dz
    val across = -rx * dz + rz * dx
    snapped = if (abs(along) > abs(across)) FloorPoint(last.x + dx * along, last.z + dz * along)
    else FloorPoint(last.x - dz * across, last.z + dx * across)
  }

  private fun publish(state: TrackingState, reason: String, cam: FloorPoint?, heading: Double?) {
    val now = SystemClock.uptimeMillis()
    val key = "$state|$reason|${floorY != null}|${reticle != null}"
    if (key == lastStatusKey && now - lastStatusAt < 150) return
    lastStatusKey = key
    lastStatusAt = now
    val payload = mutableMapOf<String, Any>(
      "tracking" to state.name.lowercase(),
      "reason" to reason.lowercase(),
      "floorFound" to (floorY != null),
      "aimingAtFloor" to (reticle != null),
      "closesShape" to closesShape,
    )
    cam?.let { payload["camera"] = mapOf("x" to it.x, "z" to it.z) }
    heading?.let { payload["heading"] = it }
    (if (snapEnabled) snapped else reticle)?.let { payload["reticle"] = mapOf("x" to it.x, "z" to it.z) }
    post { onStatus(payload) }
  }

  // ---- Overlay projection ----------------------------------------------------

  /** Everything the overlay needs for one frame, already in screen pixels. */
  class Scene(
    val segments: List<Triple<FloatArray, FloatArray, Int>>,
    val dots: List<Triple<FloatArray, Int, String?>>,
    val planes: List<List<FloatArray>>,
    val reticle: List<FloatArray>?,
    val reticleCloses: Boolean,
  )

  private fun buildScene(s: Session): Scene {
    val w = surfaceView.width.toFloat()
    val h = surfaceView.height.toFloat()
    val fy = floorY ?: 0f
    val segs = mutableListOf<Triple<FloatArray, FloatArray, Int>>()
    val dots = mutableListOf<Triple<FloatArray, Int, String?>>()

    val lines = polylines
    lines.forEachIndexed { i, line ->
      val pts = line.points
      for (k in 0 until pts.size - 1) segment(pts[k], pts[k + 1], fy, w, h)?.let { segs += Triple(it.first, it.second, line.color) }
      if (line.closed && pts.size > 2) segment(pts.last(), pts[0], fy, w, h)?.let { segs += Triple(it.first, it.second, line.color) }
      pts.forEach { p -> project(p.x, fy, p.z, w, h)?.let { dots += Triple(it, line.color, null) } }
      // Rubber band from the last corner to the reticle.
      val target = snapped
      if (i == activeIndex && target != null && pts.isNotEmpty()) {
        segment(pts.last(), target, fy, w, h)?.let { segs += Triple(it.first, it.second, Color.argb(170, 255, 255, 255)) }
      }
    }
    markers.forEach { m -> project(m.p.x, fy, m.p.z, w, h)?.let { dots += Triple(it, m.color, m.label ?: "") } }

    // Faint outlines of detected floor planes, as feedback while scanning.
    val planes = mutableListOf<List<FloatArray>>()
    for (plane in s.getAllTrackables(Plane::class.java)) {
      if (plane.trackingState != TrackingState.TRACKING || plane.subsumedBy != null) continue
      if (plane.type != Plane.Type.HORIZONTAL_UPWARD_FACING) continue
      if (floorY != null && abs(plane.centerPose.ty() - fy) > 0.1f) continue
      val poly = plane.polygon
      val pts = mutableListOf<FloatArray>()
      var i = 0
      while (i + 1 < poly.limit()) {
        val world = plane.centerPose.transformPoint(floatArrayOf(poly.get(i), 0f, poly.get(i + 1)))
        project(world[0], world[1], world[2], w, h)?.let { pts += it }
        i += 2
      }
      if (pts.size > 2) planes += pts
    }

    // Reticle: a circle lying on the floor, so it shows the floor's perspective.
    val r = (if (snapEnabled) snapped else null) ?: reticle
    val ring = r?.let { c ->
      (0..32).mapNotNull { k ->
        val a = (k / 32.0) * 2 * Math.PI
        project(c.x + 0.12f * cos(a).toFloat(), fy, c.z + 0.12f * sin(a).toFloat(), w, h)
      }
    }
    return Scene(segs, dots, planes, ring, closesShape)
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
  private fun segment(a: FloorPoint, b: FloorPoint, y: Float, w: Float, h: Float): Pair<FloatArray, FloatArray>? {
    val va = FloatArray(4); val vb = FloatArray(4)
    Matrix.multiplyMV(va, 0, viewMatrix, 0, floatArrayOf(a.x, y, a.z, 1f), 0)
    Matrix.multiplyMV(vb, 0, viewMatrix, 0, floatArrayOf(b.x, y, b.z, 1f), 0)
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

  private class OverlayView(context: Context) : View(context) {
    private var scene: Scene? = null
    private val density = context.resources.displayMetrics.density
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 3 * density; strokeCap = Paint.Cap.ROUND }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val plane = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; color = Color.argb(40, 255, 255, 255) }
    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 2.5f * density }
    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; textSize = 13 * density; setShadowLayer(4f, 0f, 0f, Color.BLACK) }

    fun update(s: Scene?) { scene = s; invalidate() }

    override fun onDraw(canvas: Canvas) {
      val s = scene ?: return
      s.planes.forEach { pts ->
        val path = Path()
        pts.forEachIndexed { i, p -> if (i == 0) path.moveTo(p[0], p[1]) else path.lineTo(p[0], p[1]) }
        path.close()
        canvas.drawPath(path, plane)
      }
      s.segments.forEach { (a, b, c) -> line.color = c; canvas.drawLine(a[0], a[1], b[0], b[1], line) }
      s.dots.forEach { (p, c, label) ->
        fill.color = c
        val big = label != null
        canvas.drawCircle(p[0], p[1], (if (big) 9 else 5) * density, fill)
        if (!label.isNullOrEmpty()) canvas.drawText(label, p[0] + 12 * density, p[1] + 4 * density, text)
      }
      s.reticle?.let { pts ->
        ring.color = if (s.reticleCloses) Color.rgb(120, 230, 160) else Color.WHITE
        val path = Path()
        pts.forEachIndexed { i, p -> if (i == 0) path.moveTo(p[0], p[1]) else path.lineTo(p[0], p[1]) }
        canvas.drawPath(path, ring)
      }
    }
  }
}

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
