package io.lechaterrant.huehttp

import android.content.Context
import android.os.Build
import android.util.Log
import java.util.Calendar
import org.json.JSONArray
import org.json.JSONObject

/**
 * "Sleep fade now" from a widget button or the Quick Settings tile, without JS: the same bridge
 * requests as the Rituals tab's "Start now" (src/lib/rituals/sleepNow.ts). The bridge runs Hue's
 * go-to-sleep behavior "Glim sleep now", set for the coming minute; a minute after the fade, the
 * "Glim after sleep" behavior recalls one scene per room or group that puts each light's level
 * back (they'd come back on at ~1% otherwise). JS makes those once and writes their IDs here
 * (`setSleepPool`); a tap only changes them.
 *
 * Also keeps the notes JS and native share about fades stopped by hand: the bridge still says
 * "started" after one is stopped (`sleepStopped`, fade end times), and the level reset that must
 * not run tonight (`sleepPaused`, ritual ID → until, in ms).
 */
object GlimSleep {
  private const val TAG = "GlimSleep"
  private const val PREFS = "huelab_fast"
  const val NOW_NAME = "Glim sleep now"
  private val GTS_SCRIPTS = setOf("7e571ac6-f363-42e1-809a-4cbf6523ed72", "a5624529-bd7e-4bc8-9d2f-9200476f106e")

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /** { now, after, groups: { id: { rtype, scene, lights: [...], dim: [...] } }, afterByRitual: { id: behavior } }. */
  fun savePool(context: Context, json: String?) {
    prefs(context).edit().apply { if (json == null) remove("sleepPool") else putString("sleepPool", json) }.apply()
    GlimTile.refresh(context)
  }

  private fun pool(context: Context): JSONObject? = try {
    prefs(context).getString("sleepPool", null)?.let { JSONObject(it) }
  } catch (_: Exception) {
    null
  }

  fun notes(context: Context, key: String): String? = prefs(context).getString(key, null)

  fun setNotes(context: Context, key: String, value: String) {
    prefs(context).edit().putString(key, value).apply()
  }

  private fun stopped(context: Context): MutableList<String> = try {
    JSONArray(notes(context, "sleepStopped") ?: "[]").let { a -> (0 until a.length()).map { a.getString(it) }.toMutableList() }
  } catch (_: Exception) {
    mutableListOf()
  }

  private fun pause(context: Context, ritualId: String, until: Long) {
    val p = try { JSONObject(notes(context, "sleepPaused") ?: "{}") } catch (_: Exception) { JSONObject() }
    p.put(ritualId, until)
    setNotes(context, "sleepPaused", p.toString())
  }

  /** A bridge time ("2026-11-13T23:41:00", maybe with a zone) in ms, or null. */
  fun parseTime(s: String?): Long? {
    if (s.isNullOrEmpty() || Build.VERSION.SDK_INT < 26) return null
    return try {
      java.time.OffsetDateTime.parse(s).toInstant().toEpochMilli()
    } catch (_: Exception) {
      try {
        java.time.LocalDateTime.parse(s.removeSuffix("Z")).atZone(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli()
      } catch (_: Exception) {
        null
      }
    }
  }

  private fun timeOf(h: Int, m: Int) = JSONObject().put("type", "time").put("time", JSONObject().put("hour", h).put("minute", m))

  private fun groupRef(pool: JSONObject, id: String): JSONObject? {
    val g = pool.optJSONObject("groups")?.optJSONObject(id) ?: return null
    return JSONObject().put("rid", id).put("rtype", g.optString("rtype", "room"))
  }

  private fun strings(a: JSONArray?): List<String> = if (a == null) emptyList() else (0 until a.length()).map { a.getString(it) }

  /**
   * Starts a sleep fade on these rooms or groups, beginning on the coming minute. False when
   * nothing is set up yet (open the app once) or no route answered. Blocking.
   */
  fun start(context: Context, targets: List<String>, fadeSec: Int): Boolean {
    val pool = pool(context) ?: return false
    val nowId = pool.optString("now").ifEmpty { return false }
    val where = JSONArray()
    targets.mapNotNull { groupRef(pool, it) }.forEach { where.put(JSONObject().put("group", it)) }
    if (where.length() == 0) return false
    // Fades start on the minute: the coming one (the bridge works in whole minutes).
    val start = Calendar.getInstance().apply { timeInMillis = System.currentTimeMillis() + 60_000; set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }
    val fade = JSONObject()
      .put("enabled", true)
      .put("configuration", JSONObject()
        .put("end_state", "turn_off")
        .put("fade_out_duration", JSONObject().put("seconds", fadeSec))
        .put("style", "basic")
        .put("when", JSONObject().put("time_point", timeOf(start.get(Calendar.HOUR_OF_DAY), start.get(Calendar.MINUTE))))
        .put("where", where))
    val requests = mutableListOf("behavior_instance/$nowId" to fade.toString())
    // The level reset: each light gets back the level it has now (lights that are off: full).
    val afterId = pool.optString("after")
    if (afterId.isNotEmpty()) {
      val levels = HashMap<String, Double>()
      FastRoute.get(context, "light")?.let { list ->
        for (i in 0 until list.length()) {
          val l = list.getJSONObject(i)
          val on = l.optJSONObject("on")?.optBoolean("on") == true
          val b = l.optJSONObject("dimming")?.optDouble("brightness")
          if (on && b != null && b > 0) levels[l.getString("id")] = b
        }
      }
      val what = JSONArray()
      for (t in targets) {
        val g = pool.optJSONObject("groups")?.optJSONObject(t) ?: continue
        val scene = g.optString("scene").ifEmpty { continue }
        val dim = strings(g.optJSONArray("dim")).toSet()
        val actions = JSONArray()
        for (id in strings(g.optJSONArray("lights"))) {
          val action = if (id in dim) JSONObject().put("dimming", JSONObject().put("brightness", (levels[id] ?: 100.0).coerceIn(1.0, 100.0)))
          // A plug has no level; an empty action is refused.
          else JSONObject().put("dynamics", JSONObject().put("duration", 0))
          actions.put(JSONObject().put("target", JSONObject().put("rid", id).put("rtype", "light")).put("action", action))
        }
        requests += "scene/$scene" to JSONObject().put("actions", actions).toString()
        what.put(JSONObject().put("group", groupRef(pool, t)).put("recall", JSONObject().put("rid", scene).put("rtype", "scene")))
      }
      if (what.length() > 0) {
        val at = Calendar.getInstance().apply { timeInMillis = start.timeInMillis + fadeSec * 1000L + 60_000 + 59_999 }
        val whereAfter = JSONArray()
        for (i in 0 until what.length()) whereAfter.put(JSONObject().put("group", what.getJSONObject(i).getJSONObject("group")))
        requests += "behavior_instance/$afterId" to JSONObject()
          .put("enabled", true)
          .put("configuration", JSONObject()
            .put("when_extended", JSONObject().put("start_at", JSONObject().put("time_point", timeOf(at.get(Calendar.HOUR_OF_DAY), at.get(Calendar.MINUTE)))))
            .put("what", what)
            .put("where", whereAfter))
          .toString()
      }
    }
    Log.i(TAG, "Sleep fade now: ${targets.size} targets, ${fadeSec}s")
    return FastRoute.sendAll(context, requests)
  }

  /** A sleep fade under way (or about to start): when it ends. */
  data class Run(val endsAt: Long, val pending: Boolean)

  /** The sleep fade running now, if any, from the bridge's behaviors. Blocking. */
  fun running(context: Context, list: JSONArray? = FastRoute.get(context, "behavior_instance")): Run? {
    list ?: return null
    val stopped = stopped(context).toSet()
    val now = System.currentTimeMillis()
    var pending: Run? = null
    for (i in 0 until list.length()) {
      val b = list.getJSONObject(i)
      if (b.optString("script_id") !in GTS_SCRIPTS) continue
      val state = b.optJSONObject("state")
      val endRaw = state?.optString("fade_end_time")
      val end = parseTime(endRaw)
      val started = state?.optString("gts_state") == "started"
      if (started && end != null && end > now && endRaw !in stopped) return Run(end, false)
      // "Now" before its minute comes: the bridge says "stopped" (or still "started" from a fade stopped by hand).
      if (b.optJSONObject("metadata")?.optString("name") == NOW_NAME && b.optBoolean("enabled")) {
        val c = b.optJSONObject("configuration") ?: continue
        val t = c.optJSONObject("when")?.optJSONObject("time_point")?.optJSONObject("time") ?: continue
        val at = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY, t.optInt("hour")); set(Calendar.MINUTE, t.optInt("minute")); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }.timeInMillis
        val fade = c.optJSONObject("fade_out_duration")?.optLong("seconds") ?: 1800
        if (at > now - 60_000 && at < now + 120_000) pending = Run(at + fade * 1000, true)
      }
    }
    return pending
  }

  /**
   * Stops every sleep fade running or about to start, and keeps the lights where they are (as
   * `stopSleepNow` in src/lib/rituals/rituals.ts): switching a behavior off doesn't stop a fade
   * under way, setting each light's level does. Blocking.
   */
  fun stop(context: Context): Boolean {
    val pool = pool(context) ?: JSONObject()
    val list = FastRoute.get(context, "behavior_instance") ?: return false
    val now = System.currentTimeMillis()
    val stopped = stopped(context)
    val fadingGroups = HashSet<String>()
    val sequence = mutableListOf<Pair<String, String>>()
    val off = """{"enabled":false}"""
    for (i in 0 until list.length()) {
      val b = list.getJSONObject(i)
      if (b.optString("script_id") !in GTS_SCRIPTS) continue
      val state = b.optJSONObject("state")
      val endRaw = state?.optString("fade_end_time")?.ifEmpty { null }
      val end = parseTime(endRaw)
      val started = state?.optString("gts_state") == "started"
      val isNow = b.optJSONObject("metadata")?.optString("name") == NOW_NAME
      if (started && end != null && end > now && endRaw !in stopped) {
        val where = b.optJSONObject("configuration")?.optJSONArray("where")
        if (where != null) for (j in 0 until where.length()) where.getJSONObject(j).optJSONObject("group")?.optString("rid")?.let { fadingGroups.add(it) }
      }
      if (endRaw != null && endRaw !in stopped) stopped.add(endRaw)
      if (!(if (isNow) b.optBoolean("enabled") else started)) continue
      // The lights stay where they are: tonight's level reset must not run.
      val until = (end ?: (now + 2 * 3600_000)) + 5 * 60_000
      val id = b.getString("id")
      val after = if (isNow) pool.optString("after") else pool.optJSONObject("afterByRitual")?.optString(id) ?: ""
      if (after.isNotEmpty()) sequence += "behavior_instance/$after" to off
      pause(context, if (isNow) "now" else id, until)
      sequence += "behavior_instance/$id" to off
      // A scheduled fade: off and on again stops tonight's run and keeps the schedule.
      if (!isNow) sequence += "behavior_instance/$id" to """{"enabled":true}"""
    }
    setNotes(context, "sleepStopped", JSONArray(stopped.takeLast(20)).toString())
    // One after the other: a scheduled fade must be switched off before it's switched on again.
    for (r in sequence) FastRoute.sendAll(context, listOf(r))
    if (fadingGroups.isEmpty()) return true
    val ids = HashSet<String>()
    for (g in fadingGroups) ids.addAll(strings(pool.optJSONObject("groups")?.optJSONObject(g)?.optJSONArray("lights")))
    val lights = FastRoute.get(context, "light") ?: return true
    val hold = mutableListOf<Pair<String, String>>()
    for (i in 0 until lights.length()) {
      val l = lights.getJSONObject(i)
      val id = l.getString("id")
      if (id !in ids || l.optJSONObject("on")?.optBoolean("on") != true) continue
      val b = l.optJSONObject("dimming")?.optDouble("brightness") ?: continue
      hold += "light/$id" to JSONObject().put("dimming", JSONObject().put("brightness", maxOf(1.0, b))).toString()
    }
    FastRoute.sendAll(context, hold)
    return true
  }
}
