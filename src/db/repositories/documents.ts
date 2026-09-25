import { AppError } from '@/domain/errors';
import type { Document, DocumentKind, DocumentQuery, DocumentSource } from '@/domain/models';
import { normalizeName } from '@/domain/validation';
import { newId } from '@/lib/id';

import { notifyChanged } from '../events';
import type { SqlDb, SqlParam } from '../types';

interface DocumentRow {
  id: string;
  title: string;
  folder_id: string | null;
  source: DocumentSource;
  kind: DocumentKind;
  file_uri: string | null;
  mime_type: string | null;
  original_name: string | null;
  page_count: number;
  thumbnail_uri: string | null;
  pdf_uri: string | null;
  pdf_stale: number;
  size_bytes: number;
  is_favorite: number;
  is_archived: number;
  in_inbox: number;
  last_read_page: number;
  last_opened_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

function toDocument(row: DocumentRow): Document {
  return {
    id: row.id,
    title: row.title,
    folderId: row.folder_id,
    source: row.source,
    kind: row.kind,
    fileUri: row.file_uri,
    mimeType: row.mime_type,
    originalName: row.original_name,
    pageCount: row.page_count,
    thumbnailUri: row.thumbnail_uri,
    pdfUri: row.pdf_uri,
    pdfStale: row.pdf_stale === 1,
    sizeBytes: row.size_bytes,
    isFavorite: row.is_favorite === 1,
    isArchived: row.is_archived === 1,
    inInbox: row.in_inbox === 1,
    lastReadPage: row.last_read_page,
    lastOpenedAt: row.last_opened_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

const SORT_SQL = {
  updated: 'updated_at DESC',
  created: 'created_at DESC',
  title: 'title COLLATE NOCASE ASC',
} as const;

/** Lists non-deleted documents. Archived documents are excluded unless `archived: true`. */
export async function listDocuments(db: SqlDb, query: DocumentQuery = {}): Promise<Document[]> {
  const where = ['deleted_at IS NULL', 'is_archived = ?'];
  const params: SqlParam[] = [query.archived ? 1 : 0];

  if (query.folderId !== undefined) {
    where.push('folder_id IS ?');
    params.push(query.folderId);
  }
  if (query.favoritesOnly) where.push('is_favorite = 1');
  if (query.inboxOnly) where.push('in_inbox = 1');

  let sql = `SELECT * FROM documents WHERE ${where.join(' AND ')} ORDER BY ${SORT_SQL[query.sort ?? 'updated']}`;
  if (query.limit !== undefined) {
    sql += ' LIMIT ?';
    params.push(query.limit);
  }
  const rows = await db.getAllAsync<DocumentRow>(sql, ...params);
  return rows.map(toDocument);
}

export async function getDocument(db: SqlDb, id: string): Promise<Document | null> {
  const row = await db.getFirstAsync<DocumentRow>('SELECT * FROM documents WHERE id = ?', id);
  return row ? toDocument(row) : null;
}

export interface FileDocumentInput {
  kind: Exclude<DocumentKind, 'pages'>;
  fileUri: string;
  mimeType: string | null;
  originalName: string | null;
  sizeBytes: number;
  pageCount?: number;
  thumbnailUri?: string | null;
}

export async function createDocument(
  db: SqlDb,
  input: {
    title: string;
    source: DocumentSource;
    folderId?: string | null;
    id?: string;
    /** For imported PDFs / text files; omitted for page-image documents. */
    file?: FileDocumentInput;
    /**
     * Whether it lands in the inbox ("Recently scanned") for filing. Defaults to true only for
     * scans; files opened from the phone are not "scanned".
     */
    inInbox?: boolean;
  },
): Promise<Document> {
  const now = Date.now();
  const id = input.id ?? newId();
  const file = input.file;
  await db.runAsync(
    `INSERT INTO documents (id, title, folder_id, source, kind, file_uri, mime_type, original_name,
                            size_bytes, page_count, thumbnail_uri, in_inbox, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    normalizeName(input.title),
    input.folderId ?? null,
    input.source,
    file?.kind ?? 'pages',
    file?.fileUri ?? null,
    file?.mimeType ?? null,
    file?.originalName ?? null,
    file?.sizeBytes ?? 0,
    file?.pageCount ?? 0,
    file?.thumbnailUri ?? null,
    (input.inInbox ?? input.source === 'scan') ? 1 : 0,
    now,
    now,
  );
  notifyChanged('documents');
  const created = await getDocument(db, id);
  if (!created) throw new AppError('database_failure', `Document ${id} missing after insert`);
  return created;
}

async function updateDocument(db: SqlDb, id: string, assignments: string, ...params: SqlParam[]) {
  const result = await db.runAsync(
    `UPDATE documents SET ${assignments}, updated_at = ? WHERE id = ?`,
    ...params,
    Date.now(),
    id,
  );
  if (result.changes === 0) throw new AppError('not_found', `Document ${id} not found`);
  notifyChanged('documents');
}

export function renameDocument(db: SqlDb, id: string, title: string): Promise<void> {
  return updateDocument(db, id, 'title = ?', normalizeName(title));
}

/** Moving a document into a folder also files it out of the inbox. */
export function moveDocument(db: SqlDb, id: string, folderId: string | null): Promise<void> {
  return updateDocument(db, id, 'folder_id = ?, in_inbox = 0', folderId);
}

export function setFavorite(db: SqlDb, id: string, isFavorite: boolean): Promise<void> {
  return updateDocument(db, id, 'is_favorite = ?', isFavorite ? 1 : 0);
}

export function setArchived(db: SqlDb, id: string, isArchived: boolean): Promise<void> {
  return updateDocument(db, id, 'is_archived = ?, in_inbox = 0', isArchived ? 1 : 0);
}

/**
 * Remembers where the reader is. Doesn't touch updated_at: reading isn't editing, and lists sort by
 * last modified.
 */
export async function setLastReadPage(db: SqlDb, id: string, page: number): Promise<void> {
  await db.runAsync('UPDATE documents SET last_read_page = ? WHERE id = ?', Math.max(0, Math.floor(page)), id);
}

/** Records that the reader opened the document (drives "Continue reading"). */
export async function markOpened(db: SqlDb, id: string): Promise<void> {
  await db.runAsync('UPDATE documents SET last_opened_at = ? WHERE id = ?', Date.now(), id);
  notifyChanged('documents');
}

/** The most recently read document, if any (not trashed or archived). */
export async function getContinueReading(db: SqlDb): Promise<Document | null> {
  const row = await db.getFirstAsync<DocumentRow>(
    `SELECT * FROM documents
     WHERE last_opened_at IS NOT NULL AND deleted_at IS NULL AND is_archived = 0
     ORDER BY last_opened_at DESC LIMIT 1`,
  );
  return row ? toDocument(row) : null;
}

/** The reader learns a PDF's page count on open (e.g. password-protected files import with 0). */
export async function setPageCount(db: SqlDb, id: string, pageCount: number): Promise<void> {
  const result = await db.runAsync(
    'UPDATE documents SET page_count = ? WHERE id = ? AND page_count != ?',
    pageCount,
    id,
    pageCount,
  );
  if (result.changes > 0) notifyChanged('documents');
}

/** Sets a file document's cover thumbnail (and page count, if it was unknown). */
export async function setDocumentCover(db: SqlDb, id: string, thumbnailUri: string, pageCount: number): Promise<void> {
  await db.runAsync('UPDATE documents SET thumbnail_uri = ?, page_count = ? WHERE id = ?', thumbnailUri, pageCount, id);
  notifyChanged('documents');
}

export function markFiled(db: SqlDb, id: string): Promise<void> {
  return updateDocument(db, id, 'in_inbox = 0');
}

/** Moves a document to the trash. Files stay on disk until the trash is emptied. */
export function trashDocument(db: SqlDb, id: string): Promise<void> {
  return updateDocument(db, id, 'deleted_at = ?', Date.now());
}

export function restoreDocument(db: SqlDb, id: string): Promise<void> {
  return updateDocument(db, id, 'deleted_at = NULL');
}

/** Deletes a document row immediately (pages cascade). The caller removes its files. */
export async function deleteDocumentPermanently(db: SqlDb, id: string): Promise<void> {
  await db.runAsync('DELETE FROM documents WHERE id = ?', id);
  notifyChanged('documents', 'pages');
}

export async function listTrashedDocuments(db: SqlDb): Promise<Document[]> {
  const rows = await db.getAllAsync<DocumentRow>(
    'SELECT * FROM documents WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC',
  );
  return rows.map(toDocument);
}

/**
 * Permanently removes trashed documents deleted before `olderThan` and returns their ids so the
 * caller can delete their files.
 */
export async function purgeTrashedDocuments(db: SqlDb, olderThan: number): Promise<string[]> {
  const rows = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM documents WHERE deleted_at IS NOT NULL AND deleted_at < ?',
    olderThan,
  );
  if (rows.length === 0) return [];
  await db.runAsync(
    'DELETE FROM documents WHERE deleted_at IS NOT NULL AND deleted_at < ?',
    olderThan,
  );
  notifyChanged('documents', 'pages');
  return rows.map((row) => row.id);
}

export async function countDocuments(db: SqlDb): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM documents WHERE deleted_at IS NULL',
  );
  return row?.n ?? 0;
}
