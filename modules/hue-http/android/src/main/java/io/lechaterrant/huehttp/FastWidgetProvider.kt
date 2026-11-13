package io.lechaterrant.huehttp

import android.content.Context
import android.content.Intent
import com.reactnativeandroidwidget.RNWidgetProvider
import java.util.concurrent.Executors

/**
 * Base class for the app's widget providers (wired by plugins/with-fast-widgets.js).
 *
 * Clicks whose action starts with "FAST_" carry ready-made bridge requests in their data: one
 * (`fastPath`, `fastBody`), or several (`fastBatch`, a JSON array of [path, body] pairs: a mood,
 * one request per light). We send them right away from native code (FastRoute), which is much
 * quicker than going through WorkManager and starting JS. JS still receives the click to redraw.
 */
open class FastWidgetProvider : RNWidgetProvider() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action ?: ""
    val clickAction = intent.getStringExtra("clickAction") ?: ""
    if (action.startsWith(context.packageName + ".WIDGET") && clickAction.startsWith("FAST_") && FastConfig.load(context) != null) {
      val data = intent.getBundleExtra("clickActionData")
      val requests = fastRequests(data)
      val sleep = data?.getString("fastSleep")
      val offKey = data?.getString("fastOffKey")
      if (requests.isNotEmpty() || clickAction == "FAST_SLEEP" || clickAction == "FAST_SLEEP_STOP") {
        val pending = goAsync()
        executor.execute {
          try {
            when (clickAction) {
              // Sleep fade now (a Moods widget button), or stop the one running.
              "FAST_SLEEP" -> sleep?.let { GlimSleep.start(context, sleepTargets(it), sleepSeconds(it)) }
              "FAST_SLEEP_STOP" -> GlimSleep.stop(context)
              else -> {
                // A path that turns itself off: the alarm is set even if the lights didn't answer.
                if (!offKey.isNullOrEmpty()) {
                  val min = data?.getString("fastOffMin")?.toDoubleOrNull() ?: 0.0
                  if (min > 0) PathOff.schedule(context, offKey, System.currentTimeMillis() + (min * 60_000).toLong(), data?.getString("fastOffLights") ?: "[]")
                }
                FastRoute.sendAll(context, requests)
              }
            }
          } catch (e: Exception) {
            android.util.Log.w("HueFastRoute", "Fast action failed", e)
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
    private val executor = Executors.newSingleThreadExecutor()

    /** A sleep fade's settings, as JS writes them: {"targets": [...], "fadeSec": 1200}. */
    fun sleepTargets(json: String): List<String> = try {
      org.json.JSONObject(json).getJSONArray("targets").let { a -> (0 until a.length()).map { a.getString(it) } }
    } catch (_: Exception) {
      emptyList()
    }

    fun sleepSeconds(json: String): Int = try {
      org.json.JSONObject(json).optInt("fadeSec", 1200)
    } catch (_: Exception) {
      1200
    }

    /** The bridge requests a tap carries: `fastBatch` ([[path, body], ...]) or `fastPath` + `fastBody`. */
    private fun fastRequests(data: android.os.Bundle?): List<Pair<String, String>> {
      if (data == null) return emptyList()
      data.getString("fastBatch")?.let { return FastRoute.parseBatch(it) }
      val path = data.getString("fastPath") ?: return emptyList()
      val body = data.getString("fastBody") ?: return emptyList()
      return listOf(path to body)
    }
  }
}
