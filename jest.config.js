/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // expo-crypto is native; Node's crypto provides the same UUIDs in tests.
    '^expo-crypto$': '<rootDir>/test/expoCryptoShim.ts',
  },
};
