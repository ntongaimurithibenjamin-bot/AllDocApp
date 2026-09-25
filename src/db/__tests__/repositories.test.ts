/**
 * @jest-environment node
 */
import { AppError } from '@/domain/errors';
import type { NewPage } from '@/domain/models';

import { LATEST_SCHEMA_VERSION, migrate } from '../migrations';
import * as documents from '../repositories/documents';
import * as folders from '../repositories/folders';
import * as pages from '../repositories/pages';
import { buildFtsQuery, searchDocuments } from '../repositories/search';
import * as settings from '../repositories/settings';
import type { SqlDb } from '../types';
import { createMigratedDb } from './nodeSqlite';

function fakePage(name: string): NewPage {
  return {
    originalUri: `file:///docs/${name}/original.jpg`,
    thumbnailUri: `file:///docs/${name}/thumb.jpg`,
    width: 1240,
    height: 1754,
  };
}

async function pageOrder(db: SqlDb, documentId: string): Promise<string[]> {
  return (await pages.listPages(db, documentId)).map((page) => page.originalUri.split('/')[4]!);
}

let db: SqlDb;

beforeEach(async () => {
  db = await createMigratedDb();
});

describe('migrations', () => {
  it('sets the schema version and is idempotent', async () => {
    await migrate(db);
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(row?.user_version).toBe(LATEST_SCHEMA_VERSION);
  });
});

describe('documents', () => {
  it('creates a document in the inbox with a normalised title', async () => {
    const doc = await documents.createDocument(db, { title: '  Rent / March  ', source: 'scan' });
    expect(doc.title).toBe('Rent March');
    expect(doc.inInbox).toBe(true);
    expect(doc.pageCount).toBe(0);
    expect(doc.pdfStale).toBe(true);
  });

  it('rejects an empty title', async () => {
    await expect(documents.createDocument(db, { title: ' / ', source: 'scan' })).rejects.toBeInstanceOf(AppError);
  });

  it('filters by folder, favourites and archive, and hides trashed documents', async () => {
    const folder = await folders.createFolder(db, { name: 'School' });
    const a = await documents.createDocument(db, { title: 'A', source: 'scan', folderId: folder.id });
    const b = await documents.createDocument(db, { title: 'B', source: 'scan' });
    const c = await documents.createDocument(db, { title: 'C', source: 'scan' });
    await documents.setFavorite(db, b.id, true);
    await documents.setArchived(db, c.id, true);

    expect((await documents.listDocuments(db, { folderId: folder.id })).map((d) => d.id)).toEqual([a.id]);
    expect((await documents.listDocuments(db, { folderId: null })).map((d) => d.id)).toEqual([b.id]);
    expect((await documents.listDocuments(db, { favoritesOnly: true })).map((d) => d.id)).toEqual([b.id]);
    expect((await documents.listDocuments(db, { archived: true })).map((d) => d.id)).toEqual([c.id]);

    await documents.trashDocument(db, a.id);
    expect(await documents.listDocuments(db, { folderId: folder.id })).toEqual([]);
    expect((await documents.listTrashedDocuments(db)).map((d) => d.id)).toEqual([a.id]);

    await documents.restoreDocument(db, a.id);
    expect(await documents.countDocuments(db)).toBe(3);
  });

  it('moving a document files it out of the inbox', async () => {
    const folder = await folders.createFolder(db, { name: 'Receipts' });
    const doc = await documents.createDocument(db, { title: 'Receipt', source: 'scan' });
    await documents.moveDocument(db, doc.id, folder.id);
    const moved = await documents.getDocument(db, doc.id);
    expect(moved?.folderId).toBe(folder.id);
    expect(moved?.inInbox).toBe(false);
  });

  it('purges only documents trashed before the cutoff, cascading to pages', async () => {
    const old = await documents.createDocument(db, { title: 'Old', source: 'scan' });
    await pages.addPages(db, old.id, [fakePage('p1')]);
    await documents.trashDocument(db, old.id);
    const cutoff = Date.now() + 1;

    const purged = await documents.purgeTrashedDocuments(db, cutoff);
    expect(purged).toEqual([old.id]);
    expect(await documents.getDocument(db, old.id)).toBeNull();
    expect(await pages.listPages(db, old.id)).toEqual([]);
  });

  it('throws not_found when updating a missing document', async () => {
    await expect(documents.renameDocument(db, 'missing', 'X')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('folders', () => {
  it('counts documents and unfiles them when the folder is deleted', async () => {
    const folder = await folders.createFolder(db, { name: 'Work' });
    const doc = await documents.createDocument(db, { title: 'Contract', source: 'scan', folderId: folder.id });

    expect((await folders.listFolders(db))[0]).toMatchObject({ name: 'Work', documentCount: 1 });

    await folders.deleteFolder(db, folder.id);
    expect(await folders.listFolders(db)).toEqual([]);
    expect((await documents.getDocument(db, doc.id))?.folderId).toBeNull();
  });
});

describe('pages', () => {
  let docId: string;

  beforeEach(async () => {
    docId = (await documents.createDocument(db, { title: 'Packet', source: 'scan' })).id;
    await pages.addPages(db, docId, [fakePage('p1'), fakePage('p2'), fakePage('p3')]);
  });

  it('appends pages in order and updates the document', async () => {
    expect(await pageOrder(db, docId)).toEqual(['p1', 'p2', 'p3']);
    const doc = await documents.getDocument(db, docId);
    expect(doc?.pageCount).toBe(3);
    expect(doc?.thumbnailUri).toBe('file:///docs/p1/thumb.jpg');
  });

  it('inserts pages at a position', async () => {
    await pages.addPages(db, docId, [fakePage('x')], 1);
    expect(await pageOrder(db, docId)).toEqual(['p1', 'x', 'p2', 'p3']);
    const positions = (await pages.listPages(db, docId)).map((page) => page.position);
    expect(positions).toEqual([0, 1, 2, 3]);
  });

  it('reorders pages and refreshes the cover thumbnail', async () => {
    const ids = (await pages.listPages(db, docId)).map((page) => page.id);
    await pages.reorderPages(db, docId, [ids[2]!, ids[0]!, ids[1]!]);
    expect(await pageOrder(db, docId)).toEqual(['p3', 'p1', 'p2']);
    expect((await documents.getDocument(db, docId))?.thumbnailUri).toBe('file:///docs/p3/thumb.jpg');
  });

  it('rejects a reorder that does not match the document pages', async () => {
    const ids = (await pages.listPages(db, docId)).map((page) => page.id);
    await expect(pages.reorderPages(db, docId, [ids[0]!, ids[0]!, ids[1]!])).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(pages.reorderPages(db, docId, ids.slice(0, 2))).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await pageOrder(db, docId)).toEqual(['p1', 'p2', 'p3']);
  });

  it('deletes pages, closes gaps and returns the deleted pages', async () => {
    const ids = (await pages.listPages(db, docId)).map((page) => page.id);
    const deleted = await pages.deletePages(db, docId, [ids[1]!]);
    expect(deleted.map((page) => page.id)).toEqual([ids[1]]);
    expect(await pageOrder(db, docId)).toEqual(['p1', 'p3']);
    expect((await pages.listPages(db, docId)).map((page) => page.position)).toEqual([0, 1]);
    expect((await documents.getDocument(db, docId))?.pageCount).toBe(2);
  });

  it('records a new render, resets OCR and refreshes the cover', async () => {
    const [first] = await pages.listPages(db, docId);
    await db.runAsync(
      `INSERT INTO ocr_pages (page_id, document_id, text, engine, processed_at) VALUES (?, ?, 'old text', 'test', 0)`,
      first!.id,
      docId,
    );
    await pages.updatePageRender(db, first!.id, {
      originalUri: first!.originalUri,
      processedUri: 'file:///docs/p1/processed-2.jpg',
      thumbnailUri: 'file:///docs/p1/thumb-2.jpg',
      width: 1754,
      height: 1240,
      rotation: 90,
      crop: null,
      filter: 'bw',
    });

    const updated = await pages.getPage(db, first!.id);
    expect(updated).toMatchObject({ rotation: 90, filter: 'bw', width: 1754, ocrStatus: 'pending' });
    expect(await db.getFirstAsync('SELECT * FROM ocr_pages WHERE page_id = ?', first!.id)).toBeNull();
    expect((await documents.getDocument(db, docId))?.thumbnailUri).toBe('file:///docs/p1/thumb-2.jpg');
  });

  it('rolls back a failed batch insert', async () => {
    await expect(pages.addPages(db, 'missing', [fakePage('y')])).rejects.toMatchObject({ code: 'not_found' });
    expect(await pages.listPages(db, 'missing')).toEqual([]);
  });
});

describe('search', () => {
  it('builds quoted, prefix-terminated FTS queries', () => {
    expect(buildFtsQuery('KSh 25,000')).toBe('"ksh" "25" "000"*');
    expect(buildFtsQuery('  "univ OR x*')).toBe('"univ" "or" "x"*');
    expect(buildFtsQuery(' ,.; ')).toBeNull();
  });

  it('finds documents by title and by OCR page text with page numbers', async () => {
    const rent = await documents.createDocument(db, { title: 'Rent agreement', source: 'scan' });
    const invoice = await documents.createDocument(db, { title: 'Scan 2026-09-25', source: 'scan' });
    const [, page2] = await pages.addPages(db, invoice.id, [fakePage('i1'), fakePage('i2')]);
    await db.runAsync(
      `INSERT INTO ocr_pages (page_id, document_id, text, engine, processed_at) VALUES (?, ?, ?, 'test', 0)`,
      page2!.id,
      invoice.id,
      'Invoice INV-29382. Total due: KSh 25,000 by 15 October 2026.',
    );

    const byTitle = await searchDocuments(db, 'rent');
    expect(byTitle).toEqual([{ documentId: rent.id, title: 'Rent agreement', pageNumber: null, snippet: null }]);

    const byAmount = await searchDocuments(db, 'KSh 25,000');
    expect(byAmount).toHaveLength(1);
    expect(byAmount[0]).toMatchObject({ documentId: invoice.id, pageNumber: 2 });
    expect(byAmount[0]!.snippet).toContain('[KSh]');

    expect(await searchDocuments(db, 'univ')).toEqual([]);
  });

  it('keeps the title index in sync with renames and hides trashed documents', async () => {
    const doc = await documents.createDocument(db, { title: 'IMG_20260925', source: 'scan' });
    await documents.renameDocument(db, doc.id, 'SMA3101 Assignment 1');
    expect((await searchDocuments(db, 'sma3101'))[0]?.documentId).toBe(doc.id);
    expect(await searchDocuments(db, 'img')).toEqual([]);

    await documents.trashDocument(db, doc.id);
    expect(await searchDocuments(db, 'assignment')).toEqual([]);
  });
});

describe('settings', () => {
  it('returns defaults and persists typed values', async () => {
    expect(await settings.getSetting(db, 'themePreference')).toBe('system');
    await settings.setSetting(db, 'themePreference', 'dark');
    await settings.setSetting(db, 'themePreference', 'light');
    expect(await settings.getSetting(db, 'themePreference')).toBe('light');
    expect(await settings.getSetting(db, 'autoExportDirectoryUri')).toBeNull();
  });
});

describe('inbox ("Recently scanned")', () => {
  it('only receives scans unless the caller says otherwise', async () => {
    const scan = await documents.createDocument(db, { title: 'Scan', source: 'scan' });
    const pdf = await documents.createDocument(db, {
      title: 'Lease',
      source: 'import_pdf',
      file: { kind: 'pdf', fileUri: 'file:///x.pdf', mimeType: 'application/pdf', originalName: 'x.pdf', sizeBytes: 1 },
    });
    const opened = await documents.createDocument(db, { title: 'Photo', source: 'import_image' });
    const scannedPhotos = await documents.createDocument(db, { title: 'Photos', source: 'import_image', inInbox: true });

    const inbox = (await documents.listDocuments(db, { inboxOnly: true })).map((d) => d.id).sort();
    expect(inbox).toEqual([scan.id, scannedPhotos.id].sort());
    expect(inbox).not.toContain(pdf.id);
    expect(inbox).not.toContain(opened.id);
  });
});
