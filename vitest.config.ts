import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

const assistantProvider = fileURLToPath(
  new URL('./src/lib/assistant/gemini.ts', import.meta.url),
);

export default defineConfig({
  resolve: { alias: { '@assistant-provider': assistantProvider } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: { include: ['src/lib/rules.ts'] },
  },
});
