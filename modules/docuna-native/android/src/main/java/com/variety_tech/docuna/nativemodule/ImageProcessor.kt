package com.variety_tech.docuna.nativemodule

import android.app.ActivityManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.io.FileOutputStream
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

class NormalizedPoint : Record {
  @Field var x: Double = 0.0
  @Field var y: Double = 0.0
}

class ProcessImageOptions : Record {
  @Field var sourceUri: String = ""
  /** Must be a file:// URI inside app storage. */
  @Field var outputUri: String = ""
  /** Four corners (TL, TR, BR, BL), normalised to the EXIF-oriented source. */
  @Field var quad: List<NormalizedPoint>? = null
  /** Clockwise degrees: 0, 90, 180 or 270. Applied after the crop. */
  @Field var rotation: Int = 0
  /** original | enhanced | grayscale | bw */
  @Field var filter: String = "original"
  /** Longest edge of the output in pixels; 0 = the device working size (3000 px, or 2000 px on low-RAM phones). */
  @Field var maxDimension: Int = 0
  @Field var quality: Int = 90
}

class ProcessedImage(val uri: String, val width: Int, val height: Int)

class InvalidImageException(message: String, cause: Throwable? = null) :
  CodedException("ERR_INVALID_IMAGE", message, cause)

class ImageWriteException(cause: Throwable) :
  CodedException("ERR_IMAGE_WRITE", "Could not write the processed image", cause)

/**
 * Page image pipeline. Works on one bitmap at a time and caps the working resolution, so a
 * 20-page document never holds more than one decoded page in memory.
 */
object ImageProcessor {
  /** ~250 DPI for an A4 page: plenty for reading, printing and OCR. */
  private const val FULL_WORKING_DIMENSION = 3000
  /** ~170 DPI: still sharp and OCR-friendly, and fits the small heaps of Android Go phones. */
  private const val LOW_RAM_WORKING_DIMENSION = 2000

  @Volatile private var workingDimension = 0

  /**
   * Longest edge we decode and process at. Peak memory is roughly two ARGB bitmaps of this size
   * (source + warped output): ~72 MB at 3000 px, ~32 MB at 2000 px.
   */
  private fun maxWorkingDimension(context: Context): Int {
    if (workingDimension == 0) {
      val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      workingDimension =
        if (am.isLowRamDevice || am.memoryClass <= 256) LOW_RAM_WORKING_DIMENSION else FULL_WORKING_DIMENSION
    }
    return workingDimension
  }

  fun orientedSize(context: Context, uri: String): Pair<Int, Int> {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    open(context, uri).use { BitmapFactory.decodeStream(it, null, bounds) }
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw InvalidImageException("Not a readable image: $uri")
    val degrees = exifDegrees(context, uri)
    return if (degrees == 90 || degrees == 270) bounds.outHeight to bounds.outWidth else bounds.outWidth to bounds.outHeight
  }

  fun process(context: Context, options: ProcessImageOptions): ProcessedImage {
    val working = maxWorkingDimension(context)
    val target = if (options.maxDimension > 0) min(options.maxDimension, working) else working
    // When cropping, decode at working resolution so the crop keeps detail; otherwise decode
    // close to the target size to save memory (thumbnails decode tiny bitmaps).
    val decodeTarget = if (options.quad != null) working else target

    var bitmap = decodeOriented(context, options.sourceUri, decodeTarget)
    options.quad?.let { quad ->
      if (quad.size != 4) throw InvalidImageException("Crop needs exactly 4 corners")
      bitmap = replace(bitmap, warpPerspective(bitmap, quad, working))
    }
    if (options.rotation % 360 != 0) {
      bitmap = replace(bitmap, rotate(bitmap, options.rotation))
    }
    bitmap = replace(bitmap, scaleToFit(bitmap, target))
    bitmap = replace(bitmap, applyFilter(bitmap, options.filter))

    try {
      val file = File(Uri.parse(options.outputUri).path ?: throw InvalidImageException("Invalid output URI"))
      file.parentFile?.mkdirs()
      FileOutputStream(file).use { out ->
        if (!bitmap.compress(Bitmap.CompressFormat.JPEG, options.quality.coerceIn(40, 100), out)) {
          throw InvalidImageException("JPEG encoding failed")
        }
      }
      return ProcessedImage(Uri.fromFile(file).toString(), bitmap.width, bitmap.height)
    } catch (e: CodedException) {
      throw e
    } catch (e: Exception) {
      throw ImageWriteException(e)
    } finally {
      bitmap.recycle()
    }
  }

  // --- decoding -------------------------------------------------------------------------------

  private fun open(context: Context, uri: String) =
    context.contentResolver.openInputStream(Uri.parse(uri)) ?: throw InvalidImageException("Cannot open $uri")

  private fun exifDegrees(context: Context, uri: String): Int = try {
    open(context, uri).use { ExifInterface(it).rotationDegrees }
  } catch (_: Exception) {
    0
  }

  private fun decodeOriented(context: Context, uri: String, maxDimension: Int): Bitmap {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    open(context, uri).use { BitmapFactory.decodeStream(it, null, bounds) }
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw InvalidImageException("Not a readable image: $uri")

    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxDimension) sample *= 2

    val decoded = try {
      open(context, uri).use {
        BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
      }
    } catch (e: OutOfMemoryError) {
      throw InvalidImageException("Image is too large to open", e)
    } ?: throw InvalidImageException("Could not decode $uri")

    val degrees = exifDegrees(context, uri)
    return if (degrees == 0) decoded else replace(decoded, rotate(decoded, degrees))
  }

  // --- geometry -------------------------------------------------------------------------------

  private fun warpPerspective(source: Bitmap, quad: List<NormalizedPoint>, maxDimension: Int): Bitmap {
    val w = source.width.toFloat()
    val h = source.height.toFloat()
    val pts = quad.map { floatArrayOf((it.x.coerceIn(0.0, 1.0) * w).toFloat(), (it.y.coerceIn(0.0, 1.0) * h).toFloat()) }
    val (tl, tr, br, bl) = pts
    fun dist(a: FloatArray, b: FloatArray) = hypot(a[0] - b[0], a[1] - b[1])

    var outW = max(dist(tl, tr), dist(bl, br))
    var outH = max(dist(tl, bl), dist(tr, br))
    if (outW < 16 || outH < 16) throw InvalidImageException("Crop area is too small")
    val scale = min(1f, maxDimension / max(outW, outH))
    outW *= scale
    outH *= scale

    val matrix = Matrix()
    val src = floatArrayOf(tl[0], tl[1], tr[0], tr[1], br[0], br[1], bl[0], bl[1])
    val dst = floatArrayOf(0f, 0f, outW, 0f, outW, outH, 0f, outH)
    if (!matrix.setPolyToPoly(src, 0, dst, 0, 4)) throw InvalidImageException("Crop corners are not a valid shape")

    val out = Bitmap.createBitmap(outW.roundToInt(), outH.roundToInt(), Bitmap.Config.ARGB_8888)
    Canvas(out).drawBitmap(source, matrix, Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG))
    return out
  }

  private fun rotate(source: Bitmap, degrees: Int): Bitmap {
    val matrix = Matrix().apply { postRotate(degrees.toFloat()) }
    return Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, true)
  }

  private fun scaleToFit(source: Bitmap, maxDimension: Int): Bitmap {
    val longest = max(source.width, source.height)
    if (longest <= maxDimension) return source
    val scale = maxDimension.toFloat() / longest
    return Bitmap.createScaledBitmap(
      source,
      (source.width * scale).roundToInt().coerceAtLeast(1),
      (source.height * scale).roundToInt().coerceAtLeast(1),
      true,
    )
  }

  // --- filters --------------------------------------------------------------------------------

  private fun applyFilter(source: Bitmap, filter: String): Bitmap = when (filter) {
    "original" -> source
    "grayscale" -> drawWithMatrix(source, ColorMatrix().apply { setSaturation(0f) })
    "enhanced" -> drawWithMatrix(source, enhanceMatrix())
    "bw" -> threshold(drawWithMatrix(source, ColorMatrix().apply { setSaturation(0f) }))
    else -> throw InvalidImageException("Unknown filter: $filter")
  }

  /** Lifts contrast and whitens the page background while keeping colour (stamps, highlights). */
  private fun enhanceMatrix(): ColorMatrix {
    val contrast = 1.35f
    val offset = (1f - contrast) * 128f + 18f
    return ColorMatrix(
      floatArrayOf(
        contrast, 0f, 0f, 0f, offset,
        0f, contrast, 0f, 0f, offset,
        0f, 0f, contrast, 0f, offset,
        0f, 0f, 0f, 1f, 0f,
      ),
    ).apply { postConcat(ColorMatrix().apply { setSaturation(1.15f) }) }
  }

  private fun drawWithMatrix(source: Bitmap, matrix: ColorMatrix): Bitmap {
    val out = Bitmap.createBitmap(source.width, source.height, Bitmap.Config.ARGB_8888)
    Canvas(out).drawBitmap(source, 0f, 0f, Paint().apply { colorFilter = ColorMatrixColorFilter(matrix) })
    return out
  }

  /** Black & white via Otsu's threshold on a grayscale bitmap; processed row by row. */
  private fun threshold(gray: Bitmap): Bitmap {
    val width = gray.width
    val row = IntArray(width)
    val histogram = IntArray(256)
    for (y in 0 until gray.height) {
      gray.getPixels(row, 0, width, 0, y, width, 1)
      for (p in row) histogram[p and 0xFF]++
    }
    val level = otsu(histogram, width.toLong() * gray.height)

    val out = gray.copy(Bitmap.Config.ARGB_8888, true)
    gray.recycle()
    for (y in 0 until out.height) {
      out.getPixels(row, 0, width, 0, y, width, 1)
      for (i in row.indices) row[i] = if ((row[i] and 0xFF) > level) -0x1 else -0x1000000
      out.setPixels(row, 0, width, 0, y, width, 1)
    }
    return out
  }

  private fun otsu(histogram: IntArray, total: Long): Int {
    var sum = 0.0
    for (i in 0..255) sum += i.toDouble() * histogram[i]
    var sumBackground = 0.0
    var weightBackground = 0L
    var best = 0.0
    var level = 127
    for (t in 0..255) {
      weightBackground += histogram[t]
      if (weightBackground == 0L) continue
      val weightForeground = total - weightBackground
      if (weightForeground == 0L) break
      sumBackground += t.toDouble() * histogram[t]
      val meanB = sumBackground / weightBackground
      val meanF = (sum - sumBackground) / weightForeground
      val between = weightBackground.toDouble() * weightForeground * (meanB - meanF) * (meanB - meanF)
      if (between > best) {
        best = between
        level = t
      }
    }
    return level
  }

  /** Returns [next], recycling [previous] when a new bitmap was produced. */
  private fun replace(previous: Bitmap, next: Bitmap): Bitmap {
    if (next !== previous) previous.recycle()
    return next
  }
}
