/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^docuna-native$': '<rootDir>/modules/docuna-native',
    // Same self-contained build the app uses (see metro.config.js).
    '^@cantoo/pdf-lib$': '<rootDir>/node_modules/@cantoo/pdf-lib/dist/pdf-lib.min.js',
    // expo-crypto is native; Node's crypto provides the same UUIDs in tests.
    '^expo-crypto$': '<rootDir>/test/expoCryptoShim.ts',
  },
};
