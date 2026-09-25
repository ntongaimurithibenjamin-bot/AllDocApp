import type { DocumentKind } from './models';

/** How an incoming file is handled: stored as a document kind, turned into pages, or refused. */
export type ImportKind = Exclude<DocumentKind, 'pages'> | 'image' | 'unsupported';

const TEXT_EXTENSIONS = new Set([
  'txt', 'text', 'md', 'markdown', 'json', 'xml', 'log', 'ini', 'yaml', 'yml', 'toml',
  'html', 'htm', 'css', 'js', 'ts', 'tsx', 'jsx', 'py', 'java', 'kt', 'c', 'h', 'cpp', 'cs', 'go', 'rs',
  'php', 'rb', 'sh', 'sql', 'srt', 'vtt', 'tex',
]);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif']);
const WORD_EXTENSIONS = new Set(['docx', 'docm', 'dotx']);
const SHEET_EXTENSIONS = new Set(['xlsx', 'xlsm', 'xls', 'ods', 'csv', 'tsv']);
const SLIDES_EXTENSIONS = new Set(['pptx', 'ppsx', 'potx']);
/** Stored in Docuna, opened with another app: no reliable offline renderer for these yet. */
const OTHER_EXTENSIONS = new Set(['doc', 'dot', 'ppt', 'pps', 'odt', 'odp', 'rtf', 'epub', 'pages', 'key', 'numbers']);

const MIME_KINDS: Record<string, ImportKind> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'sheet',
  'application/vnd.ms-excel': 'sheet',
  'application/vnd.oasis.opendocument.spreadsheet': 'sheet',
  'text/csv': 'sheet',
  'text/tab-separated-values': 'sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'slides',
  'application/msword': 'other',
  'application/vnd.ms-powerpoint': 'other',
  'application/vnd.oasis.opendocument.text': 'other',
  'application/vnd.oasis.opendocument.presentation': 'other',
  'application/rtf': 'other',
  'text/rtf': 'other',
  'application/epub+zip': 'other',
  'application/json': 'text',
  'application/xml': 'text',
};

export function fileExtension(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim());
  return match ? match[1]!.toLowerCase() : '';
}

/** Title for an imported file: its name without the extension. */
export function titleFromFileName(name: string): string {
  const withoutExtension = name.replace(/\.[a-z0-9]+$/i, '').trim();
  return withoutExtension || name.trim() || 'Imported file';
}

/**
 * Decides how an imported file is handled. The extension wins over the MIME type: apps that share
 * files often send generic types (application/octet-stream) or get them wrong.
 */
export function classifyImport(name: string, mimeType: string | null | undefined): ImportKind {
  const ext = fileExtension(name);
  const mime = (mimeType ?? '').toLowerCase().split(';')[0]!.trim();

  if (ext === 'pdf') return 'pdf';
  if (WORD_EXTENSIONS.has(ext)) return 'word';
  if (SHEET_EXTENSIONS.has(ext)) return 'sheet';
  if (SLIDES_EXTENSIONS.has(ext)) return 'slides';
  if (OTHER_EXTENSIONS.has(ext)) return 'other';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';

  const byMime = MIME_KINDS[mime];
  if (byMime) return byMime;
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('text/')) return 'text';
  return 'unsupported';
}

/** Default extension for a stored file when the incoming name has none. */
export function defaultExtension(kind: ImportKind, mimeType: string | null): string {
  switch (kind) {
    case 'pdf':
      return 'pdf';
    case 'word':
      return 'docx';
    case 'sheet':
      return mimeType === 'text/csv' ? 'csv' : 'xlsx';
    case 'slides':
      return 'pptx';
    case 'text':
      return 'txt';
    default:
      return 'bin';
  }
}

/** Human description for lists, e.g. "Word document". */
export function describeKind(kind: DocumentKind): string {
  switch (kind) {
    case 'word':
      return 'Word document';
    case 'sheet':
      return 'Spreadsheet';
    case 'slides':
      return 'Presentation';
    case 'text':
      return 'Text file';
    case 'pdf':
      return 'PDF';
    case 'other':
      return 'File';
    default:
      return 'Document';
  }
}
