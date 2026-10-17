import { estimateMastery, type DiagnosisResult, type EvidenceInput } from '@/lib/diagnosis/engine';
import { diagnosisNarrativeSchema, type DiagnosisNarrativeOutput } from '@/lib/domain/schemas';
import { buildDiagnosisNarrativePrompt } from '@/lib/ai/prompts';
import { getAiProvider } from '@/lib/ai/registry';
import { AiError } from '@/lib/ai/errors';
import { checkRateLimit } from '@/lib/ai/rate-limit';
import { listAttemptsForKnowledgePoint, getAttemptStatsByKnowledgePoint } from '@/lib/repositories/questions.repository';
import { upsertMastery, findMastery } from '@/lib/repositories/mastery.repository';
import { findKnowledgePointById, listPrerequisiteEdges, findKnowledgePointsByIds } from '@/lib/repositories/knowledge.repository';
import { prerequisiteClosure } from '@/lib/knowledge/graph';
import { readStringArray } from '@/lib/db/json';
import { errorTypeLabel, masteryLabel, type ErrorType, type Independence } from '@/lib/domain/enums';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * 薄弱知识诊断服务（需求 4.5 —— 项目的核心功能）。
 *
 * ⚠️ 职责边界非常重要：
 *   **掌握等级完全由 src/lib/diagnosis/engine.ts 的确定性算法给出，AI 不能改变它。**
 *   AI 在这里只做一件事：把已经算好的结论 + 真实证据，翻译成学生看得懂的说明。
 *   因此即使 AI 不可用（Mock 模式 / 超时），诊断功能依然完整可用 —— 只是没有那段"人话总结"。
 *
 * 每次诊断都会持久化（需求要求）：
 *   估计结果、支持判断的答题证据、证据数量、置信度、最近更新时间、建议的下一步行动。
 */

export type DiagnosisView = {
  knowledgePointId: string;
  knowledgePointName: string;
  subjectId: string;
  chapterPath: string;
  result: DiagnosisResult;
  /** AI 用自然语言解释结论（可选，失败时为 null 并附带原因） */
  narrative: DiagnosisNarrativeOutput | null;
  narrativeError: string | null;
  /** 前置知识（当算法认为需要回补时给出具体是哪几个） */
  prerequisites: { id: string; name: string; depth: number }[];
  /** 评价依据的可读化：把证据列表转成界面可直接渲染的结构 */
  evidence: {
    attemptId: string;
    questionId: string;
    questionStemPreview: string;
    isCorrect: boolean;
    independence: string;
    context: string;
    difficulty: number;
    createdAt: string;
    errorTypes: string[];
    errorTypeLabels: string[];
  }[];
  updatedAt: string;
};

/** 把数据库里的作答记录转成算法输入（含 independence / errorTypes 的解析与兜底）。 */
export function toEvidenceInput(
  attempts: readonly {
    id: string;
    isCorrect: boolean;
    independence: string;
    difficultySnapshot: number;
    context: string;
    createdAt: Date;
    errorTypes: string;
  }[],
): EvidenceInput[] {
  const validIndependence = new Set<Independence>(['independent', 'with-hint', 'with-solution']);
  const validContext = new Set(['initial', 'practice', 'review', 'retest']);

  return attempts.map((attempt) => ({
    id: attempt.id,
    isCorrect: attempt.isCorrect,
    independence: validIndependence.has(attempt.independence as Independence)
      ? (attempt.independence as Independence)
      : // 未知值保守处理为「看解析后完成」，避免错误地高估掌握度
        'with-solution',
    difficulty: attempt.difficultySnapshot,
    context: validContext.has(attempt.context)
      ? (attempt.context as EvidenceInput['context'])
      : 'practice',
    createdAt: attempt.createdAt,
    errorTypes: readStringArray(attempt.errorTypes) as ErrorType[],
  }));
}

/**
 * 计算某个知识点的诊断结果（**不调 AI，纯算法 + 数据库读取**）。
 * 单独拆出来的好处：报告页、计划生成、仪表盘都可以复用，且不需要 AI 额度。
 */
export async function computeDiagnosis(
  userId: string,
  knowledgePointId: string,
  options: { now?: Date } = {},
): Promise<{ knowledgePoint: NonNullable<Awaited<ReturnType<typeof findKnowledgePointById>>>; result: DiagnosisResult; attempts: Awaited<ReturnType<typeof listAttemptsForKnowledgePoint>> }> {
  const knowledgePoint = await findKnowledgePointById(knowledgePointId);
  if (!knowledgePoint) {
    throw new AppError('NOT_FOUND', { userMessage: '没有找到这个知识点。' });
  }

  const attempts = await listAttemptsForKnowledgePoint(userId, knowledgePointId);
  const result = estimateMastery(toEvidenceInput(attempts), options.now ? { now: options.now } : {});

  return { knowledgePoint, result, attempts };
}

/**
 * 完整诊断：算法 + 持久化 + （可选）AI 说明。
 *
 * @param withNarrative 是否调用 AI 生成说明。列表页批量诊断时应传 false 以节省额度与时间。
 */
export async function diagnoseKnowledgePoint(
  userId: string,
  knowledgePointId: string,
  options: { withNarrative?: boolean; now?: Date } = {},
): Promise<DiagnosisView> {
  const { knowledgePoint, result, attempts } = await computeDiagnosis(userId, knowledgePointId, options);

  // ---- 需要回补前置知识时，算出具体是哪几个（用图算法，不猜）----
  let prerequisites: { id: string; name: string; depth: number }[] = [];
  if (result.needsPrerequisiteReview) {
    const edges = await listPrerequisiteEdges([knowledgePointId]);
    // 继续往上取一跳，得到前置的前置
    const secondHop = edges.length > 0 ? await listPrerequisiteEdges(edges.map((e) => e.fromId)) : [];
    const closure = prerequisiteClosure(
      [knowledgePointId],
      [...edges, ...secondHop].map((e) => ({
        fromId: e.fromId,
        toId: e.toId,
        relationType: e.relationType,
        strength: e.strength,
      })),
    );
    const nodes = await findKnowledgePointsByIds(closure.map((c) => c.id));
    const nameById = new Map(nodes.map((n) => [n.id, n.name]));
    prerequisites = closure.map((c) => ({
      id: c.id,
      name: nameById.get(c.id) ?? c.id,
      depth: c.depth,
    }));
  }

  // ---- 持久化估计结果 ----
  const repeatedErrorTypes: Record<string, number> = {};
  for (const item of result.repeatedErrorTypes) repeatedErrorTypes[item.type] = item.count;

  await upsertMastery(userId, knowledgePointId, {
    level: result.level,
    score: result.score,
    confidence: result.confidence,
    evidenceCount: result.evidenceCount,
    recentAccuracy: result.recentAccuracy,
    recentSampleSize: result.recentSampleSize,
    repeatedErrorTypes,
    needsPrerequisiteReview: result.needsPrerequisiteReview,
    nextAction: result.nextAction,
    lastEvaluatedAt: options.now ?? new Date(),
  });

  // ---- 证据视图（可追溯性）----
  const evidence = attempts.slice(-20).map((attempt) => {
    const types = readStringArray(attempt.errorTypes);
    return {
      attemptId: attempt.id,
      questionId: attempt.questionId,
      questionStemPreview: attempt.questionStem.slice(0, 80) || '（题干未录入）',
      isCorrect: attempt.isCorrect,
      independence: attempt.independence,
      context: attempt.context,
      difficulty: attempt.difficultySnapshot,
      createdAt: attempt.createdAt.toISOString(),
      errorTypes: types,
      errorTypeLabels: types.map((t) => errorTypeLabel(t)),
    };
  });

  // ---- AI 说明（可选且可失败）----
  let narrative: DiagnosisNarrativeOutput | null = null;
  let narrativeError: string | null = null;

  if (options.withNarrative) {
    try {
      narrative = await generateNarrative({
        userId,
        knowledgePointName: knowledgePoint.name,
        subjectName: knowledgePoint.subjectId,
        grade: knowledgePoint.grade,
        result,
        evidence: evidence.map((e) => ({
          questionStemPreview: e.questionStemPreview,
          isCorrect: e.isCorrect,
          independence: e.independence,
          createdAt: e.createdAt,
          errorTypes: e.errorTypes,
        })),
      });
    } catch (error) {
      // AI 失败不影响诊断本身 —— 这是刻意的设计，避免把整个核心功能绑在 AI 可用性上
      narrativeError =
        error instanceof AiError ? error.userMessage : 'AI 说明生成失败，但诊断结论不受影响。';
      logger.warn('diagnosis.narrative_failed', {
        knowledgePointId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    knowledgePointId: knowledgePoint.id,
    knowledgePointName: knowledgePoint.name,
    subjectId: knowledgePoint.subjectId,
    chapterPath: knowledgePoint.chapterPath,
    result,
    narrative,
    narrativeError,
    prerequisites,
    evidence,
    updatedAt: new Date().toISOString(),
  };
}

/** 只生成 AI 说明，不落库（供「换一种说法」这类操作使用）。 */
async function generateNarrative(input: {
  userId: string;
  knowledgePointName: string;
  subjectName: string;
  grade: string;
  result: DiagnosisResult;
  evidence: {
    questionStemPreview: string;
    isCorrect: boolean;
    independence: string;
    createdAt: string;
    errorTypes: string[];
  }[];
}): Promise<DiagnosisNarrativeOutput> {
  const decision = checkRateLimit({ userId: input.userId, scope: 'knowledge-diagnosis' });
  if (!decision.allowed) {
    throw new AiError('AI_RATE_LIMITED', { userMessage: '诊断说明生成太频繁，稍后再试。' });
  }

  const prompt = buildDiagnosisNarrativePrompt({
    knowledgePointName: input.knowledgePointName,
    subjectName: input.subjectName,
    grade: input.grade,
    algorithmConclusion: {
      level: input.result.level,
      levelLabel: masteryLabel(input.result.level),
      confidence: input.result.confidence,
      evidenceCount: input.result.evidenceCount,
      recentAccuracy: input.result.recentAccuracy,
      repeatedErrorTypes: Object.fromEntries(
        input.result.repeatedErrorTypes.map((item) => [item.type, item.count]),
      ),
      needsPrerequisiteReview: input.result.needsPrerequisiteReview,
    },
    evidence: input.evidence,
  });

  const provider = getAiProvider();
  const result = await provider.generateStructured<DiagnosisNarrativeOutput>({
    messages: [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content:
          '请输出 JSON：{"summary": "...", "evidence": [{"observation": "..."}], "nextActions": ["..."], "uncertainty": "...", "confidence": 0.0}',
      },
    ],
    schema: diagnosisNarrativeSchema,
    schemaName: 'KnowledgeDiagnosisNarrative',
    schemaDescription: '对已给出的掌握度结论的自然语言解释，含证据引用、下一步动作与不确定性说明',
    service: 'knowledge-diagnosis',
  });

  return result.value;
}

/** 批量诊断（不调 AI）—— 仪表盘与计划生成用。 */
export async function computeDiagnosisBatch(
  userId: string,
  knowledgePointIds: string[],
): Promise<Map<string, DiagnosisResult>> {
  const map = new Map<string, DiagnosisResult>();
  for (const id of knowledgePointIds) {
    const attempts = await listAttemptsForKnowledgePoint(userId, id);
    map.set(id, estimateMastery(toEvidenceInput(attempts)));
  }
  return map;
}

/** 掌握度刷新入口：在某次作答落库后调用，只刷新该题关联的知识点。 */
export async function refreshMasteryForKnowledgePoints(
  userId: string,
  knowledgePointIds: string[],
  now = new Date(),
): Promise<void> {
  for (const id of knowledgePointIds) {
    const attempts = await listAttemptsForKnowledgePoint(userId, id);
    const result = estimateMastery(toEvidenceInput(attempts), { now });

    const repeatedErrorTypes: Record<string, number> = {};
    for (const item of result.repeatedErrorTypes) repeatedErrorTypes[item.type] = item.count;

    await upsertMastery(userId, id, {
      level: result.level,
      score: result.score,
      confidence: result.confidence,
      evidenceCount: result.evidenceCount,
      recentAccuracy: result.recentAccuracy,
      recentSampleSize: result.recentSampleSize,
      repeatedErrorTypes,
      needsPrerequisiteReview: result.needsPrerequisiteReview,
      nextAction: result.nextAction,
      lastEvaluatedAt: now,
    });
  }
}

export { getAttemptStatsByKnowledgePoint, findMastery };
