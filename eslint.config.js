import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: [
      'src/**/*.ts',
      'test/**/*.ts',
      'vite.config.ts',
      'vitest.config.ts',
    ],
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
