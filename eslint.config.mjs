import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * One flat config for the whole monorepo.
 *
 * Type-aware linting is deliberately not enabled: `pnpm typecheck` already runs
 * the compiler over every package, so duplicating it here would double CI time
 * for no extra signal.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/node_modules/**',
      '**/coverage/**',
      'packages/database/generated/**',
      'prisma/migrations/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2023 },
    },
    rules: {
      // Unused arguments are meaningful in interface implementations; a leading
      // underscore is the documented way to keep them.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      // Deliberately off. Nest resolves constructor dependencies from
      // `design:paramtypes`, which only exists if the class is imported for
      // value. Rewriting those imports to `import type` silently breaks
      // dependency injection at runtime, and the rule's autofix does exactly
      // that.
      '@typescript-eslint/consistent-type-imports': 'off',
      'no-console': 'off',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  // Nest and the parsers legitimately need CommonJS `require` for packages that
  // misbehave when imported at module load.
  {
    files: ['apps/api/**/*.ts', 'packages/ingest/src/parsers/**/*.ts'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },

  {
    files: ['apps/web/**/*.tsx', 'packages/ui/**/*.tsx'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  {
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', 'scripts/**/*.ts', 'prisma/seed.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
