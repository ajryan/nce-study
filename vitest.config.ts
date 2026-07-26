import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __SINGLE_FILE__: 'false',
    __BUILD_DATE__: '"test"',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
