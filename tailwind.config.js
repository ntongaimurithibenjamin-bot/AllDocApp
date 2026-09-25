const { colorNames } = require('./src/theme/palette');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    // Font size only, no fixed line-height: with Android font scaling (e.g. 1.15×) a fixed
    // line-height made text measure narrower than it draws, cutting the last character.
    fontSize: {
      xs: '12px',
      sm: '14px',
      base: '16px',
      lg: '18px',
      xl: '20px',
      '2xl': '24px',
      '3xl': '30px',
    },
    extend: {
      colors: Object.fromEntries(
        colorNames.map((name) => [name, `rgb(var(--color-${name}) / <alpha-value>)`]),
      ),
    },
  },
  plugins: [],
};
