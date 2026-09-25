import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx' } }],
  },
  // Exclude playwright spec files – they must be run via `npx playwright test`
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/tests/',
  ],
};

export default config;
