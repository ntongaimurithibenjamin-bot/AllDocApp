import { defaultExtension, fileExtension } from '@/domain/fileTypes';
import type { Document } from '@/domain/models';

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001F]/g;

/**
 * The name a document's file carries outside Docuna: its (possibly renamed) title + the original
 * extension. Scans are exported as PDF.
 */
export function shareFileName(document: Pick<Document, 'title' | 'originalName' | 'kind'>): string {
  const extension =
    fileExtension(document.originalName ?? '') || (document.kind === 'pages' ? 'pdf' : defaultExtension(document.kind, null));
  const base = document.title.replace(INVALID_FILENAME_CHARS, ' ').replace(/\s+/g, ' ').trim() || 'Document';
  return `${base}.${extension}`;
}
