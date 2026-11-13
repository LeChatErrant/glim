package io.lechaterrant.huehttp

import android.content.Context
import android.content.Intent
import com.reactnativeandroidwidget.RNWidgetProvider
import java.util.concurrent.Executors

/**
 * Base class for the app's widget providers (wired by plugins/with-fast-widgets.js).
 *
 * Clicks whose action starts with "FAST_" carry ready-made bridge requests in their data: one
 * (`fastPath`, `fastBody`), or several (`fastBatch`, a JSON array of [path, body] pairs: a mood,
 * one request per light). We send them right away from native code (FastRoute), which is much
 * quicker than going through WorkManager and starting JS. JS still receives the click to redraw.
 */
open class FastWidgetProvider : RNWidgetProvider() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action ?: ""
    val clickAction = intent.getStringExtra("clickAction") ?: ""
    if (action.startsWith(context.packageName + ".WIDGET") && clickAction.startsWith("FAST_")) {
      val requests = fastRequests(intent.getBundleExtra("clickActionData"))
      if (requests.isNotEmpty() && FastConfig.load(context) != null) {
        val pending = goAsync()
        executor.execute {
          try {
            FastRoute.sendAll(context, requests)
          } finally {
            pending.finish()
          }
        }
      }
    }
    // A widget tap may start the foreground service again if the system stopped it.
    if (action.startsWith(context.packageName + ".WIDGET")) LiveSync.start(context)
    super.onReceive(context, intent)
  }

  companion object {
    private val executor = Executors.newSingleThreadExecutor()

    /** The bridge requests a tap carries: `fastBatch` ([[path, body], ...]) or `fastPath` + `fastBody`. */
    private fun fastRequests(data: android.os.Bundle?): List<Pair<String, String>> {
      if (data == null) return emptyList()
      data.getString("fastBatch")?.let { return FastRoute.parseBatch(it) }
      val path = data.getString("fastPath") ?: return emptyList()
      val body = data.getString("fastBody") ?: return emptyList()
      return listOf(path to body)
    }
  }
}
