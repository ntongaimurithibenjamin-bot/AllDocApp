import { describeKind } from '@/domain/fileTypes';
import type { Document, DocumentKind } from '@/domain/models';
import { pluralize } from '@/lib/format';

import type { IconName } from './Icon';

const KIND_ICONS: Record<DocumentKind, IconName> = {
  pages: 'file-image-outline',
  pdf: 'file-pdf-box',
  text: 'file-document-outline',
  word: 'file-word-box',
  sheet: 'file-excel-box',
  slides: 'file-powerpoint-box',
  other: 'file-outline',
};

/** Icon shown when a document has no cover thumbnail. */
export function kindIcon(kind: DocumentKind): IconName {
  return KIND_ICONS[kind] ?? 'file-outline';
}

/** Short content description for lists: "12 pages", "8 slides", "Spreadsheet", "PDF"… */
export function describeContent(document: Pick<Document, 'kind' | 'pageCount'>): string {
  switch (document.kind) {
    case 'pages':
      return pluralize(document.pageCount, 'page');
    case 'pdf':
      return document.pageCount > 0 ? pluralize(document.pageCount, 'page') : 'PDF';
    case 'slides':
      return document.pageCount > 0 ? pluralize(document.pageCount, 'slide') : 'Presentation';
    default:
      return describeKind(document.kind);
  }
}
