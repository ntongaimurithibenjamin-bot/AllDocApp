import { DocunaNative } from 'docuna-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { startActivityAsync } from 'expo-intent-launcher';

import type { SqlDb } from '@/db/types';
import { AppError, toAppError } from '@/domain/errors';
import type { Document } from '@/domain/models';
import { ensureDocumentPdf } from '@/services/pdf/engine';

import { shareFileName } from './shareFile';

/** Intent.FLAG_GRANT_READ_URI_PERMISSION: the receiving app may read this one file, temporarily. */
const FLAG_GRANT_READ_URI_PERMISSION = 1;

export interface ExportableFile {
  uri: string;
  /** Human file name, e.g. "Lease.pdf". */
  name: string;
  mimeType: string;
}

/** The file that represents a document outside Docuna: scans as a PDF, everything else as stored. */
export async function exportableFile(db: SqlDb, document: Document): Promise<ExportableFile> {
  if (document.kind === 'pages') {
    return { uri: await ensureDocumentPdf(db, document), name: shareFileName({ ...document, kind: 'pdf', originalName: null }), mimeType: 'application/pdf' };
  }
  if (!document.fileUri || !new File(document.fileUri).exists) throw new AppError('not_found', 'Stored file is missing');
  return {
    uri: document.fileUri,
    name: shareFileName(document),
    mimeType: document.mimeType ?? (document.kind === 'pdf' ? 'application/pdf' : 'application/octet-stream'),
  };
}

/** A temporary copy under the human name (stored files are named source-….ext internally). */
function namedCopy(file: ExportableFile): File {
  try {
    const dir = new Directory(Paths.cache, 'share');
    if (dir.exists) dir.delete();
    dir.create({ intermediates: true });
    const copy = new File(dir, file.name);
    new File(file.uri).copy(copy);
    return copy;
  } catch (error) {
    throw toAppError(error, 'storage_failure');
  }
}

export async function shareDocument(db: SqlDb, document: Document): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new AppError('unknown', 'Sharing unavailable', { userMessage: 'Sharing isn’t available on this phone.' });
  }
  const file = await exportableFile(db, document);
  await Sharing.shareAsync(namedCopy(file).uri, { mimeType: file.mimeType, dialogTitle: document.title });
}

/**
 * Opens the document in another app (Android picks or asks which one). Only a temporary read grant
 * for this one file is shared; Docuna's storage stays private.
 */
export async function openInAnotherApp(db: SqlDb, document: Document): Promise<void> {
  const file = await exportableFile(db, document);
  try {
    await startActivityAsync('android.intent.action.VIEW', {
      data: namedCopy(file).contentUri,
      type: file.mimeType,
      flags: FLAG_GRANT_READ_URI_PERMISSION,
    });
  } catch (error) {
    throw new AppError('unknown', String(error), {
      cause: error,
      userMessage: 'No app on this phone can open this file. Try installing one from the Play Store, or share it instead.',
    });
  }
}

export type SaveResult = { saved: true; location: string } | { saved: false };

/** Lets the user pick any folder (including SD cards and cloud drives) and saves a copy there. */
export async function saveToFolder(db: SqlDb, document: Document): Promise<SaveResult> {
  if (!DocunaNative) throw new AppError('native_unavailable');
  const file = await exportableFile(db, document);
  let folder: Directory;
  try {
    folder = await Directory.pickDirectoryAsync();
  } catch {
    return { saved: false }; // picker dismissed
  }
  try {
    const target = folder.createFile(file.name, file.mimeType);
    await DocunaNative.copyToContentUriAsync(file.uri, target.uri);
    return { saved: true, location: `${folder.name ?? 'the folder you chose'}` };
  } catch (error) {
    throw toAppError(error, 'storage_failure');
  }
}

/** Saves a copy to Downloads/Docuna; on Android 9 and older, asks for a folder instead. */
export async function saveToDownloads(db: SqlDb, document: Document): Promise<SaveResult> {
  if (!DocunaNative) throw new AppError('native_unavailable');
  const file = await exportableFile(db, document);
  try {
    await DocunaNative.saveToDownloadsAsync(file.uri, file.name, file.mimeType);
    return { saved: true, location: `Downloads › Docuna › ${file.name}` };
  } catch (error) {
    if ((error as { code?: string })?.code === 'ERR_NEEDS_PICKER') return saveToFolder(db, document);
    throw toAppError(error, 'storage_failure');
  }
}

/** Shares recognised text as "<title>.txt" (apps like WhatsApp and Gmail accept it as a file). */
export async function shareText(title: string, text: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new AppError('unknown', 'Sharing unavailable', { userMessage: 'Sharing isn’t available on this phone.' });
  }
  let file: File;
  try {
    const dir = new Directory(Paths.cache, 'share');
    if (dir.exists) dir.delete();
    dir.create({ intermediates: true });
    file = new File(dir, `${title}.txt`);
    file.write(text);
  } catch (error) {
    throw toAppError(error, 'storage_failure');
  }
  await Sharing.shareAsync(file.uri, { mimeType: 'text/plain', dialogTitle: title });
}
