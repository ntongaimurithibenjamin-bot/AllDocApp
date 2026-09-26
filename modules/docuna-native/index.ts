import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

export interface NormalizedPoint {
  x: number;
  y: number;
}

export type NativeFilter = 'original' | 'enhanced' | 'grayscale' | 'bw';

export interface ProcessImageOptions {
  sourceUri: string;
  /** file:// URI inside app storage. */
  outputUri: string;
  /** TL, TR, BR, BL — normalised to the EXIF-oriented source image. */
  quad?: NormalizedPoint[] | null;
  rotation?: 0 | 90 | 180 | 270;
  filter?: NativeFilter;
  /** Longest output edge in pixels; 0 = device working size (3000 px, 2000 px on low-RAM phones). */
  maxDimension?: number;
  quality?: number;
}

export interface ImageResult {
  uri: string;
  width: number;
  height: number;
}

export interface IncomingFile {
  uri: string;
  /** MIME type declared by the sending app, if any. */
  mimeType: string | null;
}

export interface NativeOcrResult {
  text: string;
  /** Lines with [left, top, width, height] boxes as fractions of the page. */
  lines: { text: string; box: [number, number, number, number] }[];
  /** Mean line confidence 0–1. */
  confidence: number;
}

interface DocunaNativeModule {
  /**
   * On-device OCR (ML Kit, Latin script). Rejects with ERR_OCR_UNAVAILABLE while Google Play
   * services is still downloading the model (a download is requested automatically).
   */
  recognizeTextAsync(imageUri: string): Promise<NativeOcrResult>;
  /** OCR of one rendered PDF page; also rejects with ERR_PDF_ENCRYPTED / ERR_PDF_OPEN. */
  recognizePdfPageTextAsync(pdfUri: string, pageIndex: number): Promise<NativeOcrResult>;
  addListener(event: 'onIncomingFiles', listener: (event: { files: IncomingFile[] }) => void): EventSubscription;
  getContentInfoAsync(uri: string): Promise<{ name: string | null; size: number | null; mimeType: string | null }>;
  /** Copies a content:// file into app storage; resolves with the byte count. */
  copyContentAsync(uri: string, destinationUri: string): Promise<number>;
  consumeIncomingFilesAsync(): Promise<IncomingFile[]>;
  isScannerAvailableAsync(): Promise<boolean>;
  scanDocumentAsync(options: { pageLimit?: number; allowGalleryImport?: boolean }): Promise<{ pageUris: string[] } | null>;
  getImageInfoAsync(uri: string): Promise<{ width: number; height: number }>;
  processImageAsync(options: ProcessImageOptions): Promise<ImageResult>;
  /** Page sizes in PDF points (1/72 inch). */
  getPdfPageSizesAsync(uri: string): Promise<{ width: number; height: number }[]>;
  /** Saves into Downloads/Docuna; rejects with ERR_NEEDS_PICKER on Android 9 and older. */
  saveToDownloadsAsync(sourceUri: string, displayName: string, mimeType: string): Promise<string>;
  /** Streams a file into a content:// destination (e.g. a file created in a folder the user picked). */
  copyToContentUriAsync(sourceUri: string, destinationUri: string): Promise<void>;
  /** Rejects with ERR_PDF_ENCRYPTED for password-protected PDFs, ERR_PDF_OPEN for unreadable ones. */
  getPdfInfoAsync(uri: string): Promise<{ pageCount: number }>;
  renderPdfPageAsync(options: {
    uri: string;
    pageIndex: number;
    outputUri: string;
    maxDimension?: number;
    quality?: number;
  }): Promise<ImageResult>;
}

/** Null when running without the native module (e.g. Expo Go). */
export const DocunaNative = requireOptionalNativeModule<DocunaNativeModule>('DocunaNative');
