import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  initialState,
  initialIntervalFromAttempts,
  isOverdueForGentleReminder,
  reviewPriority,
  scheduleNextReview,
  startOfDay,
  type ReviewState,
} from '@/lib/review/scheduler';

/**
 * 间隔复习调度算法测试。
 *
 * 业务要点：
 *   - 答对 → 间隔逐步拉长，不要反复打扰学生
 *   - 答错 → 重置回 1 天，但要降低难度因子（更容易被再次安排）
 *   - 间隔必须有上限，否则会出现"永远不再复习"
 *   - 逾期太久的下一次间隔适当缩短，避免积压越来越多
 *   - 这是**记忆调度**，与"知识掌握度"是两个概念，本文件只测调度
 */

const T0 = new Date('2026-10-15T09:00:00.000Z');

function state(partial: Partial<ReviewState> = {}): ReviewState {
  return {
    repetition: partial.repetition ?? 0,
    intervalDays: partial.intervalDays ?? 1,
    easeFactor: partial.easeFactor ?? 2.5,
  };
}

describe('初始状态 initialState', () => {
  it('首次进入复习计划：1 天后复习，难度因子 2.5', () => {
    const init = initialState(T0);

    expect(init.repetition).toBe(0);
    expect(init.intervalDays).toBe(1);
    expect(init.easeFactor).toBe(2.5);
    expect(init.overdueDays).toBe(0);
    expect(init.dueAt.getTime()).toBe(addDays(T0, 1).getTime());
  });
});

describe('答对：间隔递增', () => {
  it('按 1 → 3 → 7 → 16 的顺序推进，之后按难度因子增长', () => {
    let current = state();
    const intervals: number[] = [];

    for (let i = 0; i < 5; i += 1) {
      const next = scheduleNextReview(current, 'correct', T0);
      intervals.push(next.intervalDays);
      current = next;
    }

    expect(intervals.slice(0, 4)).toEqual([1, 3, 7, 16]);
    // 第 5 次：round(16 × 2.8) = 45（难度因子已到上限 2.8）
    expect(intervals[4]).toBe(45);
  });

  it('连续答对会提高难度因子，但上限 2.8', () => {
    let current = state();
    for (let i = 0; i < 6; i += 1) {
      current = scheduleNextReview(current, 'correct', T0);
    }
    expect(current.easeFactor).toBe(2.8);
  });

  it('间隔有硬上限 60 天，不会无限增长（避免"永远不再复习"）', () => {
    const longState = state({ repetition: 10, intervalDays: 60, easeFactor: 2.8 });
    const next = scheduleNextReview(longState, 'correct', T0);

    expect(next.intervalDays).toBe(60);
    expect(next.intervalDays).toBeLessThanOrEqual(60);
  });

  it('下一次到期时间 = 复习时间 + 新间隔', () => {
    const next = scheduleNextReview(state(), 'correct', T0);
    expect(next.dueAt.getTime()).toBe(addDays(T0, next.intervalDays).getTime());
  });

  it('重复调用：间隔单调不减（前四次）', () => {
    let current = state();
    const intervals: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      current = scheduleNextReview(current, 'correct', T0);
      intervals.push(current.intervalDays);
    }
    for (let i = 1; i < intervals.length; i += 1) {
      expect(intervals[i]!).toBeGreaterThanOrEqual(intervals[i - 1]!);
    }
  });
});

describe('答错与部分正确', () => {
  it('答错 → 重置为 1 天，repetition 归零，难度因子下降', () => {
    const advanced = state({ repetition: 4, intervalDays: 16, easeFactor: 2.8 });
    const next = scheduleNextReview(advanced, 'wrong', T0);

    expect(next.repetition).toBe(0);
    expect(next.intervalDays).toBe(1);
    expect(next.easeFactor).toBeCloseTo(2.6, 5);
  });

  it('答错时难度因子有下限 1.3（不会越跌越低）', () => {
    let current = state({ easeFactor: 1.3 });
    for (let i = 0; i < 3; i += 1) {
      current = scheduleNextReview(current, 'wrong', T0);
    }
    expect(current.easeFactor).toBe(1.3);
  });

  it('部分正确 → 小幅推进间隔且不改难度因子，repetition 不变', () => {
    const partial = state({ repetition: 2, intervalDays: 3, easeFactor: 2.5 });
    const next = scheduleNextReview(partial, 'partial', T0);

    expect(next.intervalDays).toBe(4); // round(3 × 1.2) = 4
    expect(next.repetition).toBe(2);
    expect(next.easeFactor).toBe(2.5);
  });

  it('非法/异常间隔输入不会产生小于 1 天的间隔', () => {
    const broken = state({ repetition: 1, intervalDays: 0, easeFactor: 2.5 });
    const next = scheduleNextReview(broken, 'partial', T0);

    expect(next.intervalDays).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(next.dueAt.getTime())).toBe(true);
  });
});

describe('逾期处理', () => {
  it('逾期 ≥3 天时，下一次间隔适当缩短 20%', () => {
    const current = state({ repetition: 3, intervalDays: 7, easeFactor: 2.5 });
    const planned = addDays(T0, -5); // 原计划 5 天前到期
    const next = scheduleNextReview(current, 'correct', T0, planned);

    // 不逾期时会是 16 天 → 逾期后 16 × 0.8 = 12.8 → 13
    expect(next.overdueDays).toBe(5);
    expect(next.intervalDays).toBe(13);
  });

  it('逾期 <3 天不缩短间隔', () => {
    const current = state({ repetition: 3, intervalDays: 7, easeFactor: 2.5 });
    const planned = addDays(T0, -2);
    const next = scheduleNextReview(current, 'correct', T0, planned);

    expect(next.overdueDays).toBe(2);
    expect(next.intervalDays).toBe(16);
  });

  it('提前复习不算逾期', () => {
    const current = state({ repetition: 1, intervalDays: 3, easeFactor: 2.5 });
    const planned = addDays(T0, 3);
    const next = scheduleNextReview(current, 'correct', T0, planned);

    expect(next.overdueDays).toBe(0);
  });

  it('间隔为 1 天时即使逾期也不缩短（不能变成 0 天）', () => {
    const current = state({ repetition: 0, intervalDays: 1, easeFactor: 2.5 });
    const next = scheduleNextReview(current, 'wrong', T0, addDays(T0, -10));

    expect(next.intervalDays).toBe(1);
  });
});

describe('初始间隔推断 initialIntervalFromAttempts', () => {
  it('没有作答记录 → 1 天后复习', () => {
    expect(initialIntervalFromAttempts({ attemptCount: 0, correctCount: 0 })).toBe(1);
  });

  it('≥2 次作答且正确率 ≥80% → 3 天后（学得快的不占用太多时间）', () => {
    expect(initialIntervalFromAttempts({ attemptCount: 2, correctCount: 2 })).toBe(3);
    expect(initialIntervalFromAttempts({ attemptCount: 5, correctCount: 4 })).toBe(3);
  });

  it('正确率 50%~80% → 2 天', () => {
    expect(initialIntervalFromAttempts({ attemptCount: 4, correctCount: 2 })).toBe(2);
  });

  it('正确率低于 50% → 1 天', () => {
    expect(initialIntervalFromAttempts({ attemptCount: 4, correctCount: 1 })).toBe(1);
    expect(initialIntervalFromAttempts({ attemptCount: 1, correctCount: 0 })).toBe(1);
  });

  it('只答对 1 次（样本太少）不给 3 天，保守给 2 天', () => {
    expect(initialIntervalFromAttempts({ attemptCount: 1, correctCount: 1 })).toBe(2);
  });
});

describe('复习优先级 reviewPriority', () => {
  it('逾期越久越优先，且有上限（避免旧题永久霸榜）', () => {
    const fresh = reviewPriority({ overdueDays: 0 });
    const three = reviewPriority({ overdueDays: 3 });
    const ten = reviewPriority({ overdueDays: 10 });
    const hundred = reviewPriority({ overdueDays: 100 });

    expect(three).toBeGreaterThan(fresh);
    expect(ten).toBeGreaterThan(three);
    // 上限：30 分
    expect(hundred).toBe(ten);
  });

  it('越薄弱越优先（masteryRank 越小越弱）', () => {
    const weak = reviewPriority({ overdueDays: 1, masteryRank: 1 });
    const strong = reviewPriority({ overdueDays: 1, masteryRank: 6 });

    expect(weak).toBeGreaterThan(strong);
  });

  it('上次答错的更优先', () => {
    const wrong = reviewPriority({ overdueDays: 1, lastResultWrong: true });
    const right = reviewPriority({ overdueDays: 1, lastResultWrong: false });

    expect(wrong).toBeGreaterThan(right);
  });

  it('缺少可选信息时不报错，仍返回可比较的数值', () => {
    const value = reviewPriority({ overdueDays: 0 });
    expect(Number.isFinite(value)).toBe(true);
  });
});

describe('温和提醒边界 isOverdueForGentleReminder', () => {
  it('逾期 1-7 天提醒，0 天与超过 7 天都不反复催促', () => {
    expect(isOverdueForGentleReminder(0)).toBe(false);
    expect(isOverdueForGentleReminder(1)).toBe(true);
    expect(isOverdueForGentleReminder(7)).toBe(true);
    expect(isOverdueForGentleReminder(8)).toBe(false);
    expect(isOverdueForGentleReminder(-1)).toBe(false);
  });
});

describe('日期工具的时间计算边界', () => {
  it('addDays 跨月、跨年都正确', () => {
    expect(addDays(new Date('2026-10-31T00:00:00.000Z'), 1).toISOString().slice(0, 10)).toBe('2026-11-01');
    expect(addDays(new Date('2026-12-31T00:00:00.000Z'), 1).toISOString().slice(0, 10)).toBe('2027-01-01');
    expect(addDays(new Date('2028-02-28T00:00:00.000Z'), 1).toISOString().slice(0, 10)).toBe('2028-02-29');
  });

  it('startOfDay 归一到 UTC 零点', () => {
    const normalized = startOfDay(new Date('2026-10-15T23:59:59.000Z'));
    expect(normalized.toISOString()).toBe('2026-10-15T00:00:00.000Z');
  });

  it('daysBetween 以自然日为单位，忽略时分秒', () => {
    expect(daysBetween(new Date('2026-10-15T23:00:00.000Z'), new Date('2026-10-16T01:00:00.000Z'))).toBe(1);
    expect(daysBetween(new Date('2026-10-15T01:00:00.000Z'), new Date('2026-10-15T23:00:00.000Z'))).toBe(0);
    expect(daysBetween(new Date('2026-10-01T00:00:00.000Z'), new Date('2026-10-31T00:00:00.000Z'))).toBe(30);
  });

  it('反复调用 addDays 与直接相加结果一致（无累积误差）', () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    let stepwise = start;
    for (let i = 0; i < 365; i += 1) stepwise = addDays(stepwise, 1);

    expect(stepwise.getTime()).toBe(addDays(start, 365).getTime());
  });
});
