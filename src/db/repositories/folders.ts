import { AppError } from '@/domain/errors';
import type { Folder, FolderWithCount } from '@/domain/models';
import { normalizeName } from '@/domain/validation';
import { newId } from '@/lib/id';

import { notifyChanged } from '../events';
import type { SqlDb } from '../types';

interface FolderRow {
  id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

function toFolder(row: FolderRow): Folder {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    color: row.color,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listFolders(db: SqlDb, parentId: string | null = null): Promise<FolderWithCount[]> {
  const rows = await db.getAllAsync<FolderRow & { document_count: number }>(
    `SELECT f.*,
       (SELECT COUNT(*) FROM documents d
         WHERE d.folder_id = f.id AND d.deleted_at IS NULL AND d.is_archived = 0) AS document_count
     FROM folders f
     WHERE f.parent_id IS ?
     ORDER BY f.sort_order, f.name COLLATE NOCASE`,
    parentId,
  );
  return rows.map((row) => ({ ...toFolder(row), documentCount: row.document_count }));
}

export async function getFolder(db: SqlDb, id: string): Promise<Folder | null> {
  const row = await db.getFirstAsync<FolderRow>('SELECT * FROM folders WHERE id = ?', id);
  return row ? toFolder(row) : null;
}

export async function createFolder(
  db: SqlDb,
  input: { name: string; parentId?: string | null; color?: string | null },
): Promise<Folder> {
  const now = Date.now();
  const folder: Folder = {
    id: newId(),
    name: normalizeName(input.name),
    parentId: input.parentId ?? null,
    color: input.color ?? null,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  };
  await db.runAsync(
    `INSERT INTO folders (id, name, parent_id, color, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    folder.id,
    folder.name,
    folder.parentId,
    folder.color,
    folder.sortOrder,
    folder.createdAt,
    folder.updatedAt,
  );
  notifyChanged('folders');
  return folder;
}

export async function renameFolder(db: SqlDb, id: string, name: string): Promise<void> {
  const result = await db.runAsync(
    'UPDATE folders SET name = ?, updated_at = ? WHERE id = ?',
    normalizeName(name),
    Date.now(),
    id,
  );
  if (result.changes === 0) throw new AppError('not_found', `Folder ${id} not found`);
  notifyChanged('folders');
}

/** Deletes the folder and its sub-folders. Documents inside are kept and become unfiled. */
export async function deleteFolder(db: SqlDb, id: string): Promise<void> {
  await db.runAsync('DELETE FROM folders WHERE id = ?', id);
  notifyChanged('folders', 'documents');
}
