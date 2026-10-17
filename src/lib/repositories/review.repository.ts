import type { ReviewSchedule } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { toJsonText } from '@/lib/db/json';

/**
 * 复习调度的数据访问层。
 *
 * 「复习记录保留历史结果」的实现方式：historyJson 是一个 append-only 的 JSON 数组，
 * 每次复习**追加**一条 { at, result, intervalDays, easeFactor }，永不覆盖。
 * 当前状态（dueAt / repetition / easeFactor）单独存字段，方便索引与排序。
 */

export type ReviewHistoryEntry = {
  at: string;
  result: string;
  intervalDays: number;
  easeFactor: number;
  source: string;
};

export type ReviewScheduleView = Omit<ReviewSchedule, 'historyJson'> & {
  history: ReviewHistoryEntry[];
};

function readHistory(raw: string): ReviewHistoryEntry[] {
  // historyJson 是数组而非对象，这里单独解析以保持类型精确。
  // 任何损坏的历史都退化为空数组，绝不让页面崩掉。
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (entry): entry is ReviewHistoryEntry =>
        Boolean(entry) && typeof entry === 'object' && typeof (entry as ReviewHistoryEntry).result === 'string',
    );
  } catch {
    return [];
  }
}

export function toReviewView(row: ReviewSchedule): ReviewScheduleView {
  const { historyJson, ...rest } = row;
  return { ...rest, history: readHistory(historyJson) };
}

/** 为错题或知识点建立复习计划（二选一，靠唯一约束保证不重复）。 */
export async function upsertReviewSchedule(
  userId: string,
  target: { wrongAnswerRecordId?: string; knowledgePointId?: string },
  input: {
    dueAt: Date;
    intervalDays?: number;
    repetition?: number;
    easeFactor?: number;
    status?: string;
    origin?: string;
  },
): Promise<ReviewSchedule> {
  if (!target.wrongAnswerRecordId && !target.knowledgePointId) {
    throw new Error('复习计划必须指定错题或知识点之一');
  }
  if (target.wrongAnswerRecordId && target.knowledgePointId) {
    throw new Error('复习计划只能挂在一个对象上（错题或知识点）');
  }

  const payload = {
    dueAt: input.dueAt,
    intervalDays: input.intervalDays ?? 1,
    repetition: input.repetition ?? 0,
    easeFactor: input.easeFactor ?? 2.5,
    status: input.status ?? 'scheduled',
    origin: input.origin ?? 'rule-engine',
  };

  if (target.wrongAnswerRecordId) {
    return prisma.reviewSchedule.upsert({
      where: { userId_wrongAnswerRecordId: { userId, wrongAnswerRecordId: target.wrongAnswerRecordId } },
      update: payload,
      create: { userId, wrongAnswerRecordId: target.wrongAnswerRecordId, ...payload },
    });
  }

  return prisma.reviewSchedule.upsert({
    where: { userId_knowledgePointId: { userId, knowledgePointId: target.knowledgePointId! } },
    update: payload,
    create: { userId, knowledgePointId: target.knowledgePointId!, ...payload },
  });
}

export async function findReviewScheduleByWrongRecord(
  userId: string,
  wrongAnswerRecordId: string,
): Promise<ReviewSchedule | null> {
  return prisma.reviewSchedule.findUnique({
    where: { userId_wrongAnswerRecordId: { userId, wrongAnswerRecordId } },
  });
}

export async function findReviewScheduleById(
  userId: string,
  id: string,
): Promise<ReviewSchedule | null> {
  return prisma.reviewSchedule.findFirst({ where: { id, userId } });
}

/** 到期复习列表（含错题 / 知识点信息），按到期时间升序。 */
export async function listDueReviews(
  userId: string,
  options: { before?: Date; limit?: number } = {},
) {
  return prisma.reviewSchedule.findMany({
    where: {
      userId,
      status: { in: ['scheduled', 'skipped'] },
      dueAt: { lte: options.before ?? new Date() },
    },
    include: {
      wrongAnswerRecord: {
        include: {
          question: {
            select: { id: true, stem: true, stemFormat: true, subjectId: true, imagePath: true },
          },
        },
      },
      knowledgePoint: { select: { id: true, name: true, subjectId: true, chapterPath: true } },
    },
    orderBy: { dueAt: 'asc' },
    take: options.limit ?? 50,
  });
}

export async function listReviewSchedules(userId: string, options: { limit?: number } = {}) {
  return prisma.reviewSchedule.findMany({
    where: { userId },
    include: {
      wrongAnswerRecord: {
        include: { question: { select: { id: true, stem: true, subjectId: true } } },
      },
      knowledgePoint: { select: { id: true, name: true, subjectId: true } },
    },
    orderBy: { dueAt: 'asc' },
    take: options.limit ?? 100,
  });
}

/**
 * 记录一次复习结果：更新当前状态，并把这条结果**追加**进历史。
 * 历史永不覆盖，因此可以回溯「这道题我一共复习了几次、每次结果如何」。
 */
export async function recordReviewResult(
  userId: string,
  id: string,
  input: {
    result: string;
    intervalDays: number;
    repetition: number;
    easeFactor: number;
    nextDueAt: Date;
    source?: string;
  },
): Promise<ReviewSchedule> {
  const existing = await findReviewScheduleById(userId, id);
  if (!existing) throw new Error('REVIEW_SCHEDULE_NOT_FOUND_OR_FORBIDDEN');

  const history = readHistory(existing.historyJson);
  history.push({
    at: new Date().toISOString(),
    result: input.result,
    intervalDays: input.intervalDays,
    easeFactor: input.easeFactor,
    source: input.source ?? 'rule-engine',
  });

  const result = await prisma.reviewSchedule.updateMany({
    where: { id, userId },
    data: {
      lastResult: input.result,
      lastReviewedAt: new Date(),
      intervalDays: input.intervalDays,
      repetition: input.repetition,
      easeFactor: input.easeFactor,
      dueAt: input.nextDueAt,
      // 记录完结果后始终排下一次复习；具体间隔由调度算法决定
      status: 'scheduled',
      historyJson: toJsonText(history, '[]'),
    },
  });

  if (result.count === 0) throw new Error('REVIEW_SCHEDULE_NOT_FOUND_OR_FORBIDDEN');

  const updated = await prisma.reviewSchedule.findUnique({ where: { id } });
  if (!updated) throw new Error('REVIEW_SCHEDULE_NOT_FOUND_OR_FORBIDDEN');
  return updated;
}

/** 复习完成情况统计（报告用）：按时完成 / 逾期未做 / 总数 */
export async function getReviewStats(userId: string): Promise<{
  total: number;
  dueNow: number;
  done: number;
  overdue: number;
}> {
  const now = new Date();
  const [total, dueNow, done, overdue] = await Promise.all([
    prisma.reviewSchedule.count({ where: { userId } }),
    prisma.reviewSchedule.count({ where: { userId, status: 'scheduled', dueAt: { lte: now } } }),
    prisma.reviewSchedule.count({ where: { userId, lastResult: { not: null } } }),
    prisma.reviewSchedule.count({
      where: { userId, status: 'scheduled', dueAt: { lt: new Date(now.getTime() - 24 * 3600 * 1000) } },
    }),
  ]);

  return { total, dueNow, done, overdue };
}
