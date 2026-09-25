package com.variety_tech.docuna.nativemodule

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import expo.modules.kotlin.exception.CodedException
import java.io.File
import java.io.FileOutputStream

class ContentReadException(message: String, cause: Throwable? = null) :
  CodedException("ERR_CONTENT_READ", message, cause)

/**
 * Files handed to Docuna by other apps ("Open with" / "Share"). They arrive as content:// URIs with
 * a temporary read grant, so they are inspected and copied into app storage right away.
 */
object IncomingFiles {
  private const val HANDLED_EXTRA = "com.variety_tech.docuna.INCOMING_HANDLED"

  /** Display name, size and MIME type of a content:// or file:// URI. */
  fun info(context: Context, uriString: String): Map<String, Any?> {
    val uri = Uri.parse(uriString)
    var name: String? = null
    var size: Long? = null
    when (uri.scheme) {
      "content" -> try {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
          if (cursor.moveToFirst()) {
            val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (nameIndex >= 0 && !cursor.isNull(nameIndex)) name = cursor.getString(nameIndex)
            val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
            if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) size = cursor.getLong(sizeIndex)
          }
        }
      } catch (_: Exception) {
        // Some providers don't support queries; fall back to the URI itself.
      }
      "file" -> uri.path?.let { File(it) }?.let {
        name = it.name
        size = it.length()
      }
    }
    if (name == null) name = uri.lastPathSegment?.substringAfterLast('/')
    val extension = name?.substringAfterLast('.', "")?.lowercase().orEmpty()
    val mimeType = context.contentResolver.getType(uri)
      ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension)
    return mapOf("name" to name, "size" to size?.toDouble(), "mimeType" to mimeType)
  }

  /** Copies the content to a file:// destination inside app storage; returns the byte count. */
  fun copy(context: Context, uriString: String, destinationUri: String): Double {
    val destination = File(Uri.parse(destinationUri).path ?: throw ContentReadException("Invalid destination"))
    destination.parentFile?.mkdirs()
    try {
      val input = context.contentResolver.openInputStream(Uri.parse(uriString))
        ?: throw ContentReadException("Cannot open $uriString")
      val bytes = input.use { source -> FileOutputStream(destination).use { source.copyTo(it) } }
      return bytes.toDouble()
    } catch (e: CodedException) {
      throw e
    } catch (e: SecurityException) {
      throw ContentReadException("Permission to read the file was not granted", e)
    } catch (e: Exception) {
      destination.delete()
      throw ContentReadException("Could not copy the file", e)
    }
  }

  /**
   * Files carried by an intent (ACTION_VIEW data, or ACTION_SEND / SEND_MULTIPLE streams). Each
   * intent is only reported once, so reloads don't import the same file again.
   */
  fun fromIntent(intent: Intent?): List<Map<String, String?>> {
    if (intent == null || intent.getBooleanExtra(HANDLED_EXTRA, false)) return emptyList()
    val uris = mutableListOf<Uri>()
    when (intent.action) {
      Intent.ACTION_VIEW -> intent.data?.takeIf { it.scheme == "content" || it.scheme == "file" }?.let(uris::add)
      Intent.ACTION_SEND -> streamExtra(intent)?.let(uris::add)
      Intent.ACTION_SEND_MULTIPLE -> uris.addAll(streamListExtra(intent))
    }
    if (uris.isEmpty()) return emptyList()
    intent.putExtra(HANDLED_EXTRA, true)
    return uris.map { mapOf("uri" to it.toString(), "mimeType" to intent.type) }
  }

  @Suppress("DEPRECATION")
  private fun streamExtra(intent: Intent): Uri? =
    if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
    else intent.getParcelableExtra(Intent.EXTRA_STREAM)

  @Suppress("DEPRECATION")
  private fun streamListExtra(intent: Intent): List<Uri> =
    (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
    else intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)) ?: emptyList()
}
