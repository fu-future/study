import { withApiHandler, jsonOk } from '@/lib/api/http';
import { checkDatabaseConnection } from '@/lib/db/client';
import { DIALECT_NOTES } from '@/lib/db/search';
import { describeEnvStatus } from '@/lib/env';
import { describeProviderStatus } from '@/lib/ai/registry';
import type { ProviderCapabilities } from '@/lib/ai/types';

/**
 * 健康检查（无需登录）。
 *
 * 刻意不抛错：数据库或 AI 配置出问题时也返回 200 + `degraded`，
 * 让运维与前端能读到「具体哪一层坏了」，而不是拿到一个没有信息的 5xx。
 * 因此这里的返回值只暴露「状态与非敏感配置项」，绝不回显任何密钥。
 */

type HealthAi = {
  provider: string;
  label: string;
  defaultModel: string;
  visionModel: string | null;
  capabilities: ProviderCapabilities | null;
  isRealProvider: boolean;
  /** provider 无法初始化时的原因（配置损坏）；正常时为 undefined */
  error?: string;
};

export const GET = withApiHandler(async () => {
  const database = await checkDatabaseConnection();
  const config = describeEnvStatus();

  // describeProviderStatus 会走 getEnv()，配置损坏时会抛错 —— 健康检查不能因此变 500
  let ai: HealthAi;
  try {
    const status = await describeProviderStatus();
    ai = {
      provider: status.id,
      label: status.label,
      defaultModel: status.defaultModel,
      visionModel: status.visionModel ?? null,
      capabilities: status.capabilities,
      isRealProvider: status.isRealProvider,
    };
  } catch (error) {
    ai = {
      provider: config.aiProvider,
      label: '',
      defaultModel: '',
      visionModel: null,
      capabilities: null,
      isRealProvider: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // 方言相关的已知限制清单，供 /settings 展示「迁移到 PostgreSQL 时要核对什么」
  const dialectNotes =
    config.dbDialect === 'postgresql' ? DIALECT_NOTES.postgresql : DIALECT_NOTES.sqlite;

  return jsonOk({
    status: database.ok && config.ok ? ('ok' as const) : ('degraded' as const),
    timestamp: new Date().toISOString(),
    database,
    ai,
    config,
    dialectNotes,
  });
});
