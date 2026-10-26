package io.lechaterrant.arscan

import com.google.ar.core.ArCoreApk
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ArScanModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ArScan")

    // "supported" | "supported_not_installed" | "unsupported" | "unknown"
    AsyncFunction("availability") {
      val context = appContext.reactContext ?: return@AsyncFunction "unknown"
      val a = ArCoreApk.getInstance().checkAvailability(context)
      when {
        a == ArCoreApk.Availability.SUPPORTED_INSTALLED -> "supported"
        a.isSupported -> "supported_not_installed"
        a.isUnknown -> "unknown"
        else -> "unsupported"
      }
    }

    View(ArScanView::class) {
      Events("onStatus", "onError")

      // JSON: { polylines: [{ points: [{x,z}], closed, color }], markers: [{ x, z, color, label }] }
      Prop("overlayJson") { view: ArScanView, json: String ->
        view.setOverlay(json)
      }

      Prop("snapEnabled") { view: ArScanView, enabled: Boolean ->
        view.snapEnabled = enabled
      }

      // "floor" (corners) or "object" (lights: point at the light itself, it lands on the floor below).
      Prop("aimMode") { view: ArScanView, mode: String ->
        view.aimMode = mode
      }

      // Current reticle position on the floor (object mode: below the point aimed at), or null.
      AsyncFunction("capture") { view: ArScanView ->
        view.capture()
      }
    }
  }
}
