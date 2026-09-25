import type { DocumentKind } from './models';

export type ImportKind = Exclude<DocumentKind, 'pages'> | 'image' | 'office' | 'unsupported';

const TEXT_EXTENSIONS = new Set([
  'txt', 'text', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'log', 'ini', 'yaml', 'yml', 'toml',
  'html', 'htm', 'css', 'js', 'ts', 'tsx', 'jsx', 'py', 'java', 'kt', 'c', 'h', 'cpp', 'cs', 'go', 'rs',
  'php', 'rb', 'sh', 'sql', 'srt', 'vtt', 'tex',
]);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif']);
// Formats planned for the reader's second step (converted on-device).
const OFFICE_EXTENSIONS = new Set(['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'odt', 'ods', 'odp', 'rtf', 'epub']);

export function fileExtension(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim());
  return match ? match[1]!.toLowerCase() : '';
}

/** Title for an imported file: its name without the extension. */
export function titleFromFileName(name: string): string {
  const withoutExtension = name.replace(/\.[a-z0-9]+$/i, '').trim();
  return withoutExtension || name.trim() || 'Imported file';
}

/** Decides how an imported file is handled, from its MIME type and extension. */
export function classifyImport(name: string, mimeType: string | null | undefined): ImportKind {
  const ext = fileExtension(name);
  const mime = (mimeType ?? '').toLowerCase();
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (IMAGE_EXTENSIONS.has(ext) || mime.startsWith('image/')) return 'image';
  if (OFFICE_EXTENSIONS.has(ext)) return 'office';
  if (TEXT_EXTENSIONS.has(ext) || mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml') {
    return 'text';
  }
  return 'unsupported';
}
