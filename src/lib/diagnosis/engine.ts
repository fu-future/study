import {
  ERROR_TYPES,
  type ErrorType,
  type Independence,
  type MasteryLevel,
} from '@/lib/domain/enums';

/**
 * 知识掌握度估计算法（**核心功能**）。
 *
 * ┌─ 设计原则（直接对应需求 4.5）────────────────────────────────────────────┐
 * │ 1. 不依赖 AI：纯规则、可测试、可解释。AI 只负责把结论翻译成人话。        │
 * │ 2. 不以单次结果下结论：一次答错≠薄弱，一次答对≠掌握。                   │
 * │ 3. 证据不足时明确说「还需要更多练习」，不制造虚假的精确分数。           │
 * │ 4. 每个结论都能回溯到具体答题记录（evidence 字段）。                    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * 估计使用的信号（全部来自 AnswerAttempt）：
 *   - 近期正确率：越近的作答权重越高（半衰期 14 天）
 *   - 独立完成情况：独立 > 看提示 > 看解析。**看了解析才做对不能算掌握**。
 *   - 题目难度：做对难题比做对简单题提供更强证据（带难度校正）
 *   - 重复错误：同类错误反复出现 → 指向具体的方法性问题
 *   - 复测表现：隔一段时间后的复测（context=retest）通过才算真正稳固
 *
 * 注意：本文件是**纯函数**，不 import 数据库、不 import AI、不读环境变量，
 *      因此可以在 Vitest 里被充分覆盖（见 src/lib/diagnosis/engine.test.ts）。
 */

// -----------------------------------------------------------------------------
// 输入 / 输出类型
// -----------------------------------------------------------------------------

export type EvidenceInput = {
  id: string;
  isCorrect: boolean;
  independence: Independence;
  /** 该题难度 1..5 */
  difficulty: number;
  /** 作答场景 */
  context: 'initial' | 'practice' | 'review' | 'retest';
  createdAt: Date;
  errorTypes: ErrorType[];
  /** 学生自评是否真正理解（可选，来自 UI 的"我还是不太懂"按钮） */
  selfReportedUnsure?: boolean;
};

export type DiagnosisOptions = {
  /** 估算基准时刻，默认取最新一条证据的时间（便于测试） */
  now?: Date;
  /** 近期窗口天数，默认 14 天 */
  recentWindowDays?: number;
  /** 半衰期（天），默认 14 */
  halfLifeDays?: number;
  /** 进入"有足够证据"所需的最小有效证据量，默认 3.5 */
  minEffectiveEvidence?: number;
  /** 进入"有足够证据"所需的最小作答次数，默认 3 */
  minAttemptCount?: number;
};

export type RepeatedError = { type: ErrorType; count: number };

export type DiagnosisResult = {
  level: MasteryLevel;
  /** 内部估计分 0..100；level 为 unevaluated / insufficient 时为 null */
  score: number | null;
  /** 置信度 0..1，永远与 level 一起展示 */
  confidence: number;
  /** 原始作答条数 */
  evidenceCount: number;
  /** 加权后的"有效证据量"，用于判断是否够用 */
  effectiveEvidence: number;
  /** 近期窗口内的加权正确率 0..1；窗口内无数据为 null */
  recentAccuracy: number | null;
  /** 近期窗口内参与统计的作答条数 */
  recentSampleSize: number;
  /** 重复出现的错误类型（出现 ≥2 次） */
  repeatedErrorTypes: RepeatedError[];
  /** 是否建议先回补前置知识 */
  needsPrerequisiteReview: boolean;
  /** 面向学生的下一步行动建议（简短、可执行；AI 可在此基础上润色） */
  nextAction: string;
  /** 支持该结论的证据 id 列表 —— 可追溯性的实现 */
  evidenceIds: string[];
  /** 置信度为什么是这个值（可解释性） */
  confidenceReasons: string[];
  /** 是否给出了数值分数（false 表示"还需要更多练习"） */
  hasScore: boolean;
};

// -----------------------------------------------------------------------------
// 权重函数
// -----------------------------------------------------------------------------

/** 独立完成程度权重：看了解析才做对，几乎不能证明掌握。 */
const INDEPENDENCE_WEIGHT: Record<Independence, number> = {
  independent: 1,
  'with-hint': 0.5,
  'with-solution': 0.2,
};

/**
 * 记忆衰减权重：半衰期 halfLifeDays 天。
 * 14 天前的作答权重降为一半 —— 近期表现比历史表现更能说明当前状态。
 */
export function recencyWeight(ageInDays: number, halfLifeDays = 14): number {
  if (ageInDays <= 0) return 1;
  return Math.pow(0.5, ageInDays / halfLifeDays);
}

/**
 * 难度校正：做对难题给的证据更多，做错简单题扣的"分"更多。
 * 返回 0.8..1.3 的系数，避免难度过度主导结论。
 */
export function difficultyFactor(isCorrect: boolean, difficulty: number): number {
  const d = Math.min(5, Math.max(1, difficulty));
  const normalized = (d - 3) / 2; // -1 .. 1
  const factor = isCorrect ? 1 + normalized * 0.3 : 1 - normalized * 0.25;
  return Math.min(1.3, Math.max(0.8, factor));
}

/** 单条作答的有效权重 */
export function attemptWeight(evidence: EvidenceInput, now: Date, halfLifeDays: number): number {
  const ageInDays = Math.max(0, (now.getTime() - evidence.createdAt.getTime()) / 86_400_000);
  const base =
    INDEPENDENCE_WEIGHT[evidence.independence] *
    recencyWeight(ageInDays, halfLifeDays) *
    difficultyFactor(evidence.isCorrect, evidence.difficulty);

  // 学生自己说"还是不太懂"，即使答对了也降低其证据价值
  return evidence.selfReportedUnsure ? base * 0.5 : base;
}

// -----------------------------------------------------------------------------
// 主算法
// -----------------------------------------------------------------------------

const DEFAULTS: Required<Omit<DiagnosisOptions, 'now'>> = {
  recentWindowDays: 14,
  halfLifeDays: 14,
  minEffectiveEvidence: 3.5,
  minAttemptCount: 3,
};

export function estimateMastery(
  evidenceList: readonly EvidenceInput[],
  options: DiagnosisOptions = {},
): DiagnosisResult {
  const config = { ...DEFAULTS, ...options };

  if (evidenceList.length === 0) {
    return emptyResult('还没有这道题相关的作答记录。建议先做 2-3 道同类练习，我才能给出判断。', [
      '没有作答记录',
    ]);
  }

  // 按时间正序，便于计算"最近表现"
  const sorted = [...evidenceList].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const latest = sorted[sorted.length - 1]!;
  const now = options.now ?? latest.createdAt;

  // ---- 1. 加权统计 ----
  let positive = 0;
  let total = 0;
  let effectiveEvidence = 0;

  for (const evidence of sorted) {
    const weight = attemptWeight(evidence, now, config.halfLifeDays);
    effectiveEvidence += weight;
    total += weight;
    if (evidence.isCorrect) positive += weight;
  }

  const weightedAccuracy = total > 0 ? positive / total : 0;

  // ---- 2. 近期窗口表现 ----
  const windowStart = new Date(now.getTime() - config.recentWindowDays * 86_400_000);
  const recent = sorted.filter((e) => e.createdAt.getTime() >= windowStart.getTime());

  let recentPositive = 0;
  let recentTotal = 0;
  for (const evidence of recent) {
    const weight = attemptWeight(evidence, now, config.halfLifeDays);
    recentTotal += weight;
    if (evidence.isCorrect) recentPositive += weight;
  }
  const recentAccuracy = recentTotal > 0 ? recentPositive / recentTotal : null;

  // ---- 3. 重复错误识别 ----
  const errorCounts = new Map<ErrorType, number>();
  for (const evidence of sorted) {
    if (evidence.isCorrect) continue;
    for (const type of evidence.errorTypes) {
      errorCounts.set(type, (errorCounts.get(type) ?? 0) + 1);
    }
  }
  const repeatedErrorTypes: RepeatedError[] = [...errorCounts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  // ---- 4. 复测证据 ----
  // 只有"隔了一段时间后、独立完成的复测答对"才算稳固的证明
  const retestEvidence = sorted.filter(
    (e) => e.context === 'retest' && e.isCorrect && e.independence === 'independent',
  );
  const independentCorrect = sorted.filter((e) => e.isCorrect && e.independence === 'independent');

  // ---- 5. 证据是否足够 ----
  if (sorted.length < config.minAttemptCount || effectiveEvidence < config.minEffectiveEvidence) {
    const reason = [
      `作答 ${sorted.length} 次（需要至少 ${config.minAttemptCount} 次）`,
      `有效证据量 ${effectiveEvidence.toFixed(2)}（需要至少 ${config.minEffectiveEvidence}）`,
      '看解析/提示后完成的部分会被打折计算',
    ];

    return {
      level: sorted.length === 0 ? 'unevaluated' : 'insufficient',
      score: null,
      confidence: clamp01(effectiveEvidence / config.minEffectiveEvidence) * 0.45,
      evidenceCount: sorted.length,
      effectiveEvidence: round2(effectiveEvidence),
      recentAccuracy: recentAccuracy === null ? null : round3(recentAccuracy),
      recentSampleSize: recent.length,
      repeatedErrorTypes,
      needsPrerequisiteReview: false,
      nextAction: `还需要更多练习：再用独立完成的方式做 ${Math.max(2, config.minAttemptCount - sorted.length)} 道同类题，我就能给出较可靠的判断了。`,
      evidenceIds: sorted.map((e) => e.id),
      confidenceReasons: reason,
      hasScore: false,
    };
  }

  // ---- 6. 综合分 ----
  // 结构：整体准确率（55%）+ 近期准确率（30%）+ 独立完成率（15%）
  const independentRate = sorted.length > 0 ? independentCorrect.length / sorted.length : 0;
  const recentComponent = recentAccuracy ?? weightedAccuracy;

  let score = 100 * (0.55 * weightedAccuracy + 0.3 * recentComponent + 0.15 * independentRate);

  // 难度加成：独立做对 ≥4 难度的题，最多 +6 分
  const hardIndependentCorrect = independentCorrect.filter((e) => e.difficulty >= 4).length;
  score += Math.min(6, hardIndependentCorrect * 2);

  // 重复错误扣分：同一类错误反复出现，说明存在方法性问题
  const repeatedPenalty = repeatedErrorTypes.reduce(
    (sum, item) => sum + Math.min(6, (item.count - 1) * 2),
    0,
  );
  score -= Math.min(15, repeatedPenalty);

  score = Math.max(0, Math.min(100, score));

  // ---- 7. 映射到等级 ----
  let level: MasteryLevel;
  if (score < 55) {
    level = 'learning';
  } else if (score < 70) {
    level = 'initial';
  } else if (score < 85) {
    level = 'basic';
  } else {
    level = 'stable';
  }

  /**
   * 「稳定掌握」需要额外的硬条件 —— 光靠正确率不够：
   *   - 至少一次隔期复测独立答对（证明记住了，不是刚做完还记得）
   *   - 没有反复出现的概念性错误
   */
  if (level === 'stable') {
    const hasConceptError = repeatedErrorTypes.some(
      (item) => item.type === 'concept' || item.type === 'formula' || item.type === 'transfer',
    );
    if (retestEvidence.length === 0 || hasConceptError) {
      level = 'basic';
    }
  }

  // 反向保护：近期准确率很低时不允许判为"基本掌握"以上
  // （防止"以前做对很多次"掩盖"最近一直错"）
  if (recentAccuracy !== null && recentAccuracy < 0.4 && (level === 'basic' || level === 'stable')) {
    level = 'initial';
  }

  // ---- 8. 置信度 ----
  const { confidence, confidenceReasons } = computeConfidence({
    effectiveEvidence,
    attemptCount: sorted.length,
    recentSampleSize: recent.length,
    hasRetest: retestEvidence.length > 0,
  });

  // ---- 9. 前置知识建议 ----
  const conceptLikeErrors = repeatedErrorTypes.filter((item) =>
    ['concept', 'formula', 'transfer', 'method'].includes(item.type),
  );
  const needsPrerequisiteReview =
    conceptLikeErrors.length > 0 && (score < 70 || (recentAccuracy ?? 1) < 0.6);

  // ---- 10. 下一步建议 ----
  const nextAction = buildNextAction({
    level,
    score,
    repeatedErrorTypes,
    needsPrerequisiteReview,
    recentAccuracy,
  });

  return {
    level,
    score: Math.round(score),
    confidence: round3(confidence),
    evidenceCount: sorted.length,
    effectiveEvidence: round2(effectiveEvidence),
    recentAccuracy: recentAccuracy === null ? null : round3(recentAccuracy),
    recentSampleSize: recent.length,
    repeatedErrorTypes,
    needsPrerequisiteReview,
    nextAction,
    evidenceIds: sorted.map((e) => e.id),
    confidenceReasons,
    hasScore: true,
  };
}

// -----------------------------------------------------------------------------
// 辅助
// -----------------------------------------------------------------------------

function emptyResult(nextAction: string, reasons: string[]): DiagnosisResult {
  return {
    level: 'unevaluated',
    score: null,
    confidence: 0,
    evidenceCount: 0,
    effectiveEvidence: 0,
    recentAccuracy: null,
    recentSampleSize: 0,
    repeatedErrorTypes: [],
    needsPrerequisiteReview: false,
    nextAction,
    evidenceIds: [],
    confidenceReasons: reasons,
    hasScore: false,
  };
}

function computeConfidence(input: {
  effectiveEvidence: number;
  attemptCount: number;
  recentSampleSize: number;
  hasRetest: boolean;
}): { confidence: number; confidenceReasons: string[] } {
  const reasons: string[] = [];

  // 证据量贡献（占 70%）：4 条有效证据 ≈ 0.47，8 条 ≈ 0.68，12 条 ≈ 0.81
  const evidenceComponent = 1 - Math.exp(-input.effectiveEvidence / 6);
  reasons.push(
    `有效证据量 ${input.effectiveEvidence.toFixed(2)}（共 ${input.attemptCount} 次作答）→ 证据分量 ${evidenceComponent.toFixed(2)}`,
  );

  // 时间跨度贡献（占 20%）：近期样本越多，越能反映当前水平
  const recencyComponent = 1 - Math.exp(-input.recentSampleSize / 4);
  reasons.push(`近 14 天内作答 ${input.recentSampleSize} 次 → 时效分量 ${recencyComponent.toFixed(2)}`);

  // 复测贡献（占 10%）
  const retestComponent = input.hasRetest ? 1 : 0;
  reasons.push(input.hasRetest ? '已有隔期复测通过的记录 → 复测分量 1.00' : '尚无隔期复测记录 → 复测分量 0.00');

  const confidence = 0.7 * evidenceComponent + 0.2 * recencyComponent + 0.1 * retestComponent;

  // 置信度上限：不让 0.99 这种数字出现，避免"假装很确定"
  return { confidence: Math.min(0.92, confidence), confidenceReasons: reasons };
}

function buildNextAction(input: {
  level: MasteryLevel;
  score: number;
  repeatedErrorTypes: RepeatedError[];
  needsPrerequisiteReview: boolean;
  recentAccuracy: number | null;
}): string {
  const worst = input.repeatedErrorTypes[0];

  if (input.needsPrerequisiteReview) {
    const label = worst ? ERROR_TYPES[worst.type] : '基础知识';
    return `建议先回到前置知识补一补：你在「${label}」上反复出现同类问题，先看一遍相关概念和公式，再做 2 道基础题打底，然后再回来做综合题。`;
  }

  if (input.level === 'learning') {
    if (worst) {
      return `现在处于「正在学习」阶段。重点攻「${ERROR_TYPES[worst.type]}」：先看一遍讲解，然后独立做 2 道同类题，做完对照解析检查是哪一步出的问题。`;
    }
    return '现在处于「正在学习」阶段。建议先看一遍知识讲解，再独立做 2 道基础题，把每一步都写出来。';
  }

  if (input.level === 'initial') {
    return '已经有初步掌握了。再独立做 3 道难度中等偏上的题，注意把步骤写完整，做完自己检查一遍单位或符号。';
  }

  if (input.level === 'basic') {
    return '基本掌握了。做 1-2 道综合题检验一下迁移能力，尤其是把它和其他知识点串起来的题目。';
  }

  return '掌握得比较稳。隔 3-5 天做 1 道复测题维持记忆就好，把时间留给其他薄弱环节。';
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// -----------------------------------------------------------------------------
// 学习报告用的辅助统计（同样是纯函数）
// -----------------------------------------------------------------------------

export type AttemptOutcomeSummary = {
  total: number;
  correct: number;
  accuracy: number | null;
  independentAccuracy: number | null;
  averageDifficulty: number | null;
  errorDistribution: { type: ErrorType; count: number }[];
};

export function summarizeAttempts(attempts: readonly EvidenceInput[]): AttemptOutcomeSummary {
  if (attempts.length === 0) {
    return {
      total: 0,
      correct: 0,
      accuracy: null,
      independentAccuracy: null,
      averageDifficulty: null,
      errorDistribution: [],
    };
  }

  const correct = attempts.filter((a) => a.isCorrect).length;
  const independent = attempts.filter((a) => a.independence === 'independent');
  const independentCorrect = independent.filter((a) => a.isCorrect).length;

  const errorCounts = new Map<ErrorType, number>();
  for (const attempt of attempts) {
    for (const type of attempt.errorTypes) {
      errorCounts.set(type, (errorCounts.get(type) ?? 0) + 1);
    }
  }

  return {
    total: attempts.length,
    correct,
    accuracy: round3(correct / attempts.length),
    independentAccuracy: independent.length > 0 ? round3(independentCorrect / independent.length) : null,
    averageDifficulty: round2(
      attempts.reduce((sum, a) => sum + a.difficulty, 0) / attempts.length,
    ),
    errorDistribution: [...errorCounts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
  };
}
