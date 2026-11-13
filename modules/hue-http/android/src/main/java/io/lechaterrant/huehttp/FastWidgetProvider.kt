package io.lechaterrant.huehttp

import android.content.Context
import android.content.Intent
import android.util.Log
import com.reactnativeandroidwidget.RNWidgetProvider
import java.util.concurrent.Executors
import org.json.JSONArray

/**
 * Base class for the app's widget providers (wired by plugins/with-fast-widgets.js).
 *
 * Clicks whose action starts with "FAST_" carry ready-made bridge requests in their data: one
 * (`fastPath`, `fastBody`), or several (`fastBatch`, a JSON array of [path, body] pairs: a mood,
 * one request per light). We send them right away from native code, which is much quicker than
 * going through WorkManager and starting JS. JS still receives the click to redraw.
 */
open class FastWidgetProvider : RNWidgetProvider() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action ?: ""
    val clickAction = intent.getStringExtra("clickAction") ?: ""
    if (action.startsWith(context.packageName + ".WIDGET") && clickAction.startsWith("FAST_")) {
      val data = intent.getBundleExtra("clickActionData")
      val requests = fastRequests(data)
      val config = FastConfig.load(context)
      if (requests.isNotEmpty() && config != null) {
        val pending = goAsync()
        val cloud = FastConfig.loadCloud(context)
        val local = { path: String, body: String ->
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
        val remote = cloud?.let { c -> { path: String, body: String -> CloudClient.request(path, "PUT", body, c.accessToken, config.appKey) } }
        // Away from home (the app is on the cloud route), Hue's cloud first; otherwise the bridge
        // first, and the cloud only if the bridge doesn't answer.
        val routes = if (remote != null && cloud?.preferCloud == true) listOf(remote, local) else listOfNotNull(local, remote)
        executor.execute {
          try {
            // The first request finds a route that answers; the others take it, side by side
            // (a whole-home mood through the cloud would take seconds one after another).
            val (firstPath, firstBody) = requests.first()
            var route: ((String, String) -> BridgeResponse)? = null
            for (send in routes) {
              try {
                val r = send(firstPath, firstBody)
                if (r.status >= 400) Log.w(TAG, "Fast action failed: ${r.status} ${r.body}")
                route = send
                break
              } catch (e: Exception) {
                Log.w(TAG, "Fast action: no answer", e)
              }
            }
            val send = route
            if (send != null && requests.size > 1) {
              requests.drop(1).map { (path, body) ->
                batchPool.submit {
                  try {
                    val r = send(path, body)
                    if (r.status >= 400) Log.w(TAG, "Fast action failed: ${r.status} ${r.body}")
                  } catch (e: Exception) {
                    Log.w(TAG, "Fast action: no answer for $path", e)
                  }
                }
              }.forEach { it.get() }
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
    /** Lights of a mood are sent a few at a time: the bridge takes about 10 light changes a second. */
    private val batchPool = Executors.newFixedThreadPool(4)

    /** The bridge requests a tap carries: `fastBatch` ([[path, body], ...]) or `fastPath` + `fastBody`. */
    private fun fastRequests(data: android.os.Bundle?): List<Pair<String, String>> {
      if (data == null) return emptyList()
      data.getString("fastBatch")?.let { raw ->
        return try {
          val list = JSONArray(raw)
          (0 until list.length()).map { i -> list.getJSONArray(i).let { it.getString(0) to it.getString(1) } }
        } catch (e: Exception) {
          Log.w(TAG, "Bad fastBatch", e)
          emptyList()
        }
      }
      val path = data.getString("fastPath") ?: return emptyList()
      val body = data.getString("fastBody") ?: return emptyList()
      return listOf(path to body)
    }
  }
}
