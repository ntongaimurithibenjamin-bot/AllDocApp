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

interface DocunaNativeModule {
  addListener(event: 'onIncomingFiles', listener: (event: { files: IncomingFile[] }) => void): EventSubscription;
  getContentInfoAsync(uri: string): Promise<{ name: string | null; size: number | null; mimeType: string | null }>;
  /** Copies a content:// file into app storage; resolves with the byte count. */
  copyContentAsync(uri: string, destinationUri: string): Promise<number>;
  consumeIncomingFilesAsync(): Promise<IncomingFile[]>;
  isScannerAvailableAsync(): Promise<boolean>;
  scanDocumentAsync(options: { pageLimit?: number; allowGalleryImport?: boolean }): Promise<{ pageUris: string[] } | null>;
  getImageInfoAsync(uri: string): Promise<{ width: number; height: number }>;
  processImageAsync(options: ProcessImageOptions): Promise<ImageResult>;
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
