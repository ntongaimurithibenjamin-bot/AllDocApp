import { DocunaNative, type ImageResult, type ProcessImageOptions } from 'docuna-native';
import { AppError } from '@/domain/errors';

export const THUMBNAIL_MAX_DIMENSION = 360;
const THUMBNAIL_QUALITY = 75;
const PAGE_QUALITY = 90;

function native() {
  if (!DocunaNative) throw new AppError('native_unavailable');
  return DocunaNative;
}

function mapNativeError(error: unknown): AppError {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'ERR_INVALID_IMAGE') return new AppError('invalid_image', String(error), { cause: error });
  if (code === 'ERR_IMAGE_WRITE') {
    return /ENOSPC|No space/i.test(String(error))
      ? new AppError('storage_full', String(error), { cause: error })
      : new AppError('storage_failure', String(error), { cause: error });
  }
  return new AppError('unknown', String(error), { cause: error });
}

/** Decodes, crops, rotates, filters and re-encodes one image natively (off the JS thread). */
export async function processImage(options: ProcessImageOptions): Promise<ImageResult> {
  try {
    return await native().processImageAsync({ quality: PAGE_QUALITY, ...options });
  } catch (error) {
    throw mapNativeError(error);
  }
}

export function createThumbnail(sourceUri: string, outputUri: string): Promise<ImageResult> {
  return processImage({ sourceUri, outputUri, maxDimension: THUMBNAIL_MAX_DIMENSION, quality: THUMBNAIL_QUALITY });
}

/** Pixel size after EXIF orientation. */
export async function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  try {
    return await native().getImageInfoAsync(uri);
  } catch (error) {
    throw mapNativeError(error);
  }
}
