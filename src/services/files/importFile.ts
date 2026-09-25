import { DocunaNative } from 'docuna-native';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';

import { createDocument } from '@/db/repositories/documents';
import type { SqlDb } from '@/db/types';
import { AppError, toAppError } from '@/domain/errors';
import { classifyImport, defaultExtension, fileExtension, titleFromFileName } from '@/domain/fileTypes';
import type { Document } from '@/domain/models';
import { newId } from '@/lib/id';
import { createDocumentFromImages, discardDocument } from '@/services/pages/pageService';
import { inspectPdf, renderPdfThumbnail } from '@/services/pdf';
import {
  deleteDocumentFiles,
  documentSourceFile,
  ensureDocumentDirectory,
  newDocumentImageFile,
} from '@/services/filesystem/storage';

/**
 * Copies an incoming file into app storage. Files from other apps arrive as content:// URIs with a
 * temporary read grant, which the native module reads via the ContentResolver.
 */
async function copyIntoStorage(sourceUri: string, target: File): Promise<void> {
  if (sourceUri.startsWith('content://')) {
    if (!DocunaNative) throw new AppError('native_unavailable');
    await DocunaNative.copyContentAsync(sourceUri, target.uri);
  } else {
    new File(sourceUri).copy(target);
  }
}

/** Keep this much free space after an import so the phone (and Docuna) keep working. */
const STORAGE_HEADROOM_BYTES = 50 * 1024 * 1024;

const PICKER_TYPES = ['application/pdf', 'image/*', 'text/*', 'application/json', 'application/xml', '*/*'];

/** Lets the user pick a file and imports it. Resolves null if they cancelled. */
export async function pickAndImportFile(db: SqlDb): Promise<Document | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: PICKER_TYPES,
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  return importFile(db, { uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? null, size: asset.size ?? null });
}

export interface IncomingFile {
  uri: string;
  name: string;
  mimeType: string | null;
  size: number | null;
}

export async function importFile(db: SqlDb, file: IncomingFile): Promise<Document> {
  const kind = classifyImport(file.name, file.mimeType);
  const title = titleFromFileName(file.name);

  if (kind === 'unsupported') {
    throw new AppError('unsupported_file', `Unsupported file: ${file.name}`, {
      userMessage: `Docuna can’t open “${file.name}”. It supports PDFs, Word, Excel, PowerPoint, text files and images.`,
    });
  }
  if (file.size !== null && file.size > Paths.availableDiskSpace - STORAGE_HEADROOM_BYTES) {
    throw new AppError('storage_full');
  }

  if (kind === 'image') {
    return createDocumentFromImages(db, [file.uri], { title, source: 'import_image' });
  }

  // Everything else keeps the original file, byte for byte.
  const id = newId();
  ensureDocumentDirectory(id);
  try {
    const extension = fileExtension(file.name) || defaultExtension(kind, file.mimeType);
    const stored = documentSourceFile(id, extension);
    await copyIntoStorage(file.uri, stored);
    const sizeBytes = stored.size ?? file.size ?? 0;

    let pageCount = 0;
    let thumbnailUri: string | null = null;
    if (kind === 'pdf') {
      pageCount = (await inspectPdf(stored.uri))?.pageCount ?? 0;
      thumbnailUri = pageCount > 0 ? await renderPdfThumbnail(stored.uri, newDocumentImageFile(id, 'thumb').uri) : null;
    }

    return await createDocument(db, {
      id,
      title,
      source: kind === 'pdf' ? 'import_pdf' : 'import_file',
      file: { kind, fileUri: stored.uri, mimeType: file.mimeType, originalName: file.name, sizeBytes, pageCount, thumbnailUri },
    });
  } catch (error) {
    await discardDocument(db, id).catch(() => deleteDocumentFiles(id));
    throw toAppError(error, 'storage_failure');
  }
}
