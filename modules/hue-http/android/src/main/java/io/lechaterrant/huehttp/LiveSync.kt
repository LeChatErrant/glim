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

/**
 * Keeps widgets (and the open app) in sync with the bridge, whatever changed the lights: a
 * physical switch, the Hue app, a ritual. A foreground service listens to the bridge's event
 * stream while the screen is on, and redraws the widgets when something changes. With the screen
 * off it disconnects; turning the screen on reconnects and redraws at once (catch-up).
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

  /** Redraws every widget of the app (their JS task fetches the fresh state) and tells the app. */
  fun notifyChange(context: Context) {
    listener?.invoke()
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

  private val redraw = Runnable { LiveSync.notifyChange(this) }

  private val screen = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      when (intent.action) {
        Intent.ACTION_SCREEN_OFF -> {
          screenOn = false
          // Closing the socket does network I/O: not on the main thread.
          conn?.let { c -> Thread { c.disconnect() }.start() }
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
    thread = Thread(::loop, "HueLiveSync").apply { isDaemon = true; start() }
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
      try {
        val c = BridgeClient.openStream(
          url = "https://${config.ip}/eventstream/clip/v2",
          headers = mapOf("hue-application-key" to config.appKey, "Accept" to "text/event-stream"),
          bridgeId = config.id,
          pin = config.pin,
        )
        conn = c
        backoff = MIN_BACKOFF_MS
        c.inputStream.bufferedReader().use { reader ->
          while (alive && screenOn) {
            val line = reader.readLine() ?: break
            // Light state, reachability or the rooms changed: redraw once the burst settles.
            if (line.startsWith("data:") && RELEVANT.containsMatchIn(line)) scheduleRedraw(DEBOUNCE_MS)
          }
        }
      } catch (e: Exception) {
        // Away from home, bridge rebooting, screen turned off mid-read: retry below.
      } finally {
        conn?.disconnect()
        conn = null
      }
      if (alive && screenOn) {
        synchronized(lock) { lock.wait(backoff) }
        backoff = (backoff * 2).coerceAtMost(MAX_BACKOFF_MS)
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
    private const val CHANNEL_ID = "live_sync"
    private const val NOTIFICATION_ID = 7301
    private const val DEBOUNCE_MS = 450L
    private const val MIN_BACKOFF_MS = 2_000L
    private const val MAX_BACKOFF_MS = 60_000L
    private val RELEVANT = Regex("\"type\"\\s*:\\s*\"(light|grouped_light|zigbee_connectivity|room|zone|device)\"")
  }
}

/** Starts live sync after a reboot or an app update (both may start a foreground service). */
class LiveSyncBoot : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) LiveSync.start(context)
  }
}
