import type { Bookmark } from '@/domain/models';
import { newId } from '@/lib/id';

import { notifyChanged } from '../events';
import type { SqlDb } from '../types';

interface BookmarkRow {
  id: string;
  document_id: string;
  page_index: number;
  label: string | null;
  created_at: number;
}

function toBookmark(row: BookmarkRow): Bookmark {
  return {
    id: row.id,
    documentId: row.document_id,
    pageIndex: row.page_index,
    label: row.label,
    createdAt: row.created_at,
  };
}

/**
 * Bookmarks in page order. For page-image documents the bookmark follows its page when pages are
 * reordered (page_id), so the index is resolved from the page's current position.
 */
export async function listBookmarks(db: SqlDb, documentId: string): Promise<Bookmark[]> {
  const rows = await db.getAllAsync<BookmarkRow>(
    `SELECT b.id, b.document_id, COALESCE(p.position, b.page_index) AS page_index, b.label, b.created_at
     FROM bookmarks b LEFT JOIN pages p ON p.id = b.page_id
     WHERE b.document_id = ?
     ORDER BY page_index`,
    documentId,
  );
  return rows.map(toBookmark);
}

/** Adds a bookmark on the page, or removes it if one exists. Returns true if now bookmarked. */
export async function toggleBookmark(
  db: SqlDb,
  documentId: string,
  pageIndex: number,
  pageId: string | null = null,
): Promise<boolean> {
  const existing = (await listBookmarks(db, documentId)).find((bookmark) => bookmark.pageIndex === pageIndex);
  if (existing) {
    await db.runAsync('DELETE FROM bookmarks WHERE id = ?', existing.id);
  } else {
    await db.runAsync(
      'INSERT INTO bookmarks (id, document_id, page_id, page_index, label, created_at) VALUES (?, ?, ?, ?, NULL, ?)',
      newId(),
      documentId,
      pageId,
      pageIndex,
      Date.now(),
    );
  }
  notifyChanged('documents');
  return !existing;
}
