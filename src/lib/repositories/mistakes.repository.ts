import type { Prisma, WrongAnswerRecord } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { readStringArray, writeStringArray } from '@/lib/db/json';

/**
 * 错题本的数据访问层。
 *
 * 一个用户对一道题最多一条 WrongAnswerRecord（唯一约束 userId+questionId），
 * 但**多次作答**全部保留在 AnswerAttempt 中（append-only）。
 * 每道题都允许学生手动修改 AI 的分析结果（editedByUser 标记人工干预）。
 */

export type WrongAnswerRecordView = Omit<WrongAnswerRecord, 'errorTypes' | 'likelyCauses'> & {
  errorTypes: string[];
  likelyCauses: string[];
};

export function toWrongRecordView(record: WrongAnswerRecord): WrongAnswerRecordView {
  return {
    ...record,
    errorTypes: readStringArray(record.errorTypes),
    likelyCauses: readStringArray(record.likelyCauses),
  };
}

export async function upsertWrongAnswerRecord(
  userId: string,
  questionId: string,
  input: {
    studentAnswer?: string | null;
    correctAnswerSnapshot?: string | null;
    errorTypes?: string[];
    likelyCauses?: string[];
    explanation?: string | null;
    errorConfidence?: number | null;
    editedByUser?: boolean;
    source?: string;
    sourceNote?: string | null;
    status?: string;
  },
): Promise<WrongAnswerRecord> {
  const data = {
    ...(input.studentAnswer === undefined ? {} : { studentAnswer: input.studentAnswer }),
    ...(input.correctAnswerSnapshot === undefined
      ? {}
      : { correctAnswerSnapshot: input.correctAnswerSnapshot }),
    ...(input.errorTypes === undefined ? {} : { errorTypes: writeStringArray(input.errorTypes) }),
    ...(input.likelyCauses === undefined ? {} : { likelyCauses: writeStringArray(input.likelyCauses) }),
    ...(input.explanation === undefined ? {} : { explanation: input.explanation }),
    ...(input.errorConfidence === undefined ? {} : { errorConfidence: input.errorConfidence }),
    ...(input.editedByUser === undefined ? {} : { editedByUser: input.editedByUser }),
    ...(input.source === undefined ? {} : { source: input.source }),
    ...(input.sourceNote === undefined ? {} : { sourceNote: input.sourceNote }),
    ...(input.status === undefined ? {} : { status: input.status }),
  };

  return prisma.wrongAnswerRecord.upsert({
    where: { userId_questionId: { userId, questionId } },
    update: data,
    create: {
      userId,
      questionId,
      source: 'manual',
      ...data,
    },
  });
}

export async function findWrongAnswerRecordById(
  userId: string,
  id: string,
): Promise<WrongAnswerRecord | null> {
  return prisma.wrongAnswerRecord.findFirst({ where: { id, userId } });
}

export async function findWrongAnswerRecordByQuestion(
  userId: string,
  questionId: string,
): Promise<WrongAnswerRecord | null> {
  return prisma.wrongAnswerRecord.findUnique({ where: { userId_questionId: { userId, questionId } } });
}

export type WrongRecordFilter = {
  subjectId?: string;
  knowledgePointId?: string;
  errorType?: string;
  status?: string;
  /** 'due' 表示「今天该复习了」 */
  reviewFilter?: 'due' | 'not-scheduled' | 'all';
  createdAfter?: Date;
  createdBefore?: Date;
  limit?: number;
  offset?: number;
};

export async function listWrongAnswerRecords(
  userId: string,
  filter: WrongRecordFilter = {},
): Promise<{ items: WrongAnswerRecord[]; total: number }> {
  const where: Prisma.WrongAnswerRecordWhereInput = { userId, isArchived: false };

  if (filter.status) where.status = filter.status;
  if (filter.createdAfter || filter.createdBefore) {
    where.createdAt = {
      ...(filter.createdAfter ? { gte: filter.createdAfter } : {}),
      ...(filter.createdBefore ? { lte: filter.createdBefore } : {}),
    };
  }

  const questionFilter: Prisma.QuestionWhereInput = {};
  if (filter.subjectId) questionFilter.subjectId = filter.subjectId;
  if (filter.knowledgePointId) {
    questionFilter.knowledgePointLinks = { some: { knowledgePointId: filter.knowledgePointId } };
  }
  if (Object.keys(questionFilter).length > 0) where.question = questionFilter;

  // 错误类型以 JSON TEXT 存储，SQLite 不支持 JSON 查询，
  // 因此这里用「包含子串」做粗筛，再由上层做精确过滤（避免方言相关查询）。
  if (filter.errorType) {
    where.errorTypes = { contains: `"${filter.errorType}"` };
  }

  if (filter.reviewFilter === 'due') {
    where.nextReviewAt = { lte: new Date() };
  } else if (filter.reviewFilter === 'not-scheduled') {
    where.nextReviewAt = null;
  }

  const [items, total] = await Promise.all([
    prisma.wrongAnswerRecord.findMany({
      where,
      orderBy: [{ nextReviewAt: 'asc' }, { createdAt: 'desc' }],
      take: filter.limit ?? 50,
      skip: filter.offset ?? 0,
    }),
    prisma.wrongAnswerRecord.count({ where }),
  ]);

  return { items, total };
}

export async function updateWrongAnswerRecord(
  userId: string,
  id: string,
  patch: {
    errorTypes?: string[];
    likelyCauses?: string[];
    explanation?: string | null;
    errorConfidence?: number | null;
    editedByUser?: boolean;
    status?: string;
    studentAnswer?: string | null;
    sourceNote?: string | null;
  },
): Promise<WrongAnswerRecord> {
  const result = await prisma.wrongAnswerRecord.updateMany({
    where: { id, userId },
    data: {
      ...(patch.errorTypes === undefined ? {} : { errorTypes: writeStringArray(patch.errorTypes) }),
      ...(patch.likelyCauses === undefined ? {} : { likelyCauses: writeStringArray(patch.likelyCauses) }),
      ...(patch.explanation === undefined ? {} : { explanation: patch.explanation }),
      ...(patch.errorConfidence === undefined ? {} : { errorConfidence: patch.errorConfidence }),
      ...(patch.editedByUser === undefined ? {} : { editedByUser: patch.editedByUser }),
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.studentAnswer === undefined ? {} : { studentAnswer: patch.studentAnswer }),
      ...(patch.sourceNote === undefined ? {} : { sourceNote: patch.sourceNote }),
    },
  });

  if (result.count === 0) throw new Error('WRONG_RECORD_NOT_FOUND_OR_FORBIDDEN');

  const updated = await prisma.wrongAnswerRecord.findUnique({ where: { id } });
  if (!updated) throw new Error('WRONG_RECORD_NOT_FOUND_OR_FORBIDDEN');
  return updated;
}

/**
 * 作答后刷新错题记录的汇总字段（次数、最近结果、下次复习时间）。
 * 「最近复习结果」只更新快照，历史结果一律保留在 AnswerAttempt / ReviewSchedule.historyJson。
 */
export async function refreshWrongRecordSummary(
  userId: string,
  id: string,
  patch: {
    attemptCount?: number;
    correctCount?: number;
    lastReviewedAt?: Date | null;
    lastReviewResult?: string | null;
    nextReviewAt?: Date | null;
    status?: string;
    resolvedAt?: Date | null;
  },
): Promise<void> {
  await prisma.wrongAnswerRecord.updateMany({
    where: { id, userId },
    data: {
      ...(patch.attemptCount === undefined ? {} : { attemptCount: patch.attemptCount }),
      ...(patch.correctCount === undefined ? {} : { correctCount: patch.correctCount }),
      ...(patch.lastReviewedAt === undefined ? {} : { lastReviewedAt: patch.lastReviewedAt }),
      ...(patch.lastReviewResult === undefined ? {} : { lastReviewResult: patch.lastReviewResult }),
      ...(patch.nextReviewAt === undefined ? {} : { nextReviewAt: patch.nextReviewAt }),
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.resolvedAt === undefined ? {} : { resolvedAt: patch.resolvedAt }),
    },
  });
}

/** 错题数量统计（按状态 / 是否到期），用于仪表盘。 */
export async function getWrongRecordStats(userId: string): Promise<{
  total: number;
  due: number;
  resolved: number;
  byStatus: Record<string, number>;
}> {
  const now = new Date();
  const [total, due, resolved, grouped] = await Promise.all([
    prisma.wrongAnswerRecord.count({ where: { userId, isArchived: false } }),
    prisma.wrongAnswerRecord.count({
      where: { userId, isArchived: false, nextReviewAt: { lte: now } },
    }),
    prisma.wrongAnswerRecord.count({ where: { userId, isArchived: false, status: 'resolved' } }),
    prisma.wrongAnswerRecord.groupBy({
      by: ['status'],
      where: { userId, isArchived: false },
      _count: { _all: true },
    }),
  ]);

  const byStatus: Record<string, number> = {};
  for (const row of grouped) {
    byStatus[row.status] = row._count._all;
  }

  return { total, due, resolved, byStatus };
}

/** 错题卡片所需的完整视图（含题目与知识点）。 */
export type WrongRecordDetail = {
  record: WrongAnswerRecordView;
  question: {
    id: string;
    stem: string;
    stemFormat: string;
    choices: string[];
    correctAnswer: string | null;
    imagePath: string | null;
    subjectId: string;
    grade: string | null;
    chapter: string | null;
    source: string;
    sourceNote: string | null;
  };
  knowledgePoints: { id: string; name: string; chapterPath: string; isPrimary: boolean }[];
};

export async function getWrongRecordDetail(
  userId: string,
  recordId: string,
): Promise<WrongRecordDetail | null> {
  const record = await prisma.wrongAnswerRecord.findFirst({
    where: { id: recordId, userId, isArchived: false },
    include: {
      question: {
        include: {
          knowledgePointLinks: {
            include: { knowledgePoint: { select: { id: true, name: true, chapterPath: true } } },
          },
        },
      },
    },
  });

  if (!record) return null;

  return {
    record: toWrongRecordView(record),
    question: {
      id: record.question.id,
      stem: record.question.stem,
      stemFormat: record.question.stemFormat,
      choices: readStringArray(record.question.choices),
      correctAnswer: record.question.correctAnswer,
      imagePath: record.question.imagePath,
      subjectId: record.question.subjectId,
      grade: record.question.grade,
      chapter: record.question.chapter,
      source: record.question.source,
      sourceNote: record.question.sourceNote,
    },
    knowledgePoints: record.question.knowledgePointLinks.map((link) => ({
      id: link.knowledgePoint.id,
      name: link.knowledgePoint.name,
      chapterPath: link.knowledgePoint.chapterPath,
      isPrimary: link.isPrimary,
    })),
  };
}
