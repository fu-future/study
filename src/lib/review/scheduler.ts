import type { ReviewResult } from '@/lib/domain/enums';

/**
 * 间隔复习调度（纯函数，可测试）。
 *
 * 采用简化版 SM-2：
 *   - 首次答对后间隔序列 1 → 3 → 7 → 16 → 38 …（之后按难度因子递增）
 *   - 答错则重置为 1 天，并降低难度因子（最低 1.3）
 *   - 部分正确只小幅推进，不重置
 *
 * 为什么不直接用完整 SM-2：高中生的复习窗口以「天」为单位，
 * 完整 SM-2 的 0-5 评分粒度在这个场景下没有意义，反而让界面变复杂。
 * 这里保留其核心思想（难度因子 + 间隔递增 + 失败重置），并保证：
 *   - 间隔有上限（60 天），避免"永远不再复习"
 *   - 逾期复习会被识别出来（overdueDays），用于计划优先级
 *
 * ⚠️ 注意：这是**记忆调度**，与「知识掌握度」是两个概念。
 *    答对一次复习题不代表掌握度提升 —— 掌握度仍由 diagnosis/engine.ts 决定。
 */

export type ReviewState = {
  repetition: number;
  intervalDays: number;
  easeFactor: number;
};

export type ScheduledReview = ReviewState & {
  dueAt: Date;
  /** 该次复习时，距离上次计划到期晚了多少天（0 表示准时或提前） */
  overdueDays: number;
};

/** 首次进入复习计划时的初始状态 */
export function initialState(now = new Date()): ScheduledReview {
  return {
    repetition: 0,
    intervalDays: 1,
    easeFactor: 2.5,
    dueAt: addDays(now, 1),
    overdueDays: 0,
  };
}

const MIN_EASE = 1.3;
const MAX_EASE = 2.8;
const MAX_INTERVAL_DAYS = 60;

/** 首次连续答对的间隔序列（天）。超出序列后用 当前间隔 × easeFactor。 */
const FIRST_INTERVALS = [1, 3, 7, 16];

/**
 * 根据本次复习结果计算下一次复习时间。
 *
 * @param current   当前状态
 * @param result    本次结果：correct | partial | wrong
 * @param reviewedAt 本次复习时间（默认现在）
 */
export function scheduleNextReview(
  current: ReviewState,
  result: ReviewResult,
  reviewedAt: Date = new Date(),
  plannedDueAt?: Date | null,
): ScheduledReview {
  const overdueDays =
    plannedDueAt && reviewedAt.getTime() > plannedDueAt.getTime()
      ? Math.floor((reviewedAt.getTime() - plannedDueAt.getTime()) / 86_400_000)
      : 0;

  let { repetition, intervalDays, easeFactor } = current;

  switch (result) {
    case 'wrong': {
      // 答错：重置进度，并让这个知识点更容易被再次安排（降低 ease）
      repetition = 0;
      intervalDays = 1;
      easeFactor = clamp(current.easeFactor - 0.2, MIN_EASE, MAX_EASE);
      break;
    }

    case 'partial': {
      // 部分正确：小幅推进，不重置也不加难度
      intervalDays = clamp(Math.round(Math.max(1, current.intervalDays) * 1.2), 1, MAX_INTERVAL_DAYS);
      repetition = current.repetition;
      break;
    }

    case 'correct':
    default: {
      repetition = current.repetition + 1;
      if (repetition <= FIRST_INTERVALS.length) {
        intervalDays = FIRST_INTERVALS[repetition - 1] ?? 1;
      } else {
        intervalDays = clamp(Math.round(current.intervalDays * current.easeFactor), 1, MAX_INTERVAL_DAYS);
      }
      // 连续答对提高难度因子（最多 +0.1），让间隔增长更快
      easeFactor = clamp(current.easeFactor + 0.1, MIN_EASE, MAX_EASE);
      break;
    }
  }

  // 逾期的复习，下一次间隔稍微缩短，避免"积压越来越多"
  if (overdueDays >= 3 && intervalDays > 1) {
    intervalDays = Math.max(1, Math.round(intervalDays * 0.8));
  }

  return {
    repetition,
    intervalDays,
    easeFactor: round2(easeFactor),
    dueAt: addDays(reviewedAt, intervalDays),
    overdueDays,
  };
}

/**
 * 从错题状态推断初始复习间隔。
 * 学得快的学生不会被简单题反复占用时间 —— 依据是「首次录入后的作答表现」。
 */
export function initialIntervalFromAttempts(input: {
  attemptCount: number;
  correctCount: number;
}): number {
  if (input.attemptCount === 0) return 1;
  const accuracy = input.correctCount / input.attemptCount;
  if (accuracy >= 0.8 && input.attemptCount >= 2) return 3;
  if (accuracy >= 0.5) return 2;
  return 1;
}

/**
 * 复习优先级评分（越大越该先做）。
 * 用于「今天该复习什么」的排序 —— 规则透明，不含 AI。
 */
export function reviewPriority(input: {
  overdueDays: number;
  /** 该知识点当前掌握等级（弱 → 强为 1..6，未评估为 0） */
  masteryRank?: number;
  /** 上次是否答错 */
  lastResultWrong?: boolean;
}): number {
  let score = 0;

  // 逾期越久越优先，但设上限，避免长期不用的旧题一直霸占列表
  score += Math.min(30, input.overdueDays * 6);

  // 越薄弱越优先
  if (input.masteryRank !== undefined && input.masteryRank > 0) {
    score += (7 - input.masteryRank) * 5;
  }

  // 上次答错的更优先
  if (input.lastResultWrong) score += 12;

  return score;
}

/** 判断是否属于「需要提醒但不要施压」的逾期范围（超过 7 天就不再反复催促） */
export function isOverdueForGentleReminder(overdueDays: number): boolean {
  return overdueDays >= 1 && overdueDays <= 7;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** 以「天」为单位把日期归一到 UTC 零点，用于按日分组任务。 */
export function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function daysBetween(a: Date, b: Date): number {
  return Math.floor((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000);
}
