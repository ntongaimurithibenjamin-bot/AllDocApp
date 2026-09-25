import { AppError } from '@/domain/errors';
import type { CropQuad, NewPage, OcrStatus, Page, PageFilter, Rotation } from '@/domain/models';
import { newId } from '@/lib/id';

import { notifyChanged } from '../events';
import type { SqlDb } from '../types';

interface PageRow {
  id: string;
  document_id: string;
  position: number;
  original_uri: string;
  processed_uri: string | null;
  thumbnail_uri: string;
  width: number;
  height: number;
  rotation: Rotation;
  crop_json: string | null;
  filter: PageFilter;
  ocr_status: OcrStatus;
  created_at: number;
  updated_at: number;
}

function toPage(row: PageRow): Page {
  return {
    id: row.id,
    documentId: row.document_id,
    position: row.position,
    originalUri: row.original_uri,
    processedUri: row.processed_uri,
    thumbnailUri: row.thumbnail_uri,
    width: row.width,
    height: row.height,
    rotation: row.rotation,
    crop: row.crop_json ? (JSON.parse(row.crop_json) as CropQuad) : null,
    filter: row.filter,
    ocrStatus: row.ocr_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listPages(db: SqlDb, documentId: string): Promise<Page[]> {
  const rows = await db.getAllAsync<PageRow>(
    'SELECT * FROM pages WHERE document_id = ? ORDER BY position',
    documentId,
  );
  return rows.map(toPage);
}

export async function getPage(db: SqlDb, id: string): Promise<Page | null> {
  const row = await db.getFirstAsync<PageRow>('SELECT * FROM pages WHERE id = ?', id);
  return row ? toPage(row) : null;
}

/**
 * Keeps the parent document's denormalised fields (page count, cover thumbnail, PDF staleness)
 * consistent after any page mutation. Must run inside the same transaction as the mutation.
 */
async function syncDocumentAfterPageChange(txn: SqlDb, documentId: string): Promise<void> {
  await txn.runAsync(
    `UPDATE documents SET
       page_count = (SELECT COUNT(*) FROM pages WHERE document_id = ?1),
       thumbnail_uri = (SELECT thumbnail_uri FROM pages WHERE document_id = ?1 ORDER BY position LIMIT 1),
       pdf_stale = 1,
       updated_at = ?2
     WHERE id = ?1`,
    documentId,
    Date.now(),
  );
}

/** Rewrites positions to 0..n-1 in the given order. */
async function writePositions(txn: SqlDb, orderedIds: readonly string[]): Promise<void> {
  for (const [position, id] of orderedIds.entries()) {
    await txn.runAsync('UPDATE pages SET position = ? WHERE id = ?', position, id);
  }
}

/** Inserts pages at `atPosition` (default: the end) and returns them with assigned ids. */
export async function addPages(
  db: SqlDb,
  documentId: string,
  newPages: readonly NewPage[],
  atPosition?: number,
): Promise<Page[]> {
  const now = Date.now();
  const ids = newPages.map((page) => page.id ?? newId());

  await db.withExclusiveTransactionAsync(async (txn) => {
    const doc = await txn.getFirstAsync<{ id: string }>('SELECT id FROM documents WHERE id = ?', documentId);
    if (!doc) throw new AppError('not_found', `Document ${documentId} not found`);

    const existing = await txn.getAllAsync<{ id: string }>(
      'SELECT id FROM pages WHERE document_id = ? ORDER BY position',
      documentId,
    );
    const insertAt = Math.min(Math.max(atPosition ?? existing.length, 0), existing.length);

    for (const [i, page] of newPages.entries()) {
      await txn.runAsync(
        `INSERT INTO pages (id, document_id, position, original_uri, processed_uri, thumbnail_uri,
                            width, height, rotation, crop_json, filter, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ids[i]!,
        documentId,
        insertAt + i,
        page.originalUri,
        page.processedUri ?? null,
        page.thumbnailUri,
        page.width,
        page.height,
        page.rotation ?? 0,
        page.crop ? JSON.stringify(page.crop) : null,
        page.filter ?? 'original',
        now,
        now,
      );
    }

    const existingIds = existing.map((row) => row.id);
    await writePositions(txn, [
      ...existingIds.slice(0, insertAt),
      ...ids,
      ...existingIds.slice(insertAt),
    ]);
    await syncDocumentAfterPageChange(txn, documentId);
  });

  notifyChanged('pages', 'documents');
  const pages = await listPages(db, documentId);
  return pages.filter((page) => ids.includes(page.id));
}

/** Applies a new page order. `orderedIds` must contain exactly the document's page ids. */
export async function reorderPages(db: SqlDb, documentId: string, orderedIds: readonly string[]): Promise<void> {
  await db.withExclusiveTransactionAsync(async (txn) => {
    const existing = await txn.getAllAsync<{ id: string }>(
      'SELECT id FROM pages WHERE document_id = ?',
      documentId,
    );
    const existingIds = new Set(existing.map((row) => row.id));
    const sameSet =
      orderedIds.length === existingIds.size &&
      new Set(orderedIds).size === orderedIds.length &&
      orderedIds.every((id) => existingIds.has(id));
    if (!sameSet) {
      throw new AppError('invalid_input', 'Page order does not match the document pages');
    }
    await writePositions(txn, orderedIds);
    await syncDocumentAfterPageChange(txn, documentId);
  });
  notifyChanged('pages', 'documents');
}

/** Deletes pages and closes the gaps. Returns the deleted pages so the caller can remove files. */
export async function deletePages(db: SqlDb, documentId: string, pageIds: readonly string[]): Promise<Page[]> {
  const toDelete = new Set(pageIds);
  let deleted: Page[] = [];

  await db.withExclusiveTransactionAsync(async (txn) => {
    const rows = await txn.getAllAsync<PageRow>(
      'SELECT * FROM pages WHERE document_id = ? ORDER BY position',
      documentId,
    );
    deleted = rows.filter((row) => toDelete.has(row.id)).map(toPage);
    for (const page of deleted) {
      await txn.runAsync('DELETE FROM pages WHERE id = ?', page.id);
    }
    await writePositions(
      txn,
      rows.filter((row) => !toDelete.has(row.id)).map((row) => row.id),
    );
    await syncDocumentAfterPageChange(txn, documentId);
  });

  notifyChanged('pages', 'documents');
  return deleted;
}

/** Rotates a page clockwise by `quarterTurns` × 90°. */
export async function rotatePage(db: SqlDb, pageId: string, quarterTurns = 1): Promise<Rotation> {
  let rotation: Rotation = 0;
  await db.withExclusiveTransactionAsync(async (txn) => {
    const row = await txn.getFirstAsync<{ rotation: number; document_id: string }>(
      'SELECT rotation, document_id FROM pages WHERE id = ?',
      pageId,
    );
    if (!row) throw new AppError('not_found', `Page ${pageId} not found`);
    rotation = ((((row.rotation + quarterTurns * 90) % 360) + 360) % 360) as Rotation;
    await txn.runAsync(
      'UPDATE pages SET rotation = ?, updated_at = ? WHERE id = ?',
      rotation,
      Date.now(),
      pageId,
    );
    await syncDocumentAfterPageChange(txn, row.document_id);
  });
  notifyChanged('pages', 'documents');
  return rotation;
}
