package com.varietytech.docuna.nativemodule

import android.app.Activity
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

private const val SCAN_REQUEST_CODE = 0x5CA7

class ScanOptions : Record {
  /** 0 = unlimited. */
  @Field var pageLimit: Int = 0
  @Field var allowGalleryImport: Boolean = true
}

class ScannerUnavailableException(cause: Throwable?) :
  CodedException("ERR_SCANNER_UNAVAILABLE", "The document scanner could not be started", cause)

class ScanInProgressException :
  CodedException("ERR_SCAN_IN_PROGRESS", "A scan is already in progress", null)

class DocunaNativeModule : Module() {
  private var pendingScan: Promise? = null

  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("DocunaNative")

    // The ML Kit scanner needs Google Play services (absent on some devices, e.g. Huawei).
    AsyncFunction("isScannerAvailableAsync") {
      GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
    }

    /**
     * Opens the ML Kit document scanner. Resolves with the scanned page image URIs (JPEG, in the
     * app cache — the caller must move them somewhere permanent) or null if the user cancelled.
     */
    AsyncFunction("scanDocumentAsync") { options: ScanOptions, promise: Promise ->
      if (pendingScan != null) {
        promise.reject(ScanInProgressException())
        return@AsyncFunction
      }
      val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()

      val scannerOptions = GmsDocumentScannerOptions.Builder()
        .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
        .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
        .setGalleryImportAllowed(options.allowGalleryImport)
        .apply { if (options.pageLimit > 0) setPageLimit(options.pageLimit) }
        .build()

      pendingScan = promise
      GmsDocumentScanning.getClient(scannerOptions)
        .getStartScanIntent(activity)
        .addOnSuccessListener { intentSender ->
          try {
            activity.startIntentSenderForResult(intentSender, SCAN_REQUEST_CODE, null, 0, 0, 0)
          } catch (e: Exception) {
            pendingScan = null
            promise.reject(ScannerUnavailableException(e))
          }
        }
        .addOnFailureListener { e ->
          pendingScan = null
          promise.reject(ScannerUnavailableException(e))
        }
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, payload ->
      if (payload.requestCode != SCAN_REQUEST_CODE) return@OnActivityResult
      val promise = pendingScan ?: return@OnActivityResult
      pendingScan = null

      if (payload.resultCode != Activity.RESULT_OK) {
        promise.resolve(null)
        return@OnActivityResult
      }
      val result = GmsDocumentScanningResult.fromActivityResultIntent(payload.data)
      val uris = result?.pages?.map { it.imageUri.toString() } ?: emptyList()
      promise.resolve(mapOf("pageUris" to uris))
    }

    AsyncFunction("getImageInfoAsync") { uri: String ->
      val size = ImageProcessor.orientedSize(context, uri)
      mapOf("width" to size.first, "height" to size.second)
    }

    AsyncFunction("processImageAsync") { options: ProcessImageOptions ->
      val result = ImageProcessor.process(context, options)
      mapOf("uri" to result.uri, "width" to result.width, "height" to result.height)
    }
  }
}
