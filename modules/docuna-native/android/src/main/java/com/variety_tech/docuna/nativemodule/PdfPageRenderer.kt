package com.variety_tech.docuna.nativemodule

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.io.FileOutputStream
import kotlin.math.max
import kotlin.math.roundToInt

class RenderPdfPageOptions : Record {
  @Field var uri: String = ""
  @Field var pageIndex: Int = 0
  /** file:// URI inside app storage. */
  @Field var outputUri: String = ""
  @Field var maxDimension: Int = 360
  @Field var quality: Int = 80
}

class PdfOpenException(message: String, cause: Throwable? = null) :
  CodedException("ERR_PDF_OPEN", message, cause)

/** Password-protected PDFs can't be opened by Android's PdfRenderer (the reader can still open them). */
class PdfEncryptedException(cause: Throwable?) :
  CodedException("ERR_PDF_ENCRYPTED", "This PDF is password protected", cause)

/**
 * Metadata and thumbnails via Android's built-in PdfRenderer (no extra APK size). Full reading
 * happens in the PDF.js reader; this is only for page counts and list thumbnails.
 */
object PdfPageRenderer {
  private val lock = Any()

  private fun <T> withRenderer(context: Context, uri: String, block: (PdfRenderer) -> T): T = synchronized(lock) {
    val descriptor: ParcelFileDescriptor = try {
      context.contentResolver.openFileDescriptor(Uri.parse(uri), "r")
    } catch (e: Exception) {
      throw PdfOpenException("Cannot open $uri", e)
    } ?: throw PdfOpenException("Cannot open $uri")

    descriptor.use { fd ->
      val renderer = try {
        PdfRenderer(fd)
      } catch (e: SecurityException) {
        throw PdfEncryptedException(e)
      } catch (e: Exception) {
        throw PdfOpenException("Not a readable PDF", e)
      }
      renderer.use(block)
    }
  }

  fun pageCount(context: Context, uri: String): Int = withRenderer(context, uri) { it.pageCount }

  fun renderPage(context: Context, options: RenderPdfPageOptions): ProcessedImage = withRenderer(context, options.uri) { renderer ->
    if (options.pageIndex !in 0 until renderer.pageCount) throw PdfOpenException("Page ${options.pageIndex} is out of range")
    renderer.openPage(options.pageIndex).use { page ->
      val scale = options.maxDimension.toFloat() / max(page.width, page.height)
      val width = (page.width * scale).roundToInt().coerceAtLeast(1)
      val height = (page.height * scale).roundToInt().coerceAtLeast(1)
      val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
      try {
        bitmap.eraseColor(Color.WHITE) // PDFs assume a white page; the bitmap starts transparent.
        page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
        val file = File(Uri.parse(options.outputUri).path ?: throw PdfOpenException("Invalid output URI"))
        file.parentFile?.mkdirs()
        FileOutputStream(file).use { bitmap.compress(Bitmap.CompressFormat.JPEG, options.quality.coerceIn(40, 100), it) }
        ProcessedImage(Uri.fromFile(file).toString(), width, height)
      } finally {
        bitmap.recycle()
      }
    }
  }
}
