/**
 * @jest-environment node
 */
import { PDFDocument } from '@cantoo/pdf-lib';

import { createMigratedDb } from '@/db/__tests__/nodeSqlite';
import { createDocument, getDocument } from '@/db/repositories/documents';
import { addPages } from '@/db/repositories/pages';
import type { SqlDb } from '@/db/types';
import type { Document } from '@/domain/models';

import { ensureDocumentPdf, extractPages, mergeDocuments, rotatePdfPages } from '../engine';

// In-memory stand-in for expo-file-system: uri → bytes. The PDF logic (pdf-lib) and DB are real.
const mockFiles = new Map<string, Uint8Array>();
jest.mock('expo-file-system', () => ({
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    get size() {
      return mockFiles.get(this.uri)?.length ?? null;
    }
    async bytes() {
      const bytes = mockFiles.get(this.uri);
      if (!bytes) throw new Error(`missing ${this.uri}`);
      return bytes;
    }
    write(content: Uint8Array) {
      mockFiles.set(this.uri, content);
    }
  },
}));

jest.mock('@/services/filesystem/storage', () => {
  let n = 0;
  const { File } = jest.requireMock('expo-file-system');
  return {
    ensureDocumentDirectory: jest.fn(),
    newDocumentFile: (id: string, base: string, ext: string) => new File(`file:///docs/${id}/${base}-${++n}.${ext}`),
    newDocumentImageFile: (id: string) => new File(`file:///docs/${id}/thumb-${++n}.jpg`),
    newScratchFile: (ext: string) => new File(`file:///cache/work/${++n}.${ext}`),
    deleteFileQuietly: (uri: string | null) => uri && mockFiles.delete(uri),
    deleteDocumentFiles: jest.fn(),
  };
});
jest.mock('@/services/pdf/index', () => ({
  renderPdfThumbnail: jest.fn(async () => null),
  inspectPdf: jest.fn(async () => null),
}));
jest.mock('@/services/image', () => ({ processImage: jest.fn() }));
jest.mock('docuna-native', () => ({ DocunaNative: null }));

// A valid 1×1 baseline JPEG.
const JPEG = Uint8Array.from(
  Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
    'base64',
  ),
);

async function makePdf(pageCount: number, options: { encrypt?: boolean } = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) pdf.addPage([300 + i, 400]);
  if (options.encrypt) pdf.encrypt({ userPassword: 'u', ownerPassword: 'o' });
  return pdf.save();
}

async function pdfDocument(db: SqlDb, title: string, pageCount: number, options: { encrypt?: boolean } = {}): Promise<Document> {
  const uri = `file:///docs/${title}/source.pdf`;
  mockFiles.set(uri, await makePdf(pageCount, options));
  return createDocument(db, {
    title,
    source: 'import_pdf',
    file: { kind: 'pdf', fileUri: uri, mimeType: 'application/pdf', originalName: `${title}.pdf`, sizeBytes: 1, pageCount },
  });
}

async function pageSizes(uri: string): Promise<number[]> {
  const pdf = await PDFDocument.load(mockFiles.get(uri)!);
  return pdf.getPages().map((page) => Math.round(page.getWidth()));
}

let db: SqlDb;

beforeEach(async () => {
  mockFiles.clear();
  db = await createMigratedDb();
});

describe('ensureDocumentPdf', () => {
  it('builds a PDF from scan pages once, then reuses it until pages change', async () => {
    const scan = await createDocument(db, { title: 'Scan', source: 'scan' });
    for (const name of ['a', 'b']) mockFiles.set(`file:///p/${name}.jpg`, JPEG);
    await addPages(db, scan.id, [
      { originalUri: 'file:///p/a.jpg', thumbnailUri: 'file:///p/a.jpg', width: 1, height: 1 },
      { originalUri: 'file:///p/b.jpg', thumbnailUri: 'file:///p/b.jpg', width: 1, height: 1 },
    ]);

    const first = await ensureDocumentPdf(db, (await getDocument(db, scan.id))!);
    expect(await pageSizes(first)).toEqual([595, 595]);
    const again = await ensureDocumentPdf(db, (await getDocument(db, scan.id))!);
    expect(again).toBe(first);
  });

  it('refuses kinds that are not scans or PDFs', async () => {
    const sheet = await createDocument(db, {
      title: 'Budget',
      source: 'import_file',
      file: { kind: 'sheet', fileUri: 'file:///b.xlsx', mimeType: null, originalName: 'b.xlsx', sizeBytes: 1 },
    });
    await expect(ensureDocumentPdf(db, sheet)).rejects.toMatchObject({ code: 'unsupported_file' });
  });
});

describe('merge / extract / rotate', () => {
  it('merges documents in order into a new PDF document', async () => {
    const a = await pdfDocument(db, 'A', 2);
    const b = await pdfDocument(db, 'B', 1);
    const merged = await mergeDocuments(db, [b, a], 'Combined');
    expect(merged).toMatchObject({ title: 'Combined', kind: 'pdf', pageCount: 3, inInbox: false });
    expect(await pageSizes(merged.fileUri!)).toEqual([300, 300, 301]);
  });

  it('extracts chosen pages in the chosen order', async () => {
    const a = await pdfDocument(db, 'A', 4);
    const extract = await extractPages(db, a, [3, 1], 'A pages 4 and 2');
    expect(await pageSizes(extract.fileUri!)).toEqual([303, 301]);
    expect(extract.pageCount).toBe(2);
  });

  it('rotates pages in place, replacing the stored file', async () => {
    const a = await pdfDocument(db, 'A', 2);
    const rotated = await rotatePdfPages(db, a, [1], 1);
    expect(rotated.fileUri).not.toBe(a.fileUri);
    expect(mockFiles.has(a.fileUri!)).toBe(false);
    const pdf = await PDFDocument.load(mockFiles.get(rotated.fileUri!)!);
    expect(pdf.getPages().map((page) => page.getRotation().angle)).toEqual([0, 90]);
  });

  it('reports password-protected PDFs clearly', async () => {
    const locked = await pdfDocument(db, 'Locked', 1, { encrypt: true });
    await expect(extractPages(db, locked, [0], 'x')).rejects.toMatchObject({ code: 'pdf_encrypted' });
  });

  it('needs at least two documents to merge', async () => {
    const a = await pdfDocument(db, 'A', 1);
    await expect(mergeDocuments(db, [a], 'x')).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
