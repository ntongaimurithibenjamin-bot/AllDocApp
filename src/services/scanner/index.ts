import * as ImagePicker from 'expo-image-picker';

import { DocunaNative } from 'docuna-native';
import { AppError, toAppError } from '@/domain/errors';

/**
 * - available: ML Kit scanner (auto edge detection, multi-page, filters)
 * - no_play_services: device without Google Play services → camera/photo fallback
 * - needs_native_build: running without the native module (Expo Go)
 */
export type ScannerAvailability = 'available' | 'no_play_services' | 'needs_native_build';

export async function getScannerAvailability(): Promise<ScannerAvailability> {
  if (!DocunaNative) return 'needs_native_build';
  try {
    return (await DocunaNative.isScannerAvailableAsync()) ? 'available' : 'no_play_services';
  } catch {
    return 'no_play_services';
  }
}

/**
 * Opens the on-device scanner. Returns temporary JPEG URIs for the captured pages, or null if the
 * user cancelled. Callers must copy the pages into permanent storage.
 */
export async function scanWithScanner(options: { pageLimit?: number } = {}): Promise<string[] | null> {
  if (!DocunaNative) throw new AppError('native_unavailable');
  try {
    const result = await DocunaNative.scanDocumentAsync({
      pageLimit: options.pageLimit ?? 0,
      allowGalleryImport: true,
    });
    return result && result.pageUris.length > 0 ? result.pageUris : null;
  } catch (error) {
    throw new AppError('scanner_unavailable', String(error), { cause: error });
  }
}

/** Fallback capture with the system camera (no edge detection; user can crop afterwards). */
export async function captureWithCamera(): Promise<string[] | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new AppError('permission_denied', 'Camera permission denied', {
      userMessage: permission.canAskAgain
        ? 'Docuna needs the camera to scan documents.'
        : 'Camera access is turned off for Docuna. You can turn it on in Android settings.',
    });
  }
  try {
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false });
    return result.canceled ? null : result.assets.map((asset) => asset.uri);
  } catch (error) {
    throw toAppError(error);
  }
}

/** Picks one or more photos via the Android photo picker (no storage permission needed). */
export async function pickImages(options: { multiple?: boolean } = {}): Promise<string[] | null> {
  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: options.multiple ?? true,
      orderedSelection: true,
      selectionLimit: options.multiple === false ? 1 : 0,
      quality: 1,
      exif: false,
    });
    return result.canceled ? null : result.assets.map((asset) => asset.uri);
  } catch (error) {
    throw toAppError(error);
  }
}
