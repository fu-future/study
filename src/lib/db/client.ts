import { PrismaClient } from '@prisma/client';

/**
 * Prisma 客户端单例。
 *
 * 这里是**唯一**接触 Prisma 实例的地方 —— 上层全部通过 repositories/ 访问数据，
 * 业务逻辑（诊断算法、计划生成、复习调度）完全不感知数据库的存在与方言。
 *
 * 方言无关性说明：DATABASE_URL 由 Prisma 自身读取，业务代码从不解析它，
 * 因此后续把数据源从 SQLite 换成 PostgreSQL 时，业务层无需改动。
 * （但迁移**不只是**换 URL，见 docs/DATABASE.md。）
 */

const globalForPrisma = globalThis as unknown as { __studyCoachPrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.__studyCoachPrisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }]
        : [{ emit: 'event', level: 'error' }],
  });

if (process.env.NODE_ENV !== 'production') {
  // 开发模式下 Next.js 会热重载模块，挂到 globalThis 避免连接数爆炸
  globalForPrisma.__studyCoachPrisma = prisma;
}

/** 供 /api/health 与脚本使用的最小连通性探针。 */
export async function checkDatabaseConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export type Db = PrismaClient;
