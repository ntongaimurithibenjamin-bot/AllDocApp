import { Directory, File, Paths } from 'expo-file-system';

import { toAppError } from '@/domain/errors';

/**
 * App-private file layout. Canonical copies live under documents/ so they survive cache eviction;
 * reader tiles and other derivatives live under cache/ and may be deleted at any time.
 *
 *   <document>/docs/<docId>/pages/<pageId>/{original,processed,thumb}-<version>.jpg
 *   <document>/docs/<docId>/document.pdf
 *   <cache>/render/<docId>/…
 */
const docsRoot = () => new Directory(Paths.document, 'docs');
const renderRoot = () => new Directory(Paths.cache, 'render');

export type PageFileKind = 'original' | 'processed' | 'thumb';

export function documentDirectory(documentId: string): Directory {
  return new Directory(docsRoot(), documentId);
}

export function pageDirectory(documentId: string, pageId: string): Directory {
  return new Directory(documentDirectory(documentId), 'pages', pageId);
}

let versionCounter = 0;

/**
 * A new, uniquely named file for a page image. Every edit writes a new file instead of
 * overwriting, so image caches keyed by URI never show a stale version.
 */
export function newPageFile(documentId: string, pageId: string, kind: PageFileKind): File {
  versionCounter = (versionCounter + 1) % 1296;
  const version = `${Date.now().toString(36)}${versionCounter.toString(36).padStart(2, '0')}`;
  return new File(pageDirectory(documentId, pageId), `${kind}-${version}.jpg`);
}

/** Best-effort delete of a single file by URI (used to drop superseded page images). */
export function deleteFileQuietly(uri: string | null | undefined): void {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch (error) {
    if (__DEV__) console.warn('Could not delete', uri, error);
  }
}

/** The stored original of an imported file document, e.g. source.pdf. */
export function documentSourceFile(documentId: string, extension: string): File {
  return new File(documentDirectory(documentId), `source.${extension}`);
}

/** A uniquely named document-level image (e.g. a PDF cover thumbnail). */
export function newDocumentImageFile(documentId: string, kind: 'thumb'): File {
  versionCounter = (versionCounter + 1) % 1296;
  return new File(documentDirectory(documentId), `${kind}-${Date.now().toString(36)}${versionCounter.toString(36)}.jpg`);
}

export function ensureDocumentDirectory(documentId: string): Directory {
  try {
    const dir = documentDirectory(documentId);
    dir.create({ intermediates: true, idempotent: true });
    return dir;
  } catch (error) {
    throw toAppError(error, 'storage_failure');
  }
}

export function documentPdfFile(documentId: string): File {
  return new File(documentDirectory(documentId), 'document.pdf');
}

/** Creates the page directory (and parents) if needed and returns it. */
export function ensurePageDirectory(documentId: string, pageId: string): Directory {
  try {
    const dir = pageDirectory(documentId, pageId);
    dir.create({ intermediates: true, idempotent: true });
    return dir;
  } catch (error) {
    throw toAppError(error, 'storage_failure');
  }
}

function deleteIfExists(entry: File | Directory): void {
  if (entry.exists) entry.delete();
}

export function deleteDocumentFiles(documentId: string): void {
  try {
    deleteIfExists(documentDirectory(documentId));
    deleteIfExists(new Directory(renderRoot(), documentId));
  } catch (error) {
    throw toAppError(error, 'storage_failure');
  }
}

export function deletePageFiles(documentId: string, pageId: string): void {
  try {
    deleteIfExists(pageDirectory(documentId, pageId));
  } catch (error) {
    throw toAppError(error, 'storage_failure');
  }
}

export interface StorageUsage {
  /** Bytes used by documents (originals, processed pages, PDFs). */
  documentsBytes: number;
  /** Bytes used by regenerable caches. */
  cacheBytes: number;
  /** Free bytes on the device's internal storage. */
  freeBytes: number;
  totalBytes: number;
}

export function getStorageUsage(): StorageUsage {
  const docs = docsRoot();
  const render = renderRoot();
  return {
    documentsBytes: docs.exists ? (docs.size ?? 0) : 0,
    cacheBytes: render.exists ? (render.size ?? 0) : 0,
    freeBytes: Paths.availableDiskSpace,
    totalBytes: Paths.totalDiskSpace,
  };
}

export function clearRenderCache(): void {
  try {
    deleteIfExists(renderRoot());
  } catch (error) {
    throw toAppError(error, 'storage_failure');
  }
}
