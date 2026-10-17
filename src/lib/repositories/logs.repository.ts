import type { ModelCallLog, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';

/**
 * 模型调用日志的数据访问层。
 *
 * 记录内容有明确边界（对应需求「模型调用日志不保存不必要的敏感信息」）：
 *   ✅ 记录：服务名、供应商、模型名、状态、耗时、字符数、token 用量、费用、重试次数、错误码
 *   ❌ 不记录：完整提示词、模型原始输出、API Key、学生答案原文、图片内容
 */

export type ModelCallInput = {
  userId?: string | null;
  service: string;
  provider: string;
  model: string;
  status: string;
  latencyMs: number;
  promptChars?: number;
  completionChars?: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
  estimatedCostUsd?: number | null;
  schemaValidated?: boolean;
  retryCount?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
};

/** 写日志失败不能影响主流程 —— 因此这里吞掉异常，只降级为控制台告警。 */
export async function recordModelCall(input: ModelCallInput): Promise<void> {
  try {
    await prisma.modelCallLog.create({
      data: {
        userId: input.userId ?? null,
        service: input.service,
        provider: input.provider,
        model: input.model,
        status: input.status,
        latencyMs: input.latencyMs,
        promptChars: input.promptChars ?? 0,
        completionChars: input.completionChars ?? 0,
        promptTokens: input.promptTokens ?? null,
        completionTokens: input.completionTokens ?? null,
        estimatedCostUsd: input.estimatedCostUsd ?? null,
        schemaValidated: input.schemaValidated ?? false,
        retryCount: input.retryCount ?? 0,
        // 错误信息可能含上游返回的敏感串，截断并去掉明显的密钥片段
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ? sanitizeErrorMessage(input.errorMessage) : null,
      },
    });
  } catch (error) {
    // 日志表异常不应打断学习流程
    console.warn('[model-call-log] 写入失败：', error instanceof Error ? error.message : error);
  }
}

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer ***')
    .slice(0, 300);
}

export async function listRecentModelCalls(
  userId: string | null,
  options: { limit?: number; service?: string; status?: string } = {},
): Promise<ModelCallLog[]> {
  const where: Prisma.ModelCallLogWhereInput = {};
  if (userId) where.userId = userId;
  if (options.service) where.service = options.service;
  if (options.status) where.status = options.status;

  return prisma.modelCallLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: options.limit ?? 50,
  });
}

export async function getModelCallStats(options: { since: Date; userId?: string | null }): Promise<{
  total: number;
  success: number;
  failed: number;
  avgLatencyMs: number;
  totalCostUsd: number;
  byService: Record<string, { total: number; failed: number; avgLatencyMs: number }>;
}> {
  const where: Prisma.ModelCallLogWhereInput = { createdAt: { gte: options.since } };
  if (options.userId) where.userId = options.userId;

  const rows = await prisma.modelCallLog.findMany({
    where,
    select: { service: true, status: true, latencyMs: true, estimatedCostUsd: true },
  });

  let success = 0;
  let failed = 0;
  let latencySum = 0;
  let costSum = 0;
  const byService: Record<string, { total: number; failed: number; latencySum: number; avgLatencyMs: number }> = {};

  for (const row of rows) {
    if (row.status === 'success') success += 1;
    else failed += 1;

    latencySum += row.latencyMs;
    costSum += row.estimatedCostUsd ?? 0;

    const bucket = byService[row.service] ?? { total: 0, failed: 0, latencySum: 0, avgLatencyMs: 0 };
    bucket.total += 1;
    if (row.status !== 'success') bucket.failed += 1;
    bucket.latencySum += row.latencyMs;
    byService[row.service] = bucket;
  }

  const finalized: Record<string, { total: number; failed: number; avgLatencyMs: number }> = {};
  for (const [service, bucket] of Object.entries(byService)) {
    finalized[service] = {
      total: bucket.total,
      failed: bucket.failed,
      avgLatencyMs: bucket.total > 0 ? Math.round(bucket.latencySum / bucket.total) : 0,
    };
  }

  return {
    total: rows.length,
    success,
    failed,
    avgLatencyMs: rows.length > 0 ? Math.round(latencySum / rows.length) : 0,
    totalCostUsd: Number(costSum.toFixed(6)),
    byService: finalized,
  };
}
