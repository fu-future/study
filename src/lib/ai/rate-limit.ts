import { getEnv } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * 进程内滑动窗口限流。
 *
 * 为什么需要：AI 调用是**花钱**且**慢**的操作。学生连点、脚本误触发、
 * 或者页面重试风暴，都会造成真实成本。
 *
 * 实现取舍：
 *   - 第一版是单机部署，用进程内 Map 足够；多实例部署时应替换为 Redis，
 *     因此把它收敛在一个模块里，接口保持不变即可替换。
 *   - 按「用户 × 业务服务」分桶，避免答疑把错题分析的额度吃掉。
 */

type Bucket = { timestamps: number[] };

const buckets = new Map<string, Bucket>();

/** 周期性清理，避免长期运行后 Map 无限增长。 */
let lastSweep = 0;
function sweepIfNeeded(now: number, windowMs: number): void {
  if (now - lastSweep < windowMs) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);
    if (bucket.timestamps.length === 0) buckets.delete(key);
  }
}

export type RateLimitDecision = {
  allowed: boolean;
  /** 剩余可用次数 */
  remaining: number;
  /** 距下次可用还有多少秒 */
  retryAfterSeconds: number;
  limit: number;
};

export function checkRateLimit(input: {
  userId: string;
  scope: string;
  limitPerMinute?: number;
  cost?: number;
  now?: number;
}): RateLimitDecision {
  const env = getEnv();
  const limit = input.limitPerMinute ?? env.AI_RATE_LIMIT_PER_MINUTE;
  const windowMs = 60_000;
  const now = input.now ?? Date.now();
  const cost = Math.max(1, input.cost ?? 1);

  sweepIfNeeded(now, windowMs);

  const key = `${input.userId}:${input.scope}`;
  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);

  if (bucket.timestamps.length + cost > limit) {
    buckets.set(key, bucket);
    const oldest = bucket.timestamps[0];
    const retryAfterSeconds = oldest ? Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)) : 60;
    return { allowed: false, remaining: 0, retryAfterSeconds, limit };
  }

  for (let i = 0; i < cost; i += 1) bucket.timestamps.push(now);
  buckets.set(key, bucket);

  return {
    allowed: true,
    remaining: Math.max(0, limit - bucket.timestamps.length),
    retryAfterSeconds: 0,
    limit,
  };
}

/** 仅供测试使用：清空所有限流状态。 */
export function resetRateLimits(): void {
  buckets.clear();
  lastSweep = 0;
}

/** 把限流决策记进日志，但不刷屏（只在拒绝时按 warn 记录）。 */
export function logRateLimitDecision(decision: RateLimitDecision, meta: Record<string, unknown>): void {
  if (!decision.allowed) {
    logger.warn('ai.rate_limited', { ...meta, limit: decision.limit, retryAfter: decision.retryAfterSeconds });
  }
}
