import { getDocument, setDocumentSuggestion } from '@/db/repositories/documents';
import { listFolders } from '@/db/repositories/folders';
import { getDocumentText } from '@/db/repositories/ocr';
import type { SqlDb } from '@/db/types';
import { suggestFiling } from '@/domain/suggestions';

/** Titles Docuna generated itself ("Scan 2026-09-25 14.32"); anything else was chosen by the user. */
const GENERATED_TITLE = /^Scan \d{4}-\d{2}-\d{2} \d{2}\.\d{2}( \(\d+\))?$/;

/**
 * Works out a filing suggestion for an inbox document from its first recognised pages. Called by
 * the OCR queue as text arrives; a title is only suggested while the document still has its
 * generated name.
 */
export async function refreshSuggestion(db: SqlDb, documentId: string): Promise<void> {
  const document = await getDocument(db, documentId);
  if (!document || !document.inInbox || document.deletedAt !== null) return;

  const pages = await getDocumentText(db, documentId);
  const text = pages
    .slice(0, 2)
    .map((page) => page.text)
    .join('\n');
  const suggestion = suggestFiling(text, await listFolders(db));
  if (!suggestion) return;

  const title = GENERATED_TITLE.test(document.title) && suggestion.title !== document.title ? suggestion.title : null;
  const folderId = suggestion.folderId !== document.folderId ? suggestion.folderId : null;
  if (!title && !folderId) return;
  await setDocumentSuggestion(db, documentId, { ...suggestion, title, folderId });
}
