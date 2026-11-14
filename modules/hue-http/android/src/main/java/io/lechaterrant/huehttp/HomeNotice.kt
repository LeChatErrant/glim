package io.lechaterrant.huehttp

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.util.Log
import java.util.concurrent.Executors
import org.json.JSONObject

/**
 * Arriving and leaving home say what they did: one notification, the newest replacing the last
 * ("Welcome home · Relax is on", "You left home · 4 lights off", "Couldn't reach your lights").
 * Its button (Put back, Turn back on, Try again...) carries ready-made bridge requests, sent from
 * here through FastRoute: it works locked, away from home, with the app closed.
 *
 * Two channels, so each can be tuned in Android's settings: what happened (no sound) and
 * problems (sound, pops up): lights left on while away matter more.
 */
object HomeNotice {
  private const val TAG = "GlimHomeNotice"
  const val ACTION = "io.lechaterrant.huehttp.HOME_NOTICE_ACTION"
  private const val ID = 7320
  private const val CHANNEL_RUNS = "home_runs"
  private const val CHANNEL_PROBLEMS = "home_problems"
  /** A notice that worked stays an hour (its button is still useful); problems stay until seen. */
  private const val KEEP_MS = 60 * 60_000L

  /**
   * One button: its title, the requests ([[path, body], ...]) and what the notice says once
   * they're sent. `pathOff`: a path's auto-off to set when it's lit ({key, min, lights}).
   */
  data class Button(val title: String, val batch: String, val done: String, val pathOff: String?)

  fun post(context: Context, title: String, text: String, problem: Boolean, button: Button?) {
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    if (Build.VERSION.SDK_INT >= 26) ensureChannels(manager)
    val channel = if (problem) CHANNEL_PROBLEMS else CHANNEL_RUNS
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, channel) else @Suppress("DEPRECATION") Notification.Builder(context)
    builder
      .setSmallIcon(R.drawable.glim_tile_home)
      .setColor(0xFFE9CF9F.toInt())
      .setContentTitle(title)
      .setContentText(text)
      .setStyle(Notification.BigTextStyle().bigText(text))
      .setContentIntent(open(context))
      .setAutoCancel(true)
      .setShowWhen(true)
      .setWhen(System.currentTimeMillis())
    if (!problem && Build.VERSION.SDK_INT >= 26) builder.setTimeoutAfter(KEEP_MS)
    if (button != null) {
      val intent = Intent(ACTION).setClass(context, HomeNoticeReceiver::class.java)
        .putExtra("title", button.title)
        .putExtra("batch", button.batch)
        .putExtra("done", button.done)
        .putExtra("pathOff", button.pathOff)
      // A new request code each time: a pending intent with the same one would keep old extras.
      val pi = PendingIntent.getBroadcast(context, (System.currentTimeMillis() % Int.MAX_VALUE).toInt(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      builder.addAction(Notification.Action.Builder(Icon.createWithResource(context, R.drawable.glim_tile_home), button.title, pi).build())
    }
    try {
      manager.notify(ID, builder.build())
    } catch (e: SecurityException) {
      // Android 13+ without the notification permission: nothing to show.
      Log.w(TAG, "Notifications not allowed", e)
    }
  }

  private fun ensureChannels(manager: NotificationManager) {
    if (manager.getNotificationChannel(CHANNEL_RUNS) == null) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_RUNS, "Arriving and leaving home", NotificationManager.IMPORTANCE_DEFAULT).apply {
          description = "What Glim did when you got home or left."
          setSound(null, null)
          enableVibration(false)
          setShowBadge(false)
        }
      )
    }
    if (manager.getNotificationChannel(CHANNEL_PROBLEMS) == null) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_PROBLEMS, "Arriving and leaving home: problems", NotificationManager.IMPORTANCE_HIGH).apply {
          description = "When Glim couldn't reach your lights as you got home or left."
          setShowBadge(false)
        }
      )
    }
  }

  /** Tapping the notice opens the Rituals tab (`glim://rituals`; Glim Fresh has `glimfresh://`). */
  private fun open(context: Context): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("${if (Sandbox.on) "glimfresh" else "glim"}://rituals"))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return PendingIntent.getActivity(context, ID, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  /** The button was tapped: sends its requests, then says it's done (or offers to try again). Blocking. */
  fun act(context: Context, intent: Intent) {
    val batch = FastRoute.parseBatch(intent.getStringExtra("batch"))
    intent.getStringExtra("pathOff")?.let { raw ->
      try {
        val p = JSONObject(raw)
        val key = p.optString("key")
        if (key.isNotEmpty() && p.optDouble("min", 0.0) > 0) {
          PathOff.schedule(context, key, System.currentTimeMillis() + (p.optDouble("min") * 60_000).toLong(), p.optJSONArray("lights")?.toString() ?: "[]")
        }
      } catch (e: Exception) {
        Log.w(TAG, "Bad path auto-off", e)
      }
    }
    val sent = FastRoute.sendAll(context, batch)
    Log.i(TAG, "${intent.getStringExtra("title")}: ${if (sent) "sent" else "no answer"} (${batch.size} requests)")
    if (sent) {
      post(context, intent.getStringExtra("done") ?: "Done", "", false, null)
    } else {
      val button = Button(
        intent.getStringExtra("title") ?: "Try again",
        intent.getStringExtra("batch") ?: "[]",
        intent.getStringExtra("done") ?: "Done",
        intent.getStringExtra("pathOff"),
      )
      post(context, "Couldn't reach your lights", "Neither your bridge nor Hue's cloud answered. Try again in a moment.", true, button)
    }
  }
}

class HomeNoticeReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != HomeNotice.ACTION) return
    val pending = goAsync()
    executor.execute {
      try {
        HomeNotice.act(context, intent)
      } catch (e: Exception) {
        Log.w("GlimHomeNotice", "Notice action failed", e)
      } finally {
        pending.finish()
      }
    }
  }

  companion object {
    private val executor = Executors.newSingleThreadExecutor()
  }
}
