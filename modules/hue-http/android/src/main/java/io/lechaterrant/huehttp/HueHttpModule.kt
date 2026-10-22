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

class HueHttpModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HueHttp")

    AsyncFunction("request") { o: RequestOptions ->
      val r = BridgeClient.request(o.url, o.method, o.headers, o.body, o.bridgeId, o.pin, o.timeoutMs)
      mapOf("status" to r.status, "body" to r.body, "pin" to r.pin, "cn" to r.cn)
    }

    // Lets widget taps reach the bridge from native code, without waiting for JS to start.
    AsyncFunction("setFastConfig") { c: FastConfigRecord? ->
      val context = appContext.reactContext ?: return@AsyncFunction
      if (c == null) FastConfig.clear(context) else FastConfig.save(context, c.ip, c.id, c.appKey, c.pin)
    }
  }
}
