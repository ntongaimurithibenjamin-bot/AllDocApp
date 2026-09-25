import { File } from 'expo-file-system';

import {
  createDocument,
  deleteDocumentPermanently,
} from '@/db/repositories/documents';
import { addPages, deletePages, getPage, updatePageRender, type PageRender } from '@/db/repositories/pages';
import type { SqlDb } from '@/db/types';
import { AppError, toAppError } from '@/domain/errors';
import type { Document, DocumentSource, NewPage, Page } from '@/domain/models';
import { needsProcessing, normalizeCrop, type PageEdits } from '@/domain/pageEdits';
import { newId } from '@/lib/id';
import { createThumbnail, getImageSize, processImage } from '@/services/image';
import {
  deleteDocumentFiles,
  deleteFileQuietly,
  deletePageFiles,
  ensurePageDirectory,
  newPageFile,
} from '@/services/filesystem/storage';

export type ProgressCallback = (done: number, total: number) => void;

/**
 * Copies one source image into permanent storage as a page: the original is normalised
 * (EXIF-oriented, capped at working resolution) and a thumbnail is generated.
 */
async function preparePage(documentId: string, sourceUri: string): Promise<NewPage> {
  const pageId = newId();
  ensurePageDirectory(documentId, pageId);
  try {
    const original = await processImage({
      sourceUri,
      outputUri: newPageFile(documentId, pageId, 'original').uri,
    });
    const thumb = await createThumbnail(original.uri, newPageFile(documentId, pageId, 'thumb').uri);
    return {
      id: pageId,
      originalUri: original.uri,
      thumbnailUri: thumb.uri,
      width: original.width,
      height: original.height,
    };
  } catch (error) {
    deletePageFiles(documentId, pageId);
    throw error;
  }
}

/**
 * Imports images as pages, one at a time (bounded memory), then inserts them in a single
 * transaction. If any page fails, nothing is inserted and the files written so far are removed.
 */
export async function importImagesIntoDocument(
  db: SqlDb,
  documentId: string,
  sourceUris: readonly string[],
  options: { atPosition?: number; onProgress?: ProgressCallback } = {},
): Promise<Page[]> {
  const prepared: NewPage[] = [];
  try {
    for (const [i, uri] of sourceUris.entries()) {
      prepared.push(await preparePage(documentId, uri));
      options.onProgress?.(i + 1, sourceUris.length);
    }
    return await addPages(db, documentId, prepared, options.atPosition);
  } catch (error) {
    for (const page of prepared) deletePageFiles(documentId, page.id!);
    throw toAppError(error);
  }
}

/** Creates a document from scanned or picked images. The document starts in the inbox. */
export async function createDocumentFromImages(
  db: SqlDb,
  sourceUris: readonly string[],
  input: { title: string; source: DocumentSource; inInbox?: boolean; onProgress?: ProgressCallback },
): Promise<Document> {
  const document = await createDocument(db, { title: input.title, source: input.source, inInbox: input.inInbox });
  try {
    await importImagesIntoDocument(db, document.id, sourceUris, { onProgress: input.onProgress });
    return document;
  } catch (error) {
    await discardDocument(db, document.id).catch(() => {});
    throw error;
  }
}

/** Permanently deletes a document and its files (used when discarding a fresh scan). */
export async function discardDocument(db: SqlDb, documentId: string): Promise<void> {
  await deleteDocumentPermanently(db, documentId);
  deleteDocumentFiles(documentId);
}

async function requirePage(db: SqlDb, pageId: string): Promise<Page> {
  const page = await getPage(db, pageId);
  if (!page) throw new AppError('not_found', `Page ${pageId} not found`);
  return page;
}

type PageFiles = Pick<PageRender, 'originalUri' | 'processedUri' | 'thumbnailUri'>;

/** Deletes the files of `files` that `keep` does not also reference. */
function deleteUnreferenced(files: PageFiles, keep: PageFiles): void {
  const kept = new Set([keep.originalUri, keep.processedUri, keep.thumbnailUri]);
  for (const uri of [files.originalUri, files.processedUri, files.thumbnailUri]) {
    if (uri && !kept.has(uri)) deleteFileQuietly(uri);
  }
}

/** Saves a render; on success drops the page's old files, on failure drops the new ones. */
async function commitRender(db: SqlDb, page: Page, render: PageRender): Promise<Page> {
  try {
    await updatePageRender(db, page.id, render);
  } catch (error) {
    deleteUnreferenced(render, page);
    throw error;
  }
  deleteUnreferenced(page, render);
  return requirePage(db, page.id);
}

/**
 * Renders a page from its original with the given edits. Edits always start from the untouched
 * original, so repeated edits never compound quality loss.
 */
async function renderPage(page: Page, originalUri: string, originalSize: { width: number; height: number }, edits: PageEdits): Promise<PageRender> {
  const crop = normalizeCrop(edits.crop);
  const normalized: PageEdits = { ...edits, crop };
  let processedUri: string | null = null;
  let size = originalSize;

  if (needsProcessing(normalized)) {
    const processed = await processImage({
      sourceUri: originalUri,
      outputUri: newPageFile(page.documentId, page.id, 'processed').uri,
      quad: crop,
      rotation: normalized.rotation,
      filter: normalized.filter,
    });
    processedUri = processed.uri;
    size = { width: processed.width, height: processed.height };
  }

  const thumb = await createThumbnail(processedUri ?? originalUri, newPageFile(page.documentId, page.id, 'thumb').uri);
  return { originalUri, processedUri, thumbnailUri: thumb.uri, ...size, ...normalized };
}

/** The size of the page's original image (processed pages store the processed size). */
function originalSize(page: Page): Promise<{ width: number; height: number }> {
  if (!page.processedUri) return Promise.resolve({ width: page.width, height: page.height });
  return getImageSize(page.originalUri);
}

/** Applies crop/rotation/filter changes to a page. */
export async function editPage(db: SqlDb, pageId: string, changes: Partial<PageEdits>): Promise<Page> {
  const page = await requirePage(db, pageId);
  const edits: PageEdits = {
    crop: changes.crop !== undefined ? changes.crop : page.crop,
    rotation: changes.rotation ?? page.rotation,
    filter: changes.filter ?? page.filter,
  };
  const render = await renderPage(page, page.originalUri, await originalSize(page), edits);
  return commitRender(db, page, render);
}

/** Replaces a page's image with a new capture, resetting its edits. */
export async function replacePageImage(db: SqlDb, pageId: string, sourceUri: string): Promise<Page> {
  const page = await requirePage(db, pageId);
  const original = await processImage({
    sourceUri,
    outputUri: newPageFile(page.documentId, page.id, 'original').uri,
  });
  let render: PageRender;
  try {
    render = await renderPage(page, original.uri, original, { crop: null, rotation: 0, filter: 'original' });
  } catch (error) {
    deleteFileQuietly(original.uri);
    throw error;
  }
  return commitRender(db, page, render);
}

/** Inserts a copy of the page (files included) right after it. */
export async function duplicatePage(db: SqlDb, pageId: string): Promise<Page> {
  const page = await requirePage(db, pageId);
  const copyId = newId();
  ensurePageDirectory(page.documentId, copyId);
  try {
    const copy = (uri: string, kind: 'original' | 'processed' | 'thumb') => {
      const target = newPageFile(page.documentId, copyId, kind);
      new File(uri).copy(target);
      return target.uri;
    };
    const [inserted] = await addPages(
      db,
      page.documentId,
      [
        {
          id: copyId,
          originalUri: copy(page.originalUri, 'original'),
          processedUri: page.processedUri ? copy(page.processedUri, 'processed') : null,
          thumbnailUri: copy(page.thumbnailUri, 'thumb'),
          width: page.width,
          height: page.height,
          rotation: page.rotation,
          crop: page.crop,
          filter: page.filter,
        },
      ],
      page.position + 1,
    );
    if (!inserted) throw new AppError('database_failure', 'Duplicated page missing');
    return inserted;
  } catch (error) {
    deletePageFiles(page.documentId, copyId);
    throw toAppError(error, 'storage_failure');
  }
}

/** Deletes pages and their files. */
export async function deletePagesWithFiles(db: SqlDb, documentId: string, pageIds: readonly string[]): Promise<void> {
  const deleted = await deletePages(db, documentId, pageIds);
  for (const page of deleted) deletePageFiles(documentId, page.id);
}
