import type { Document } from './models';

/** Scans (with pages) and PDFs can be merged, split, compressed and exported as PDF. */
export function isPdfCapable(document: Pick<Document, 'kind' | 'pageCount'>): boolean {
  return document.kind === 'pdf' || (document.kind === 'pages' && document.pageCount > 0);
}

/**
 * Parses a page selection like "1-3, 5, 8-6" (1-based, as people write it) into 0-based indices in
 * the order given, without duplicates. Returns null if anything is invalid or out of range.
 */
export function parsePageRanges(input: string, pageCount: number): number[] | null {
  const result: number[] = [];
  const seen = new Set<number>();
  const parts = input.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  for (const part of parts) {
    const match = /^(\d+)\s*(?:[-–]\s*(\d+))?$/.exec(part);
    if (!match) return null;
    const start = Number(match[1]);
    const end = match[2] !== undefined ? Number(match[2]) : start;
    if (start < 1 || end < 1 || start > pageCount || end > pageCount) return null;
    const step = start <= end ? 1 : -1;
    for (let page = start; step > 0 ? page <= end : page >= end; page += step) {
      if (!seen.has(page)) {
        seen.add(page);
        result.push(page - 1);
      }
    }
  }
  return result;
}

/** Formats 0-based indices as compact 1-based ranges: [0,1,2,4] → "1–3, 5". */
export function formatPageRanges(indices: readonly number[]): string {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    ranges.push(i === j ? `${sorted[i]! + 1}` : `${sorted[i]! + 1}–${sorted[j]! + 1}`);
    i = j + 1;
  }
  return ranges.join(', ');
}
