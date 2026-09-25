/**
 * @jest-environment node
 */
import { LATEST_SCHEMA_VERSION, migrate } from '../migrations';
import { toggleBookmark, listBookmarks } from '../repositories/bookmarks';
import {
  createDocument,
  getContinueReading,
  getDocument,
  markOpened,
  setLastReadPage,
  trashDocument,
} from '../repositories/documents';
import { reorderPages } from '../repositories/pages';
import { searchDocuments } from '../repositories/search';
import { createNodeSqlDb } from './nodeSqlite';

describe('migration 2 (reader)', () => {
  it('upgrades a v1 database without losing documents, pages or the title index', async () => {
    const db = createNodeSqlDb();
    await migrate(db, 1);
    await db.runAsync(
      `INSERT INTO documents (id, title, source, page_count, created_at, updated_at) VALUES ('d1', 'Rent agreement', 'scan', 1, 1, 1)`,
    );
    await db.runAsync(
      `INSERT INTO pages (id, document_id, position, original_uri, thumbnail_uri, width, height, created_at, updated_at)
       VALUES ('p1', 'd1', 0, 'file:///o.jpg', 'file:///t.jpg', 10, 10, 1, 1)`,
    );

    await migrate(db);

    const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(version?.user_version).toBe(LATEST_SCHEMA_VERSION);
    expect(await getDocument(db, 'd1')).toMatchObject({ title: 'Rent agreement', kind: 'pages', lastReadPage: 0, pageCount: 1 });
    expect(await db.getFirstAsync('SELECT id FROM pages WHERE document_id = ?', 'd1')).toEqual({ id: 'p1' });
    expect((await searchDocuments(db, 'rent'))[0]?.documentId).toBe('d1');
    // Foreign keys are back on and still enforced.
    const fk = await db.getFirstAsync<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(fk?.foreign_keys).toBe(1);
    await db.runAsync('DELETE FROM documents WHERE id = ?', 'd1');
    expect(await db.getFirstAsync('SELECT id FROM pages WHERE id = ?', 'p1')).toBeNull();
  });
});

describe('file documents and reading state', () => {
  it('stores imported files and remembers the last page', async () => {
    const db = createNodeSqlDb();
    await migrate(db);
    const doc = await createDocument(db, {
      title: 'Lease',
      source: 'import_pdf',
      file: { kind: 'pdf', fileUri: 'file:///docs/x/source.pdf', mimeType: 'application/pdf', originalName: 'Lease.pdf', sizeBytes: 1234, pageCount: 12 },
    });
    expect(doc).toMatchObject({ kind: 'pdf', pageCount: 12, originalName: 'Lease.pdf', sizeBytes: 1234 });
    await setLastReadPage(db, doc.id, 7);
    expect((await getDocument(db, doc.id))?.lastReadPage).toBe(7);
  });

  it('toggles bookmarks, and page bookmarks follow their page when reordered', async () => {
    const db = createNodeSqlDb();
    await migrate(db);
    const doc = await createDocument(db, { title: 'Packet', source: 'scan' });
    for (const [i, id] of ['a', 'b'].entries()) {
      await db.runAsync(
        `INSERT INTO pages (id, document_id, position, original_uri, thumbnail_uri, width, height, created_at, updated_at)
         VALUES (?, ?, ?, 'file:///o.jpg', 'file:///t.jpg', 10, 10, 1, 1)`,
        id,
        doc.id,
        i,
      );
    }
    expect(await toggleBookmark(db, doc.id, 1, 'b')).toBe(true);
    await reorderPages(db, doc.id, ['b', 'a']);
    expect((await listBookmarks(db, doc.id)).map((b) => b.pageIndex)).toEqual([0]);
    expect(await toggleBookmark(db, doc.id, 0, 'b')).toBe(false);
    expect(await listBookmarks(db, doc.id)).toEqual([]);
  });
});

describe('continue reading', () => {
  it('returns the most recently opened live document', async () => {
    const db = createNodeSqlDb();
    await migrate(db);
    expect(await getContinueReading(db)).toBeNull();

    const a = await createDocument(db, { title: 'A', source: 'scan' });
    const b = await createDocument(db, { title: 'B', source: 'scan' });
    await markOpened(db, a.id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await markOpened(db, b.id);
    expect((await getContinueReading(db))?.id).toBe(b.id);

    await trashDocument(db, b.id);
    expect((await getContinueReading(db))?.id).toBe(a.id);
  });
});

describe('migration 5 (office kinds)', () => {
  it('keeps every document and its reading state, and accepts the new kinds', async () => {
    const db = createNodeSqlDb();
    await migrate(db, 4);
    await db.runAsync(
      `INSERT INTO documents (id, title, source, kind, page_count, last_read_page, last_opened_at, created_at, updated_at)
       VALUES ('d1', 'Lease', 'import_pdf', 'pdf', 12, 7, 99, 1, 1)`,
    );
    await migrate(db);

    expect(await getDocument(db, 'd1')).toMatchObject({ title: 'Lease', kind: 'pdf', lastReadPage: 7, lastOpenedAt: 99 });
    expect((await searchDocuments(db, 'lease'))[0]?.documentId).toBe('d1');

    const sheet = await createDocument(db, {
      title: 'Budget',
      source: 'import_file',
      file: { kind: 'sheet', fileUri: 'file:///b.xlsx', mimeType: null, originalName: 'Budget.xlsx', sizeBytes: 10 },
    });
    expect(sheet.kind).toBe('sheet');
  });
});
