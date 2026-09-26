package com.variety_tech.docuna.nativemodule

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import expo.modules.kotlin.exception.CodedException
import java.io.File

class ExportException(message: String, cause: Throwable? = null) :
  CodedException("ERR_EXPORT", message, cause)

/** Android 9 and older need storage permission for Downloads; the app offers "Save to…" instead. */
class NeedsFolderPickerException :
  CodedException("ERR_NEEDS_PICKER", "Saving to Downloads needs Android 10 or newer", null)

/**
 * Copies files out of Docuna's private storage to places the user can see. Everything streams, so
 * large PDFs never pass through JavaScript memory.
 */
object ExportFiles {
  private const val DOWNLOADS_FOLDER = "Download/Docuna"

  /** Saves into Downloads/Docuna via MediaStore (no permission needed on Android 10+). */
  fun saveToDownloads(context: Context, sourceUri: String, displayName: String, mimeType: String): String {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) throw NeedsFolderPickerException()
    val resolver = context.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, displayName)
      put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
      put(MediaStore.MediaColumns.RELATIVE_PATH, DOWNLOADS_FOLDER)
      put(MediaStore.MediaColumns.IS_PENDING, 1)
    }
    val target = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
      ?: throw ExportException("Could not create the file in Downloads")
    try {
      copy(context, sourceUri, target)
      values.clear()
      values.put(MediaStore.MediaColumns.IS_PENDING, 0)
      resolver.update(target, values, null, null)
      return target.toString()
    } catch (e: Exception) {
      resolver.delete(target, null, null)
      throw if (e is CodedException) e else ExportException("Could not save to Downloads", e)
    }
  }

  /** Streams a file:// source into a content:// destination (e.g. a file created in a picked folder). */
  fun copyToContentUri(context: Context, sourceUri: String, destinationUri: String) {
    copy(context, sourceUri, Uri.parse(destinationUri))
  }

  private fun copy(context: Context, sourceUri: String, target: Uri) {
    val source = Uri.parse(sourceUri)
    val input = if (source.scheme == "file") File(source.path ?: throw ExportException("Invalid source")).inputStream()
    else context.contentResolver.openInputStream(source)
    input ?: throw ExportException("Cannot read $sourceUri")
    input.use { from ->
      val output = context.contentResolver.openOutputStream(target, "w") ?: throw ExportException("Cannot write $target")
      output.use { to -> from.copyTo(to) }
    }
  }
}
