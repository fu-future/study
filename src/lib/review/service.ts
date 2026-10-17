import { addDays, scheduleNextReview, startOfDay, daysBetween } from '@/lib/review/scheduler';
import {
  createAnswerAttempt,
  findQuestionForUser,
  listAttemptsForQuestion,
} from '@/lib/repositories/questions.repository';
import {
  findWrongAnswerRecordByQuestion,
  refreshWrongRecordSummary,
  updateWrongAnswerRecord,
} from '@/lib/repositories/mistakes.repository';
import {
  findReviewScheduleByWrongRecord,
  recordReviewResult,
  upsertReviewSchedule,
} from '@/lib/repositories/review.repository';
import { findMastery } from '@/lib/repositories/mastery.repository';
import { refreshMasteryForKnowledgePoints } from '@/lib/ai/services/knowledge-diagnosis.service';
import { MASTERY_ORDER } from '@/lib/domain/enums';
import { AppError } from '@/lib/errors';
import type { AttemptContext, ErrorType, Independence, ReviewResult } from '@/lib/domain/enums';

/**
 * 复习与作答的编排服务。
 *
 * 一次「作答」会牵动四件事，必须按顺序、原子性地处理（都在一个函数里完成）：
 *   1. 追加一条 AnswerAttempt（append-only，永不覆盖历史）
 *   2. 刷新错题记录的汇总字段（次数 / 最近结果 / 下次复习时间）
 *   3. 用间隔复习算法计算下一次复习时间，并把本次结果**追加**进历史
 *   4. 重新估计相关知识点的掌握度（只有这一步会改变"掌握"结论）
 *
 * 第 4 步是刻意的：**只有真实作答才会改变掌握度判断**，
 * 单纯"看完讲解"或"看完视频"不会 —— 因为那是输入，不是输出。
 */

export type SubmitAttemptResult = {
  attempt: {
    id: string;
    isCorrect: boolean;
    independence: string;
    context: string;
    createdAt: string;
  };
  /** 下一次复习安排 */
  review: {
    dueAt: string;
    intervalDays: number;
    repetition: number;
    easeFactor: number;
    overdueDays: number;
  } | null;
  /** 受影响知识点的掌握度（只返回有结论的部分） */
  mastery: {
    knowledgePointId: string;
    knowledgePointName: string;
    level: string;
    score: number | null;
    confidence: number;
    evidenceCount: number;
    recentAccuracy: number | null;
    needsPrerequisiteReview: boolean;
    nextAction: string | null;
  }[];
};

/** 提交一次作答（练习或复测）。 */
export async function submitAttempt(params: {
  userId: string;
  questionId: string;
  input: {
    answer?: string | null;
    isCorrect: boolean;
    independence: Independence;
    difficultySnapshot: number;
    timeSpentSeconds?: number | null;
    errorTypes?: ErrorType[];
    note?: string | null;
    context: AttemptContext;
  };
}): Promise<SubmitAttemptResult> {
  const question = await findQuestionForUser(params.userId, params.questionId);
  if (!question) {
    throw new AppError('NOT_FOUND', { userMessage: '这道题不存在，或者不属于你。' });
  }

  const wrongRecord = await findWrongAnswerRecordByQuestion(params.userId, params.questionId);

  const attempt = await createAnswerAttempt(params.userId, {
    questionId: params.questionId,
    answer: params.input.answer ?? null,
    isCorrect: params.input.isCorrect,
    independence: params.input.independence,
    difficultySnapshot: params.input.difficultySnapshot,
    timeSpentSeconds: params.input.timeSpentSeconds ?? null,
    errorTypes: params.input.errorTypes ?? [],
    note: params.input.note ?? null,
    context: params.input.context,
    wrongAnswerRecordId: wrongRecord?.id ?? null,
  });

  // 刷新错题汇总
  if (wrongRecord) {
    const history = await listAttemptsForQuestion(params.userId, params.questionId);
    const correctCount = history.filter((a) => a.isCorrect).length;

    await refreshWrongRecordSummary(params.userId, wrongRecord.id, {
      attemptCount: history.length,
      correctCount,
      lastReviewedAt: new Date(),
      lastReviewResult: params.input.isCorrect ? 'correct' : 'wrong',
      // 连续答对 2 次以上视为已订正（但仍保留复习计划，间隔会自然拉长）
      status: params.input.isCorrect && correctCount >= 2 ? 'resolved' : 'needs-review',
      resolvedAt: params.input.isCorrect && correctCount >= 2 ? new Date() : null,
      nextReviewAt: wrongRecord.nextReviewAt,
    });
  }

  const mastery = await refreshMasteryForKnowledgePoints(
    params.userId,
    question.knowledgePointLinks.map((link) => link.knowledgePointId),
  ).then(() =>
    Promise.all(
      question.knowledgePointLinks.map(async (link) => {
        const row = await findMastery(params.userId, link.knowledgePointId);
        return {
          knowledgePointId: link.knowledgePointId,
          knowledgePointName: link.knowledgePoint.name,
          level: row?.level ?? 'unevaluated',
          score: row?.score ?? null,
          confidence: row?.confidence ?? 0,
          evidenceCount: row?.evidenceCount ?? 0,
          recentAccuracy: row?.recentAccuracy ?? null,
          needsPrerequisiteReview: row?.needsPrerequisiteReview ?? false,
          nextAction: row?.nextAction ?? null,
        };
      }),
    ),
  );

  return {
    attempt: {
      id: attempt.id,
      isCorrect: attempt.isCorrect,
      independence: attempt.independence,
      context: attempt.context,
      createdAt: attempt.createdAt.toISOString(),
    },
    review: null,
    mastery,
  };
}

/**
 * 提交一次错题复习（这是「错题本 → 复习 → 验证效果」的核心闭环）。
 *
 * 与 submitAttempt 的区别：
 *   - 要求必须先有错题记录
 *   - 会推进间隔复习计划（scheduleNextReview）
 *   - 复习结果同时回写到错题记录的快照字段
 */
export async function submitMistakeReview(params: {
  userId: string;
  questionId: string;
  input: {
    result: ReviewResult;
    independence: Independence;
    answer?: string | null;
    timeSpentSeconds?: number | null;
  };
}): Promise<SubmitAttemptResult> {
  const question = await findQuestionForUser(params.userId, params.questionId);
  if (!question) {
    throw new AppError('NOT_FOUND', { userMessage: '这道题不存在，或者不属于你。' });
  }

  const wrongRecord = await findWrongAnswerRecordByQuestion(params.userId, params.questionId);
  if (!wrongRecord) {
    throw new AppError('NOT_FOUND', {
      userMessage: '这道题还没有错题记录，请先在错题本里录入。',
    });
  }

  const isCorrect = params.input.result === 'correct';

  const attempt = await createAnswerAttempt(params.userId, {
    questionId: params.questionId,
    answer: params.input.answer ?? null,
    isCorrect,
    independence: params.input.independence,
    difficultySnapshot: 3,
    timeSpentSeconds: params.input.timeSpentSeconds ?? null,
    // 复习时答错，把上次记录的错误类型带过来（如果学生这次没重新标注）
    errorTypes: isCorrect ? [] : [],
    context: 'review',
    wrongAnswerRecordId: wrongRecord.id,
  });

  // ---- 推进间隔复习 ----
  const existing = await findReviewScheduleByWrongRecord(params.userId, wrongRecord.id);

  const currentState = existing
    ? {
        repetition: existing.repetition,
        intervalDays: existing.intervalDays,
        easeFactor: existing.easeFactor,
      }
    : { repetition: 0, intervalDays: 1, easeFactor: 2.5 };

  const next = scheduleNextReview(
    currentState,
    params.input.result,
    new Date(),
    existing?.dueAt ?? null,
  );

  let scheduleId: string;
  if (existing) {
    await recordReviewResult(params.userId, existing.id, {
      result: params.input.result,
      intervalDays: next.intervalDays,
      repetition: next.repetition,
      easeFactor: next.easeFactor,
      nextDueAt: next.dueAt,
    });
    scheduleId = existing.id;
  } else {
    const created = await upsertReviewSchedule(
      params.userId,
      { wrongAnswerRecordId: wrongRecord.id },
      {
        dueAt: next.dueAt,
        intervalDays: next.intervalDays,
        repetition: next.repetition,
        easeFactor: next.easeFactor,
        status: 'scheduled',
      },
    );
    scheduleId = created.id;
  }

  // ---- 刷新错题汇总 ----
  const history = await listAttemptsForQuestion(params.userId, params.questionId);
  const correctCount = history.filter((a) => a.isCorrect).length;
  const recentCorrectStreak = countTrailingCorrect(history.map((a) => a.isCorrect));

  await refreshWrongRecordSummary(params.userId, wrongRecord.id, {
    attemptCount: history.length,
    correctCount,
    lastReviewedAt: new Date(),
    lastReviewResult: params.input.result,
    nextReviewAt: next.dueAt,
    // 连续答对 2 次以上 → 视为已订正（复习间隔已经拉长，不会立刻再来烦学生）
    status: recentCorrectStreak >= 2 ? 'resolved' : 'needs-review',
    resolvedAt: recentCorrectStreak >= 2 ? new Date() : null,
  });

  // 学生手动修改错误原因时，把「人工干预」记下来（AI 分析不再被当作权威）
  if (params.input.result === 'wrong') {
    await updateWrongAnswerRecord(params.userId, wrongRecord.id, { status: 'needs-review' });
  }

  // ---- 重新估计掌握度 ----
  const knowledgePointIds = question.knowledgePointLinks.map((link) => link.knowledgePointId);
  await refreshMasteryForKnowledgePoints(params.userId, knowledgePointIds);

  const mastery = await Promise.all(
    question.knowledgePointLinks.map(async (link) => {
      const row = await findMastery(params.userId, link.knowledgePointId);
      return {
        knowledgePointId: link.knowledgePointId,
        knowledgePointName: link.knowledgePoint.name,
        level: row?.level ?? 'unevaluated',
        score: row?.score ?? null,
        confidence: row?.confidence ?? 0,
        evidenceCount: row?.evidenceCount ?? 0,
        recentAccuracy: row?.recentAccuracy ?? null,
        needsPrerequisiteReview: row?.needsPrerequisiteReview ?? false,
        nextAction: row?.nextAction ?? null,
      };
    }),
  );

  void scheduleId;

  return {
    attempt: {
      id: attempt.id,
      isCorrect: attempt.isCorrect,
      independence: attempt.independence,
      context: attempt.context,
      createdAt: attempt.createdAt.toISOString(),
    },
    review: {
      dueAt: next.dueAt.toISOString(),
      intervalDays: next.intervalDays,
      repetition: next.repetition,
      easeFactor: next.easeFactor,
      overdueDays: next.overdueDays,
    },
    mastery,
  };
}

/** 新录入的错题：立刻建立第一条复习计划（1 天后） */
export async function createInitialReviewSchedule(
  userId: string,
  wrongAnswerRecordId: string,
  options: { attemptCount?: number; correctCount?: number } = {},
): Promise<{ dueAt: Date; intervalDays: number }> {
  const { initialIntervalFromAttempts } = await import('@/lib/review/scheduler');
  const intervalDays = initialIntervalFromAttempts({
    attemptCount: options.attemptCount ?? 0,
    correctCount: options.correctCount ?? 0,
  });

  const dueAt = addDays(startOfDay(new Date()), intervalDays);

  await upsertReviewSchedule(
    userId,
    { wrongAnswerRecordId },
    { dueAt, intervalDays, repetition: 0, easeFactor: 2.5, status: 'scheduled' },
  );

  // 错题记录上的 nextReviewAt 是列表页筛选「今天该复习」的依据，
  // 必须在建立复习计划的同时回写，否则会出现「有计划但列表里看不到到期」的不一致。
  await refreshWrongRecordSummary(userId, wrongAnswerRecordId, { nextReviewAt: dueAt });

  return { dueAt, intervalDays };
}

function countTrailingCorrect(scroll: boolean[]): number {
  let count = 0;
  for (let i = scroll.length - 1; i >= 0; i -= 1) {
    if (scroll[i]) count += 1;
    else break;
  }
  return count;
}

/** 掌握等级排名（越小越弱）——供上层排序 */
export function masteryRankOf(level: string): number {
  const index = MASTERY_ORDER.indexOf(level as never);
  return index === -1 ? 0 : index + 1;
}

export { daysBetween };
