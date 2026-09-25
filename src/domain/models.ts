export type DocumentSource = 'scan' | 'import_pdf' | 'import_image';

export interface Document {
  id: string;
  title: string;
  folderId: string | null;
  source: DocumentSource;
  pageCount: number;
  thumbnailUri: string | null;
  pdfUri: string | null;
  /** True when pages changed since the PDF was last generated. */
  pdfStale: boolean;
  sizeBytes: number;
  isFavorite: boolean;
  isArchived: boolean;
  inInbox: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
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
  /** Page number (1-based) when the hit came from page text; null for title matches. */
  pageNumber: number | null;
  snippet: string | null;
}
