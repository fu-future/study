import type { UserKnowledgeMastery } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { readNumberRecord, writeNumberRecord } from '@/lib/db/json';
import { MASTERY_ORDER } from '@/lib/domain/enums';

/**
 * 知识掌握估计的数据访问层。
 *
 * 注意职责边界：**估计逻辑不在这里** —— 算法在 src/lib/diagnosis/engine.ts，
 * 是一个不依赖数据库、不依赖 AI 的纯函数（可单元测试）。
 * 本文件只负责读写与排序，避免把业务规则混进数据访问层。
 */

export type MasteryView = Omit<UserKnowledgeMastery, 'repeatedErrorTypes'> & {
  repeatedErrorTypes: Record<string, number>;
};

export function toMasteryView(row: UserKnowledgeMastery): MasteryView {
  return { ...row, repeatedErrorTypes: readNumberRecord(row.repeatedErrorTypes) };
}

export async function listMastery(userId: string): Promise<UserKnowledgeMastery[]> {
  return prisma.userKnowledgeMastery.findMany({ where: { userId } });
}

/** 带知识点信息的掌握列表 —— 薄弱诊断页面用。 */
export async function listMasteryWithKnowledgePoint(userId: string, options: { subjectId?: string } = {}) {
  return prisma.userKnowledgeMastery.findMany({
    where: {
      userId,
      ...(options.subjectId ? { knowledgePoint: { subjectId: options.subjectId } } : {}),
    },
    include: {
      knowledgePoint: {
        select: {
          id: true,
          name: true,
          code: true,
          subjectId: true,
          grade: true,
          chapter: true,
          chapterPath: true,
          difficulty: true,
        },
      },
    },
    orderBy: [{ confidence: 'desc' }, { updatedAt: 'desc' }],
  });
}

export async function findMastery(
  userId: string,
  knowledgePointId: string,
): Promise<UserKnowledgeMastery | null> {
  return prisma.userKnowledgeMastery.findUnique({
    where: { userId_knowledgePointId: { userId, knowledgePointId } },
  });
}

export type MasteryUpsertInput = {
  level: string;
  score?: number | null;
  confidence: number;
  evidenceCount: number;
  recentAccuracy?: number | null;
  recentSampleSize?: number;
  repeatedErrorTypes?: Record<string, number>;
  needsPrerequisiteReview?: boolean;
  nextAction?: string | null;
  lastEvaluatedAt?: Date;
};

/**
 * 写入掌握估计结果。唯一约束保证「用户 × 知识点」只有一条记录。
 * 每次诊断都会覆盖估计值，但**证据本身保存在 AnswerAttempt 里**，
 * 因此任何时候都可以回溯「为什么得出这个结论」。
 */
export async function upsertMastery(
  userId: string,
  knowledgePointId: string,
  input: MasteryUpsertInput,
): Promise<UserKnowledgeMastery> {
  const payload = {
    level: input.level,
    score: input.score ?? null,
    confidence: input.confidence,
    evidenceCount: input.evidenceCount,
    recentAccuracy: input.recentAccuracy ?? null,
    recentSampleSize: input.recentSampleSize ?? 0,
    repeatedErrorTypes: writeNumberRecord(input.repeatedErrorTypes ?? {}),
    needsPrerequisiteReview: input.needsPrerequisiteReview ?? false,
    nextAction: input.nextAction ?? null,
    lastEvaluatedAt: input.lastEvaluatedAt ?? new Date(),
  };

  return prisma.userKnowledgeMastery.upsert({
    where: { userId_knowledgePointId: { userId, knowledgePointId } },
    update: payload,
    create: { userId, knowledgePointId, ...payload },
  });
}

/**
 * 薄弱知识点列表。
 *
 * 排序规则（可解释、无 AI 参与）：
 *   1. 等级越弱越靠前（未评估/证据不足不参与「薄弱」排序，单独归类）
 *   2. 同等级下，近期正确率低的更靠前
 *   3. 再按证据数量多的靠前（证据越多，判断越可信）
 */
export async function listWeakMastery(userId: string, options: { limit?: number; subjectId?: string } = {}) {
  const rows = await prisma.userKnowledgeMastery.findMany({
    where: {
      userId,
      // 「薄弱」只统计已经进入学习状态的知识点；未评估/证据不足不算薄弱
      level: { in: ['learning', 'initial'] },
      ...(options.subjectId ? { knowledgePoint: { subjectId: options.subjectId } } : {}),
    },
    include: {
      knowledgePoint: {
        select: {
          id: true,
          name: true,
          subjectId: true,
          chapterPath: true,
          difficulty: true,
          commonMistakes: true,
        },
      },
    },
  });

  const ranked = rows.sort((a, b) => {
    const levelDiff = MASTERY_ORDER.indexOf(a.level as never) - MASTERY_ORDER.indexOf(b.level as never);
    if (levelDiff !== 0) return levelDiff;

    const aAcc = a.recentAccuracy ?? 0;
    const bAcc = b.recentAccuracy ?? 0;
    if (aAcc !== bAcc) return aAcc - bAcc;

    return b.evidenceCount - a.evidenceCount;
  });

  return ranked.slice(0, options.limit ?? 20);
}

/** 已进入「基本掌握 / 稳定掌握」的知识点 —— 用于汇报「最近进步的知识点」 */
export async function listStrongMastery(userId: string, options: { limit?: number } = {}) {
  return prisma.userKnowledgeMastery.findMany({
    where: { userId, level: { in: ['basic', 'stable'] } },
    include: { knowledgePoint: { select: { id: true, name: true, subjectId: true, chapterPath: true } } },
    orderBy: { lastEvaluatedAt: 'desc' },
    take: options.limit ?? 20,
  });
}

/** 掌握程度分布统计（仪表盘 / 报告用）—— 只统计真实评估过的记录 */
export async function getMasteryDistribution(userId: string): Promise<Record<string, number>> {
  const grouped = await prisma.userKnowledgeMastery.groupBy({
    by: ['level'],
    where: { userId },
    _count: { _all: true },
  });

  const distribution: Record<string, number> = {};
  for (const level of MASTERY_ORDER) distribution[level] = 0;
  for (const row of grouped) distribution[row.level] = row._count._all;
  return distribution;
}
