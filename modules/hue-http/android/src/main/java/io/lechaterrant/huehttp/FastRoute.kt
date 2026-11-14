package io.lechaterrant.huehttp

import android.content.Context
import android.util.Log
import java.util.concurrent.Executors
import org.json.JSONArray

/** One CLIP v2 request on one route (the bridge or Hue's cloud): path, method, body. */
typealias HueSend = (path: String, method: String, body: String?) -> BridgeResponse

/**
 * Requests from native code without JS (widget taps, the Quick Settings tile): straight to the
 * bridge, or through Hue's cloud when the app is on the cloud route or the bridge doesn't answer.
 * Blocking: call from a background thread.
 */
object FastRoute {
  private const val TAG = "HueFastRoute"
  /** Lights of a mood are sent a few at a time: the bridge takes about 10 light changes a second. */
  private val batchPool = Executors.newFixedThreadPool(4)

  /** The routes to try, in order. Empty when no bridge is paired. */
  fun routes(context: Context): List<HueSend> {
    val config = FastConfig.load(context) ?: return emptyList()
    val cloud = FastConfig.loadCloud(context)
    val local: HueSend = { path, method, body ->
      BridgeClient.request(
        url = "https://${config.ip}/clip/v2/resource/$path",
        method = method,
        headers = mapOf("hue-application-key" to config.appKey),
        body = body,
        bridgeId = config.id,
        pin = config.pin,
        timeoutMs = 3000,
      )
    }
    val remote: HueSend? = cloud?.let { c -> { path, method, body -> CloudClient.request(path, method, body, c.accessToken, config.appKey) } }
    // Away from home (the app is on the cloud route), Hue's cloud first; otherwise the bridge
    // first, and the cloud only if the bridge doesn't answer.
    return if (remote != null && cloud?.preferCloud == true) listOf(remote, local) else listOfNotNull(local, remote)
  }

  /**
   * Sends PUT requests ([path, body] pairs). The first one finds a route that answers; the others
   * take it, side by side (a whole-home mood through the cloud would take seconds one after
   * another). False if no route answered.
   */
  fun sendAll(context: Context, batch: List<Pair<String, String>>): Boolean {
    // Glim Fresh: a room made in the sandbox is one request per light (Sandbox.kt).
    val requests = Sandbox.expand(context, batch)
    if (requests.isEmpty()) return true
    val (firstPath, firstBody) = requests.first()
    var route: HueSend? = null
    for (send in routes(context)) {
      try {
        val r = send(firstPath, "PUT", firstBody)
        if (r.status >= 400) Log.w(TAG, "Fast action failed: ${r.status} ${r.body}")
        route = send
        break
      } catch (e: Exception) {
        Log.w(TAG, "Fast action: no answer", e)
      }
    }
    val send = route ?: return false
    requests.drop(1).map { (path, body) ->
      batchPool.submit {
        try {
          val r = send(path, "PUT", body)
          if (r.status >= 400) Log.w(TAG, "Fast action failed: ${r.status} ${r.body}")
        } catch (e: Exception) {
          Log.w(TAG, "Fast action: no answer for $path", e)
        }
      }
    }.forEach { it.get() }
    return true
  }

  /** GETs a resource list (`light`, `zigbee_connectivity`...): its `data` array, or null if no route answered. */
  fun get(context: Context, path: String): JSONArray? {
    for (send in routes(context)) {
      try {
        val r = send(path, "GET", null)
        if (r.status in 200..299) return org.json.JSONObject(r.body).optJSONArray("data")
        Log.w(TAG, "GET $path: ${r.status}")
      } catch (e: Exception) {
        Log.w(TAG, "GET $path: no answer", e)
      }
    }
    return null
  }

  /** [[path, body], ...] as sent by JS (`fastBatch`, the tile's requests). */
  fun parseBatch(raw: String?): List<Pair<String, String>> {
    if (raw.isNullOrEmpty()) return emptyList()
    return try {
      val list = JSONArray(raw)
      (0 until list.length()).map { i -> list.getJSONArray(i).let { it.getString(0) to it.getString(1) } }
    } catch (e: Exception) {
      Log.w(TAG, "Bad request batch", e)
      emptyList()
    }
  }
}
