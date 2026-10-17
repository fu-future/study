import { getEnv } from '@/lib/env';

/**
 * 方言差异的唯一收敛点。
 *
 * SQLite 与 PostgreSQL 在**文本模糊匹配的大小写行为**上不一致：
 *   - SQLite：`LIKE` 对 ASCII 默认不区分大小写
 *   - PostgreSQL：`LIKE` 严格区分大小写，需要显式 `mode: 'insensitive'`
 *
 * Prisma 在 SQLite 上不接受 `mode` 参数（会直接报错），所以这里按运行时的
 * 实际方言生成正确的过滤条件。这样「业务代码」依然不需要知道方言，
 * 差异被隔离在 data-access 层内部 —— 这正是本层存在的意义之一。
 *
 * 迁移到 PostgreSQL 时，这个函数会自动切换到 insensitive 模式，
 * 无需修改任何调用点。
 */
export function containsFilter(term: string): { contains: string; mode?: 'insensitive' } {
  const trimmed = term.trim();
  if (!trimmed) return { contains: '' };

  if (getEnv().dbDialect === 'postgresql') {
    return { contains: trimmed, mode: 'insensitive' };
  }
  return { contains: trimmed };
}

/**
 * 标记数据库方言相关的已知限制，供 /settings 与文档引用。
 * 这些是「迁移到 PostgreSQL 时必须逐项核对」的清单来源。
 */
export const DIALECT_NOTES = {
  sqlite: [
    '文本搜索：LIKE 对 ASCII 不区分大小写（PostgreSQL 默认区分，已由 containsFilter 处理）',
    '并发写：SQLite 是单写者模型，高并发写入场景需要迁移到 PostgreSQL',
    '存储过程 / 全文检索：不支持，第一版未使用',
    'JSON 字段：未使用原生 Json 类型，结构化数据以 TEXT 存 JSON（见 src/lib/db/json.ts）',
    '原生 enum：未使用，取值域由 src/lib/domain/enums.ts 在应用层校验',
    '时区：SQLite 不存储时区，统一按 UTC 存 DateTime，展示时转本地时区',
  ],
  postgresql: [
    '文本搜索：contains 默认区分大小写，已由 containsFilter 自动加 mode: insensitive',
    '原生 enum / Json / 数组：本 schema 刻意未使用，迁移后仍保持应用层校验',
    '时区：使用 timestamptz 语义（Prisma DateTime），与 SQLite 的 UTC 存储约定一致',
  ],
} as const;
