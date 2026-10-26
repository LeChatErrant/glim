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
        val cloud = FastConfig.loadCloud(context)
        val local = {
          BridgeClient.request(
            url = "https://${config.ip}/clip/v2/resource/$path",
            method = "PUT",
            headers = mapOf("hue-application-key" to config.appKey),
            body = body,
            bridgeId = config.id,
            pin = config.pin,
            timeoutMs = 3000,
          )
        }
        val remote = cloud?.let { c -> { CloudClient.request(path, "PUT", body, c.accessToken, config.appKey) } }
        // Away from home (the app is on the cloud route), Hue's cloud first; otherwise the bridge
        // first, and the cloud only if the bridge doesn't answer.
        val routes = if (remote != null && cloud?.preferCloud == true) listOf(remote, local) else listOfNotNull(local, remote)
        executor.execute {
          try {
            for (send in routes) {
              try {
                val r = send()
                if (r.status >= 400) Log.w(TAG, "Fast action failed: ${r.status} ${r.body}")
                break
              } catch (e: Exception) {
                Log.w(TAG, "Fast action: no answer", e)
              }
            }
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
    private const val TAG = "HueFastWidget"
    private val executor = Executors.newSingleThreadExecutor()
  }
}
