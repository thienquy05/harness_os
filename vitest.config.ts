import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Workspace packages resolve to source, not dist/, so tests exercise the same
// code being edited without a build step in between. The Docker image still
// runs `tsc --build` to produce dist/ for the actual compiled runtime.
export default defineConfig({
  resolve: {
    alias: {
      '@harness-os/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: [
      'packages/*/src/**/*.test.ts',
      'server/tests/**/*.test.ts',
      'cli/src/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/*/src/**/*.ts', 'server/src/**/*.ts', 'cli/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/dist/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
