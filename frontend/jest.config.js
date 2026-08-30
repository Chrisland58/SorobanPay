/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }],
  },
  moduleNameMapper: {
    // Resolve @/* path alias to ./src/*
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // Only pick up *.test.ts / *.test.tsx files — exclude Next.js build output
  testPathIgnorePatterns: ['/node_modules/', '/.next/'],
};

module.exports = config;
