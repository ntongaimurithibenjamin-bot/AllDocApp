import { formatPageRanges, isPdfCapable, parsePageRanges } from '../pdfTools';

describe('parsePageRanges', () => {
  it.each([
    ['1', 5, [0]],
    ['1-3, 5', 5, [0, 1, 2, 4]],
    ['5-3', 5, [4, 3, 2]],
    ['2, 2, 1–2', 5, [1, 0]],
    [' 1 - 2 ,4 ', 5, [0, 1, 3]],
  ])('%s of %d pages → %j', (input, count, expected) => {
    expect(parsePageRanges(input, count)).toEqual(expected);
  });

  it.each(['', '0', '6', '1-9', 'a', '1-', '1,,x'])('rejects %j for a 5-page document', (input) => {
    expect(parsePageRanges(input, 5)).toBeNull();
  });
});

describe('formatPageRanges', () => {
  it('compacts runs', () => {
    expect(formatPageRanges([0, 1, 2, 4])).toBe('1–3, 5');
    expect(formatPageRanges([6, 2, 3])).toBe('3–4, 7');
    expect(formatPageRanges([])).toBe('');
  });
});

describe('isPdfCapable', () => {
  it('accepts PDFs and scans with pages only', () => {
    expect(isPdfCapable({ kind: 'pdf', pageCount: 0 })).toBe(true);
    expect(isPdfCapable({ kind: 'pages', pageCount: 2 })).toBe(true);
    expect(isPdfCapable({ kind: 'pages', pageCount: 0 })).toBe(false);
    expect(isPdfCapable({ kind: 'word', pageCount: 0 })).toBe(false);
  });
});
