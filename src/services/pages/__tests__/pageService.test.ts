/**
 * @jest-environment node
 */
import { createMigratedDb } from '@/db/__tests__/nodeSqlite';
import { createDocument, getDocument } from '@/db/repositories/documents';
import { listPages } from '@/db/repositories/pages';
import type { SqlDb } from '@/db/types';
import { AppError } from '@/domain/errors';

import { createDocumentFromImages, editPage, importImagesIntoDocument } from '../pageService';

// Native image processing and the filesystem are replaced with in-memory fakes; the database is real.
const mockWritten = new Set<string>();
const mockDeletedPageDirs: string[] = [];
let mockFailOnSource: string | null = null;

jest.mock('@/services/image', () => ({
  processImage: jest.fn(async ({ sourceUri, outputUri, rotation = 0 }: { sourceUri: string; outputUri: string; rotation?: number }) => {
    if (sourceUri === mockFailOnSource) {
      const { AppError: MockAppError } = jest.requireActual('@/domain/errors');
      throw new MockAppError('invalid_image');
    }
    mockWritten.add(outputUri);
    return rotation % 180 === 0 ? { uri: outputUri, width: 1000, height: 1400 } : { uri: outputUri, width: 1400, height: 1000 };
  }),
  createThumbnail: jest.fn(async (_source: string, outputUri: string) => {
    mockWritten.add(outputUri);
    return { uri: outputUri, width: 257, height: 360 };
  }),
  getImageSize: jest.fn(async () => ({ width: 1000, height: 1400 })),
}));

jest.mock('@/services/filesystem/storage', () => {
  let n = 0;
  return {
    ensurePageDirectory: jest.fn(),
    newPageFile: jest.fn((docId: string, pageId: string, kind: string) => ({
      uri: `file:///docs/${docId}/pages/${pageId}/${kind}-${++n}.jpg`,
    })),
    deletePageFiles: jest.fn((_docId: string, pageId: string) => mockDeletedPageDirs.push(pageId)),
    deleteDocumentFiles: jest.fn(),
    deleteFileQuietly: jest.fn((uri: string) => mockWritten.delete(uri)),
  };
});

let db: SqlDb;

beforeEach(async () => {
  db = await createMigratedDb();
  mockWritten.clear();
  mockDeletedPageDirs.length = 0;
  mockFailOnSource = null;
});

describe('importImagesIntoDocument', () => {
  it('imports pages in order with originals and thumbnails', async () => {
    const doc = await createDocument(db, { title: 'Packet', source: 'scan' });
    const progress: number[] = [];
    await importImagesIntoDocument(db, doc.id, ['a', 'b', 'c'], { onProgress: (done) => progress.push(done) });

    const pages = await listPages(db, doc.id);
    expect(pages).toHaveLength(3);
    expect(pages.every((page) => page.originalUri.includes('/original-') && page.thumbnailUri.includes('/thumb-'))).toBe(true);
    expect(progress).toEqual([1, 2, 3]);
    expect((await getDocument(db, doc.id))?.pageCount).toBe(3);
  });

  it('inserts nothing and cleans up files when any page fails', async () => {
    const doc = await createDocument(db, { title: 'Packet', source: 'scan' });
    mockFailOnSource = 'c';
    await expect(importImagesIntoDocument(db, doc.id, ['a', 'b', 'c'])).rejects.toMatchObject({ code: 'invalid_image' });

    expect(await listPages(db, doc.id)).toEqual([]);
    // Two prepared pages rolled back + the failing page's own directory.
    expect(mockDeletedPageDirs).toHaveLength(3);
  });
});

describe('createDocumentFromImages', () => {
  it('removes the new document entirely when the import fails', async () => {
    mockFailOnSource = 'a';
    await expect(createDocumentFromImages(db, ['a'], { title: 'Scan', source: 'scan' })).rejects.toBeInstanceOf(AppError);
    const count = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM documents');
    expect(count?.n).toBe(0);
  });
});

describe('editPage', () => {
  it('bakes rotation into a processed image and drops superseded files', async () => {
    const doc = await createDocumentFromImages(db, ['a'], { title: 'Scan', source: 'scan' });
    const [page] = await listPages(db, doc.id);

    const rotated = await editPage(db, page!.id, { rotation: 90 });
    expect(rotated.processedUri).toContain('/processed-');
    expect(rotated).toMatchObject({ rotation: 90, width: 1400, height: 1000 });
    expect(mockWritten.has(page!.thumbnailUri)).toBe(false);
    expect(mockWritten.has(page!.originalUri)).toBe(true);

    const reset = await editPage(db, page!.id, { rotation: 0 });
    expect(reset.processedUri).toBeNull();
    expect(mockWritten.has(rotated.processedUri!)).toBe(false);
    expect(reset.originalUri).toBe(page!.originalUri);
  });
});
