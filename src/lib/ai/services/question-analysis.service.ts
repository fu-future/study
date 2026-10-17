import { getAiProvider } from '@/lib/ai/registry';
import { buildQuestionAnalysisPrompt } from '@/lib/ai/prompts';
import { questionAnalysisSchema, type QuestionAnalysisOutput } from '@/lib/domain/schemas';
import { checkRateLimit, logRateLimitDecision } from '@/lib/ai/rate-limit';
import { AiError } from '@/lib/ai/errors';
import { ERROR_TYPE_CODES, SUBJECT_CODES, type ErrorType } from '@/lib/domain/enums';
import { listKnowledgePoints } from '@/lib/repositories/knowledge.repository';
import { listSubjects } from '@/lib/repositories/subjects.repository';
import { logger } from '@/lib/logger';

/**
 * 错题识别与分析服务（需求 4.3 + 第六节）。
 *
 * 两阶段设计（需求要求「先完成题目识别和知识点匹配，再生成讲解与学习建议」）：
 *   Stage A：如果有图片 → 先用视觉模型做「题目识别」，产出题干/选项/答案
 *   Stage B：带着题干 + 知识点目录 → 结构化分析（知识点匹配、错因分类、解析、建议）
 *
 * 硬性约束：
 *   - 图片不清晰 / 题干缺失 → needsUserConfirmation = true，**绝不编造题目内容**
 *   - knowledgePoints 只能返回目录里真实存在的 code，服务层再做一次白名单过滤
 *   - 视觉能力不足时抛明确错误（由界面引导到手动录入），不静默降级成假结果
 */

export type AnalyzeTextInput = {
  userId: string;
  stem: string;
  choices?: string[];
  studentAnswer?: string | null;
  correctAnswer?: string | null;
  subjectId?: string | null;
  grade?: string | null;
};

export type AnalyzeImageInput = {
  userId: string;
  imageBase64: string;
  mimeType: string;
  /** 学生补充的上下文，例如「这是第 18 题」 */
  hint?: string;
  subjectId?: string | null;
  grade?: string | null;
};

export type AnalysisResult = {
  analysis: QuestionAnalysisOutput;
  /** 模型返回的 knowledgePoint code 中，真实存在于目录里的那些（白名单过滤结果） */
  matchedKnowledgePointCodes: string[];
  /** 模型提到但目录里不存在的 code —— 前端可提示「AI 引用了不存在的知识点，已忽略」 */
  rejectedKnowledgePointCodes: string[];
  model: string;
  providerId: string;
  latencyMs: number;
  /** 是否处于 Mock 模式（界面需显示「示例数据」提示） */
  isMock: boolean;
};

function assertRateLimit(userId: string, scope: string): void {
  const decision = checkRateLimit({ userId, scope });
  if (!decision.allowed) {
    logRateLimitDecision(decision, { userId, scope });
    throw new AiError('AI_RATE_LIMITED', {
      userMessage: `分析请求有点频繁，等 ${decision.retryAfterSeconds} 秒再试吧。`,
    });
  }
}

/** 把模型返回的学科名归一：既接受 code（math）也接受中文（数学）。 */
function normalizeSubject(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!value) return '';
  if (SUBJECT_CODES.includes(value as never)) return value;

  const zhMap: Record<string, string> = {
    语文: 'chinese',
    数学: 'math',
    英语: 'english',
    物理: 'physics',
    化学: 'chemistry',
    生物: 'biology',
    历史: 'history',
    地理: 'geography',
    思想政治: 'politics',
    政治: 'politics',
  };
  return zhMap[raw.trim()] ?? '';
}

/** 把模型返回的错误原因代码归一；未知值一律归到 unknown，不落库脏数据。 */
function normalizeErrorTypes(raw: string[]): ErrorType[] {
  const valid = new Set<string>(ERROR_TYPE_CODES);
  const seen = new Set<ErrorType>();
  for (const item of raw) {
    const code = item.trim().toLowerCase().replace(/_/g, '-');
    if (valid.has(code)) seen.add(code as ErrorType);
  }
  if (seen.size === 0 && raw.length > 0) seen.add('unknown');
  return [...seen];
}

/** 取用于提示词的知识点目录（按学科过滤，避免目录过长）。 */
async function loadKnowledgePointCatalog(subjectId?: string | null, grade?: string | null) {
  const subjects = await listSubjects();
  const subject = subjectId
    ? subjects.find((s) => s.id === subjectId || s.code === subjectId)
    : undefined;

  const { items } = await listKnowledgePoints({
    subjectId: subject?.id,
    grade: grade ?? undefined,
    // 只把「已审核」的知识点放进目录 —— AI 不能引用未审核的草稿
    reviewStatus: 'reviewed',
    limit: 200,
  });

  return { subject, catalog: items };
}

async function runAnalysis(params: {
  userId: string;
  grade?: string | null;
  subjectId?: string | null;
  subjectName?: string | null;
  stem: string;
  choices: string[];
  studentAnswer?: string | null;
  correctAnswer?: string | null;
  imageData?: { base64: string; mimeType: string };
  hint?: string;
}): Promise<AnalysisResult> {
  assertRateLimit(params.userId, 'question-analysis');

  const provider = getAiProvider();
  const { catalog } = await loadKnowledgePointCatalog(params.subjectId, params.grade);

  const systemPrompt = buildQuestionAnalysisPrompt({
    grade: params.grade,
    subjectName: params.subjectName,
    knowledgePointCatalog: catalog.map((kp) => ({
      code: kp.code,
      name: kp.name,
      chapterPath: kp.chapterPath,
    })),
  });

  // ---- Stage A：图片识别（可选） ----
  let recognizedStem = params.stem;
  let recognizedChoices = params.choices;
  let recognizedAnswer = params.correctAnswer ?? null;
  let ocrNotes = '';

  if (params.imageData) {
    const caps = provider.getCapabilities();
    if (!caps.vision || !provider.visionModel) {
      // 明确报错，让界面引导到手动录入 —— 不假装识别成功
      throw new AiError('AI_CAPABILITY_UNSUPPORTED', {
        message: '当前 provider 未配置视觉模型',
        userMessage:
          '当前配置的模型不能识别图片。你可以直接手动录入题目内容（同样能获得完整分析），或者在 .env 里设置支持视觉的 AI_VISION_MODEL。',
      });
    }

    const imageResult = await provider.analyzeImage({
      image: { type: 'image', mimeType: params.imageData.mimeType, dataBase64: params.imageData.base64 },
      service: 'question-analysis',
      instruction: [
        '请识别这张题目图片。只做识别，不要解题。',
        '严格按 JSON 输出：{"stem": 题干原文, "choices": [选项], "correctAnswer": 正确答案（看不清就留空）, "unclear": true/false, "unclearReason": "哪里看不清"}',
        '如果图片模糊、被裁切、或题干不完整，把 unclear 设为 true 并在 unclearReason 说明缺什么。**不要猜测看不清的内容。**',
        params.hint ? `学生补充：${params.hint}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      context: [params.subjectName, params.grade].filter(Boolean).join(' · '),
    });

    try {
      const cleaned = imageResult.text
        .replace(/```(?:json)?/gi, '')
        .replace(/```/g, '')
        .trim();
      const first = cleaned.indexOf('{');
      const last = cleaned.lastIndexOf('}');
      const parsed = JSON.parse(first !== -1 && last > first ? cleaned.slice(first, last + 1) : cleaned) as {
        stem?: string;
        choices?: string[];
        correctAnswer?: string;
        unclear?: boolean;
        unclearReason?: string;
      };

      if (parsed.stem) recognizedStem = parsed.stem;
      if (Array.isArray(parsed.choices) && parsed.choices.length > 0) recognizedChoices = parsed.choices;
      if (parsed.correctAnswer) recognizedAnswer = parsed.correctAnswer;
      if (parsed.unclear) {
        ocrNotes = `题目图片可能不清晰：${parsed.unclearReason ?? '未说明'}`;
      }
    } catch {
      ocrNotes = '未能从图片中稳定解析出题目结构，请核对下方识别结果。';
    }
  }

  // ---- Stage B：结构化分析 ----
  const userContent = [
    `【题目】\n${recognizedStem || '（题干为空 —— 请在 explanation 中说明题干缺失，不要编造题目）'}`,
    recognizedChoices.length ? `【选项】\n${recognizedChoices.join('\n')}` : '',
    params.studentAnswer ? `【学生的答案】\n${params.studentAnswer}` : '【学生的答案】（未提供）',
    recognizedAnswer ? `【已知正确答案】\n${recognizedAnswer}` : '',
    ocrNotes ? `【识别提示】${ocrNotes}` : '',
    '',
    '请按要求的 JSON 结构输出分析结果。',
  ]
    .filter(Boolean)
    .join('\n\n');

  // 显式指定输出类型：Zod 的 .default() 会让 `z.infer` 取到“输入类型”，
  // 显式传泛型参数才能拿到“输出类型”，避免一堆“possibly undefined”。
  const result = await provider.generateStructured<QuestionAnalysisOutput>({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    schema: questionAnalysisSchema,
    schemaName: 'QuestionAnalysis',
    schemaDescription:
      '错题分析结果：学科、题干、知识点code数组、错误原因分类数组、可能原因、解析、前置知识、建议动作、置信度',
    service: 'question-analysis',
  });

  const analysis = result.value;

  // ---- 服务层白名单过滤 ----
  // 即使提示词说了"只能用目录里的 code"，模型仍可能编造。
  // 这里做最后一道防线：编造的 code 一律丢弃，并记录下来供界面提示。
  const catalogCodes = new Set(catalog.map((kp) => kp.code));
  const matchedKnowledgePointCodes = analysis.knowledgePoints.filter((code) => catalogCodes.has(code));
  const rejectedKnowledgePointCodes = analysis.knowledgePoints.filter((code) => !catalogCodes.has(code));

  if (rejectedKnowledgePointCodes.length > 0) {
    logger.warn('ai.analysis_rejected_knowledge_points', {
      count: rejectedKnowledgePointCodes.length,
      // 只记数量与长度，不记具体内容，避免把模型幻觉写进日志
    });
  }

  /**
   * 合并两个阶段的结果。
   *
   * 为什么必须合并：图片分析分两步走 ——
   *   Stage A 用视觉模型做「识别」（题干/选项/答案），
   *   Stage B 用文本模型做「分析」。
   * Stage B 的模型经常只回答"怎么解"而**不回填题干**（它觉得那是已知输入），
   * 如果这里不做兜底，就会出现「识别明明成功了，最终题干却是空的」这种数据丢失，
   * 学生保存下来的错题会没有题干。
   *
   * 注意：Stage A 的识别结果**也是真实模型输出**，不是我们编造的，因此可以直接采用。
   */
  const mergedStem = analysis.stem.trim() || recognizedStem;
  const mergedChoices = analysis.choices.length > 0 ? analysis.choices : recognizedChoices;
  const mergedAnswer = analysis.correctAnswer.trim() || (recognizedAnswer ?? '');

  const normalized: QuestionAnalysisOutput = {
    ...analysis,
    subject: normalizeSubject(analysis.subject),
    errorTypes: normalizeErrorTypes(analysis.errorTypes),
    knowledgePoints: matchedKnowledgePointCodes,
    stem: mergedStem,
    choices: mergedChoices,
    correctAnswer: mergedAnswer,
    // 题干最终仍为空 / 识别过程有提示时，才标记为需要学生确认
    needsUserConfirmation:
      analysis.needsUserConfirmation || !mergedStem.trim() || Boolean(ocrNotes),
    confidence: analysis.mock ? 0 : analysis.confidence,
  };

  return {
    analysis: normalized,
    matchedKnowledgePointCodes,
    rejectedKnowledgePointCodes,
    model: result.model,
    providerId: result.providerId,
    latencyMs: result.latencyMs,
    isMock: Boolean(analysis.mock),
  };
}

/** 文本分析（手动录入 / 已有题干） */
export async function analyzeQuestionText(input: AnalyzeTextInput): Promise<AnalysisResult> {
  const subject = input.subjectId
    ? (await listSubjects()).find((s) => s.id === input.subjectId || s.code === input.subjectId)
    : undefined;

  return runAnalysis({
    userId: input.userId,
    grade: input.grade,
    subjectId: subject?.id ?? input.subjectId ?? null,
    subjectName: subject?.name ?? null,
    stem: input.stem,
    choices: input.choices ?? [],
    studentAnswer: input.studentAnswer,
    correctAnswer: input.correctAnswer,
  });
}

/** 图片分析（先识别再分析） */
export async function analyzeQuestionImage(input: AnalyzeImageInput): Promise<AnalysisResult> {
  const subject = input.subjectId
    ? (await listSubjects()).find((s) => s.id === input.subjectId || s.code === input.subjectId)
    : undefined;

  return runAnalysis({
    userId: input.userId,
    grade: input.grade,
    subjectId: subject?.id ?? input.subjectId ?? null,
    subjectName: subject?.name ?? null,
    stem: '',
    choices: [],
    imageData: { base64: input.imageBase64, mimeType: input.mimeType },
    hint: input.hint,
  });
}

/**
 * 手动录入时的「零 AI」分析结果 —— 保证在没有 AI 的情况下错题本依然完全可用。
 * 这对应需求「图片识别失败时允许手动录入」。
 */
export function manualAnalysisPlaceholder(): QuestionAnalysisOutput {
  return {
    subject: '',
    stem: '',
    choices: [],
    correctAnswer: '',
    explanation: '',
    knowledgePoints: [],
    errorTypes: ['unknown'],
    likelyCauses: [],
    prerequisites: [],
    recommendedActions: ['先自己写一遍完整过程，再对照答案解析，标出卡住的那一步。'],
    confidence: 0,
    needsUserConfirmation: true,
  };
}
