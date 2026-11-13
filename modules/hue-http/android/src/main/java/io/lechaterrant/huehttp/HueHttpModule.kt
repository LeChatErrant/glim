package io.lechaterrant.huehttp

import android.app.StatusBarManager
import android.content.ComponentName
import android.graphics.drawable.Icon
import android.os.Build
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class RequestOptions : Record {
  @Field val url: String = ""
  @Field val method: String = "GET"
  @Field val headers: Map<String, String> = emptyMap()
  @Field val body: String? = null
  // Expected certificate CN (the bridge ID, lowercase). Empty during discovery/pairing.
  @Field val bridgeId: String = ""
  // Base64 SHA-256 of the bridge certificate's public key, pinned at pairing. Empty = trust on first use.
  @Field val pin: String = ""
  @Field val timeoutMs: Int = 5000
}

class FastConfigRecord : Record {
  @Field val ip: String = ""
  @Field val id: String = ""
  @Field val appKey: String = ""
  @Field val pin: String = ""
}

class CloudConfigRecord : Record {
  @Field val accessToken: String = ""
  // Epoch milliseconds.
  @Field val expiresAt: Double = 0.0
  @Field val preferCloud: Boolean = false
}

class TileRecord : Record {
  @Field val kind: String = ""
  @Field val icon: String = "home"
  @Field val label: String = ""
  @Field val sub: String = ""
  @Field val lights: List<String> = emptyList()
  // JSON [[path, body], ...].
  @Field val on: String = "[]"
  @Field val off: String = "[]"
}

class FxRecord : Record {
  @Field val kind: String = ""
  @Field val x: Double = 0.0
  @Field val y: Double = 0.0
  @Field val w: Double = 0.0
  @Field val h: Double = 0.0
  @Field val tint: String? = null
}

class WidgetOutsideRecord : Record {
  @Field val widgetId: Int = 0
  @Field val width: Double = 0.0
  @Field val height: Double = 0.0
  @Field val scale: Double = 1.0
  @Field val ground: String? = null
  @Field val over: String? = null
  @Field val low: List<FxRecord> = emptyList()
  @Field val high: List<FxRecord> = emptyList()
}

class HueHttpModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HueHttp")

    // The bridge reported a change (live sync): screens refresh without waiting for their poll.
    Events("onChange")

    OnCreate { LiveSync.listener = { sendEvent("onChange", emptyMap<String, Any>()) } }
    OnDestroy { LiveSync.listener = null }

    AsyncFunction("request") { o: RequestOptions ->
      val r = BridgeClient.request(o.url, o.method, o.headers, o.body, o.bridgeId, o.pin, o.timeoutMs)
      mapOf("status" to r.status, "body" to r.body, "pin" to r.pin, "cn" to r.cn)
    }

    // Lets widget taps reach the bridge from native code, without waiting for JS to start.
    AsyncFunction("setFastConfig") { c: FastConfigRecord? ->
      val context = appContext.reactContext ?: return@AsyncFunction
      if (c == null) FastConfig.clear(context) else FastConfig.save(context, c.ip, c.id, c.appKey, c.pin)
    }

    // Lets widget taps go through Hue's cloud away from home.
    AsyncFunction("setCloudConfig") { c: CloudConfigRecord? ->
      val context = appContext.reactContext ?: return@AsyncFunction
      FastConfig.saveCloud(context, c?.let { FastConfig.Cloud(it.accessToken, it.expiresAt.toLong(), it.preferCloud) })
    }

    // What the Quick Settings tile does (GlimTile.kt). Null: nothing chosen.
    AsyncFunction("setTileConfig") { t: TileRecord? ->
      val context = appContext.reactContext ?: return@AsyncFunction
      GlimTile.save(context, t?.let { GlimTile.Config(it.kind, it.icon, it.label, it.sub, it.lights, it.on, it.off) })
    }

    // Whether the tile is in the user's Quick Settings (as last seen by the tile itself).
    Function("isTileAdded") {
      appContext.reactContext?.let { GlimTile.added(it) } ?: false
    }

    // Android 13+: the system's "Add tile to Quick Settings?" prompt. Resolves with its result
    // (StatusBarManager.TILE_ADD_REQUEST_RESULT_*: 2 added, 1 already there, 0 declined), or -1
    // where it isn't available.
    AsyncFunction("requestAddTile") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null || Build.VERSION.SDK_INT < 33) {
        promise.resolve(-1)
        return@AsyncFunction
      }
      val bar = context.getSystemService(StatusBarManager::class.java)
      bar.requestAddTileService(
        ComponentName(context, GlimTileService::class.java),
        "Glim",
        Icon.createWithResource(context, R.drawable.glim_tile_home),
        { it.run() },
      ) { result ->
        if (result == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED || result == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED) GlimTile.setAdded(context, true)
        promise.resolve(result)
      }
    }

    // Live sync of widgets with the bridge (foreground service). Started at app start, while it's allowed.
    AsyncFunction("setWidgetOutside") { r: WidgetOutsideRecord ->
      val context = appContext.reactContext ?: return@AsyncFunction
      val fx = { l: List<FxRecord> -> l.map { WidgetOutside.Fx(it.kind, it.x, it.y, it.w, it.h, it.tint) } }
      WidgetOutside.set(context, r.widgetId, r.ground, r.over, fx(r.low), fx(r.high), r.width, r.height, r.scale)
    }

    AsyncFunction("startLive") {
      appContext.reactContext?.let { LiveSync.start(it) }
    }

    AsyncFunction("setLiveEnabled") { on: Boolean ->
      appContext.reactContext?.let { LiveSync.setEnabled(it, on) }
    }

    Function("isLiveEnabled") {
      appContext.reactContext?.let { LiveSync.enabled(it) } ?: false
    }
  }
}
