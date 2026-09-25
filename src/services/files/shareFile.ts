import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { AppError, toAppError } from '@/domain/errors';
import { fileExtension } from '@/domain/fileTypes';
import type { Document } from '@/domain/models';

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001F]/g;

/** The name a shared file should carry: the document's (possibly renamed) title + original extension. */
export function shareFileName(document: Pick<Document, 'title' | 'originalName' | 'kind'>): string {
  const extension = fileExtension(document.originalName ?? '') || (document.kind === 'pdf' ? 'pdf' : 'txt');
  const base = document.title.replace(INVALID_FILENAME_CHARS, ' ').replace(/\s+/g, ' ').trim() || 'Document';
  return `${base}.${extension}`;
}

/**
 * Shares a file document under a human name. Stored files are named source.<ext> internally, so a
 * copy with the right name is made in the cache; the previous share's copy is removed first.
 */
export async function shareDocumentFile(document: Document): Promise<void> {
  if (!document.fileUri) throw new AppError('not_found', 'No file to share');
  if (!(await Sharing.isAvailableAsync())) {
    throw new AppError('unknown', 'Sharing unavailable', { userMessage: 'Sharing isn’t available on this phone.' });
  }
  let shared: File;
  try {
    const dir = new Directory(Paths.cache, 'share');
    if (dir.exists) dir.delete();
    dir.create({ intermediates: true });
    shared = new File(dir, shareFileName(document));
    new File(document.fileUri).copy(shared);
  } catch (error) {
    throw toAppError(error, 'storage_failure');
  }
  await Sharing.shareAsync(shared.uri, {
    mimeType: document.mimeType ?? (document.kind === 'pdf' ? 'application/pdf' : 'text/plain'),
    dialogTitle: document.title,
  });
}
