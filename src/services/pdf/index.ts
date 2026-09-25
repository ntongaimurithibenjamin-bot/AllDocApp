import { DocunaNative } from 'docuna-native';

/**
 * PDF metadata via Android's PdfRenderer. Returns null instead of throwing when the file can't be
 * inspected (password-protected or damaged): the reader (PDF.js) can still open or repair many of
 * those, so import must not fail on them.
 */
export async function inspectPdf(uri: string): Promise<{ pageCount: number } | null> {
  if (!DocunaNative) return null;
  try {
    return await DocunaNative.getPdfInfoAsync(uri);
  } catch {
    return null;
  }
}

/** Renders page 1 as a small JPEG for lists. Null if the PDF can't be rendered natively. */
export async function renderPdfThumbnail(uri: string, outputUri: string): Promise<string | null> {
  if (!DocunaNative) return null;
  try {
    const result = await DocunaNative.renderPdfPageAsync({ uri, pageIndex: 0, outputUri, maxDimension: 360, quality: 75 });
    return result.uri;
  } catch {
    return null;
  }
}
