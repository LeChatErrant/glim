package io.lechaterrant.huehttp

import android.content.Context
import android.util.Base64
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.X509TrustManager

/**
 * The Hue bridge serves a certificate signed by Signify's private root CA, which
 * Android doesn't trust. We accept it only if its CN is the expected bridge ID and
 * its public key matches the pin recorded at pairing.
 */
class BridgeTrustManager(private val bridgeId: String, private val pin: String) : X509TrustManager {
  @Volatile var seenPin: String = ""
  @Volatile var seenCn: String = ""

  override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {
    throw CertificateException("Client auth not supported")
  }

  override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
    val leaf = chain.firstOrNull() ?: throw CertificateException("Empty chain")
    leaf.checkValidity()
    seenCn = Regex("CN=([^,]+)").find(leaf.subjectX500Principal.name)?.groupValues?.get(1) ?: ""
    seenPin = Base64.encodeToString(
      MessageDigest.getInstance("SHA-256").digest(leaf.publicKey.encoded), Base64.NO_WRAP
    )
    if (bridgeId.isNotEmpty() && !seenCn.equals(bridgeId, ignoreCase = true)) {
      throw CertificateException("Certificate CN $seenCn doesn't match bridge $bridgeId")
    }
    if (pin.isNotEmpty() && pin != seenPin) {
      throw CertificateException("Bridge certificate changed (pin mismatch)")
    }
  }

  override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}

data class BridgeResponse(val status: Int, val body: String, val pin: String, val cn: String)

object BridgeClient {
  // Reusing the socket factory once the pin is known lets TLS sessions and connections be reused.
  private val factories = ConcurrentHashMap<String, Pair<SSLSocketFactory, BridgeTrustManager>>()

  private fun factory(bridgeId: String, pin: String): Pair<SSLSocketFactory, BridgeTrustManager> {
    fun create(): Pair<SSLSocketFactory, BridgeTrustManager> {
      val trust = BridgeTrustManager(bridgeId, pin)
      val ssl = SSLContext.getInstance("TLS")
      ssl.init(null, arrayOf(trust), SecureRandom())
      return ssl.socketFactory to trust
    }
    // Without a pin (discovery, pairing) we need a fresh trust manager to report what we saw.
    if (pin.isEmpty()) return create()
    return factories.getOrPut("$bridgeId|$pin") { create() }
  }

  fun request(
    url: String,
    method: String = "GET",
    headers: Map<String, String> = emptyMap(),
    body: String? = null,
    bridgeId: String = "",
    pin: String = "",
    timeoutMs: Int = 5000,
  ): BridgeResponse {
    val (socketFactory, trust) = factory(bridgeId, pin)
    val conn = URL(url).openConnection() as HttpURLConnection
    if (conn is HttpsURLConnection) {
      conn.sslSocketFactory = socketFactory
      // Identity is checked by CN + pin in the trust manager; the URL host is an IP.
      conn.hostnameVerifier = HostnameVerifier { _, _ -> true }
    }
    try {
      conn.requestMethod = method
      conn.connectTimeout = timeoutMs
      conn.readTimeout = timeoutMs
      headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
      body?.let { b ->
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        conn.outputStream.use { it.write(b.toByteArray()) }
      }
      val status = conn.responseCode
      val stream = if (status >= 400) conn.errorStream else conn.inputStream
      val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
      return BridgeResponse(status, text, trust.seenPin, trust.seenCn)
    } finally {
      conn.disconnect()
    }
  }
}

/** Bridge credentials readable without starting JS, for widget fast actions. */
object FastConfig {
  private const val PREFS = "huelab_fast"

  data class Config(val ip: String, val id: String, val appKey: String, val pin: String)

  fun save(context: Context, ip: String, id: String, appKey: String, pin: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString("ip", ip).putString("id", id).putString("appKey", appKey).putString("pin", pin)
      .apply()
  }

  fun clear(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
  }

  fun load(context: Context): Config? {
    val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val ip = p.getString("ip", null) ?: return null
    return Config(ip, p.getString("id", "")!!, p.getString("appKey", "")!!, p.getString("pin", "")!!)
  }
}
