import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@biina/ai-gateway': fileURLToPath(
        new URL('../../packages/ai-gateway/src/index.ts', import.meta.url),
      ),
    },
  },
});
