package io.lechaterrant.huehttp

import android.content.Context
import android.content.Intent
import android.util.Log
import com.reactnativeandroidwidget.RNWidgetProvider
import java.util.concurrent.Executors

/**
 * Base class for the app's widget providers (wired by plugins/with-fast-widgets.js).
 *
 * Clicks whose action starts with "FAST_" carry a ready-made bridge request in their data
 * (`fastPath`, `fastBody`). We send it right away from native code, which is much quicker
 * than going through WorkManager and starting JS. JS still receives the click to redraw.
 */
open class FastWidgetProvider : RNWidgetProvider() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action ?: ""
    val clickAction = intent.getStringExtra("clickAction") ?: ""
    if (action.startsWith(context.packageName + ".WIDGET") && clickAction.startsWith("FAST_")) {
      val data = intent.getBundleExtra("clickActionData")
      val path = data?.getString("fastPath")
      val body = data?.getString("fastBody")
      val config = FastConfig.load(context)
      if (path != null && body != null && config != null) {
        val pending = goAsync()
        executor.execute {
          try {
            val r = BridgeClient.request(
              url = "https://${config.ip}/clip/v2/resource/$path",
              method = "PUT",
              headers = mapOf("hue-application-key" to config.appKey),
              body = body,
              bridgeId = config.id,
              pin = config.pin,
              timeoutMs = 3000,
            )
            if (r.status >= 400) Log.w(TAG, "Fast action failed: ${r.status} ${r.body}")
          } catch (e: Exception) {
            Log.w(TAG, "Fast action failed", e)
          } finally {
            pending.finish()
          }
        }
      }
    }
    super.onReceive(context, intent)
  }

  companion object {
    private const val TAG = "HueFastWidget"
    private val executor = Executors.newSingleThreadExecutor()
  }
}
