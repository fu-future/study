import type { AnswerAttempt, Prisma, Question, QuestionKnowledgePoint } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { writeStringArray } from '@/lib/db/json';
import { containsFilter } from '@/lib/db/search';

/**
 * 题目与作答记录的数据访问层。
 *
 * 关键约束（来自需求）：
 *   - 题目 ↔ 知识点 多对多
 *   - **同一道题可以有很多次作答记录，绝不只保存最后一次**
 *   - 所有查询都必须带 userId 过滤，保证用户间数据隔离
 */

export type QuestionWithLinks = Question & {
  knowledgePointLinks: (QuestionKnowledgePoint & {
    knowledgePoint: { id: string; name: string; subjectId: string; chapterPath: string };
  })[];
};

const questionWithLinksInclude = {
  knowledgePointLinks: {
    include: {
      knowledgePoint: { select: { id: true, name: true, subjectId: true, chapterPath: true } },
    },
  },
} satisfies Prisma.QuestionInclude;

// -----------------------------------------------------------------------------
// 题目
// -----------------------------------------------------------------------------

export type CreateQuestionInput = {
  subjectId: string;
  grade?: string | null;
  chapter?: string | null;
  stem: string;
  stemFormat?: string;
  choices?: string[];
  correctAnswer?: string | null;
  explanation?: string | null;
  imagePath?: string | null;
  imageMimeType?: string | null;
  imageBytes?: number | null;
  source?: string;
  sourceNote?: string | null;
  ocrConfidence?: number | null;
};

export async function createQuestion(userId: string, input: CreateQuestionInput): Promise<Question> {
  return prisma.question.create({
    data: {
      userId,
      subjectId: input.subjectId,
      grade: input.grade ?? null,
      chapter: input.chapter ?? null,
      stem: input.stem,
      stemFormat: input.stemFormat ?? 'text',
      choices: writeStringArray(input.choices ?? []),
      correctAnswer: input.correctAnswer ?? null,
      explanation: input.explanation ?? null,
      imagePath: input.imagePath ?? null,
      imageMimeType: input.imageMimeType ?? null,
      imageBytes: input.imageBytes ?? null,
      source: input.source ?? 'manual',
      sourceNote: input.sourceNote ?? null,
      ocrConfidence: input.ocrConfidence ?? null,
    },
  });
}

/** 单题查询 —— 必须带 userId，防止猜 id 访问别人的题目。 */
export async function findQuestionForUser(
  userId: string,
  questionId: string,
): Promise<QuestionWithLinks | null> {
  return prisma.question.findFirst({
    where: { id: questionId, userId, isArchived: false },
    include: questionWithLinksInclude,
  });
}

export type QuestionFilter = {
  subjectId?: string;
  knowledgePointId?: string;
  search?: string;
  source?: string;
  status?: string;
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'updatedAt';
};

export async function listQuestions(
  userId: string,
  filter: QuestionFilter = {},
): Promise<{ items: QuestionWithLinks[]; total: number }> {
  const where: Prisma.QuestionWhereInput = { userId, isArchived: false };

  if (filter.subjectId) where.subjectId = filter.subjectId;
  if (filter.source) where.source = filter.source;
  if (filter.status) where.status = filter.status;
  if (filter.knowledgePointId) {
    where.knowledgePointLinks = { some: { knowledgePointId: filter.knowledgePointId } };
  }
  if (filter.search) {
    const like = containsFilter(filter.search);
    where.OR = [{ stem: like }, { chapter: like }, { sourceNote: like }];
  }

  const [items, total] = await Promise.all([
    prisma.question.findMany({
      where,
      include: questionWithLinksInclude,
      orderBy: { [filter.orderBy ?? 'createdAt']: 'desc' },
      take: filter.limit ?? 50,
      skip: filter.offset ?? 0,
    }),
    prisma.question.count({ where }),
  ]);

  return { items, total };
}

export async function updateQuestion(
  userId: string,
  questionId: string,
  patch: {
    stem?: string;
    stemFormat?: string;
    choices?: string[];
    correctAnswer?: string | null;
    explanation?: string | null;
    subjectId?: string;
    grade?: string | null;
    chapter?: string | null;
    sourceNote?: string | null;
    status?: string;
  },
): Promise<Question> {
  // updateMany + userId 条件：即使拿到别人的 questionId 也改不动
  const result = await prisma.question.updateMany({
    where: { id: questionId, userId },
    data: {
      ...(patch.stem === undefined ? {} : { stem: patch.stem }),
      ...(patch.stemFormat === undefined ? {} : { stemFormat: patch.stemFormat }),
      ...(patch.choices === undefined ? {} : { choices: writeStringArray(patch.choices) }),
      ...(patch.correctAnswer === undefined ? {} : { correctAnswer: patch.correctAnswer }),
      ...(patch.explanation === undefined ? {} : { explanation: patch.explanation }),
      ...(patch.subjectId === undefined ? {} : { subjectId: patch.subjectId }),
      ...(patch.grade === undefined ? {} : { grade: patch.grade }),
      ...(patch.chapter === undefined ? {} : { chapter: patch.chapter }),
      ...(patch.sourceNote === undefined ? {} : { sourceNote: patch.sourceNote }),
      ...(patch.status === undefined ? {} : { status: patch.status }),
    },
  });

  if (result.count === 0) {
    throw new Error('QUESTION_NOT_FOUND_OR_FORBIDDEN');
  }

  const updated = await prisma.question.findUnique({ where: { id: questionId } });
  if (!updated) throw new Error('QUESTION_NOT_FOUND_OR_FORBIDDEN');
  return updated;
}

/** 归档而不是物理删除 —— 学习记录不能被轻易抹掉。 */
export async function archiveQuestion(userId: string, questionId: string): Promise<void> {
  await prisma.question.updateMany({
    where: { id: questionId, userId },
    data: { isArchived: true, status: 'archived' },
  });
}

// -----------------------------------------------------------------------------
// 题目 ↔ 知识点
// -----------------------------------------------------------------------------

export async function linkQuestionToKnowledgePoints(
  questionId: string,
  links: { knowledgePointId: string; isPrimary?: boolean; weight?: number; source?: string; confidence?: number }[],
): Promise<void> {
  for (const link of links) {
    await prisma.questionKnowledgePoint.upsert({
      where: {
        questionId_knowledgePointId: { questionId, knowledgePointId: link.knowledgePointId },
      },
      update: {
        isPrimary: link.isPrimary ?? true,
        weight: link.weight ?? 1,
        source: link.source ?? 'manual',
        confidence: link.confidence ?? 1,
      },
      create: {
        questionId,
        knowledgePointId: link.knowledgePointId,
        isPrimary: link.isPrimary ?? true,
        weight: link.weight ?? 1,
        source: link.source ?? 'manual',
        confidence: link.confidence ?? 1,
      },
    });
  }
}

export async function unlinkQuestionFromKnowledgePoint(
  questionId: string,
  knowledgePointId: string,
): Promise<void> {
  await prisma.questionKnowledgePoint.deleteMany({ where: { questionId, knowledgePointId } });
}

// -----------------------------------------------------------------------------
// 作答记录（append-only，永不覆盖历史）
// -----------------------------------------------------------------------------

export type CreateAttemptInput = {
  questionId: string;
  answer?: string | null;
  isCorrect: boolean;
  independence?: string;
  difficultySnapshot?: number;
  timeSpentSeconds?: number | null;
  errorTypes?: string[];
  note?: string | null;
  context?: string;
  studyTaskId?: string | null;
  wrongAnswerRecordId?: string | null;
};

export async function createAnswerAttempt(
  userId: string,
  input: CreateAttemptInput,
): Promise<AnswerAttempt> {
  return prisma.answerAttempt.create({
    data: {
      userId,
      questionId: input.questionId,
      answer: input.answer ?? null,
      isCorrect: input.isCorrect,
      independence: input.independence ?? 'independent',
      difficultySnapshot: input.difficultySnapshot ?? 3,
      timeSpentSeconds: input.timeSpentSeconds ?? null,
      errorTypes: writeStringArray(input.errorTypes ?? []),
      note: input.note ?? null,
      context: input.context ?? 'practice',
      studyTaskId: input.studyTaskId ?? null,
      wrongAnswerRecordId: input.wrongAnswerRecordId ?? null,
    },
  });
}

/** 一道题的全部作答历史，按时间正序 —— 诊断算法依赖这个顺序。 */
export async function listAttemptsForQuestion(
  userId: string,
  questionId: string,
  options: { limit?: number } = {},
): Promise<AnswerAttempt[]> {
  return prisma.answerAttempt.findMany({
    where: { userId, questionId },
    orderBy: { createdAt: 'asc' },
    take: options.limit ?? 200,
  });
}

/** 一个用户近期所有作答 —— 掌握度估计的输入。 */
export async function listRecentAttempts(  userId: string,
  options: { since?: Date; limit?: number; knowledgePointId?: string; subjectId?: string } = {},
): Promise<AnswerAttempt[]> {
  const where: Prisma.AnswerAttemptWhereInput = { userId };
  if (options.since) where.createdAt = { gte: options.since };
  if (options.knowledgePointId) {
    where.question = { knowledgePointLinks: { some: { knowledgePointId: options.knowledgePointId } } };
  }
  if (options.subjectId) {
    where.question = { ...(where.question as object), subjectId: options.subjectId };
  }

  return prisma.answerAttempt.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: options.limit ?? 500,
  });
}

export async function getAttemptStats(
  userId: string,
  options: { since?: Date } = {},
): Promise<{ total: number; correct: number }> {
  const where: Prisma.AnswerAttemptWhereInput = { userId };
  if (options.since) where.createdAt = { gte: options.since };

  const [total, correct] = await Promise.all([
    prisma.answerAttempt.count({ where }),
    prisma.answerAttempt.count({ where: { ...where, isCorrect: true } }),
  ]);

  return { total, correct };
}

/**
 * 某个知识点下的全部作答记录（含题目信息）——
 * 掌握度估计算法的输入。
 *
 * 关联路径：AnswerAttempt → Question → QuestionKnowledgePoint(knowledgePointId)
 * 注意：一道题可能挂多个知识点，所以同一条作答可能出现在多个知识点的诊断里 ——
 * 这是符合预期的：它确实同时提供了两个知识点的证据。
 */
export async function listAttemptsForKnowledgePoint(
  userId: string,
  knowledgePointId: string,
  options: { limit?: number } = {},
): Promise<(AnswerAttempt & { questionStem: string; questionId: string })[]> {
  const attempts = await prisma.answerAttempt.findMany({
    where: {
      userId,
      question: { knowledgePointLinks: { some: { knowledgePointId } } },
    },
    include: { question: { select: { id: true, stem: true } } },
    orderBy: { createdAt: 'asc' },
    take: options.limit ?? 200,
  });

  return attempts.map((attempt) => ({
    ...attempt,
    questionId: attempt.question.id,
    questionStem: attempt.question.stem,
  }));
}

/** 一个知识点的作答证据数量（用于"还需要更多练习"的快速判断）。 */
export async function countAttemptsForKnowledgePoint(
  userId: string,
  knowledgePointId: string,
): Promise<number> {
  return prisma.answerAttempt.count({
    where: { userId, question: { knowledgePointLinks: { some: { knowledgePointId } } } },
  });
}

/** 按学科统计作答正确率（周报用）—— 只统计真实记录。 */
export async function getAttemptStatsBySubject(
  userId: string,
  range: { from: Date; to: Date },
): Promise<Map<string, { total: number; correct: number }>> {
  const attempts = await prisma.answerAttempt.findMany({
    where: { userId, createdAt: { gte: range.from, lte: range.to } },
    select: { isCorrect: true, question: { select: { subjectId: true } } },
  });

  const result = new Map<string, { total: number; correct: number }>();
  for (const attempt of attempts) {
    const subjectId = attempt.question.subjectId;
    const bucket = result.get(subjectId) ?? { total: 0, correct: 0 };
    bucket.total += 1;
    if (attempt.isCorrect) bucket.correct += 1;
    result.set(subjectId, bucket);
  }
  return result;
}

/** 某段时间内按知识点聚合的作答情况（周报的"进步/待加强"依据）。 */
export async function getAttemptStatsByKnowledgePoint(
  userId: string,
  range: { from: Date; to: Date },
): Promise<Map<string, { total: number; correct: number }>> {
  const attempts = await prisma.answerAttempt.findMany({
    where: { userId, createdAt: { gte: range.from, lte: range.to } },
    select: {
      isCorrect: true,
      question: {
        select: { knowledgePointLinks: { select: { knowledgePointId: true } } },
      },
    },
  });

  const result = new Map<string, { total: number; correct: number }>();
  for (const attempt of attempts) {
    for (const link of attempt.question.knowledgePointLinks) {
      const bucket = result.get(link.knowledgePointId) ?? { total: 0, correct: 0 };
      bucket.total += 1;
      if (attempt.isCorrect) bucket.correct += 1;
      result.set(link.knowledgePointId, bucket);
    }
  }
  return result;
}
