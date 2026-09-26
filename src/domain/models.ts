import type { DocumentSuggestion } from './suggestions';

export type DocumentSource = 'scan' | 'import_pdf' | 'import_image' | 'import_file';

/**
 * How a document's content is stored and read:
 *  - 'pages': page images (scans, photos)
 *  - 'pdf' | 'text' | 'word' | 'sheet' | 'slides': one imported file, rendered on the device
 *  - 'other': kept in Docuna but opened with another app (e.g. legacy .doc, .epub)
 */
export type DocumentKind = 'pages' | 'pdf' | 'text' | 'word' | 'sheet' | 'slides' | 'other';

/** Kinds rendered by the office reader (Word / spreadsheets / PowerPoint). */
export const OFFICE_KINDS: readonly DocumentKind[] = ['word', 'sheet', 'slides'];

export interface Document {
  id: string;
  title: string;
  folderId: string | null;
  source: DocumentSource;
  kind: DocumentKind;
  /** The stored file for 'pdf' / 'text' documents. */
  fileUri: string | null;
  mimeType: string | null;
  /** File name as imported, e.g. "Lease.pdf". */
  originalName: string | null;
  /** 0 when unknown (e.g. a password-protected PDF before it is opened). */
  pageCount: number;
  thumbnailUri: string | null;
  pdfUri: string | null;
  /** True when pages changed since the PDF was last generated. */
  pdfStale: boolean;
  sizeBytes: number;
  isFavorite: boolean;
  isArchived: boolean;
  inInbox: boolean;
  /** 1-based page the reader was last on (0 = never opened). */
  lastReadPage: number;
  /** When the document was last opened in the reader. */
  lastOpenedAt: number | null;
  /** Text recognition progress for file documents (PDF, text); scans track it per page. */
  ocrState: OcrStatus;
  /** Rule-based filing suggestion from the recognised text (inbox). */
  suggestion: DocumentSuggestion | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface Bookmark {
  id: string;
  documentId: string;
  /** 0-based page number. */
  pageIndex: number;
  label: string | null;
  createdAt: number;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  color: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface FolderWithCount extends Folder {
  documentCount: number;
}

export type PageFilter = 'original' | 'enhanced' | 'grayscale' | 'bw';
export type Rotation = 0 | 90 | 180 | 270;
export type OcrStatus = 'pending' | 'done' | 'failed' | 'skipped';

export interface Point {
  /** 0–1, relative to the original image width. */
  x: number;
  /** 0–1, relative to the original image height. */
  y: number;
}

/** Corners in clockwise order starting top-left. */
export type CropQuad = [Point, Point, Point, Point];

export interface Page {
  id: string;
  documentId: string;
  position: number;
  originalUri: string;
  processedUri: string | null;
  thumbnailUri: string;
  width: number;
  height: number;
  rotation: Rotation;
  crop: CropQuad | null;
  filter: PageFilter;
  ocrStatus: OcrStatus;
  createdAt: number;
  updatedAt: number;
}

/** What a caller supplies when adding a page; the repository assigns id/position/timestamps. */
export interface NewPage {
  id?: string;
  originalUri: string;
  processedUri?: string | null;
  thumbnailUri: string;
  width: number;
  height: number;
  rotation?: Rotation;
  crop?: CropQuad | null;
  filter?: PageFilter;
}

export type DocumentSort = 'updated' | 'created' | 'title';

export interface DocumentQuery {
  /** undefined = any folder, null = unfiled only. */
  folderId?: string | null;
  favoritesOnly?: boolean;
  archived?: boolean;
  inboxOnly?: boolean;
  sort?: DocumentSort;
  limit?: number;
}

export interface SearchHit {
  documentId: string;
  title: string;
  kind: DocumentKind;
  /** Page number (1-based) of the best page-text hit; null for title matches. */
  pageNumber: number | null;
  snippet: string | null;
  /** How many pages of the document match. */
  pageMatches: number;
}
