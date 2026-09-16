import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.e2e-spec.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    passWithNoTests: false,
  },
  esbuild: {
    target: 'es2022',
  },
});
