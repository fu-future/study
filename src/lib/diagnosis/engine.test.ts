import { describe, expect, it } from 'vitest';
import {
  attemptWeight,
  difficultyFactor,
  estimateMastery,
  recencyWeight,
  summarizeAttempts,
  type EvidenceInput,
} from '@/lib/diagnosis/engine';

/**
 * 知识掌握度诊断算法测试。
 *
 * 这个算法是项目的核心功能，所以测试的重点不是"能跑"，而是**业务规则是否被真正遵守**：
 *   - 证据不足时必须说"还需要更多练习"，而不是给一个假分数
 *   - 看了解析才做对，不能算掌握
 *   - 单次答错不等于薄弱，单次答对不等于掌握
 *   - 反复出现的同类错误要能被识别，并触发"先补前置知识"的建议
 *   - 时间越久的证据权重越低
 */

const BASE = new Date('2026-10-01T00:00:00.000Z');

function daysBefore(days: number, base: Date = BASE): Date {
  return new Date(base.getTime() - days * 86_400_000);
}

let seq = 0;
function ev(partial: Partial<EvidenceInput> = {}): EvidenceInput {
  seq += 1;
  return {
    id: partial.id ?? `a${seq}`,
    isCorrect: partial.isCorrect ?? true,
    independence: partial.independence ?? 'independent',
    difficulty: partial.difficulty ?? 3,
    context: partial.context ?? 'practice',
    createdAt: partial.createdAt ?? BASE,
    errorTypes: partial.errorTypes ?? [],
    ...(partial.selfReportedUnsure === undefined
      ? {}
      : { selfReportedUnsure: partial.selfReportedUnsure }),
  };
}

describe('难度校正 difficultyFactor', () => {
  it('难度 3 为中性系数 1', () => {
    expect(difficultyFactor(true, 3)).toBe(1);
    expect(difficultyFactor(false, 3)).toBe(1);
  });

  it('做对难题给更多证据，上限 1.3', () => {
    expect(difficultyFactor(true, 5)).toBeCloseTo(1.3, 5);
    // 超出范围要按 1..5 夹紧，而不是继续放大
    expect(difficultyFactor(true, 99)).toBeCloseTo(1.3, 5);
  });

  it('做错简单题扣得更重，但系数有下限 0.8（不能变成负数或发散）', () => {
    expect(difficultyFactor(false, 1)).toBeCloseTo(1.25, 5);
    expect(difficultyFactor(true, 1)).toBeCloseTo(0.8, 5);
    expect(difficultyFactor(true, -5)).toBeCloseTo(0.8, 5);
  });
});

describe('记忆衰减权重 recencyWeight', () => {
  it('当天与"未来"时间的权重都是 1（不做外推放大）', () => {
    expect(recencyWeight(0)).toBe(1);
    expect(recencyWeight(-3)).toBe(1);
  });

  it('半衰期边界：14 天 ≈ 0.5，28 天 ≈ 0.25', () => {
    expect(recencyWeight(14)).toBeCloseTo(0.5, 6);
    expect(recencyWeight(28)).toBeCloseTo(0.25, 6);
    expect(recencyWeight(7)).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('权重随时间单调递减', () => {
    const values = [0, 3, 7, 14, 30, 90].map((d) => recencyWeight(d));
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]!).toBeLessThan(values[i - 1]!);
    }
  });
});

describe('单条证据权重 attemptWeight', () => {
  it('独立完成 = 1，看提示 = 0.5，看解析 = 0.2', () => {
    expect(attemptWeight(ev({ independence: 'independent' }), BASE, 14)).toBeCloseTo(1, 6);
    expect(attemptWeight(ev({ independence: 'with-hint' }), BASE, 14)).toBeCloseTo(0.5, 6);
    expect(attemptWeight(ev({ independence: 'with-solution' }), BASE, 14)).toBeCloseTo(0.2, 6);
  });

  it('学生自评"还是不太懂"时，即使答对也打折', () => {
    const confident = attemptWeight(ev(), BASE, 14);
    const unsure = attemptWeight(ev({ selfReportedUnsure: true }), BASE, 14);
    expect(unsure).toBeCloseTo(confident * 0.5, 6);
  });
});

describe('空数据', () => {
  it('没有任何作答记录 → 未评估、无分数、置信度 0，并给出练习建议', () => {
    const result = estimateMastery([]);

    expect(result.level).toBe('unevaluated');
    expect(result.score).toBeNull();
    expect(result.hasScore).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.evidenceCount).toBe(0);
    expect(result.recentAccuracy).toBeNull();
    expect(result.repeatedErrorTypes).toEqual([]);
    expect(result.needsPrerequisiteReview).toBe(false);
    expect(result.nextAction).toContain('2-3 道');
    expect(result.confidenceReasons).toContain('没有作答记录');
  });
});

describe('证据不足', () => {
  it('只有 1 次答错 → 不判定为薄弱，而是"证据不足"', () => {
    const result = estimateMastery([ev({ isCorrect: false, errorTypes: ['concept'] })]);

    expect(result.level).toBe('insufficient');
    expect(result.hasScore).toBe(false);
    expect(result.score).toBeNull();
    // 关键业务规则：不能因为一次答错就下"薄弱"的结论
    expect(result.level).not.toBe('learning');
    expect(result.nextAction).toContain('还需要更多练习');
  });

  it('只有 1 次答对 → 不判定为掌握', () => {
    const result = estimateMastery([ev()]);
    expect(result.level).toBe('insufficient');
    expect(result.hasScore).toBe(false);
  });

  it('边界：3 次独立答对（难度 3）仍未跨过有效证据门槛 3.5', () => {
    const result = estimateMastery([ev(), ev(), ev()]);

    expect(result.evidenceCount).toBe(3);
    expect(result.effectiveEvidence).toBeCloseTo(3, 5);
    expect(result.hasScore).toBe(false);
    expect(result.level).toBe('insufficient');
  });

  it('边界：3 次高难度独立答对（难度 5 × 1.3 = 3.9）跨过门槛，可以给出结论', () => {
    const result = estimateMastery([
      ev({ difficulty: 5 }),
      ev({ difficulty: 5 }),
      ev({ difficulty: 5 }),
    ]);

    expect(result.effectiveEvidence).toBeCloseTo(3.9, 5);
    expect(result.hasScore).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(85);
  });

  it('看解析才做对的 4 次，有效证据量只有 0.8，不能算掌握', () => {
    const result = estimateMastery([
      ev({ independence: 'with-solution' }),
      ev({ independence: 'with-solution' }),
      ev({ independence: 'with-solution' }),
      ev({ independence: 'with-solution' }),
    ]);

    expect(result.effectiveEvidence).toBeCloseTo(0.8, 5);
    expect(result.hasScore).toBe(false);
    expect(result.level).toBe('insufficient');
    // 这条规则的业务含义：答案看懂了 ≠ 会做
    expect(result.confidenceReasons.join(' ')).toContain('看解析/提示后完成的部分会被打折计算');
  });
});

describe('正常情况：形成结论的路径', () => {
  const fiveCorrect = [ev(), ev(), ev(), ev(), ev()];

  it('5 次近期独立答对 → 给出分数，但因缺少隔期复测暂不判为"稳定掌握"', () => {
    const result = estimateMastery(fiveCorrect);

    expect(result.hasScore).toBe(true);
    expect(result.score).toBe(100);
    expect(result.level).toBe('basic');
    expect(result.recentAccuracy).toBe(1);
    expect(result.recentSampleSize).toBe(5);
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.confidence).toBeLessThanOrEqual(0.92);
    expect(result.confidenceReasons.join(' ')).toContain('尚无隔期复测记录');
  });

  it('加上一次隔期复测独立答对 → 升为"稳定掌握"', () => {
    const withRetest = [...fiveCorrect, ev({ context: 'retest', createdAt: daysBefore(0) })];

    const baseline = estimateMastery(fiveCorrect);
    const result = estimateMastery(withRetest);

    expect(result.level).toBe('stable');
    expect(result.confidence).toBeGreaterThan(baseline.confidence);
  });

  it('置信度配有可解释的依据（证据量 / 时效 / 复测三段）', () => {
    const result = estimateMastery(fiveCorrect);
    const reasons = result.confidenceReasons.join('\n');

    expect(reasons).toContain('有效证据量');
    expect(reasons).toContain('近 14 天内作答');
    expect(reasons).toContain('复测分量');
  });

  it('全部答错 → 正在学习，分数偏低', () => {
    const result = estimateMastery([
      ev({ isCorrect: false }),
      ev({ isCorrect: false }),
      ev({ isCorrect: false }),
      ev({ isCorrect: false }),
    ]);

    expect(result.level).toBe('learning');
    expect(result.score).toBeLessThan(55);
    expect(result.recentAccuracy).toBe(0);
  });
});

describe('重复错误', () => {
  const repeatedConcept = [
    ev({ isCorrect: false, errorTypes: ['concept'] }),
    ev({ isCorrect: false, errorTypes: ['concept'] }),
    ev({ isCorrect: false, errorTypes: ['concept'] }),
    ev({ isCorrect: false, errorTypes: ['concept'] }),
  ];

  it('识别出反复出现的同类错误，并给出次数', () => {
    const result = estimateMastery(repeatedConcept);

    expect(result.repeatedErrorTypes).toHaveLength(1);
    expect(result.repeatedErrorTypes[0]).toEqual({ type: 'concept', count: 4 });
  });

  it('出现 ≥2 次的错误才被计入"重复错误"，单次不计', () => {
    const result = estimateMastery([
      ev({ isCorrect: false, errorTypes: ['reading'] }),
      ev({ isCorrect: false, errorTypes: ['calculation'] }),
      ev({ isCorrect: false, errorTypes: ['calculation'] }),
    ]);

    const types = result.repeatedErrorTypes.map((item) => item.type);
    expect(types).toContain('calculation');
    expect(types).not.toContain('reading');
  });

  it('概念性错误反复出现 → 建议先补前置知识', () => {
    const result = estimateMastery(repeatedConcept);

    expect(result.needsPrerequisiteReview).toBe(true);
    expect(result.nextAction).toContain('前置知识');
    expect(result.nextAction).toContain('概念理解错误');
  });

  it('重复的概念性错误会阻止判为"稳定掌握"（即使正确率很高）', () => {
    // 6 次答对 + 2 次概念性错误：正确率很高，但存在方法性问题
    const result = estimateMastery([
      ev(), ev(), ev(), ev(), ev(), ev(),
      ev({ isCorrect: false, errorTypes: ['concept'] }),
      ev({ isCorrect: false, errorTypes: ['concept'] }),
    ]);

    expect(result.repeatedErrorTypes[0]?.type).toBe('concept');
    expect(result.level).not.toBe('stable');
  });

  it('重复错误会拉低总分（同类惩罚有上限，不会把分数打到负数）', () => {
    const clean = estimateMastery([ev(), ev(), ev(), ev()]);
    const dirty = estimateMastery([
      ev(),
      ev(),
      ev(),
      ev({ isCorrect: false, errorTypes: ['calculation'] }),
      ev({ isCorrect: false, errorTypes: ['calculation'] }),
    ]);

    expect(dirty.score!).toBeLessThan(clean.score!);
    expect(dirty.score!).toBeGreaterThanOrEqual(0);
  });
});

describe('历史表现 vs 近期表现', () => {
  it('很久以前的错误对当前判断影响很小', () => {
    const now = BASE;
    const oldMistake = ev({ isCorrect: false, createdAt: daysBefore(30, now) });
    const recentCorrect = [ev({ createdAt: now }), ev({ createdAt: now }), ev({ createdAt: now }), ev({ createdAt: now })];

    const withOldMistake = estimateMastery([oldMistake, ...recentCorrect], { now });
    const withoutOldMistake = estimateMastery(recentCorrect, { now });

    expect(withOldMistake.score!).toBeLessThan(withoutOldMistake.score!);
    // 30 天前的证据权重只剩 0.5^(30/14) ≈ 0.23，不应把分数拉低太多
    expect(withoutOldMistake.score! - withOldMistake.score!).toBeLessThan(10);
  });

  it('近期一直错，即使历史上做对很多次，也不能判为"基本掌握"以上', () => {
    const now = BASE;
    const history = [
      ev({ createdAt: daysBefore(40, now) }),
      ev({ createdAt: daysBefore(38, now) }),
      ev({ createdAt: daysBefore(36, now) }),
      ev({ createdAt: daysBefore(34, now) }),
    ];
    const recentFailures = [
      ev({ isCorrect: false, createdAt: daysBefore(2, now) }),
      ev({ isCorrect: false, createdAt: daysBefore(1, now) }),
      ev({ isCorrect: false, createdAt: now }),
    ];

    const result = estimateMastery([...history, ...recentFailures], { now });

    expect(result.recentAccuracy).toBe(0);
    expect(result.level).not.toBe('basic');
    expect(result.level).not.toBe('stable');
  });

  it('证据时间顺序不影响结论（乱序输入结果一致）', () => {
    const attempts = [
      ev({ createdAt: daysBefore(6) }),
      ev({ isCorrect: false, createdAt: daysBefore(4), errorTypes: ['calculation'] }),
      ev({ createdAt: daysBefore(2) }),
      ev({ createdAt: daysBefore(1) }),
      ev({ createdAt: daysBefore(0) }),
    ];

    const ordered = estimateMastery(attempts);
    const shuffled = estimateMastery([
      attempts[3]!, attempts[0]!, attempts[4]!, attempts[2]!, attempts[1]!,
    ]);

    expect(shuffled.score).toBe(ordered.score);
    expect(shuffled.level).toBe(ordered.level);
    expect(shuffled.effectiveEvidence).toBe(ordered.effectiveEvidence);
  });
});

describe('时间计算边界', () => {
  it('14 天窗口的边界：正好 14 天前算作"近期"', () => {
    const now = BASE;
    const result = estimateMastery(
      [
        ev({ createdAt: now }),
        ev({ createdAt: now }),
        ev({ createdAt: now }),
        ev({ createdAt: new Date(now.getTime() - 14 * 86_400_000) }),
      ],
      { now },
    );

    expect(result.recentSampleSize).toBe(4);
  });

  it('超过 14 天的作答不计入近期样本，但仍参与整体评估', () => {
    const now = BASE;
    const result = estimateMastery(
      [
        ev({ createdAt: now }),
        ev({ createdAt: now }),
        ev({ createdAt: now }),
        ev({ createdAt: new Date(now.getTime() - 15 * 86_400_000) }),
      ],
      { now },
    );

    expect(result.recentSampleSize).toBe(3);
    expect(result.evidenceCount).toBe(4);
  });

  it('可自定义窗口与半衰期参数', () => {
    const now = BASE;
    const attempts = [ev({ createdAt: now }), ev({ createdAt: daysBefore(10, now) }), ev({ createdAt: daysBefore(20, now) })];

    const narrow = estimateMastery(attempts, { now, recentWindowDays: 5 });
    const wide = estimateMastery(attempts, { now, recentWindowDays: 30 });

    expect(narrow.recentSampleSize).toBe(1);
    expect(wide.recentSampleSize).toBe(3);
  });

  it('重复调用同一份证据结果完全一致（无隐藏状态）', () => {
    const attempts = [ev(), ev({ isCorrect: false, errorTypes: ['concept'] }), ev(), ev({ difficulty: 5 })];

    const first = estimateMastery(attempts);
    const second = estimateMastery(attempts);
    const third = estimateMastery(attempts);

    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });
});

describe('证据可追溯性', () => {
  it('返回支持结论的证据 id 列表，与输入一一对应', () => {
    const attempts = [
      ev({ id: 'x1' }),
      ev({ id: 'x2' }),
      ev({ id: 'x3' }),
      ev({ id: 'x4' }),
    ];

    const result = estimateMastery(attempts);

    expect(result.evidenceIds).toEqual(['x1', 'x2', 'x3', 'x4']);
    expect(result.evidenceCount).toBe(4);
  });
});

describe('非法输入与健壮性', () => {
  it('难度值超范围会被夹紧，不会产生异常权重', () => {
    const result = estimateMastery([ev({ difficulty: 0 }), ev({ difficulty: 99 }), ev({ difficulty: -3 })]);
    expect(Number.isFinite(result.effectiveEvidence)).toBe(true);
    expect(result.effectiveEvidence).toBeGreaterThan(0);
  });

  it('未来的作答时间不会被当作"高可信证据"放大（权重上限为 1）', () => {
    const future = new Date(BASE.getTime() + 5 * 86_400_000);
    const result = estimateMastery([ev({ createdAt: future }), ev({ createdAt: future }), ev({ createdAt: future })], { now: BASE });
    expect(result.effectiveEvidence).toBeLessThanOrEqual(3.0001);
  });

  it('分数永远落在 0..100 之间', () => {
    const cases: EvidenceInput[][] = [
      [ev({ difficulty: 5 }), ev({ difficulty: 5 }), ev({ difficulty: 5 }), ev({ difficulty: 5 })],
      [ev({ isCorrect: false }), ev({ isCorrect: false }), ev({ isCorrect: false }), ev({ isCorrect: false }), ev({ isCorrect: false })],
    ];

    for (const attempts of cases) {
      const result = estimateMastery(attempts);
      if (result.score !== null) {
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
      }
    }
  });

  it('相同输入数组不会被就地修改（纯函数）', () => {
    const attempts = [ev({ id: 'keep1' }), ev({ id: 'keep2' }), ev({ id: 'keep3' }), ev({ id: 'keep4' })];
    const snapshot = attempts.map((a) => a.id);

    estimateMastery(attempts);

    expect(attempts.map((a) => a.id)).toEqual(snapshot);
  });
});

describe('作答摘要 summarizeAttempts', () => {
  it('空数据返回 null 而不是 0（避免展示成"0% 正确率"）', () => {
    const summary = summarizeAttempts([]);

    expect(summary.total).toBe(0);
    expect(summary.accuracy).toBeNull();
    expect(summary.independentAccuracy).toBeNull();
    expect(summary.averageDifficulty).toBeNull();
    expect(summary.errorDistribution).toEqual([]);
  });

  it('统计正确率、独立完成正确率与错误分布', () => {
    const summary = summarizeAttempts([
      ev({ isCorrect: true }),
      ev({ isCorrect: false, independence: 'with-solution', errorTypes: ['calculation'] }),
      ev({ isCorrect: true, independence: 'with-hint' }),
      ev({ isCorrect: false, errorTypes: ['calculation', 'reading'] }),
    ]);

    expect(summary.total).toBe(4);
    expect(summary.correct).toBe(2);
    expect(summary.accuracy).toBe(0.5);
    // 独立完成的只有第 1、4 条，其中 1 条对 → 0.5
    expect(summary.independentAccuracy).toBe(0.5);
    expect(summary.errorDistribution[0]).toEqual({ type: 'calculation', count: 2 });
  });
});
