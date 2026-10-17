import {
  createQuestion,
  findQuestionForUser,
  linkQuestionToKnowledgePoints,
  listAttemptsForQuestion,
  updateQuestion,
  type QuestionWithLinks,
} from '@/lib/repositories/questions.repository';
import {
  findWrongAnswerRecordByQuestion,
  getWrongRecordDetail,
  listWrongAnswerRecords,
  toWrongRecordView,
  upsertWrongAnswerRecord,
} from '@/lib/repositories/mistakes.repository';
import { createInitialReviewSchedule } from '@/lib/review/service';
import { uploadUrl } from '@/lib/storage/uploads';
import { readStringArray } from '@/lib/db/json';
import { AppError } from '@/lib/errors';
import { findSubjectById, getSubjectNameMap, resolveSubjectByIdentifier } from '@/lib/repositories/subjects.repository';
import type { ErrorType } from '@/lib/domain/enums';

/**
 * 错题本的业务编排（需求 4.3）。
 *
 * 把「建题 → 关联知识点 → 建错题记录 → 建首次复习计划」这条链收敛在一个函数里，
 * 保证不会出现「有题目没有错题记录」或「有错题记录没有复习计划」的中间态。
 */

export type QuestionSummary = {
  id: string;
  stem: string;
  stemFormat: string;
  choices: string[];
  subjectId: string;
  subjectName: string;
  grade: string | null;
  chapter: string | null;
  correctAnswer: string | null;
  explanation: string | null;
  imagePath: string | null;
  imageUrl: string | null;
  source: string;
  sourceNote: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  knowledgePoints: { id: string; name: string; chapterPath: string; isPrimary: boolean }[];
  mistake: {
    id: string;
    status: string;
    studentAnswer: string | null;
    errorTypes: string[];
    likelyCauses: string[];
    errorConfidence: number | null;
    editedByUser: boolean;
    attemptCount: number;
    correctCount: number;
    lastReviewedAt: string | null;
    lastReviewResult: string | null;
    nextReviewAt: string | null;
    confidenceNote: string;
  } | null;
};

export async function toQuestionSummary(
  question: QuestionWithLinks,
  subjectName?: string,
): Promise<QuestionSummary> {
  const record = await findWrongAnswerRecordByQuestion(question.userId, question.id);
  const view = record ? toWrongRecordView(record) : null;

  return {
    id: question.id,
    stem: question.stem,
    stemFormat: question.stemFormat,
    choices: readStringArray(question.choices),
    subjectId: question.subjectId,
    subjectName: subjectName ?? (await findSubjectById(question.subjectId))?.name ?? '',
    grade: question.grade,
    chapter: question.chapter,
    correctAnswer: question.correctAnswer,
    explanation: question.explanation,
    imagePath: question.imagePath,
    imageUrl: uploadUrl(question.imagePath),
    source: question.source,
    sourceNote: question.sourceNote,
    status: question.status,
    createdAt: question.createdAt.toISOString(),
    updatedAt: question.updatedAt.toISOString(),
    knowledgePoints: question.knowledgePointLinks.map((link) => ({
      id: link.knowledgePoint.id,
      name: link.knowledgePoint.name,
      chapterPath: link.knowledgePoint.chapterPath,
      isPrimary: link.isPrimary,
    })),
    mistake: view
      ? {
          id: view.id,
          status: view.status,
          studentAnswer: view.studentAnswer,
          errorTypes: view.errorTypes,
          likelyCauses: view.likelyCauses,
          errorConfidence: view.errorConfidence,
          editedByUser: view.editedByUser,
          attemptCount: view.attemptCount,
          correctCount: view.correctCount,
          lastReviewedAt: view.lastReviewedAt?.toISOString() ?? null,
          lastReviewResult: view.lastReviewResult,
          nextReviewAt: view.nextReviewAt?.toISOString() ?? null,
          // 置信度必须与结论一起展示，避免学生把 AI 的推测当成结论
          confidenceNote:
            view.errorConfidence === null
              ? '这条错误原因还没有经过分析，或者分析置信度不可用。'
              : view.errorConfidence < 0.5
                ? 'AI 对错误原因的把握不高，建议你自己核对一下，也欢迎直接修改。'
                : 'AI 对错误原因的判断把握较高，但仍建议你确认一下是否符合当时的思路。',
        }
      : null,
  };
}

export type CreateQuestionResult = {
  question: QuestionSummary;
  /** 是否同时创建了错题记录 */
  mistakeCreated: boolean;
  /** 首次复习安排 */
  firstReview: { dueAt: string; intervalDays: number } | null;
};

/**
 * 创建题目；可选同时建错题记录与首次复习计划。
 */
export async function createQuestionWithOptionalMistake(params: {
  userId: string;
  input: {
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
  knowledgePoints?: { knowledgePointId: string; isPrimary?: boolean; source?: string; confidence?: number }[];
  mistake?: {
    create: boolean;
    studentAnswer?: string | null;
    errorTypes?: ErrorType[];
    likelyCauses?: string[];
    explanation?: string | null;
    errorConfidence?: number | null;
    source?: string;
  };
}): Promise<CreateQuestionResult> {
  // 归一化学科标识：调用方可能传 code（math）也可能传 id，外键只认 id
  const subject = await resolveSubjectByIdentifier(params.input.subjectId);
  if (!subject) {
    throw new AppError('VALIDATION_ERROR', { userMessage: '请选择一个有效的学科。' });
  }

  const question = await createQuestion(params.userId, {
    ...params.input,
    subjectId: subject.id,
    grade: params.input.grade ?? null,
  });

  if (params.knowledgePoints && params.knowledgePoints.length > 0) {
    await linkQuestionToKnowledgePoints(
      question.id,
      params.knowledgePoints.map((link) => ({
        knowledgePointId: link.knowledgePointId,
        isPrimary: link.isPrimary ?? true,
        source: link.source ?? 'manual',
        confidence: link.confidence ?? 1,
      })),
    );
  }

  let mistakeCreated = false;
  let firstReview: { dueAt: string; intervalDays: number } | null = null;

  if (params.mistake?.create) {
    const record = await upsertWrongAnswerRecord(params.userId, question.id, {
      studentAnswer: params.mistake.studentAnswer ?? null,
      correctAnswerSnapshot: params.input.correctAnswer ?? null,
      errorTypes: params.mistake.errorTypes ?? [],
      likelyCauses: params.mistake.likelyCauses ?? [],
      explanation: params.mistake.explanation ?? params.input.explanation ?? null,
      errorConfidence: params.mistake.errorConfidence ?? null,
      source: params.mistake.source ?? params.input.source ?? 'manual',
      status: 'needs-review',
    });

    mistakeCreated = true;

    const review = await createInitialReviewSchedule(params.userId, record.id, {
      attemptCount: 0,
      correctCount: 0,
    });

    firstReview = { dueAt: review.dueAt.toISOString(), intervalDays: review.intervalDays };
  }

  const created = await findQuestionForUser(params.userId, question.id);
  if (!created) throw new AppError('INTERNAL_ERROR');

  return {
    question: await toQuestionSummary(created, subject.name),
    mistakeCreated,
    firstReview,
  };
}

/** 题目详情：题目 + 作答历史 + 错题记录 + 复习历史 */
export async function getQuestionDetail(userId: string, questionId: string) {
  const question = await findQuestionForUser(userId, questionId);
  if (!question) {
    throw new AppError('NOT_FOUND', { userMessage: '这道题不存在，或者不属于你。' });
  }

  const subjectNameMap = await getSubjectNameMap();
  const attempts = await listAttemptsForQuestion(userId, questionId);
  const detail = await getWrongRecordDetail(userId, (await findWrongAnswerRecordByQuestion(userId, questionId))?.id ?? '');

  return {
    question: await toQuestionSummary(question, subjectNameMap.get(question.subjectId)),
    attempts: attempts.map((attempt) => ({
      id: attempt.id,
      answer: attempt.answer,
      isCorrect: attempt.isCorrect,
      independence: attempt.independence,
      difficultySnapshot: attempt.difficultySnapshot,
      timeSpentSeconds: attempt.timeSpentSeconds,
      errorTypes: readStringArray(attempt.errorTypes),
      note: attempt.note,
      context: attempt.context,
      createdAt: attempt.createdAt.toISOString(),
    })),
    wrongRecord: detail?.record ?? null,
    reviewHistory: detail?.record
      ? await loadReviewHistory(userId, detail.record.id)
      : [],
  };
}

async function loadReviewHistory(userId: string, wrongRecordId: string) {
  const { findReviewScheduleByWrongRecord } = await import('@/lib/repositories/review.repository');
  const { toReviewView } = await import('@/lib/repositories/review.repository');
  const schedule = await findReviewScheduleByWrongRecord(userId, wrongRecordId);
  if (!schedule) return [];
  return toReviewView(schedule).history;
}

/** 错题本列表（支持按学科 / 知识点 / 错误类型 / 时间 / 复习状态筛选） */
export async function listMistakeSummaries(
  userId: string,
  filter: Parameters<typeof listWrongAnswerRecords>[1],
): Promise<{ items: QuestionSummary[]; total: number }> {
  const { items, total } = await listWrongAnswerRecords(userId, filter);
  const subjectNameMap = await getSubjectNameMap();

  const summaries: QuestionSummary[] = [];
  for (const record of items) {
    const question = await findQuestionForUser(record.userId, record.questionId);
    if (!question) continue;
    summaries.push(await toQuestionSummary(question, subjectNameMap.get(question.subjectId)));
  }

  return { items: summaries, total };
}

export { updateQuestion };
