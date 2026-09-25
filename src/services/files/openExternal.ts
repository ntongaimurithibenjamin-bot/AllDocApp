import { File } from 'expo-file-system';
import { startActivityAsync } from 'expo-intent-launcher';

import { AppError } from '@/domain/errors';
import type { Document } from '@/domain/models';

/** Intent.FLAG_GRANT_READ_URI_PERMISSION: the receiving app may read this one file, temporarily. */
const FLAG_GRANT_READ_URI_PERMISSION = 1;

/**
 * Opens a stored file in another app (Android picks or asks which one). Used for formats Docuna
 * can't render, and as an option for every file. Only a temporary read grant for that single file
 * is shared; Docuna's storage stays private.
 */
export async function openInAnotherApp(document: Document): Promise<void> {
  if (!document.fileUri) throw new AppError('not_found', 'No file to open');
  const file = new File(document.fileUri);
  if (!file.exists) throw new AppError('not_found', 'Stored file is missing');
  try {
    await startActivityAsync('android.intent.action.VIEW', {
      data: file.contentUri,
      type: document.mimeType ?? 'application/octet-stream',
      flags: FLAG_GRANT_READ_URI_PERMISSION,
    });
  } catch (error) {
    throw new AppError('unknown', String(error), {
      cause: error,
      userMessage: 'No app on this phone can open this file. Try installing one from the Play Store, or share it instead.',
    });
  }
}
