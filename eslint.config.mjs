import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules: {
      // Allow any for external API responses that may have unknown shapes
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow unused vars that start with _ (common in Fastify handlers)
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // No console.log — use pino logger instead
      'no-console': 'error',
      // Require return types on exported functions
      '@typescript-eslint/explicit-function-return-type': 'off',
      // Allow non-null assertions where we've validated
      '@typescript-eslint/no-non-null-assertion': 'warn',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'coverage/', '*.js'],
  },
];