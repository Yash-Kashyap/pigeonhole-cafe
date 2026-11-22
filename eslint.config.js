import eslint from '@eslint/js';
import astro from 'eslint-plugin-astro';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.astro/**',
      '.checks/**',
      '.wrangler/**',
      'design-prototype/**',
      'functions/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  {
    files: [
      'scripts/**/*.{js,mjs,ts}',
      'playwright.config.ts',
      'vitest.config.ts',
    ],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        // used inside page.evaluate callbacks in the browser check scripts
        document: 'readonly',
        window: 'readonly',
        getComputedStyle: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        crypto: 'readonly',
        TextEncoder: 'readonly',
        localStorage: 'readonly',
      },
    },
  },
  {
    files: ['**/*.astro'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.astro'],
      },
    },
  },
];
