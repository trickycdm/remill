import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // Plain-JS node scripts (the TS scripts get their globals via the type
    // checker; eslint's no-undef only fires on untyped .mjs).
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
  },
  {
    ignores: [
      'dist/',
      'node_modules/',
      '.wrangler/',
      'public/',
      'src/router.ts',
      'playwright-report/',
      'test-results/',
    ],
  },
);
