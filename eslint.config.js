import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', 'release/**', 'node_modules/**', 'Flow_Reference_Studio_Kit/**', 'coverage/**', '.chrome-profile/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node scripts (build and packaging) run outside the browser.
    files: ['**/*.mjs', 'eslint.config.js'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly' },
    },
  },
  {
    files: ['**/*.{ts,mjs,js}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
