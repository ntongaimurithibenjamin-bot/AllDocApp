import { purgeTrashedDocuments } from '@/db/repositories/documents';
import type { SqlDb } from '@/db/types';
import { deleteDocumentFiles } from '@/services/filesystem/storage';

export const TRASH_RETENTION_DAYS = 30;
const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

async function purge(db: SqlDb, olderThan: number): Promise<number> {
  // Rows go first: a crash between the two steps leaves orphaned files (reclaimable),
  // never rows pointing at missing files.
  const ids = await purgeTrashedDocuments(db, olderThan);
  for (const id of ids) deleteDocumentFiles(id);
  return ids.length;
}

/** Permanently deletes documents that have been in the trash longer than the retention period. */
export function purgeExpiredTrash(db: SqlDb, now: number = Date.now()): Promise<number> {
  return purge(db, now - TRASH_RETENTION_MS);
}

export function emptyTrash(db: SqlDb): Promise<number> {
  return purge(db, Number.MAX_SAFE_INTEGER);
}
