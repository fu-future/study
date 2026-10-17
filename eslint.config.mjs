import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  {
    ignores: [
      // 构建产物：`.next` 之外还要覆盖 `.next.bak.*`
      // （本地排查时会把 .next 改名保留，避免被沙箱删除守卫拦住）
      '.next/**',
      '.next*/**',
      'node_modules/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'prisma/schema.postgres.prisma',
      'prisma/postgres-reference/**',
      'playwright-report*/**',
      'test-results*/**',
      '.data/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['scripts/**/*.mjs', '*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];

export default eslintConfig;
