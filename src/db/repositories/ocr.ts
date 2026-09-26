import type { OcrStatus } from '@/domain/models';

import { notifyChanged } from '../events';
import type { SqlDb } from '../types';

/** A recognised line; `box` is [left, top, width, height] as fractions of the page. */
export interface OcrLine {
  text: string;
  box: [number, number, number, number];
}

export interface RecognizedText {
  text: string;
  lines: OcrLine[];
  /** Mean line confidence, 0–1 (0 when nothing was found). */
  confidence: number;
}

/** Text files are indexed as-is, up to this many characters. */
export const MAX_INDEXED_TEXT_CHARS = 500_000;

export type OcrJob =
  | { kind: 'scan-page'; documentId: string; pageId: string; imageUri: string }
  | { kind: 'pdf-page'; documentId: string; fileUri: string; pageIndex: number; pageCount: number }
  | { kind: 'text-file'; documentId: string; fileUri: string };

/**
 * The next unit of OCR work, newest documents first: scanned pages, then text files (cheap), then
 * PDF pages. Trashed documents wait until restored.
 */
export async function nextOcrJob(db: SqlDb): Promise<OcrJob | null> {
  const page = await db.getFirstAsync<{
    document_id: string;
    id: string;
    processed_uri: string | null;
    original_uri: string;
  }>(
    `SELECT p.document_id, p.id, p.processed_uri, p.original_uri
     FROM pages p JOIN documents d ON d.id = p.document_id
     WHERE p.ocr_status = 'pending' AND d.deleted_at IS NULL
     ORDER BY d.created_at DESC, p.position
     LIMIT 1`,
  );
  if (page) {
    return {
      kind: 'scan-page',
      documentId: page.document_id,
      pageId: page.id,
      imageUri: page.processed_uri ?? page.original_uri,
    };
  }

  const file = await db.getFirstAsync<{ id: string; kind: string; file_uri: string; ocr_next_page: number; page_count: number }>(
    `SELECT id, kind, file_uri, ocr_next_page, page_count FROM documents
     WHERE ocr_state = 'pending' AND kind IN ('text', 'pdf') AND file_uri IS NOT NULL AND deleted_at IS NULL
     ORDER BY kind = 'pdf', created_at DESC
     LIMIT 1`,
  );
  if (!file) return null;
  if (file.kind === 'text') return { kind: 'text-file', documentId: file.id, fileUri: file.file_uri };
  return {
    kind: 'pdf-page',
    documentId: file.id,
    fileUri: file.file_uri,
    pageIndex: file.ocr_next_page,
    pageCount: file.page_count,
  };
}

function blocksJson(result: RecognizedText): string | null {
  return result.lines.length ? JSON.stringify(result.lines) : null;
}

// Page image files are renamed on every edit, so the image URI identifies the exact version recognised.
const SAME_PAGE_IMAGE = `id = ? AND COALESCE(processed_uri, original_uri) = ? AND ocr_status = 'pending'`;

/**
 * Stores a scanned page's text. Skipped (returns false) when the page changed or was deleted while
 * it was being recognised; the page is then still pending and gets recognised again.
 */
export async function saveScanPageText(db: SqlDb, job: Extract<OcrJob, { kind: 'scan-page' }>, result: RecognizedText): Promise<boolean> {
  let saved = false;
  await db.withExclusiveTransactionAsync(async (txn) => {
    const update = await txn.runAsync(
      `UPDATE pages SET ocr_status = 'done' WHERE ${SAME_PAGE_IMAGE}`,
      job.pageId,
      job.imageUri,
    );
    if (update.changes === 0) return;
    await txn.runAsync(
      `INSERT INTO ocr_pages (document_id, page_id, text, blocks_json, engine, confidence, processed_at)
       VALUES (?, ?, ?, ?, 'mlkit-latin-v2', ?, ?)
       ON CONFLICT(page_id) DO UPDATE SET text = excluded.text, blocks_json = excluded.blocks_json,
         engine = excluded.engine, confidence = excluded.confidence, processed_at = excluded.processed_at`,
      job.documentId,
      job.pageId,
      result.text.trim(),
      blocksJson(result),
      result.confidence,
      Date.now(),
    );
    saved = true;
  });
  if (saved) notifyChanged('ocr');
  return saved;
}

export async function markScanPageFailed(db: SqlDb, job: Extract<OcrJob, { kind: 'scan-page' }>): Promise<void> {
  await db.runAsync(`UPDATE pages SET ocr_status = 'failed' WHERE ${SAME_PAGE_IMAGE}`, job.pageId, job.imageUri);
  notifyChanged('ocr');
}

/**
 * Stores one PDF page's text (null = the page couldn't be recognised; it is skipped) and advances
 * the document. Skipped when OCR was restarted or the document removed meanwhile.
 */
export async function savePdfPageText(
  db: SqlDb,
  job: Extract<OcrJob, { kind: 'pdf-page' }>,
  result: RecognizedText | null,
): Promise<boolean> {
  let saved = false;
  await db.withExclusiveTransactionAsync(async (txn) => {
    const next = job.pageIndex + 1;
    const update = await txn.runAsync(
      `UPDATE documents SET ocr_next_page = ?, ocr_state = CASE WHEN ? >= page_count THEN 'done' ELSE 'pending' END
       WHERE id = ? AND ocr_next_page = ? AND ocr_state = 'pending'`,
      next,
      next,
      job.documentId,
      job.pageIndex,
    );
    if (update.changes === 0) return;
    if (result) {
      await txn.runAsync(
        `INSERT INTO ocr_pages (document_id, page_index, text, blocks_json, engine, confidence, processed_at)
         VALUES (?, ?, ?, ?, 'mlkit-latin-v2', ?, ?)
         ON CONFLICT(document_id, page_index) DO UPDATE SET text = excluded.text, blocks_json = excluded.blocks_json,
           engine = excluded.engine, confidence = excluded.confidence, processed_at = excluded.processed_at`,
        job.documentId,
        job.pageIndex,
        result.text.trim(),
        blocksJson(result),
        result.confidence,
        Date.now(),
      );
    }
    saved = true;
  });
  if (saved) notifyChanged('ocr');
  return saved;
}

/** Indexes a text file's content as its single "page". */
export async function saveTextFileText(db: SqlDb, documentId: string, text: string): Promise<void> {
  await db.withExclusiveTransactionAsync(async (txn) => {
    const update = await txn.runAsync(
      `UPDATE documents SET ocr_state = 'done', ocr_next_page = 1 WHERE id = ? AND ocr_state = 'pending'`,
      documentId,
    );
    if (update.changes === 0) return;
    await txn.runAsync(
      `INSERT INTO ocr_pages (document_id, page_index, text, engine, processed_at) VALUES (?, 0, ?, 'text', ?)
       ON CONFLICT(document_id, page_index) DO UPDATE SET text = excluded.text, processed_at = excluded.processed_at`,
      documentId,
      text.slice(0, MAX_INDEXED_TEXT_CHARS),
      Date.now(),
    );
  });
  notifyChanged('ocr');
}

/** Marks a file document's OCR as finished without text ('failed': unreadable/encrypted file). */
export async function setFileOcrState(db: SqlDb, documentId: string, state: Exclude<OcrStatus, 'pending'>): Promise<void> {
  await db.runAsync('UPDATE documents SET ocr_state = ? WHERE id = ?', state, documentId);
  notifyChanged('ocr');
}

/** Clears a document's text and queues it for recognition again. */
export async function resetDocumentOcr(db: SqlDb, documentId: string): Promise<void> {
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync('DELETE FROM ocr_pages WHERE document_id = ?', documentId);
    await txn.runAsync(`UPDATE pages SET ocr_status = 'pending' WHERE document_id = ?`, documentId);
    await txn.runAsync(`UPDATE documents SET ocr_state = 'pending', ocr_next_page = 0 WHERE id = ?`, documentId);
  });
  notifyChanged('ocr');
}

export interface PageText {
  /** 1-based. */
  pageNumber: number;
  text: string;
  lines: OcrLine[];
  confidence: number | null;
}

/** A document's recognised text in page order (scans follow their current page order). */
export async function getDocumentText(db: SqlDb, documentId: string): Promise<PageText[]> {
  const rows = await db.getAllAsync<{ page_number: number; text: string; blocks_json: string | null; confidence: number | null }>(
    `SELECT COALESCE(p.position, o.page_index) + 1 AS page_number, o.text, o.blocks_json, o.confidence
     FROM ocr_pages o LEFT JOIN pages p ON p.id = o.page_id
     WHERE o.document_id = ?
     ORDER BY page_number`,
    documentId,
  );
  return rows.map((row) => ({
    pageNumber: row.page_number,
    text: row.text,
    lines: row.blocks_json ? (JSON.parse(row.blocks_json) as OcrLine[]) : [],
    confidence: row.confidence,
  }));
}

export interface OcrProgress {
  /** Pages recognised (or skipped) so far. */
  done: number;
  total: number;
  /** 'pending' while pages are waiting. */
  state: OcrStatus;
}

export async function getDocumentOcrProgress(db: SqlDb, documentId: string): Promise<OcrProgress | null> {
  const document = await db.getFirstAsync<{ kind: string; ocr_state: OcrStatus; ocr_next_page: number; page_count: number }>(
    'SELECT kind, ocr_state, ocr_next_page, page_count FROM documents WHERE id = ?',
    documentId,
  );
  if (!document) return null;
  if (document.kind === 'pages') {
    const counts = await db.getFirstAsync<{ total: number; pending: number; failed: number }>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(ocr_status = 'pending'), 0) AS pending,
              COALESCE(SUM(ocr_status = 'failed'), 0) AS failed
       FROM pages WHERE document_id = ?`,
      documentId,
    );
    const total = counts?.total ?? 0;
    const pending = counts?.pending ?? 0;
    return {
      done: total - pending,
      total,
      state: pending > 0 ? 'pending' : total > 0 && counts?.failed === total ? 'failed' : 'done',
    };
  }
  if (document.kind === 'pdf' || document.kind === 'text') {
    const total = document.kind === 'text' ? 1 : document.page_count;
    return { done: Math.min(document.ocr_next_page, total), total, state: document.ocr_state };
  }
  return { done: 0, total: 0, state: 'skipped' };
}

/** Pages still waiting for recognition across the library (for the "making searchable" hint). */
export async function countPendingOcrPages(db: SqlDb): Promise<number> {
  const row = await db.getFirstAsync<{ pages: number; files: number }>(
    `SELECT
       (SELECT COUNT(*) FROM pages p JOIN documents d ON d.id = p.document_id
        WHERE p.ocr_status = 'pending' AND d.deleted_at IS NULL) AS pages,
       (SELECT COALESCE(SUM(CASE WHEN kind = 'text' THEN 1 ELSE MAX(page_count - ocr_next_page, 1) END), 0)
        FROM documents WHERE ocr_state = 'pending' AND kind IN ('text', 'pdf')
        AND file_uri IS NOT NULL AND deleted_at IS NULL) AS files`,
  );
  return (row?.pages ?? 0) + (row?.files ?? 0);
}
