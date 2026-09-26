import { DocunaNative } from 'docuna-native';
import { File } from 'expo-file-system';

import { createDocument, getDocument, setDocumentPdf, updateDocumentFile } from '@/db/repositories/documents';
import { listPages } from '@/db/repositories/pages';
import type { SqlDb } from '@/db/types';
import { AppError, toAppError } from '@/domain/errors';
import type { Document } from '@/domain/models';
import { normalizeName } from '@/domain/validation';
import { newId } from '@/lib/id';
import { installTextDecoderPolyfill } from '@/lib/textDecoderPolyfill';
import { processImage } from '@/services/image';
import {
  deleteDocumentFiles,
  deleteFileQuietly,
  ensureDocumentDirectory,
  newDocumentFile,
  newDocumentImageFile,
  newScratchFile,
} from '@/services/filesystem/storage';

import { inspectPdf, renderPdfThumbnail } from './index';

type PdfLib = typeof import('@cantoo/pdf-lib');
type PDFDocumentType = import('@cantoo/pdf-lib').PDFDocument;

/** pdf-lib holds a whole PDF in memory while editing it; keep that bounded on low-RAM phones. */
const MAX_PDF_BYTES = 80 * 1024 * 1024;
const MAX_TOTAL_BYTES = 150 * 1024 * 1024;
/** Scans are laid out on A4-width pages (595 pt), keeping each image's aspect ratio. */
const PAGE_WIDTH_PT = 595;

let pdfLib: PdfLib | null = null;

/** Loaded on first use: it's ~600 KB and most sessions never edit a PDF. */
function lib(): PdfLib {
  if (!pdfLib) {
    installTextDecoderPolyfill();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    pdfLib = require('@cantoo/pdf-lib') as PdfLib;
  }
  return pdfLib;
}

async function readBytes(uri: string): Promise<Uint8Array> {
  const file = new File(uri);
  if (!file.exists) throw new AppError('not_found', `Missing file ${uri}`);
  if ((file.size ?? 0) > MAX_PDF_BYTES) {
    throw new AppError('file_too_large', `${file.size} bytes`, {
      userMessage: `This file is ${Math.round((file.size ?? 0) / 1048576)} MB, too large to edit on this phone (limit ${MAX_PDF_BYTES / 1048576} MB).`,
    });
  }
  return file.bytes();
}

async function loadPdf(uri: string): Promise<PDFDocumentType> {
  const bytes = await readBytes(uri);
  try {
    return await lib().PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    const name = (error as { name?: string; constructor?: { name?: string } })?.constructor?.name ?? '';
    if (name === 'EncryptedPDFError' || /encrypted/i.test(String(error))) throw new AppError('pdf_encrypted', String(error), { cause: error });
    throw new AppError('pdf_invalid', String(error), { cause: error });
  }
}

async function writePdf(pdf: PDFDocumentType, target: File): Promise<number> {
  const bytes = await pdf.save({ useObjectStreams: true });
  target.write(bytes);
  return bytes.length;
}

/** Adds a JPEG as a page: A4 width, the image's own aspect ratio, no re-encoding. */
async function addJpegPage(pdf: PDFDocumentType, jpegUri: string, pageSize?: { width: number; height: number }) {
  const image = await pdf.embedJpg(await new File(jpegUri).bytes());
  const width = pageSize?.width ?? PAGE_WIDTH_PT;
  const height = pageSize?.height ?? (image.height / image.width) * PAGE_WIDTH_PT;
  pdf.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height });
}

/**
 * The PDF for a document: the stored file for PDFs; for scans, a PDF generated from the page
 * images (cached, and rebuilt only after pages change).
 */
export async function ensureDocumentPdf(db: SqlDb, document: Document): Promise<string> {
  if (document.kind === 'pdf') {
    if (!document.fileUri) throw new AppError('not_found', 'PDF file missing');
    return document.fileUri;
  }
  if (document.kind !== 'pages') {
    throw new AppError('unsupported_file', `Cannot make a PDF from ${document.kind}`, {
      userMessage: 'Only scans and PDFs can be used here.',
    });
  }
  if (document.pdfUri && !document.pdfStale && new File(document.pdfUri).exists) return document.pdfUri;

  const pages = await listPages(db, document.id);
  if (pages.length === 0) throw new AppError('invalid_input', 'No pages', { userMessage: 'This document has no pages yet.' });
  const pdf = await lib().PDFDocument.create();
  pdf.setTitle(document.title);
  pdf.setProducer('Docuna');
  // One page at a time: each JPEG is embedded as-is (no decoding or re-compression).
  for (const page of pages) await addJpegPage(pdf, page.processedUri ?? page.originalUri);

  const target = newDocumentFile(document.id, 'document', 'pdf');
  await writePdf(pdf, target);
  const previous = document.pdfUri;
  await setDocumentPdf(db, document.id, target.uri);
  if (previous && previous !== target.uri) deleteFileQuietly(previous);
  return target.uri;
}

/** Saves a finished PDF as a new document (with cover thumbnail) and returns it. */
async function createPdfDocument(db: SqlDb, pdf: PDFDocumentType, title: string): Promise<Document> {
  const id = newId();
  ensureDocumentDirectory(id);
  try {
    pdf.setTitle(title);
    pdf.setProducer('Docuna');
    const target = newDocumentFile(id, 'source', 'pdf');
    const sizeBytes = await writePdf(pdf, target);
    const pageCount = pdf.getPageCount();
    const thumbnailUri = await renderPdfThumbnail(target.uri, newDocumentImageFile(id, 'thumb').uri);
    return await createDocument(db, {
      id,
      title,
      source: 'import_pdf',
      file: { kind: 'pdf', fileUri: target.uri, mimeType: 'application/pdf', originalName: `${title}.pdf`, sizeBytes, pageCount, thumbnailUri },
    });
  } catch (error) {
    deleteDocumentFiles(id);
    throw toAppError(error, 'storage_failure');
  }
}

/** Combines documents (scans and PDFs, in the given order) into one new PDF document. */
export async function mergeDocuments(db: SqlDb, documents: readonly Document[], title: string): Promise<Document> {
  if (documents.length < 2) throw new AppError('invalid_input', 'Need 2+', { userMessage: 'Choose at least two documents to merge.' });
  const sources: string[] = [];
  let total = 0;
  for (const document of documents) {
    const uri = await ensureDocumentPdf(db, document);
    total += new File(uri).size ?? 0;
    if (total > MAX_TOTAL_BYTES) {
      throw new AppError('file_too_large', 'merge too large', {
        userMessage: `Together these files are over ${MAX_TOTAL_BYTES / 1048576} MB, too large to merge on this phone. Try fewer at a time.`,
      });
    }
    sources.push(uri);
  }
  const merged = await lib().PDFDocument.create();
  for (const uri of sources) {
    const source = await loadPdf(uri);
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  return createPdfDocument(db, merged, normalizeName(title));
}

/** Copies the chosen pages (0-based, in order) into a new PDF document. */
export async function extractPages(db: SqlDb, document: Document, pageIndices: readonly number[], title: string): Promise<Document> {
  if (pageIndices.length === 0) throw new AppError('invalid_input', 'No pages', { userMessage: 'Choose at least one page.' });
  const source = await loadPdf(await ensureDocumentPdf(db, document));
  const out = await lib().PDFDocument.create();
  const pages = await out.copyPages(source, [...pageIndices]);
  pages.forEach((page) => out.addPage(page));
  return createPdfDocument(db, out, normalizeName(title));
}

/** Rotates pages of a PDF document permanently (clockwise quarter turns). */
export async function rotatePdfPages(
  db: SqlDb,
  document: Document,
  pageIndices: readonly number[],
  quarterTurns: number,
): Promise<Document> {
  if (document.kind !== 'pdf' || !document.fileUri) throw new AppError('unsupported_file', 'Only PDFs can be rotated here');
  const pdf = await loadPdf(document.fileUri);
  const { degrees } = lib();
  for (const index of pageIndices) {
    const page = pdf.getPage(index);
    page.setRotation(degrees((((page.getRotation().angle + quarterTurns * 90) % 360) + 360) % 360));
  }
  const target = newDocumentFile(document.id, 'source', 'pdf');
  const sizeBytes = await writePdf(pdf, target);
  const thumbnailUri = pageIndices.includes(0)
    ? await renderPdfThumbnail(target.uri, newDocumentImageFile(document.id, 'thumb').uri)
    : document.thumbnailUri;
  await updateDocumentFile(db, document.id, { fileUri: target.uri, sizeBytes, pageCount: pdf.getPageCount(), thumbnailUri });
  deleteFileQuietly(document.fileUri);
  if (thumbnailUri !== document.thumbnailUri) deleteFileQuietly(document.thumbnailUri);
  const updated = await getDocument(db, document.id);
  if (!updated) throw new AppError('not_found', 'Document vanished');
  return updated;
}

export type CompressionLevel = 'balanced' | 'small';

const LEVELS: Record<CompressionLevel, { maxDimension: number; quality: number }> = {
  // ~190 DPI on A4: still crisp for reading and printing.
  balanced: { maxDimension: 1600, quality: 70 },
  // ~140 DPI: fine on a phone screen, much smaller to send.
  small: { maxDimension: 1200, quality: 55 },
};

export interface CompressionResult {
  document: Document;
  originalBytes: number;
  compressedBytes: number;
}

/**
 * Makes a smaller copy of a scan or PDF. Every page is re-rendered as a JPEG at the chosen level
 * (text in PDFs becomes part of the image). The original is kept.
 */
export async function compressDocument(db: SqlDb, document: Document, level: CompressionLevel): Promise<CompressionResult> {
  if (!DocunaNative) throw new AppError('native_unavailable');
  const settings = LEVELS[level];
  const scratch: string[] = [];
  try {
    const pdf = await lib().PDFDocument.create();
    let originalBytes: number;

    if (document.kind === 'pages') {
      const pages = await listPages(db, document.id);
      originalBytes = pages.reduce((sum, page) => sum + (new File(page.processedUri ?? page.originalUri).size ?? 0), 0);
      for (const page of pages) {
        const out = await processImage({ sourceUri: page.processedUri ?? page.originalUri, outputUri: newScratchFile('jpg').uri, ...settings });
        scratch.push(out.uri);
        await addJpegPage(pdf, out.uri);
        deleteFileQuietly(out.uri);
      }
    } else if (document.kind === 'pdf' && document.fileUri) {
      originalBytes = new File(document.fileUri).size ?? 0;
      const sizes = await DocunaNative.getPdfPageSizesAsync(document.fileUri);
      for (const [index, size] of sizes.entries()) {
        const out = await DocunaNative.renderPdfPageAsync({
          uri: document.fileUri,
          pageIndex: index,
          outputUri: newScratchFile('jpg').uri,
          maxDimension: settings.maxDimension,
          quality: settings.quality,
        });
        scratch.push(out.uri);
        await addJpegPage(pdf, out.uri, size);
        deleteFileQuietly(out.uri);
      }
    } else {
      throw new AppError('unsupported_file', 'Compress scans and PDFs only', { userMessage: 'Only scans and PDFs can be compressed.' });
    }

    const created = await createPdfDocument(db, pdf, normalizeName(`${document.title} (compressed)`));
    return { document: created, originalBytes, compressedBytes: created.sizeBytes };
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === 'ERR_PDF_ENCRYPTED') throw new AppError('pdf_encrypted', String(error), { cause: error });
    throw toAppError(error);
  } finally {
    scratch.forEach(deleteFileQuietly);
  }
}

/** Page count without loading the PDF into memory (native PdfRenderer), falling back to pdf-lib. */
export async function countPdfPages(uri: string): Promise<number> {
  const info = await inspectPdf(uri);
  if (info) return info.pageCount;
  return (await loadPdf(uri)).getPageCount();
}
