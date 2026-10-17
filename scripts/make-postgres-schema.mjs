#!/usr/bin/env node
/**
 * 从 prisma/schema.prisma 生成 PostgreSQL 变体（prisma/schema.postgres.prisma）。
 *
 * 为什么需要它：
 *   第一阶段默认数据源是 SQLite（见 docs/DATABASE.md）。为了让「未来迁移到 PostgreSQL」
 *   有明确、可检查的落点，这里把同一份数据模型机械地转换出 PostgreSQL 版本。
 *   由于 schema.prisma 刻意只使用两种方言都支持的通用特性（无原生 enum、
 *   无 Json 字段、无数组字段、无 @db.* 原生类型），转换只需要改 provider 一行。
 *
 * 生成的产物：
 *   - prisma/schema.postgres.prisma  （可直接用于 `prisma migrate diff` / `db push`）
 *   - prisma/postgres-reference/0001_init.sql（参考迁移 SQL，由 pg:migration:sql 产出）
 *
 * ⚠️ 该文件不参与日常开发，也**没有在真实 PostgreSQL 上验证过**。
 *    真机上迁移仍需按 docs/DATABASE.md 的清单逐项核对。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SRC = path.join(ROOT, 'prisma', 'schema.prisma');
const OUT = path.join(ROOT, 'prisma', 'schema.postgres.prisma');

/** 生成文件顶部的免责声明，避免有人误以为它已经被验证过。 */
const HEADER = `// ⚠️ 本文件由 scripts/make-postgres-schema.mjs 自动生成，请勿手动编辑。
// 修改数据模型请改 prisma/schema.prisma，然后执行：npm run pg:schema
//
// 用途：仅为「未来迁移到 PostgreSQL」提供可检查的落点。
// 状态：**未在真实 PostgreSQL 上验证过**，不参与第一阶段启动流程，
//       也不保证替换 DATABASE_URL 即可完成迁移（见 docs/DATABASE.md）。
`;

async function main() {
  if (!existsSync(SRC)) {
    console.error(`[pg:schema] 找不到源 schema：${SRC}`);
    process.exit(1);
  }

  const source = await readFile(SRC, 'utf8');

  // 只做 provider 替换；其余内容保持 1:1，方便人工 diff 审查。
  const converted = source.replace(
    /(datasource\s+db\s*\{[^}]*?provider\s*=\s*)"sqlite"/,
    '$1"postgresql"',
  );

  if (converted === source) {
    console.error('[pg:schema] 未匹配到 datasource provider = "sqlite"，请检查 schema.prisma。');
    process.exit(1);
  }

  await writeFile(OUT, HEADER + converted, 'utf8');
  console.log(`[pg:schema] 已生成 ${path.relative(ROOT, OUT)}`);
  console.log('[pg:schema] 提示：该 schema 未在真实 PostgreSQL 上验证，迁移前请阅读 docs/DATABASE.md。');
}

main().catch((error) => {
  console.error('[pg:schema] 失败：', error);
  process.exit(1);
});
