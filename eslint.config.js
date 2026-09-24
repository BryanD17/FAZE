// Flat ESLint config applied to every workspace (root, shared, server, client).
// CI runs `npm run lint`; a lint failure blocks merge, because a red main
// blocks four other people (anti-pattern C20).
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'db/data/**', 'db/dumps/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Convention B.2/B.3: `any` defeats the point of a typed contract.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Anti-pattern C10: a swallowed error is a bug you pay for later.
      'no-empty': ['error', { allowEmptyCatch: false }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    // Server code logs through pino; console.* has no level or redaction.
    files: ['server/src/**/*.ts'],
    rules: { 'no-console': 'error' },
  },
  {
    // Migration runner, ETL and seed scripts are operator CLIs — their output
    // IS the user interface, and their evidence is pasted into Appendix A.
    files: ['db/**/*.js'],
    languageOptions: { globals: globals.node, sourceType: 'module' },
    rules: { 'no-console': 'off' },
  },
);
