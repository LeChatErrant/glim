package io.lechaterrant.huehttp

import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

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

/**
 * The Hue bridge serves a certificate signed by Signify's private root CA, which
 * Android doesn't trust. We accept it only if its CN is the expected bridge ID and
 * its public key matches the pin recorded at pairing.
 */
private class BridgeTrustManager(private val bridgeId: String, private val pin: String) : X509TrustManager {
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

class HueHttpModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HueHttp")

    AsyncFunction("request") { options: RequestOptions ->
      val trust = BridgeTrustManager(options.bridgeId, options.pin)
      val conn = URL(options.url).openConnection() as HttpURLConnection
      if (conn is HttpsURLConnection) {
        val ssl = SSLContext.getInstance("TLS")
        ssl.init(null, arrayOf(trust), SecureRandom())
        conn.sslSocketFactory = ssl.socketFactory
        // Identity is checked by CN + pin in the trust manager; the URL host is an IP.
        conn.hostnameVerifier = javax.net.ssl.HostnameVerifier { _, _ -> true }
      }
      try {
        conn.requestMethod = options.method
        conn.connectTimeout = options.timeoutMs
        conn.readTimeout = options.timeoutMs
        options.headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
        options.body?.let { body ->
          conn.doOutput = true
          conn.setRequestProperty("Content-Type", "application/json")
          conn.outputStream.use { it.write(body.toByteArray()) }
        }
        val status = conn.responseCode
        val stream = if (status >= 400) conn.errorStream else conn.inputStream
        val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
        mapOf("status" to status, "body" to text, "pin" to trust.seenPin, "cn" to trust.seenCn)
      } finally {
        conn.disconnect()
      }
    }
  }
}
