/**
 * @jest-environment node
 */
import { createMigratedDb, createNodeSqlDb } from '@/db/__tests__/nodeSqlite';
import { migrate } from '@/db/migrations';
import { createDocument, getDocument, trashDocument } from '@/db/repositories/documents';
import { createFolder } from '@/db/repositories/folders';
import {
  countPendingOcrPages,
  getDocumentOcrProgress,
  getDocumentText,
  nextOcrJob,
  resetDocumentOcr,
  type RecognizedText,
} from '@/db/repositories/ocr';
import { addPages, updatePageRender } from '@/db/repositories/pages';
import { searchDocuments } from '@/db/repositories/search';
import type { SqlDb } from '@/db/types';

import { runOcrStep, type OcrEngine } from '../queue';

function recognized(text: string): RecognizedText {
  return { text, lines: [{ text, box: [0.1, 0.1, 0.5, 0.05] }], confidence: 0.9 };
}

function codedError(code: string) {
  return Object.assign(new Error(code), { code });
}

/** Fake device: page text keyed by image URI or `${pdfUri}#${pageIndex}`. */
function fakeEngine(texts: Record<string, string>, overrides: Partial<OcrEngine> = {}): OcrEngine {
  return {
    recognizeImage: jest.fn(async (uri: string) => recognized(texts[uri] ?? '')),
    recognizePdfPage: jest.fn(async (uri: string, index: number) => recognized(texts[`${uri}#${index}`] ?? '')),
    pdfPageCount: jest.fn(async () => 0),
    readText: jest.fn(async (uri: string) => texts[uri] ?? ''),
    ...overrides,
  };
}

async function drain(db: SqlDb, engine: OcrEngine, max = 50) {
  for (let i = 0; i < max; i++) if ((await runOcrStep(db, engine)) !== 'worked') return;
  throw new Error('OCR queue did not finish');
}

const scanPage = (name: string) => ({
  originalUri: `file:///docs/${name}.jpg`,
  thumbnailUri: `file:///docs/${name}-t.jpg`,
  width: 1240,
  height: 1754,
});

const pdfFile = (pageCount: number) => ({
  kind: 'pdf' as const,
  fileUri: 'file:///docs/lease.pdf',
  mimeType: 'application/pdf',
  originalName: 'Lease.pdf',
  sizeBytes: 1000,
  pageCount,
});

let db: SqlDb;
beforeEach(async () => {
  db = await createMigratedDb();
});

describe('migration 6 (OCR for files)', () => {
  it('keeps existing scan text searchable', async () => {
    const old = createNodeSqlDb();
    await migrate(old, 5);
    await old.runAsync(`INSERT INTO documents (id, title, source, created_at, updated_at) VALUES ('d1', 'Scan', 'scan', 1, 1)`);
    await old.runAsync(
      `INSERT INTO pages (id, document_id, position, original_uri, thumbnail_uri, width, height, created_at, updated_at)
       VALUES ('p1', 'd1', 0, 'file:///o.jpg', 'file:///t.jpg', 10, 10, 1, 1)`,
    );
    await old.runAsync(`INSERT INTO ocr_pages (page_id, document_id, text, engine, processed_at) VALUES ('p1', 'd1', 'Naivas receipt', 'x', 1)`);

    await migrate(old);

    expect(await searchDocuments(old, 'naivas')).toMatchObject([{ documentId: 'd1', pageNumber: 1 }]);
    expect((await getDocument(old, 'd1'))?.ocrState).toBe('pending');
  });
});

describe('OCR queue', () => {
  it('recognises scanned pages and makes "KSh 25,000" searchable offline', async () => {
    const doc = await createDocument(db, { title: 'Scan 2026-09-26 10.00', source: 'scan' });
    await addPages(db, doc.id, [scanPage('a'), scanPage('b')]);
    const engine = fakeEngine({ 'file:///docs/b.jpg': 'Invoice INV-29382\nTotal due: KSh 25,000 by 15 October 2026' });

    expect(await countPendingOcrPages(db)).toBe(2);
    await drain(db, engine);

    expect(await countPendingOcrPages(db)).toBe(0);
    expect(await getDocumentOcrProgress(db, doc.id)).toEqual({ done: 2, total: 2, state: 'done' });
    expect(await searchDocuments(db, 'KSh 25,000')).toMatchObject([{ documentId: doc.id, pageNumber: 2, pageMatches: 1 }]);
    const text = await getDocumentText(db, doc.id);
    expect(text.map((page) => page.pageNumber)).toEqual([1, 2]);
    expect(text[1]?.lines[0]?.box).toEqual([0.1, 0.1, 0.5, 0.05]);
  });

  it('recognises PDFs page by page, resumable, with page-number hits', async () => {
    const doc = await createDocument(db, { title: 'Lease', source: 'import_pdf', file: pdfFile(3) });
    const engine = fakeEngine({ 'file:///docs/lease.pdf#2': 'Monthly rent KSh 25,000 payable to the landlord' });

    // Two steps, then "the app is closed": progress is kept.
    await runOcrStep(db, engine);
    await runOcrStep(db, engine);
    expect(await getDocumentOcrProgress(db, doc.id)).toEqual({ done: 2, total: 3, state: 'pending' });
    expect(await nextOcrJob(db)).toMatchObject({ kind: 'pdf-page', pageIndex: 2 });

    await drain(db, engine);
    expect(engine.recognizePdfPage).toHaveBeenCalledTimes(3);
    expect((await getDocument(db, doc.id))?.ocrState).toBe('done');
    expect(await searchDocuments(db, 'landlord')).toMatchObject([{ documentId: doc.id, pageNumber: 3, kind: 'pdf' }]);
  });

  it('skips a failing PDF page but marks encrypted PDFs as failed', async () => {
    const doc = await createDocument(db, { title: 'Report', source: 'import_pdf', file: pdfFile(2) });
    const flaky = fakeEngine(
      {},
      {
        recognizePdfPage: jest.fn(async (_uri: string, index: number) => {
          if (index === 0) throw new Error('decode failed');
          return recognized('Annual report');
        }),
      },
    );
    await drain(db, flaky);
    expect((await getDocument(db, doc.id))?.ocrState).toBe('done');
    expect(await searchDocuments(db, 'annual')).toMatchObject([{ pageNumber: 2 }]);

    const locked = await createDocument(db, { title: 'Locked', source: 'import_pdf', file: pdfFile(4) });
    await drain(db, fakeEngine({}, { recognizePdfPage: jest.fn(async () => Promise.reject(codedError('ERR_PDF_ENCRYPTED'))) }));
    expect((await getDocument(db, locked.id))?.ocrState).toBe('failed');
  });

  it('learns the page count of PDFs imported without one', async () => {
    const doc = await createDocument(db, { title: 'Unknown', source: 'import_pdf', file: pdfFile(0) });
    const engine = fakeEngine({ 'file:///docs/lease.pdf#0': 'Hello' }, { pdfPageCount: jest.fn(async () => 1) });
    await drain(db, engine);
    expect(await getDocument(db, doc.id)).toMatchObject({ pageCount: 1, ocrState: 'done' });
  });

  it('waits (keeps pages pending) while the OCR model is downloading', async () => {
    const doc = await createDocument(db, { title: 'Scan', source: 'scan' });
    await addPages(db, doc.id, [scanPage('a')]);
    const engine = fakeEngine({}, { recognizeImage: jest.fn(async () => Promise.reject(codedError('ERR_OCR_UNAVAILABLE'))) });
    expect(await runOcrStep(db, engine)).toBe('unavailable');
    expect(await countPendingOcrPages(db)).toBe(1);
  });

  it('marks unreadable scan pages as failed and moves on', async () => {
    const doc = await createDocument(db, { title: 'Scan', source: 'scan' });
    await addPages(db, doc.id, [scanPage('a'), scanPage('b')]);
    const engine = fakeEngine(
      { 'file:///docs/b.jpg': 'Second page' },
      {
        recognizeImage: jest.fn(async (uri: string) => {
          if (uri.endsWith('a.jpg')) throw new Error('corrupt');
          return recognized('Second page');
        }),
      },
    );
    await drain(db, engine);
    expect(await getDocumentOcrProgress(db, doc.id)).toEqual({ done: 2, total: 2, state: 'done' });
  });

  it('discards text for a page edited while it was being recognised', async () => {
    const doc = await createDocument(db, { title: 'Scan', source: 'scan' });
    const [page] = await addPages(db, doc.id, [scanPage('a')]);
    const engine = fakeEngine(
      {},
      {
        recognizeImage: jest.fn(async () => {
          // The user rotates the page mid-recognition.
          await updatePageRender(db, page!.id, {
            originalUri: 'file:///docs/a.jpg',
            processedUri: 'file:///docs/a-rotated.jpg',
            thumbnailUri: 'file:///docs/a-rotated-t.jpg',
            width: 1754,
            height: 1240,
            rotation: 90,
            crop: null,
            filter: 'original',
          });
          return recognized('stale text');
        }),
      },
    );
    await runOcrStep(db, engine);
    expect(await searchDocuments(db, 'stale')).toEqual([]);
    // Still pending, now for the new image.
    expect(await nextOcrJob(db)).toMatchObject({ kind: 'scan-page', imageUri: 'file:///docs/a-rotated.jpg' });
  });

  it('indexes text files, ignores trashed documents, and re-runs on request', async () => {
    const notes = await createDocument(db, {
      title: 'Notes',
      source: 'import_file',
      file: { kind: 'text', fileUri: 'file:///docs/notes.txt', mimeType: 'text/plain', originalName: 'notes.txt', sizeBytes: 10, pageCount: 1 },
    });
    const trashed = await createDocument(db, { title: 'Old', source: 'scan' });
    await addPages(db, trashed.id, [scanPage('old')]);
    await trashDocument(db, trashed.id);

    const engine = fakeEngine({ 'file:///docs/notes.txt': 'Meeting with the chama treasurer' });
    await drain(db, engine);
    expect(engine.recognizeImage).not.toHaveBeenCalled();
    expect(await searchDocuments(db, 'chama')).toMatchObject([{ documentId: notes.id, pageNumber: 1 }]);

    await resetDocumentOcr(db, notes.id);
    expect(await searchDocuments(db, 'chama')).toEqual([]);
    await drain(db, engine);
    expect(await searchDocuments(db, 'chama')).toHaveLength(1);
  });
});

describe('inbox suggestions', () => {
  it('suggests a title and folder for a new scan from its text', async () => {
    const receipts = await createFolder(db, { name: 'Receipts' });
    const doc = await createDocument(db, { title: 'Scan 2026-09-26 10.00', source: 'scan' });
    await addPages(db, doc.id, [scanPage('r')]);
    const engine = fakeEngine({
      'file:///docs/r.jpg': 'NAIVAS\nWestlands Branch\nCASH SALE RECEIPT\nDate: 12/09/2026\nTOTAL 1,250.00\nM-PESA 1,250.00\nServed by: Jane',
    });
    await drain(db, engine);

    expect((await getDocument(db, doc.id))?.suggestion).toEqual({
      type: 'receipt',
      title: 'Receipt – Naivas 2026-09-12',
      date: '2026-09-12',
      folderId: receipts.id,
    });
  });

  it('does not suggest renaming a document the user already named', async () => {
    const doc = await createDocument(db, { title: 'Chama minutes', source: 'scan' });
    await addPages(db, doc.id, [scanPage('m')]);
    await drain(db, fakeEngine({ 'file:///docs/m.jpg': 'Dear members,\nRe: Annual meeting\nYours faithfully,\nSecretary' }));
    expect((await getDocument(db, doc.id))?.suggestion).toBeNull();
  });
});
