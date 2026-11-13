package io.lechaterrant.huehttp

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import java.util.concurrent.Executors
import kotlin.math.abs
import org.json.JSONArray
import org.json.JSONObject

/**
 * A night path's auto-off: N minutes after a path is lit (from the app, a widget or the tile), an
 * exact alarm turns its lights off from native code, with the phone locked and no app open. Only
 * the lights that still look as the path left them (on, at about its brightness) go off: one
 * turned up by hand since, or taken by another mood, stays as it is.
 *
 * Pending offs live in `huelab_fast` (one per path, keyed by mood ID), so a reboot can set them
 * again. A bridge timer can't do this: it only recalls a scene, a scene is per room and must list
 * every light of it, and a path crosses rooms.
 */
object PathOff {
  private const val TAG = "GlimPathOff"
  private const val PREFS = "huelab_fast"
  private const val KEY = "pathOffs"
  const val ACTION = "io.lechaterrant.huehttp.PATH_OFF"
  /** Tries again when neither the bridge nor the cloud answers (Wi-Fi waking up). */
  private const val RETRIES = 3

  data class Pending(val key: String, val at: Long, val lights: List<Pair<String, Double>>, val tries: Int)

  private fun all(context: Context): MutableMap<String, Pending> {
    val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return mutableMapOf()
    return try {
      val o = JSONObject(raw)
      o.keys().asSequence().associateWith { k ->
        val p = o.getJSONObject(k)
        val l = p.getJSONArray("lights")
        Pending(k, p.getLong("at"), (0 until l.length()).map { i -> l.getJSONArray(i).let { it.getString(0) to it.getDouble(1) } }, p.optInt("tries"))
      }.toMutableMap()
    } catch (e: Exception) {
      Log.w(TAG, "Bad pending offs", e)
      mutableMapOf()
    }
  }

  private fun save(context: Context, map: Map<String, Pending>) {
    val o = JSONObject()
    for ((k, p) in map) {
      o.put(k, JSONObject().put("at", p.at).put("tries", p.tries).put("lights", JSONArray(p.lights.map { JSONArray().put(it.first).put(it.second) })))
    }
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, o.toString()).apply()
  }

  /** `lights`: JSON [[lightId, brightness], ...], the lights the path lit and how bright. */
  fun schedule(context: Context, key: String, at: Long, lightsJson: String) {
    val lights = try {
      val a = JSONArray(lightsJson)
      (0 until a.length()).map { i -> a.getJSONArray(i).let { it.getString(0) to it.getDouble(1) } }
    } catch (e: Exception) {
      Log.w(TAG, "Bad path lights", e)
      return
    }
    if (lights.isEmpty()) return cancel(context, key)
    val map = all(context)
    map[key] = Pending(key, at, lights, 0)
    save(context, map)
    arm(context, key, at)
    Log.i(TAG, "Path $key off at $at (${lights.size} lights)")
  }

  fun cancel(context: Context, key: String) {
    val map = all(context)
    if (map.remove(key) != null) save(context, map)
    alarms(context).cancel(intent(context, key))
  }

  /** After a reboot or an app update: alarms are gone, the pending offs aren't. */
  fun rearm(context: Context) {
    val now = System.currentTimeMillis()
    for (p in all(context).values) arm(context, p.key, maxOf(p.at, now + 5_000))
  }

  private fun alarms(context: Context) = context.getSystemService(AlarmManager::class.java)

  private fun intent(context: Context, key: String) = PendingIntent.getBroadcast(
    context,
    0,
    Intent(ACTION).setClass(context, PathOffReceiver::class.java).setData(Uri.fromParts("glim-path-off", key, null)),
    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
  )

  private fun arm(context: Context, key: String, at: Long) {
    val am = alarms(context)
    val pi = intent(context, key)
    // Exact and allowed while idle: fires on time in Doze (phone locked on the nightstand), and
    // the system lets the app use the network for a few seconds.
    if (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()) {
      am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    } else {
      am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    }
  }

  /** The alarm went off: turns off the path's lights that still look like the path. Blocking. */
  fun fire(context: Context, key: String) {
    val map = all(context)
    val p = map[key] ?: return
    val now = FastRoute.get(context, "light")
    if (now == null) {
      // No route answered. Try again in a minute, a few times.
      if (p.tries + 1 < RETRIES) {
        map[key] = p.copy(at = System.currentTimeMillis() + 60_000, tries = p.tries + 1)
        save(context, map)
        arm(context, key, map[key]!!.at)
        Log.w(TAG, "Path $key: no answer, trying again")
      } else {
        map.remove(key)
        save(context, map)
        Log.w(TAG, "Path $key: no answer, gave up")
      }
      return
    }
    map.remove(key)
    save(context, map)
    val byId = HashMap<String, JSONObject>()
    for (i in 0 until now.length()) now.getJSONObject(i).let { byId[it.getString("id")] = it }
    val off = p.lights.filter { (id, want) ->
      val l = byId[id] ?: return@filter false
      if (l.optJSONObject("on")?.optBoolean("on") != true) return@filter false
      val b = l.optJSONObject("dimming")?.optDouble("brightness") ?: return@filter true
      abs(b - want) <= 5
    }
    Log.i(TAG, "Path $key: turning off ${off.size} of ${p.lights.size} lights")
    // Never a duration with on: false (Hue dims the light to its minimum on the way out).
    FastRoute.sendAll(context, off.map { (id, _) -> "light/$id" to """{"on":{"on":false}}""" })
  }
}

class PathOffReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != PathOff.ACTION) return
    val key = intent.data?.schemeSpecificPart ?: return
    val pending = goAsync()
    executor.execute {
      try {
        PathOff.fire(context, key)
      } catch (e: Exception) {
        Log.w("GlimPathOff", "Path off failed", e)
      } finally {
        pending.finish()
      }
    }
  }

  companion object {
    private val executor = Executors.newSingleThreadExecutor()
  }
}
