import { requireOptionalNativeModule } from 'expo-modules-core';

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
  /** Longest output edge in pixels; 0 = working resolution (3000 px). */
  maxDimension?: number;
  quality?: number;
}

export interface ImageResult {
  uri: string;
  width: number;
  height: number;
}

interface DocunaNativeModule {
  isScannerAvailableAsync(): Promise<boolean>;
  scanDocumentAsync(options: { pageLimit?: number; allowGalleryImport?: boolean }): Promise<{ pageUris: string[] } | null>;
  getImageInfoAsync(uri: string): Promise<{ width: number; height: number }>;
  processImageAsync(options: ProcessImageOptions): Promise<ImageResult>;
}

/** Null when running without the native module (e.g. Expo Go). */
export const DocunaNative = requireOptionalNativeModule<DocunaNativeModule>('DocunaNative');
