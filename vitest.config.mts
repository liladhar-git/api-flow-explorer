import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
