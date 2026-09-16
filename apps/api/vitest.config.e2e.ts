import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.e2e-spec.ts'],
    setupFiles: ['./test/setup-e2e.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // The suite shares one database; running files in parallel would let them
    // trip over each other's fixtures.
    fileParallelism: false,
    sequence: { concurrent: false },
    passWithNoTests: false,
  },
  plugins: [
    // Nest resolves constructor dependencies from `design:paramtypes`, which
    // esbuild does not emit. SWC does, so the container can wire real providers.
    swc.vite({ module: { type: 'es6' } }),
  ],
});
