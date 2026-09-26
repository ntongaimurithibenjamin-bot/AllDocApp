/**
 * @jest-environment node
 */
import paletteModule from '../palette';

/** WCAG 2.x relative luminance of '#RRGGBB'. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r = 0, g = 0, b = 0] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Foreground/background pairs the UI actually draws as text, all held to WCAG AA (4.5:1). */
const TEXT_PAIRS: [string, string][] = [
  ['text', 'background'],
  ['text', 'surface'],
  ['text', 'surface-muted'],
  ['muted', 'background'],
  ['muted', 'surface'],
  ['primary', 'background'],
  ['primary', 'surface'],
  ['on-primary', 'primary'],
  ['danger', 'surface'],
  ['success', 'surface'],
  ['warning', 'surface'],
];

const HEX = /^#[0-9A-F]{6}$/;

describe('theme palettes', () => {
  it('has five themes with unique ids', () => {
    expect(paletteModule.themes).toHaveLength(5);
    expect(new Set(paletteModule.themes.map((theme) => theme.id)).size).toBe(5);
  });

  const cases = paletteModule.themes.flatMap((theme) =>
    (['light', 'dark'] as const).map((scheme) => [`${theme.name} ${scheme}`, theme[scheme]] as const),
  );

  it.each(cases)('%s defines every colour as #RRGGBB', (_, colors) => {
    expect(Object.keys(colors).sort()).toEqual([...paletteModule.colorNames].sort());
    Object.values(colors).forEach((hex) => expect(hex).toMatch(HEX));
  });

  it.each(cases)('%s meets WCAG AA text contrast', (_, colors) => {
    const failures = TEXT_PAIRS.map(([fg, bg]) => ({ pair: `${fg} on ${bg}`, ratio: contrast(colors[fg]!, colors[bg]!) }))
      .filter(({ ratio }) => ratio < 4.5)
      .map(({ pair, ratio }) => `${pair}: ${ratio.toFixed(2)}`);
    expect(failures).toEqual([]);
  });
});
