package io.lechaterrant.huehttp

import android.app.Application
import android.content.Context
import android.os.Build
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * Glim Fresh: a second build of the app (package ID ending in `.fresh`) for testing the first-time
 * setup next to the real one. It may never change the bridge's configuration: every request to
 * the bridge or Hue's cloud goes through [check], which lets through only reads, pairing (a new
 * app key, as any new phone gets) and light state (on, brightness, color, effects, the identify
 * blink). Rooms, groups, scenes, behaviors and names live on the phone (src/lib/hue/sandbox.ts).
 *
 * This is the last line of defence: the JS side never sends a config write in Fresh, but a bug
 * there must not reach the bridge.
 */
object Sandbox {
  private const val TAG = "GlimSandbox"
  private const val PREFS = "huelab_fast"

  /**
   * Whether this process is Glim Fresh. Read from the process name, so it holds in every entry
   * point (app, widgets, tile, alarms) without a context. If the name can't be read at all, it's
   * treated as Fresh: a real app that can't write fails loudly, a sandbox that writes doesn't.
   */
  val on: Boolean by lazy {
    val name = processName()
    val fresh = name == null || name.substringBefore(':').endsWith(".fresh")
    if (fresh) Log.i(TAG, "Sandbox on ($name): bridge configuration is read-only")
    fresh
  }

  private fun processName(): String? = try {
    if (Build.VERSION.SDK_INT >= 28) Application.getProcessName()
    else Class.forName("android.app.ActivityThread").getMethod("currentProcessName").invoke(null) as String?
  } catch (_: Throwable) {
    null
  }

  /** What a light or a room's lights may be told: state only. No `metadata`, `powerup`, `mode`... */
  private val LIGHT_KEYS = setOf(
    "type", "on", "dimming", "dimming_delta", "color", "color_temperature", "color_temperature_delta",
    "dynamics", "alert", "signaling", "gradient", "effects", "effects_v2", "timed_effects", "identify",
  )
  private val GROUP_KEYS = setOf(
    "type", "on", "dimming", "dimming_delta", "color", "color_temperature", "color_temperature_delta",
    "dynamics", "alert", "signaling",
  )
  private val PAIRING_KEYS = setOf("devicetype", "generateclientkey")

  /**
   * Null if the request may go out, else the answer to give instead (403, Hue's error shape).
   * `path` is the URL path (`/clip/v2/resource/light/…`, `/api`) or a CLIP v2 resource path
   * (`light/…`, as the cloud client takes it).
   */
  fun check(path: String, method: String, body: String?): BridgeResponse? {
    if (!on || allowed(path, method.uppercase(), body)) return null
    Log.w(TAG, "Refused $method $path (sandbox: bridge configuration is read-only)")
    val error = JSONObject().put("description", "Glim Fresh is a sandbox: it doesn't change the bridge's configuration ($method $path)")
    val json = JSONObject().put("data", JSONArray()).put("errors", JSONArray().put(error))
    return BridgeResponse(403, json.toString(), "", "")
  }

  private fun allowed(rawPath: String, method: String, body: String?): Boolean {
    if (method == "GET") return true
    val path = rawPath.substringBefore('?').trimEnd('/')
    // Pairing (CLIP v1): asks the bridge for an app key. Adds a key, changes nothing else.
    if (path == "/api") return method == "POST" && keysWithin(body, PAIRING_KEYS)
    if (method != "PUT") return false
    val resource = path.removePrefix("/clip/v2/resource/").trimStart('/').split('/')
    if (resource.size != 2 || resource[1].isEmpty()) return false
    return when (resource[0]) {
      "light" -> keysWithin(body, LIGHT_KEYS)
      "grouped_light" -> keysWithin(body, GROUP_KEYS)
      // The blink that says which device is which (pairing a light to a spot on the map).
      "device" -> keysWithin(body, setOf("identify"))
      else -> false
    }
  }

  private fun keysWithin(body: String?, keys: Set<String>): Boolean {
    if (body.isNullOrBlank()) return false
    return try {
      val json = JSONObject(body)
      json.keys().asSequence().all { it in keys }
    } catch (_: Exception) {
      false
    }
  }

  /**
   * Rooms and groups made in Fresh exist only on the phone, with their own grouped light ids. JS
   * writes which lights each one holds (`sandboxGroups`: {"id": ["lightId", ...]}), and a widget
   * or tile request to one of them becomes one request per light.
   */
  fun expand(context: Context, requests: List<Pair<String, String>>): List<Pair<String, String>> {
    if (!on) return requests
    val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("sandboxGroups", null) ?: return requests
    val groups = try { JSONObject(raw) } catch (_: Exception) { return requests }
    return requests.flatMap { (path, body) ->
      val id = path.removePrefix("grouped_light/")
      val lights = if (path.startsWith("grouped_light/")) groups.optJSONArray(id) else null
      if (lights == null) listOf(path to body)
      else (0 until lights.length()).map { i -> "light/${lights.getString(i)}" to body }
    }
  }

  fun saveGroups(context: Context, json: String?) {
    val e = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
    if (json == null) e.remove("sandboxGroups") else e.putString("sandboxGroups", json)
    e.apply()
  }
}
