import type { CropQuad, PageFilter, Rotation } from './models';

export interface PageEdits {
  crop: CropQuad | null;
  rotation: Rotation;
  filter: PageFilter;
}

export const FULL_PAGE_QUAD: CropQuad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

export const PAGE_FILTERS: { value: PageFilter; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'enhanced', label: 'Enhanced' },
  { value: 'grayscale', label: 'Grayscale' },
  { value: 'bw', label: 'B&W' },
];

/** Rotates clockwise by `quarterTurns` × 90° (negative = anticlockwise). */
export function rotateBy(rotation: Rotation, quarterTurns: number): Rotation {
  return ((((rotation + quarterTurns * 90) % 360) + 360) % 360) as Rotation;
}

const EPSILON = 0.002;

/** True when the quad covers the whole image (i.e. no crop). */
export function isFullPageQuad(quad: CropQuad): boolean {
  return quad.every(
    (point, i) => Math.abs(point.x - FULL_PAGE_QUAD[i]!.x) < EPSILON && Math.abs(point.y - FULL_PAGE_QUAD[i]!.y) < EPSILON,
  );
}

/** Normalises a crop: a full-page quad is stored as "no crop". */
export function normalizeCrop(quad: CropQuad | null): CropQuad | null {
  return quad && !isFullPageQuad(quad) ? quad : null;
}

/** Whether the page needs a processed image, or can be shown straight from the original. */
export function needsProcessing(edits: PageEdits): boolean {
  return edits.crop !== null || edits.rotation !== 0 || edits.filter !== 'original';
}

/**
 * Rejects crops that would fold over themselves: the corners must form a convex quadrilateral in
 * clockwise order (TL, TR, BR, BL).
 */
export function isValidQuad(quad: CropQuad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i]!;
    const b = quad[(i + 1) % 4]!;
    const c = quad[(i + 2) % 4]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-6) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign > 0;
}
