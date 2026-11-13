package io.lechaterrant.huehttp

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.appwidget.AppWidgetManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import java.net.HttpURLConnection
import org.json.JSONArray
import org.json.JSONObject

/**
 * Keeps widgets (and the open app) in sync with the bridge, whatever changed the lights: a
 * physical switch, the Hue app, a ritual. A foreground service listens to the bridge's event
 * stream while the screen is on, and redraws the widgets when something changes. Away from home
 * (the bridge doesn't answer, or the app is on the cloud route) it follows the same events
 * through Hue's cloud. With the screen off it disconnects; turning the screen on reconnects and
 * redraws at once (catch-up).
 */
object LiveSync {
  private const val PREFS = "huelab_fast"
  private const val TAG = "HueLiveSync"

  /** Set by the JS module while the app runs, so its screens refresh at once. */
  @Volatile var listener: (() -> Unit)? = null

  fun enabled(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("live", true)

  fun setEnabled(context: Context, on: Boolean) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("live", on).apply()
    if (on) start(context) else context.stopService(Intent(context, LiveSyncService::class.java))
  }

  /** Starts the service if it should run. Only call from a context allowed to start one (app, widget tap, boot). */
  fun start(context: Context) {
    if (!enabled(context) || FastConfig.load(context) == null || LiveSyncService.running) return
    try {
      val intent = Intent(context, LiveSyncService::class.java)
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
    } catch (e: Exception) {
      // Not allowed from the background on recent Android: the next app start or widget tap retries.
      Log.w(TAG, "Can't start live sync", e)
    }
  }

  /** Redraws every widget of the app (their JS task fetches the fresh state) and the tile, and tells the app. */
  fun notifyChange(context: Context) {
    listener?.invoke()
    // The Quick Settings tile reads the lights again if the shade is open.
    GlimTile.refresh(context)
    val manager = AppWidgetManager.getInstance(context)
    for (info in manager.installedProviders) {
      val provider = info.provider
      if (provider.packageName != context.packageName) continue
      val ids = manager.getAppWidgetIds(provider)
      if (ids.isEmpty()) continue
      context.sendBroadcast(
        Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
          .setComponent(ComponentName(context, provider.className))
          .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
      )
    }
  }
}

class LiveSyncService : Service() {
  private val main = Handler(Looper.getMainLooper())
  private val lock = Object()
  @Volatile private var alive = false
  @Volatile private var screenOn = true
  @Volatile private var conn: HttpURLConnection? = null
  private var thread: Thread? = null
  /** Following the lights through Hue's cloud (away from home) rather than the bridge. */
  @Volatile private var onCloud = false
  /** The route just changed: reconnect at once, without the backoff. */
  @Volatile private var switching = false
  /** Whether Hue's cloud serves the event stream (else a poll), and when it last refused it. */
  @Volatile private var cloudStream = true
  private var streamRefusedAt = 0L
  /** A cloud token Hue refused: wait until the app writes a renewed one. */
  @Volatile private var refusedToken: String? = null
  /** The route of the last connection (true: the cloud), null before the first one. */
  private var lastRoute: Boolean? = null

  private val redraw = Runnable { LiveSync.notifyChange(this) }

  private val screen = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      when (intent.action) {
        Intent.ACTION_SCREEN_OFF -> {
          screenOn = false
          // Closing the socket does network I/O: not on the main thread.
          conn?.let { c -> Thread { c.disconnect() }.start() }
          synchronized(lock) { lock.notifyAll() }
        }
        Intent.ACTION_SCREEN_ON -> {
          screenOn = true
          synchronized(lock) { lock.notifyAll() }
          // Things may have changed while the screen was off.
          scheduleRedraw(0)
        }
      }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    running = true
    alive = true
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= 29) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    screenOn = (getSystemService(Context.POWER_SERVICE) as PowerManager).isInteractive
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_SCREEN_ON)
      addAction(Intent.ACTION_SCREEN_OFF)
    }
    if (Build.VERSION.SDK_INT >= 33) registerReceiver(screen, filter, Context.RECEIVER_NOT_EXPORTED) else registerReceiver(screen, filter)
    onCloud = FastConfig.loadCloud(this)?.preferCloud == true
    thread = Thread(::loop, "HueLiveSync").apply { isDaemon = true; start() }
    Thread(::probeLoop, "HueLiveSyncProbe").apply { isDaemon = true; start() }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int) = START_STICKY

  override fun onDestroy() {
    alive = false
    running = false
    unregisterReceiver(screen)
    main.removeCallbacks(redraw)
    synchronized(lock) { lock.notifyAll() }
    conn?.let { c -> Thread { c.disconnect() }.start() }
    super.onDestroy()
  }

  private fun scheduleRedraw(delayMs: Long) {
    main.removeCallbacks(redraw)
    main.postDelayed(redraw, delayMs)
  }

  private fun loop() {
    var backoff = MIN_BACKOFF_MS
    while (alive) {
      if (!screenOn) {
        synchronized(lock) { if (alive && !screenOn) lock.wait() }
        continue
      }
      val config = FastConfig.load(this)
      if (config == null) {
        stopSelf()
        return
      }
      val cloud = FastConfig.loadCloud(this)
      if (cloud == null) onCloud = false
      val ok = if (onCloud && cloud != null) followCloud(config, cloud) else followBridge(config, cloud != null)
      if (ok) backoff = MIN_BACKOFF_MS
      if (alive && screenOn && !switching) {
        synchronized(lock) { lock.wait(backoff) }
        if (!ok) backoff = (backoff * 2).coerceAtMost(MAX_BACKOFF_MS)
      }
      switching = false
    }
  }

  /**
   * The bridge's own event stream, on the home network. False if it couldn't connect. When it
   * doesn't answer and a Hue account is connected, switches to the cloud (away from home).
   */
  private fun followBridge(config: FastConfig.Config, hasCloud: Boolean): Boolean {
    val c = try {
      BridgeClient.openStream(
        url = "https://${config.ip}/eventstream/clip/v2",
        headers = mapOf("hue-application-key" to config.appKey, "Accept" to "text/event-stream"),
        bridgeId = config.id,
        pin = config.pin,
      )
    } catch (e: Exception) {
      // Away from home, or the bridge is rebooting.
      if (hasCloud && alive && screenOn) {
        Log.i(TAG, "Bridge doesn't answer: following the lights through Hue's cloud")
        onCloud = true
        switching = true
      }
      return false
    }
    // The bridge answers (screen just turned on, or reconnected): have a connection ready for taps.
    Thread { BridgeClient.warm(config) }.start()
    connected(cloud = false)
    read(c)
    return true
  }

  /**
   * Away from home: the bridge's events relayed by Hue's cloud, or, if the cloud refuses the
   * stream, a light poll that redraws only when something changed. Meanwhile the bridge is tried
   * now and then, and live sync goes back to it as soon as it answers.
   */
  private fun followCloud(config: FastConfig.Config, cloud: FastConfig.Cloud): Boolean {
    if (cloud.accessToken == refusedToken) return false
    if (!cloudStream && System.currentTimeMillis() - streamRefusedAt < STREAM_RETRY_MS) return pollCloud(config, cloud)
    val c = try {
      CloudClient.openStream(cloud.accessToken, config.appKey)
    } catch (e: CloudClient.StreamRefused) {
      Log.w(TAG, e.message ?: "Cloud event stream refused")
      when {
        // Token no longer valid: wait for the app to renew it (it writes the new one to prefs).
        e.status == 401 || e.status == 403 -> refusedToken = cloud.accessToken
        e.status == 429 || e.status >= 500 -> {}
        else -> {
          cloudStream = false
          streamRefusedAt = System.currentTimeMillis()
          return pollCloud(config, cloud)
        }
      }
      return false
    } catch (e: Exception) {
      Log.w(TAG, "Cloud event stream: no answer", e)
      return false
    }
    Log.i(TAG, "Following the lights through Hue's cloud (event stream)")
    cloudStream = true
    connected(cloud = true)
    read(c)
    return true
  }

  /** Light state and reachability through the cloud, every few seconds while the screen is on. */
  private fun pollCloud(config: FastConfig.Config, cloud: FastConfig.Cloud): Boolean {
    Log.i(TAG, "Following the lights through Hue's cloud (polling)")
    connected(cloud = true)
    var last: String? = null
    while (alive && screenOn && onCloud && !switching) {
      val now = FastConfig.loadCloud(this) ?: return false
      if (now.accessToken != cloud.accessToken) return true
      val sig = try {
        val lights = CloudClient.request("light", "GET", null, now.accessToken, config.appKey)
        val links = CloudClient.request("zigbee_connectivity", "GET", null, now.accessToken, config.appKey)
        if (lights.status == 401) {
          refusedToken = now.accessToken
          return false
        }
        if (lights.status != 200) null else signature(lights.body, links.body.takeIf { links.status == 200 })
      } catch (e: Exception) {
        null
      }
      if (sig != null) {
        if (last != null && sig != last) scheduleRedraw(DEBOUNCE_MS)
        last = sig
      }
      synchronized(lock) { if (alive && screenOn && onCloud && !switching) lock.wait(POLL_MS) }
    }
    return true
  }

  /** What widgets show of the lights: on, level, color, white, effect, reachability. */
  private fun signature(lights: String, links: String?): String {
    val out = StringBuilder()
    val data = JSONObject(lights).optJSONArray("data") ?: JSONArray()
    for (i in 0 until data.length()) {
      val l = data.getJSONObject(i)
      out.append(l.optString("id")).append(':')
        .append(l.optJSONObject("on")?.optBoolean("on")).append(',')
        .append(l.optJSONObject("dimming")?.optDouble("brightness")).append(',')
        .append(l.optJSONObject("color")?.optJSONObject("xy")?.toString()).append(',')
        .append(l.optJSONObject("color_temperature")?.opt("mirek")).append(',')
        .append(l.optJSONObject("effects_v2")?.optJSONObject("status")?.optString("effect")).append(';')
    }
    links?.let { raw ->
      val list = JSONObject(raw).optJSONArray("data") ?: JSONArray()
      for (i in 0 until list.length()) list.getJSONObject(i).let { out.append(it.optString("id")).append('=').append(it.optString("status")).append(';') }
    }
    return out.toString()
  }

  /** After a change of route (left home, came back), the lights may have changed in between: redraw. */
  private fun connected(cloud: Boolean) {
    if (lastRoute != null && lastRoute != cloud) scheduleRedraw(0)
    lastRoute = cloud
  }

  /** Reads an event stream until it ends, the screen turns off or the route changes. */
  private fun read(c: HttpURLConnection) {
    conn = c
    try {
      c.inputStream.bufferedReader().use { reader ->
        while (alive && screenOn) {
          val line = reader.readLine() ?: break
          // Light state, reachability or the rooms changed: redraw once the burst settles.
          if (line.startsWith("data:") && RELEVANT.containsMatchIn(line)) scheduleRedraw(DEBOUNCE_MS)
        }
      }
    } catch (e: Exception) {
      // Network lost, bridge rebooting, screen turned off or route switched mid-read: the loop retries.
    } finally {
      c.disconnect()
      conn = null
    }
  }

  /** While on the cloud: is the bridge reachable again (back home)? Then go back to it. */
  private fun probeLoop() {
    while (alive) {
      synchronized(lock) { lock.wait(PROBE_MS) }
      if (!alive || !onCloud || !screenOn) continue
      val config = FastConfig.load(this) ?: continue
      val home = try {
        BridgeClient.request(
          url = "https://${config.ip}/clip/v2/resource/bridge",
          headers = mapOf("hue-application-key" to config.appKey),
          bridgeId = config.id,
          pin = config.pin,
          timeoutMs = 1500,
        ).status == 200
      } catch (_: Exception) {
        false
      }
      if (home && onCloud) {
        Log.i(TAG, "Bridge answers again: back to its own event stream")
        onCloud = false
        switching = true
        conn?.disconnect()
        synchronized(lock) { lock.notifyAll() }
      }
    }
  }

  private fun buildNotification(): Notification {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(CHANNEL_ID) == null) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Live widgets", NotificationManager.IMPORTANCE_MIN).apply {
          description = "Keeps your widgets in sync with your lights. You can hide this notification."
          setShowBadge(false)
        }
      )
    }
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE)
    }
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL_ID) else @Suppress("DEPRECATION") Notification.Builder(this)
    return builder
      .setSmallIcon(R.drawable.ic_glim_live)
      .setContentTitle("Widgets stay in sync")
      .setContentText("Following your lights while the screen is on")
      .setContentIntent(open)
      .setOngoing(true)
      .build()
  }

  companion object {
    @Volatile var running = false
      private set
    private const val TAG = "HueLiveSync"
    private const val CHANNEL_ID = "live_sync"
    private const val NOTIFICATION_ID = 7301
    private const val DEBOUNCE_MS = 450L
    private const val MIN_BACKOFF_MS = 2_000L
    private const val MAX_BACKOFF_MS = 60_000L
    /** Away from home: how often the bridge is tried, and the poll's pace if the cloud has no stream. */
    private const val PROBE_MS = 30_000L
    private const val POLL_MS = 15_000L
    /** After the cloud refused the stream, poll this long before asking for it again. */
    private const val STREAM_RETRY_MS = 30 * 60_000L
    private val RELEVANT = Regex("\"type\"\\s*:\\s*\"(light|grouped_light|zigbee_connectivity|room|zone|device)\"")
  }
}

/** Starts live sync after a reboot or an app update (both may start a foreground service). */
class LiveSyncBoot : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
      LiveSync.start(context)
      // A path's auto-off set before the reboot or update: its alarm is gone.
      PathOff.rearm(context)
    }
  }
}
