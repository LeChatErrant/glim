package io.lechaterrant.huehttp

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

class WidgetFramesRecord : Record {
  @Field val widgetId: Int = 0
  @Field val frames: List<String> = emptyList()
  @Field val intervalMs: Int = 100
  @Field val width: Double = 0.0
  @Field val height: Double = 0.0
  @Field val scale: Double = 1.0
  /** Lightning: an SVG shown at `flashSteps[i]` opacity for `flashMs` each (none if null). */
  @Field val flash: String? = null
  @Field val flashSteps: List<Double> = emptyList()
  @Field val flashMs: Int = 200
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

    // Live sync of widgets with the bridge (foreground service). Started at app start, while it's allowed.
    AsyncFunction("setWidgetFrames") { r: WidgetFramesRecord ->
      val context = appContext.reactContext ?: return@AsyncFunction
      WidgetFrames.set(context, r.widgetId, r.frames, r.intervalMs, r.width, r.height, r.scale, r.flash, r.flashSteps, r.flashMs)
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
