#!/usr/bin/env node
/**
 * 生成 PostgreSQL 的**参考**迁移 SQL（不做实际连接、不做实际迁移）。
 *
 * 原理：prisma migrate diff --from-empty --to-schema-datamodel <schema> --script
 *       完全是离线推导，不需要数据库连接，因此在一台没装 PostgreSQL 的机器上也能产出 SQL。
 *
 * 产物：prisma/postgres-reference/0001_init.sql —— 供人工审查 / 未来真机迁移时参考。
 *
 * ⚠️ 这段 SQL **没有在任何真实 PostgreSQL 实例上执行过**。
 *    真机迁移请按 docs/DATABASE.md 的清单执行，并自行验证。
 */
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SCHEMA = path.join(ROOT, 'prisma', 'schema.postgres.prisma');
const OUT_DIR = path.join(ROOT, 'prisma', 'postgres-reference');
const OUT_FILE = path.join(OUT_DIR, '0001_init.sql');

const HEADER = `-- ⚠️ 参考文件，未在真实 PostgreSQL 上执行或验证。
-- 由 npm run pg:migration:sql 从 prisma/schema.postgres.prisma 离线推导生成。
-- 迁移前请阅读 docs/DATABASE.md，并在测试库上先跑通再上生产。
--
`;

async function main() {
  if (!existsSync(SCHEMA)) {
    console.error(`[pg:migration:sql] 找不到 ${path.relative(ROOT, SCHEMA)}，请先执行 npm run pg:schema`);
    process.exit(1);
  }

  const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';

  const { stdout } = await execFileAsync(
    npxBin,
    [
      'prisma',
      'migrate',
      'diff',
      '--from-empty',
      '--to-schema-datamodel',
      SCHEMA,
      '--script',
    ],
    { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 },
  );

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, HEADER + stdout, 'utf8');

  const lines = stdout.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--')).length;
  console.log(`[pg:migration:sql] 已生成 ${path.relative(ROOT, OUT_FILE)}（约 ${lines} 条语句）`);
  console.log('[pg:migration:sql] 提醒：这是离线推导的参考 SQL，不代表已在 PostgreSQL 上验证通过。');
}

main().catch((error) => {
  console.error('[pg:migration:sql] 失败：', error?.stderr || error);
  process.exit(1);
});
