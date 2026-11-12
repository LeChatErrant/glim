package io.lechaterrant.huehttp

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.util.Log
import android.util.TypedValue
import android.widget.RemoteViews
import com.caverock.androidsvg.SVG
import java.io.File
import java.io.FileOutputStream
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * A map widget's outside, in the glim_fx layer under the widget's image (the app overrides the
 * widget library's rn_widget.xml to add it), from the bottom up:
 * - the ground, a still image;
 * - `low` animations: the weather in the garden (rain, snow, fog, clouds, ripples);
 * - `over`, a still image: outdoor floors, the house's rim, the dark all around;
 * - `high` animations: what moves on outdoor areas, fireflies, lightning.
 * Animations are animated vectors in ProgressBars (FxKinds, written by scripts/widget-fx.mjs): the
 * launcher plays them smoothly on its own, nothing runs here between redraws.
 *
 * The library replaces the whole widget when it draws. Views are added as stable views
 * (Android 12+), so a redraw keeps the running animations instead of restarting them; JS sends
 * the outside right before each draw and it is applied a moment later, then once more.
 *
 * Still images are PNG files served by the library's image provider, named like its collection
 * images (collection 9, which it never uses): its redraws leave them alone and deleting the
 * widget deletes them.
 */
object WidgetOutside {
  private const val TAG = "GlimOutside"
  private val AFTER_DRAW_MS = longArrayOf(1200L, 3500L)
  private val executor = Executors.newSingleThreadScheduledExecutor()
  private val generation = ConcurrentHashMap<Int, Int>()
  private val random = SecureRandom()
  private const val COLLECTION = 9

  /** An animation: `kind` (FxKinds), centered at x, y (dp), w × h dp (placed kinds), tinted. */
  data class Fx(val kind: String, val x: Double, val y: Double, val w: Double, val h: Double, val tint: String?)

  /** The still images rendered last per widget, so a redraw with the same outside reuses them. */
  private val rendered = ConcurrentHashMap<Int, Pair<Int, List<String>>>()

  fun set(
    context: Context, widgetId: Int, ground: String?, over: String?, low: List<Fx>, high: List<Fx>,
    widthDp: Double, heightDp: Double, scale: Double,
  ) {
    val gen = (generation[widgetId] ?: 0) + 1
    generation[widgetId] = gen
    val app = context.applicationContext
    val start = System.currentTimeMillis()
    executor.execute {
      if (generation[widgetId] != gen) return@execute
      try {
        val stills = listOfNotNull(ground, over)
        val key = listOf(stills, widthDp, heightDp, scale).hashCode()
        val folder = File(app.filesDir, "widget_images")
        val cached = rendered[widgetId]?.takeIf { (k, names) -> k == key && names.all { File(folder, it).exists() } }?.second
        val names = cached ?: render(app, widgetId, stills, widthDp, heightDp, scale, gen) ?: return@execute
        rendered[widgetId] = key to names
        val groundName = if (ground != null) names.getOrNull(0) else null
        val overName = if (over != null) names.getOrNull(if (ground != null) 1 else 0) else null
        Log.i(TAG, "widget $widgetId: ${names.size} images, ${low.size + high.size} animations in ${System.currentTimeMillis() - start} ms${if (cached != null) " (images as last)" else ""}")
        for (delay in AFTER_DRAW_MS) {
          val wait = maxOf(0L, start + delay - System.currentTimeMillis())
          executor.schedule({
            if (generation[widgetId] == gen) send(app, widgetId, groundName, overName, low, high, widthDp, heightDp)
          }, wait, TimeUnit.MILLISECONDS)
        }
      } catch (e: Throwable) {
        Log.w(TAG, "outside for widget $widgetId failed", e)
      }
    }
  }

  private fun send(context: Context, widgetId: Int, ground: String?, over: String?, low: List<Fx>, high: List<Fx>, widthDp: Double, heightDp: Double) {
    val pkg = context.packageName
    val stable = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    val views = RemoteViews(pkg, com.reactnativeandroidwidget.R.layout.rn_widget)
    views.removeAllViews(R.id.glim_fx)
    // Same stable id (and layout) = the view already shown is kept, its animation running on.
    // Ids change with each install: views kept across an app update stood still.
    val base = install(context) * 10000
    val add = { child: RemoteViews, id: Int ->
      if (stable) views.addStableView(R.id.glim_fx, child, base + id) else views.addView(R.id.glim_fx, child)
    }
    val image = { name: String ->
      RemoteViews(pkg, R.layout.glim_widget_frame).apply {
        setImageViewUri(R.id.glim_frame_image, Uri.Builder().scheme("content").authority("$pkg.rnwidget.imageprovider").appendPath(name).build())
      }
    }
    ground?.let { add(image(it), 1) }
    low.forEachIndexed { i, fx -> fxView(pkg, fx, i, widthDp, heightDp, stable)?.let { add(it, 1000 + i) } }
    over?.let { add(image(it), 2) }
    high.forEachIndexed { i, fx -> fxView(pkg, fx, i, widthDp, heightDp, stable)?.let { add(it, 2000 + i) } }
    AppWidgetManager.getInstance(context).partiallyUpdateAppWidget(widgetId, views)
  }

  private var installId: Int? = null

  /** A number for the installed version of the app (its update time). */
  private fun install(context: Context): Int = installId ?: runCatching {
    val updated = context.packageManager.getPackageInfo(context.packageName, 0).lastUpdateTime
    ((updated / 1000) % 200_000).toInt()
  }.getOrDefault(0).also { installId = it }

  /** `index`: the animation's place in its layer, which picks a placed kind's variant. */
  private fun fxView(pkg: String, fx: Fx, index: Int, widthDp: Double, heightDp: Double, sized: Boolean): RemoteViews? {
    val kind = FxKinds.variants[fx.kind]?.let { "${fx.kind}_${index % it + 1}" } ?: fx.kind
    val (layout, full) = FxKinds.all[kind] ?: return null
    // Placing and sizing views needs Android 12; before that only full fields are shown.
    if (!full && !sized) return null
    val v = RemoteViews(pkg, layout)
    val dip = TypedValue.COMPLEX_UNIT_DIP
    if (sized) {
      // Full fields fill a square as big as the widget's longer side, so they keep their shape.
      val w = if (full) max(widthDp, heightDp) else fx.w
      val h = if (full) max(widthDp, heightDp) else fx.h
      v.setViewLayoutWidth(R.id.glim_fx_view, w.toFloat(), dip)
      v.setViewLayoutHeight(R.id.glim_fx_view, h.toFloat(), dip)
      if (!full) {
        v.setViewLayoutMargin(R.id.glim_fx_view, RemoteViews.MARGIN_LEFT, (fx.x - fx.w / 2).toFloat(), dip)
        v.setViewLayoutMargin(R.id.glim_fx_view, RemoteViews.MARGIN_TOP, (fx.y - fx.h / 2).toFloat(), dip)
      }
      fx.tint?.let { runCatching { Color.parseColor(it) }.getOrNull() }?.let {
        v.setColorStateList(R.id.glim_fx_view, "setIndeterminateTintList", ColorStateList.valueOf(it))
      }
    }
    return v
  }

  /** Renders the still images to files; null if a newer outside came in meanwhile. */
  private fun render(context: Context, widgetId: Int, stills: List<String>, widthDp: Double, heightDp: Double, scale: Double, gen: Int): List<String>? {
    val w = max(1, (widthDp * scale).roundToInt())
    val h = max(1, (heightDp * scale).roundToInt())
    val folder = File(context.filesDir, "widget_images").apply { mkdirs() }
    val prefix = "widget_${widgetId}_mode_light_collection_${COLLECTION}_"
    val old = folder.listFiles { f -> f.name.startsWith(prefix) }.orEmpty()
    val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val names = ArrayList<String>()
    stills.forEachIndexed { i, text ->
      if (generation[widgetId] != gen) return null
      val svg = SVG.getFromString(text)
      svg.setDocumentWidth(w.toFloat())
      svg.setDocumentHeight(h.toFloat())
      bitmap.eraseColor(0)
      svg.renderToCanvas(canvas)
      // The image provider only serves `<prefix><number>_<64 hex>.png`.
      val name = "$prefix${i}_${token()}.png"
      FileOutputStream(File(folder, name)).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
      names.add(name)
    }
    bitmap.recycle()
    // The launcher reads the new files once they're sent; drop the old ones after that.
    executor.schedule({ old.forEach { it.delete() } }, 8, TimeUnit.SECONDS)
    return names
  }

  private fun token(): String {
    val bytes = ByteArray(32).also { random.nextBytes(it) }
    return bytes.joinToString("") { "%02x".format(it) }
  }
}
