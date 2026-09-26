package com.variety_tech.docuna.nativemodule

import android.content.Context
import android.graphics.Bitmap
import android.util.Log
import com.google.android.gms.common.moduleinstall.ModuleInstall
import com.google.android.gms.common.moduleinstall.ModuleInstallRequest
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.common.MlKitException
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.exception.CodedException
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import kotlin.math.min
import kotlin.math.roundToInt

/** The OCR model is delivered by Google Play services and isn't downloaded yet (or Play services is missing). */
class OcrUnavailableException(cause: Throwable?) :
  CodedException("ERR_OCR_UNAVAILABLE", "Text recognition isn't available yet", cause)

class OcrFailedException(cause: Throwable?) :
  CodedException("ERR_OCR_FAILED", "Text recognition failed", cause)

/**
 * On-device OCR with ML Kit Text Recognition v2 (Latin script: English, Swahili, French…).
 * The model comes from Google Play services, so it adds ~260 KB to the APK instead of ~4 MB per ABI.
 * One page at a time; each call decodes, recognises and frees its bitmap before returning.
 */
object OcrEngine {
  private const val TAG = "DocunaOcr"
  /** ~240 DPI for an A4 page: small print stays legible for the recogniser. */
  private const val OCR_DIMENSION = 2400

  private val recognizer: TextRecognizer by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }

  private fun dimension(context: Context) = min(OCR_DIMENSION, ImageProcessor.maxWorkingDimension(context))

  fun recognizeImage(context: Context, uri: String): Map<String, Any> =
    recognize(context, ImageProcessor.decodeOriented(context, uri, dimension(context)))

  fun recognizePdfPage(context: Context, uri: String, pageIndex: Int): Map<String, Any> =
    recognize(context, PdfPageRenderer.renderBitmap(context, uri, pageIndex, dimension(context)))

  /**
   * Play Store installs fetch the model at install time (manifest meta-data). Sideloaded builds, or a
   * cleared Play services cache, need an explicit request; it downloads in the background.
   */
  private fun requestModelDownload(context: Context) {
    try {
      ModuleInstall.getClient(context).installModules(ModuleInstallRequest.newBuilder().addApi(recognizer).build())
    } catch (_: Exception) {
      // No Play services: nothing to request. The queue keeps the page pending.
    }
  }

  /**
   * The bitmap is deliberately NOT recycled here. The Play-services recogniser can still be reading
   * its pixels on its own thread after the task completes; recycling then freed native memory in use
   * and corrupted the heap (crashes later in unrelated code: Hermes, SQLite). The GC frees it once
   * ML Kit lets go.
   */
  private fun recognize(context: Context, bitmap: Bitmap): Map<String, Any> {
    val width = bitmap.width.toFloat()
    val height = bitmap.height.toFloat()
    Log.d(TAG, "recognize ${bitmap.width}x${bitmap.height}")
    run {
      val result = try {
        Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0)), 60, TimeUnit.SECONDS)
      } catch (e: ExecutionException) {
        val cause = e.cause
        if (cause is MlKitException && cause.errorCode == MlKitException.UNAVAILABLE) {
          requestModelDownload(context)
          throw OcrUnavailableException(cause)
        }
        throw OcrFailedException(cause ?: e)
      } catch (e: TimeoutException) {
        throw OcrFailedException(e)
      }

      // Line boxes normalised to the page (0–1), for search highlights and "copy this line" later.
      val lines = ArrayList<Map<String, Any>>()
      var confidenceSum = 0f
      for (block in result.textBlocks) {
        for (line in block.lines) {
          val box = line.boundingBox ?: continue
          confidenceSum += line.confidence
          lines.add(
            mapOf(
              "text" to line.text,
              "box" to listOf(box.left / width, box.top / height, box.width() / width, box.height() / height).map { round4(it) },
            ),
          )
        }
      }
      Log.d(TAG, "recognized ${lines.size} lines")
      return mapOf(
        "text" to result.text,
        "lines" to lines,
        "confidence" to if (lines.isEmpty()) 0.0 else round4(confidenceSum / lines.size),
      )
    }
  }

  private fun round4(value: Float): Double = (value * 10000).roundToInt() / 10000.0
}
