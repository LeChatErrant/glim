package io.lechaterrant.huehttp

import android.appwidget.AppWidgetManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.net.Uri
import android.util.Log
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
 * A map widget's weather loop: SVG frames rendered to bitmaps and put in the ViewFlipper under
 * the widget's image (the app overrides the widget library's rn_widget.xml to add it). The
 * launcher flips them on its own, so nothing runs here between redraws.
 *
 * The library replaces the whole widget when it draws, which drops the frames: JS sends them
 * right before each draw, and they are applied a moment later as a partial update on top.
 *
 * Bitmaps sent inline would hit the 1 MB binder limit, so frames are PNG files served by the
 * library's image provider, named like its collection images (collection 9, which it never
 * uses): its redraws leave them alone and deleting the widget deletes them.
 */
object WidgetFrames {
  private const val TAG = "GlimFrames"
  /** The library's draw (layout, bitmap, PNG) can take a while: apply after it, then once more. */
  private val AFTER_DRAW_MS = longArrayOf(1200L, 3500L)
  private val executor = Executors.newSingleThreadScheduledExecutor()
  private val generation = ConcurrentHashMap<Int, Int>()
  /** The last frames rendered per widget, so a redraw with the same loop (a tap's second draw,
   * live sync) skips the second or so of rendering. */
  private val rendered = ConcurrentHashMap<Int, Pair<Int, List<String>>>()
  private val random = SecureRandom()
  private const val COLLECTION = 9

  fun set(context: Context, widgetId: Int, frames: List<String>, intervalMs: Int, widthDp: Double, heightDp: Double, scale: Double) {
    val gen = (generation[widgetId] ?: 0) + 1
    generation[widgetId] = gen
    val app = context.applicationContext
    val start = System.currentTimeMillis()
    executor.execute {
      // A newer set of frames for this widget is on its way: skip this one.
      if (generation[widgetId] != gen) return@execute
      try {
        val key = listOf(frames, intervalMs, widthDp, heightDp, scale).hashCode()
        val folder = File(app.filesDir, "widget_images")
        val cached = rendered[widgetId]?.takeIf { (k, names) -> k == key && names.all { File(folder, it).exists() } }?.second
        val names = cached ?: render(app, widgetId, frames, widthDp, heightDp, scale, gen) ?: return@execute
        rendered[widgetId] = key to names
        Log.i(TAG, "widget $widgetId: ${names.size} frames in ${System.currentTimeMillis() - start} ms${if (cached != null) " (same as last)" else ""}")
        for (delay in AFTER_DRAW_MS) {
          val wait = maxOf(0L, start + delay - System.currentTimeMillis())
          executor.schedule({ if (generation[widgetId] == gen) send(app, widgetId, names, intervalMs) }, wait, TimeUnit.MILLISECONDS)
        }
      } catch (e: Throwable) {
        Log.w(TAG, "frames for widget $widgetId failed", e)
      }
    }
  }

  private fun send(context: Context, widgetId: Int, names: List<String>, intervalMs: Int) {
    val pkg = context.packageName
    val views = RemoteViews(pkg, com.reactnativeandroidwidget.R.layout.rn_widget)
    views.removeAllViews(R.id.glim_frames)
    for (name in names) {
      val frame = RemoteViews(pkg, R.layout.glim_widget_frame)
      frame.setImageViewUri(R.id.glim_frame_image, Uri.Builder().scheme("content").authority("$pkg.rnwidget.imageprovider").appendPath(name).build())
      views.addView(R.id.glim_frames, frame)
    }
    views.setInt(R.id.glim_frames, "setFlipInterval", max(16, intervalMs))
    AppWidgetManager.getInstance(context).partiallyUpdateAppWidget(widgetId, views)
  }

  /** Renders the frames to files; null if a newer set came in meanwhile. */
  private fun render(context: Context, widgetId: Int, frames: List<String>, widthDp: Double, heightDp: Double, scale: Double, gen: Int): List<String>? {
    val w = max(1, (widthDp * scale).roundToInt())
    val h = max(1, (heightDp * scale).roundToInt())
    val folder = File(context.filesDir, "widget_images").apply { mkdirs() }
    val prefix = "widget_${widgetId}_mode_light_collection_${COLLECTION}_"
    val old = folder.listFiles { f -> f.name.startsWith(prefix) }.orEmpty()
    val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val names = ArrayList<String>()
    frames.forEachIndexed { i, text ->
      if (generation[widgetId] != gen) return null
      val svg = SVG.getFromString(text)
      svg.setDocumentWidth(w.toFloat())
      svg.setDocumentHeight(h.toFloat())
      bitmap.eraseColor(0)
      svg.renderToCanvas(canvas)
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
