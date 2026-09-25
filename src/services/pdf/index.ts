import { DocunaNative } from 'docuna-native';

import { setDocumentCover } from '@/db/repositories/documents';
import type { SqlDb } from '@/db/types';
import { newDocumentImageFile } from '@/services/filesystem/storage';

/**
 * PDF metadata via Android's PdfRenderer. Returns null instead of throwing when the file can't be
 * inspected (password-protected or damaged): the reader (PDF.js) can still open or repair many of
 * those, so import must not fail on them.
 */
export async function inspectPdf(uri: string): Promise<{ pageCount: number } | null> {
  if (!DocunaNative) return null;
  try {
    return await DocunaNative.getPdfInfoAsync(uri);
  } catch (error) {
    if (__DEV__) console.warn('inspectPdf failed', uri, error);
    return null;
  }
}

/** Renders page 1 as a small JPEG for lists. Null if the PDF can't be rendered natively. */
export async function renderPdfThumbnail(uri: string, outputUri: string): Promise<string | null> {
  if (!DocunaNative) return null;
  try {
    const result = await DocunaNative.renderPdfPageAsync({ uri, pageIndex: 0, outputUri, maxDimension: 360, quality: 75 });
    return result.uri;
  } catch (error) {
    if (__DEV__) console.warn('renderPdfThumbnail failed', uri, error);
    return null;
  }
}

/**
 * Fills in missing PDF thumbnails / page counts (e.g. files imported while rendering failed).
 * Runs quietly in the background at startup; one file at a time.
 */
export async function repairPdfThumbnails(db: SqlDb): Promise<number> {
  const rows = await db.getAllAsync<{ id: string; file_uri: string; page_count: number }>(
    `SELECT id, file_uri, page_count FROM documents
     WHERE kind = 'pdf' AND thumbnail_uri IS NULL AND file_uri IS NOT NULL AND deleted_at IS NULL`,
  );
  let repaired = 0;
  for (const row of rows) {
    const info = await inspectPdf(row.file_uri);
    if (!info || info.pageCount === 0) continue;
    const thumbnail = await renderPdfThumbnail(row.file_uri, newDocumentImageFile(row.id, 'thumb').uri);
    if (!thumbnail) continue;
    await setDocumentCover(db, row.id, thumbnail, row.page_count || info.pageCount);
    repaired++;
  }
  return repaired;
}
