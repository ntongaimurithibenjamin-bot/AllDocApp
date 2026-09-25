const { colorNames } = require('./src/theme/palette');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: Object.fromEntries(
        colorNames.map((name) => [name, `rgb(var(--color-${name}) / <alpha-value>)`]),
      ),
    },
  },
  plugins: [],
};
