package io.lechaterrant.huehttp

import android.app.Activity
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.util.Log
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.hypot
import org.json.JSONArray
import org.json.JSONObject

/**
 * What the Quick Settings tile does, written by JS (src/lib/tile.ts) into `huelab_fast` whenever
 * the target, the moods, the map or the lights' capabilities change. Taps never wait for JS.
 */
object GlimTile {
  private const val PREFS = "huelab_fast"

  /**
   * `kind`: room, group, home or mood. `icon`: room, home, mood or sleep. `lights`: the light ids
   * it covers (on/off count). `on` / `off`: [[path, body], ...] to turn it on (apply the mood) or
   * off. A mood is "on" while its lights look like its `on` requests.
   */
  data class Config(val kind: String, val icon: String, val label: String, val sub: String, val lights: List<String>, val on: String, val off: String)

  fun save(context: Context, c: Config?) {
    // JS sends it at every start and refresh: only a real change redraws the tile.
    if (load(context) == c) return
    val e = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
    if (c == null) {
      e.remove("tileKind")
    } else {
      e.putString("tileKind", c.kind).putString("tileIcon", c.icon).putString("tileLabel", c.label).putString("tileSub", c.sub)
        .putString("tileLights", JSONArray(c.lights).toString()).putString("tileOn", c.on).putString("tileOff", c.off)
    }
    // Another target: what the tile shows is from the old one. Forget it, the next look at the
    // bridge fills it. (Same target, new requests, e.g. a mood edited: keep it.)
    if (load(context)?.let { it.kind == c?.kind && it.label == c?.label } != true) e.remove("tileActive").remove("tileState")
    e.apply()
    refresh(context)
  }

  fun load(context: Context): Config? {
    val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val kind = p.getString("tileKind", null) ?: return null
    val lights = try {
      JSONArray(p.getString("tileLights", "[]")).let { a -> (0 until a.length()).map { a.getString(it) } }
    } catch (_: Exception) {
      emptyList()
    }
    return Config(kind, p.getString("tileIcon", "home")!!, p.getString("tileLabel", "Glim")!!, p.getString("tileSub", "")!!, lights, p.getString("tileOn", "[]")!!, p.getString("tileOff", "[]")!!)
  }

  /** Last known state, shown at once when the shade opens: active, and the subtitle. */
  data class Shown(val active: Boolean, val state: String?)

  fun shown(context: Context): Shown? {
    val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (!p.contains("tileActive")) return null
    return Shown(p.getBoolean("tileActive", false), p.getString("tileState", null))
  }

  fun saveShown(context: Context, s: Shown) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("tileActive", s.active).putString("tileState", s.state).apply()
  }

  fun added(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("tileAdded", false)

  fun setAdded(context: Context, on: Boolean) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("tileAdded", on).apply()
  }

  /** Asks the system to let the tile redraw (it calls onStartListening). Cheap: does nothing when the tile isn't added. */
  fun refresh(context: Context) {
    if (!added(context)) return
    try {
      TileService.requestListeningState(context, ComponentName(context, GlimTileService::class.java))
    } catch (e: Exception) {
      Log.w("GlimTile", "Can't refresh the tile", e)
    }
  }

  /**
   * Reads the lights and works out what the tile shows. Null if neither the bridge nor the cloud
   * answered. Blocking.
   */
  fun readState(context: Context, c: Config): Shown? {
    val lights = FastRoute.get(context, "light") ?: return null
    // Unreachable lights report a stale state: leave them out, like the app does.
    val down = HashSet<String>()
    FastRoute.get(context, "zigbee_connectivity")?.let { list ->
      for (i in 0 until list.length()) {
        val z = list.getJSONObject(i)
        if (z.optString("status") != "connected") z.optJSONObject("owner")?.optString("rid")?.let { down.add(it) }
      }
    }
    val byId = HashMap<String, JSONObject>()
    for (i in 0 until lights.length()) {
      val l = lights.getJSONObject(i)
      if ((l.optJSONObject("owner")?.optString("rid") ?: "") !in down) byId[l.getString("id")] = l
    }
    if (c.kind == "mood") {
      val showing = moodShowing(byId, FastRoute.parseBatch(c.on))
      return Shown(showing, null)
    }
    val reachable = c.lights.mapNotNull { byId[it] }
    if (reachable.isEmpty()) return Shown(false, if (c.lights.isEmpty()) "No lights" else "Unreachable")
    val on = reachable.count { it.optJSONObject("on")?.optBoolean("on") == true }
    return Shown(on > 0, if (on == 0) "Off" else if (on == 1) "1 light on" else "$on lights on")
  }

  /**
   * Whether the lights look like the mood: each reachable light it sets is on or off as it says,
   * at about its brightness, color, white or effect (as `isShowing` in src/widgets/moodButtons.ts).
   */
  private fun moodShowing(byId: Map<String, JSONObject>, requests: List<Pair<String, String>>): Boolean {
    var checked = 0
    for ((path, raw) in requests) {
      if (!path.startsWith("light/")) continue
      val l = byId[path.removePrefix("light/")] ?: continue
      val body = try { JSONObject(raw) } catch (_: Exception) { continue }
      checked++
      val wantOn = body.optJSONObject("on")?.optBoolean("on") ?: true
      val isOn = l.optJSONObject("on")?.optBoolean("on") == true
      if (wantOn != isOn) return false
      if (!wantOn) continue
      body.optJSONObject("dimming")?.let { d ->
        val now = l.optJSONObject("dimming")?.optDouble("brightness")
        if (now != null && abs(now - d.optDouble("brightness")) > 4) return false
      }
      val effect = body.optJSONObject("effects_v2")?.optJSONObject("action")?.optString("effect")
      if (!effect.isNullOrEmpty() && effect != "no_effect") {
        if (l.optJSONObject("effects_v2")?.optJSONObject("status")?.optString("effect") != effect) return false
        continue
      }
      body.optJSONObject("color")?.optJSONObject("xy")?.let { want ->
        val now = l.optJSONObject("color")?.optJSONObject("xy") ?: return false
        // A light showing a white (mirek set) isn't showing the color.
        if (l.optJSONObject("color_temperature")?.optBoolean("mirek_valid") == true) return false
        if (hypot(now.optDouble("x") - want.optDouble("x"), now.optDouble("y") - want.optDouble("y")) > 0.03) return false
      }
      body.optJSONObject("color_temperature")?.let { want ->
        val ct = l.optJSONObject("color_temperature") ?: return false
        if (!ct.optBoolean("mirek_valid") || ct.isNull("mirek")) return false
        if (abs(ct.optInt("mirek") - want.optInt("mirek")) > 12) return false
      }
    }
    return checked > 0
  }

  /** Opens the tile's section in Settings (`glim://settings?section=tile`). */
  fun settingsIntent(context: Context): Intent =
    Intent(Intent.ACTION_VIEW, Uri.parse("glim://settings?section=tile")).setPackage(context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}

/**
 * The Quick Settings tile: toggles a room, a group or the whole home, or applies a mood (and turns
 * its lights off when it's showing). Requests go from here, like widget taps (FastRoute).
 * Long-press opens its section in Settings (GlimTilePrefsActivity).
 */
class GlimTileService : TileService() {
  private val main = Handler(Looper.getMainLooper())

  override fun onTileAdded() {
    GlimTile.setAdded(this, true)
  }

  override fun onTileRemoved() {
    GlimTile.setAdded(this, false)
  }

  override fun onStartListening() {
    GlimTile.setAdded(this, true)
    val config = GlimTile.load(this)
    draw(config, GlimTile.shown(this))
    if (config != null && FastConfig.load(this) != null) {
      executor.execute {
        val s = GlimTile.readState(this, config) ?: return@execute
        GlimTile.saveShown(this, s)
        main.post { draw(GlimTile.load(this), s) }
      }
    }
  }

  override fun onClick() {
    val config = GlimTile.load(this)
    if (config == null || FastConfig.load(this) == null) {
      // Nothing chosen yet (or no bridge): the app, to choose.
      open(if (FastConfig.load(this) == null) packageManager.getLaunchIntentForPackage(packageName) else GlimTile.settingsIntent(this))
      return
    }
    val wasActive = GlimTile.shown(this)?.active ?: (qsTile?.state == Tile.STATE_ACTIVE)
    val requests = FastRoute.parseBatch(if (wasActive) config.off else config.on)
    // Shown at once; the bridge's answer corrects it a moment later.
    val guess = GlimTile.Shown(!wasActive, if (config.kind == "mood") null else if (wasActive) "Off" else "On")
    GlimTile.saveShown(this, guess)
    draw(config, guess)
    executor.execute {
      FastRoute.sendAll(this, requests)
      // The bridge reports a room's lights one by one: give it a moment before reading back.
      Thread.sleep(900)
      val s = GlimTile.readState(this, config) ?: return@execute
      GlimTile.saveShown(this, s)
      main.post { draw(GlimTile.load(this), s) }
    }
    LiveSync.start(this)
  }

  private fun draw(config: GlimTile.Config?, shown: GlimTile.Shown?) {
    val tile = qsTile ?: return
    val paired = FastConfig.load(this) != null
    tile.icon = Icon.createWithResource(this, iconFor(config?.icon))
    tile.label = config?.label ?: "Glim"
    val sub = when {
      !paired -> "Not paired"
      config == null -> "Choose in Glim"
      config.kind == "mood" -> config.sub
      else -> shown?.state
    }
    if (Build.VERSION.SDK_INT >= 29) tile.subtitle = sub
    tile.state = if (!paired) Tile.STATE_UNAVAILABLE else if (shown?.active == true) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
    if (Build.VERSION.SDK_INT >= 30) tile.stateDescription = if (shown?.active == true) "On" else "Off"
    tile.updateTile()
  }

  private fun iconFor(name: String?) = when (name) {
    "room" -> R.drawable.glim_tile_room
    "mood" -> R.drawable.glim_tile_mood
    "sleep" -> R.drawable.glim_tile_sleep
    else -> R.drawable.glim_tile_home
  }

  @Suppress("DEPRECATION")
  private fun open(intent: Intent?) {
    if (intent == null) return
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    if (Build.VERSION.SDK_INT >= 34) {
      startActivityAndCollapse(PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    } else {
      startActivityAndCollapse(intent)
    }
  }

  companion object {
    private val executor = Executors.newSingleThreadExecutor()
  }
}

/** Long-press on the tile: Android opens this; it hands over to the app's Settings, tile section. */
class GlimTilePrefsActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    try {
      startActivity(GlimTile.settingsIntent(this))
    } catch (e: Exception) {
      packageManager.getLaunchIntentForPackage(packageName)?.let { startActivity(it) }
    }
    finish()
  }
}
