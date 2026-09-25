import type { CropQuad } from '../models';
import { FULL_PAGE_QUAD, isValidQuad, needsProcessing, normalizeCrop, rotateBy } from '../pageEdits';

describe('rotateBy', () => {
  it('rotates clockwise and wraps in both directions', () => {
    expect(rotateBy(0, 1)).toBe(90);
    expect(rotateBy(270, 1)).toBe(0);
    expect(rotateBy(0, -1)).toBe(270);
    expect(rotateBy(90, 6)).toBe(270);
  });
});

describe('crop normalisation', () => {
  it('treats a full-page quad as no crop', () => {
    expect(normalizeCrop(FULL_PAGE_QUAD)).toBeNull();
    const nearlyFull: CropQuad = [
      { x: 0.001, y: 0 },
      { x: 1, y: 0.001 },
      { x: 1, y: 1 },
      { x: 0, y: 0.999 },
    ];
    expect(normalizeCrop(nearlyFull)).toBeNull();
  });

  it('keeps a real crop', () => {
    const quad: CropQuad = [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.12 },
      { x: 0.88, y: 0.9 },
      { x: 0.12, y: 0.88 },
    ];
    expect(normalizeCrop(quad)).toBe(quad);
  });
});

describe('isValidQuad', () => {
  it('accepts a clockwise convex quad', () => {
    expect(isValidQuad(FULL_PAGE_QUAD)).toBe(true);
  });

  it('rejects crossed, anticlockwise and degenerate quads', () => {
    const crossed: CropQuad = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    const anticlockwise = [...FULL_PAGE_QUAD].reverse() as CropQuad;
    const collapsed: CropQuad = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    expect(isValidQuad(crossed)).toBe(false);
    expect(isValidQuad(anticlockwise)).toBe(false);
    expect(isValidQuad(collapsed)).toBe(false);
  });
});

describe('needsProcessing', () => {
  it('is false only for an unedited page', () => {
    expect(needsProcessing({ crop: null, rotation: 0, filter: 'original' })).toBe(false);
    expect(needsProcessing({ crop: null, rotation: 90, filter: 'original' })).toBe(true);
    expect(needsProcessing({ crop: null, rotation: 0, filter: 'bw' })).toBe(true);
    expect(needsProcessing({ crop: FULL_PAGE_QUAD, rotation: 0, filter: 'original' })).toBe(true);
  });
});
