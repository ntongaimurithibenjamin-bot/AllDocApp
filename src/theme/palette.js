// Single source of truth for colours. CommonJS so tailwind.config.js can require it.
// Components use Tailwind classes (bg-surface, text-muted…) which resolve to CSS variables
// set on the root view; JS-only consumers (navigation, icons, status bar) use useTheme().

/** @type {Record<'light' | 'dark', Record<string, string>>} */
const palette = {
  light: {
    background: '#F6F7F9',
    surface: '#FFFFFF',
    'surface-muted': '#EDF0F4',
    border: '#DCE1E8',
    text: '#111827',
    muted: '#5B6573',
    primary: '#2F54EB',
    'on-primary': '#FFFFFF',
    danger: '#C62828',
    success: '#2E7D32',
    warning: '#A15C00',
  },
  dark: {
    background: '#0B0F14',
    surface: '#151A21',
    'surface-muted': '#1E252E',
    border: '#2A323D',
    text: '#E8ECF1',
    muted: '#9AA4B2',
    primary: '#7C95FF',
    'on-primary': '#0B0F14',
    danger: '#F07070',
    success: '#6FCF73',
    warning: '#F2B54C',
  },
};

const colorNames = Object.keys(palette.light);

/** '#RRGGBB' → 'R G B' (the form Tailwind's <alpha-value> needs). */
function hexToRgbChannels(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

module.exports = { palette, colorNames, hexToRgbChannels };
