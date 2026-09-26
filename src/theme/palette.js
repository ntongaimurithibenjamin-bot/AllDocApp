// Single source of truth for colours. CommonJS so tailwind.config.js can require it.
// Components use Tailwind classes (bg-surface, text-muted…) which resolve to CSS variables
// set on the root view; JS-only consumers (navigation, icons, status bar) use useTheme().
//
// Five themes, each with a light and a dark palette. Every palette defines the same colour
// names; src/theme/__tests__/palette.test.ts checks their text contrast against WCAG AA.

const status = {
  light: { danger: '#C62828', success: '#2E7D32', warning: '#A15C00' },
  dark: { danger: '#F07070', success: '#6FCF73', warning: '#F2B54C' },
};

/** @type {{ id: string, name: string, light: Record<string, string>, dark: Record<string, string> }[]} */
const themes = [
  {
    id: 'indigo',
    name: 'Indigo',
    light: {
      background: '#F6F7F9',
      surface: '#FFFFFF',
      'surface-muted': '#EDF0F4',
      border: '#DCE1E8',
      text: '#111827',
      muted: '#5B6573',
      primary: '#2F54EB',
      'on-primary': '#FFFFFF',
      ...status.light,
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
      ...status.dark,
    },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    light: {
      background: '#F3F7F8',
      surface: '#FFFFFF',
      'surface-muted': '#E6EFF1',
      border: '#D3E0E4',
      text: '#0E1A1F',
      muted: '#52636A',
      primary: '#00717E',
      'on-primary': '#FFFFFF',
      ...status.light,
    },
    dark: {
      background: '#081214',
      surface: '#0F1C1F',
      'surface-muted': '#172729',
      border: '#23363A',
      text: '#E4EEF0',
      muted: '#93A8AD',
      primary: '#4FC3D1',
      'on-primary': '#06181B',
      ...status.dark,
    },
  },
  {
    id: 'forest',
    name: 'Forest',
    light: {
      background: '#F5F8F4',
      surface: '#FFFFFF',
      'surface-muted': '#E8EFE6',
      border: '#D6E0D3',
      text: '#121A12',
      muted: '#566356',
      primary: '#2A7148',
      'on-primary': '#FFFFFF',
      ...status.light,
    },
    dark: {
      background: '#0A110C',
      surface: '#131C15',
      'surface-muted': '#1B271E',
      border: '#28362B',
      text: '#E6EEE7',
      muted: '#9AAC9E',
      primary: '#6FD39A',
      'on-primary': '#07140C',
      ...status.dark,
    },
  },
  {
    id: 'dusk',
    name: 'Dusk',
    light: {
      background: '#F7F5FA',
      surface: '#FFFFFF',
      'surface-muted': '#EEEAF4',
      border: '#DDD7E8',
      text: '#17121F',
      muted: '#605A6E',
      primary: '#6D3FD1',
      'on-primary': '#FFFFFF',
      ...status.light,
    },
    dark: {
      background: '#100C16',
      surface: '#19141F',
      'surface-muted': '#231C2B',
      border: '#322939',
      text: '#EDE8F3',
      muted: '#A79EB5',
      primary: '#B69CFF',
      'on-primary': '#150D24',
      ...status.dark,
    },
  },
  {
    id: 'ember',
    name: 'Ember',
    light: {
      background: '#FAF6F2',
      surface: '#FFFFFF',
      'surface-muted': '#F2EBE4',
      border: '#E4D9CF',
      text: '#1E1510',
      muted: '#6A5C52',
      primary: '#A8421A',
      'on-primary': '#FFFFFF',
      ...status.light,
    },
    dark: {
      background: '#140E0B',
      surface: '#1E1612',
      'surface-muted': '#29201A',
      border: '#3A2E26',
      text: '#F2EAE4',
      muted: '#B3A396',
      primary: '#FF9A66',
      'on-primary': '#1E0F06',
      ...status.dark,
    },
  },
];

const colorNames = Object.keys(themes[0].light);

/** '#RRGGBB' → 'R G B' (the form Tailwind's <alpha-value> needs). */
function hexToRgbChannels(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

module.exports = { themes, colorNames, hexToRgbChannels };
