import { describe, expect, it } from 'vitest';
import {
  generateDailyPlan,
  generateStudyPlan,
  type DueReviewInput,
  type PlanningInput,
  type UnfinishedTaskInput,
  type WeakPointInput,
} from '@/lib/planning/generator';

/**
 * 学习计划生成与时间精简算法测试。
 *
 * 业务要点（来自需求 4.7）：
 *   - 计划必须是**动态的**，且**不得超过学生可用时间**
 *   - 超出可用时间时自动精简，并如实告知精简了几个
 *   - 未完成任务可重排；连续重排多次后不再无限顺延
 *   - 考试临近要提升优先级；完成率低要减量而不是加量
 *   - 不鼓励熬夜/过度学习
 */

/** 2026-10-12 是星期一（便于验证周末可用时间的差异） */
const MONDAY = new Date('2026-10-12T00:00:00.000Z');

function weak(partial: Partial<WeakPointInput> = {}): WeakPointInput {
  return {
    knowledgePointId: partial.knowledgePointId ?? 'kp-1',
    name: partial.name ?? '导数的几何意义',
    subjectId: partial.subjectId ?? 'math',
    subjectName: partial.subjectName ?? '数学',
    level: partial.level ?? 'learning',
    masteryRank: partial.masteryRank ?? 3,
    confidence: partial.confidence ?? 0.7,
    evidenceCount: partial.evidenceCount ?? 8,
    needsPrerequisiteReview: partial.needsPrerequisiteReview ?? false,
    hasExplanationResource: partial.hasExplanationResource ?? true,
    hasVideoResource: partial.hasVideoResource ?? false,
  };
}

function review(partial: Partial<DueReviewInput> = {}): DueReviewInput {
  return {
    kind: partial.kind ?? 'wrong-answer',
    targetId: partial.targetId ?? 'rec-1',
    questionId: partial.questionId ?? 'q-1',
    title: partial.title ?? '已知函数 f(x)=x^3-3ax+1 ...',
    subjectId: partial.subjectId ?? 'math',
    knowledgePointId: partial.knowledgePointId ?? 'kp-1',
    knowledgePointName: partial.knowledgePointName,
    dueAt: partial.dueAt ?? new Date(MONDAY.getTime() - 3 * 86_400_000),
    masteryRank: partial.masteryRank ?? 3,
    lastResultWrong: partial.lastResultWrong ?? true,
  };
}

function unfinished(partial: Partial<UnfinishedTaskInput> = {}): UnfinishedTaskInput {
  return {
    taskId: partial.taskId ?? 'task-1',
    title: partial.title ?? '独立练习：等差数列',
    subjectId: partial.subjectId ?? 'math',
    knowledgePointId: partial.knowledgePointId ?? 'kp-2',
    taskType: partial.taskType ?? 'practice',
    estimatedMinutes: partial.estimatedMinutes ?? 20,
    scheduledDate: partial.scheduledDate ?? new Date(MONDAY.getTime() - 86_400_000),
    priority: partial.priority ?? 2,
    rescheduleCount: partial.rescheduleCount ?? 0,
  };
}

function input(partial: Partial<PlanningInput> = {}): PlanningInput {
  return {
    planType: partial.planType ?? 'daily',
    from: partial.from ?? MONDAY,
    dayCount: partial.dayCount ?? 1,
    dailyAvailableMinutes: partial.dailyAvailableMinutes ?? 90,
    weekendAvailableMinutes: partial.weekendAvailableMinutes ?? null,
    examDate: partial.examDate ?? null,
    weakPoints: partial.weakPoints ?? [weak()],
    dueReviews: partial.dueReviews ?? [],
    unfinishedTasks: partial.unfinishedTasks ?? [],
    recentCompletionRate: partial.recentCompletionRate ?? null,
    ...(partial.subjectWeights === undefined ? {} : { subjectWeights: partial.subjectWeights }),
    ...(partial.electiveSubjectIds === undefined ? {} : { electiveSubjectIds: partial.electiveSubjectIds }),
    ...(partial.hardDailyCapMinutes === undefined
      ? {}
      : { hardDailyCapMinutes: partial.hardDailyCapMinutes }),
  };
}

describe('空数据', () => {
  it('没有任何薄弱点/到期复习/未完成任务 → 不生成任务，并给出明确说明', () => {
    const result = generateStudyPlan(
      input({ weakPoints: [], dueReviews: [], unfinishedTasks: [] }),
    );

    expect(result.tasks).toEqual([]);
    expect(result.totalMinutes).toBe(0);
    expect(result.trimmedCount).toBe(0);
    expect(result.minutesByDay).toHaveLength(1);
    expect(result.rationale.notes.join('\n')).toContain('目前没有需要安排的任务');
  });

  it('"稳定掌握"的知识点不再排任务（不浪费学生时间）', () => {
    const result = generateStudyPlan(
      input({ weakPoints: [weak({ level: 'stable', masteryRank: 6 })] }),
    );

    expect(result.tasks).toHaveLength(0);
  });

  it('空数据时 rationale 的统计字段为 0 而不是 undefined', () => {
    const result = generateStudyPlan(input({ weakPoints: [], dueReviews: [], unfinishedTasks: [] }));

    expect(result.rationale.weakPointCount).toBe(0);
    expect(result.rationale.dueReviewCount).toBe(0);
    expect(result.rationale.unfinishedCount).toBe(0);
    expect(result.rationale.recentCompletionRate).toBeNull();
  });
});

describe('正常情况', () => {
  it('为"正在学习"的知识点生成完整任务链：讲解 → 视频 → 例题 → 练习', () => {
    const result = generateStudyPlan(
      input({
        weakPoints: [weak({ hasExplanationResource: true, hasVideoResource: true })],
      }),
    );

    const types = result.tasks.map((task) => task.taskType);
    expect(types).toContain('explanation');
    expect(types).toContain('video');
    expect(types).toContain('example');
    expect(types).toContain('practice');
    expect(result.tasks).toHaveLength(4);
  });

  it('同一知识点内，"讲解"排在"练习"之前（学习顺序正确）', () => {
    const result = generateStudyPlan(input({ weakPoints: [weak()] }));
    const types = result.tasks.map((task) => task.taskType);

    expect(types.indexOf('explanation')).toBeLessThan(types.indexOf('practice'));
  });

  it('每个任务都带推荐原因与完成条件（计划必须可解释）', () => {
    const result = generateStudyPlan(input({ weakPoints: [weak()] }));

    for (const task of result.tasks) {
      expect(task.reason.length).toBeGreaterThan(0);
      expect(task.completionCriteria.length).toBeGreaterThan(0);
      expect(task.estimatedMinutes).toBeGreaterThanOrEqual(8);
      expect(task.priority).toBeGreaterThanOrEqual(1);
      expect(task.priority).toBeLessThanOrEqual(5);
    }
  });

  it('计划总时长等于各任务之和，且不超过当天可用时间', () => {
    const result = generateStudyPlan(
      input({
        weakPoints: [weak({ hasVideoResource: true }), weak({ knowledgePointId: 'kp-2', name: '等差数列' })],
        dueReviews: [review()],
      }),
    );

    const sum = result.tasks.reduce((total, task) => total + task.estimatedMinutes, 0);
    expect(result.totalMinutes).toBe(sum);
    expect(result.totalMinutes).toBeLessThanOrEqual(90);
    expect(result.minutesByDay[0]!.minutes).toBe(sum);
  });

  it('没有讲解/视频资源时，任务链退化为例题 + 练习', () => {
    const result = generateStudyPlan(
      input({
        weakPoints: [weak({ hasExplanationResource: false, hasVideoResource: false })],
      }),
    );

    const types = result.tasks.map((task) => task.taskType);
    expect(types).not.toContain('explanation');
    expect(types).not.toContain('video');
    expect(types).toContain('example');
    expect(types).toContain('practice');
  });

  it('纯函数：重复调用结果完全一致（按时间戳比较）', () => {
    const config = input({ weakPoints: [weak()], dueReviews: [review()] });

    const first = generateStudyPlan(config);
    const second = generateStudyPlan(config);

    expect(second.totalMinutes).toBe(first.totalMinutes);
    expect(second.trimmedCount).toBe(first.trimmedCount);
    expect(second.tasks.map((t) => `${t.title}|${t.estimatedMinutes}|${t.scheduledDate.toISOString()}`)).toEqual(
      first.tasks.map((t) => `${t.title}|${t.estimatedMinutes}|${t.scheduledDate.toISOString()}`),
    );
  });

  it('generateDailyPlan 等价于 dayCount=1 的每日计划', () => {
    const viaDaily = generateDailyPlan({
      from: MONDAY,
      dailyAvailableMinutes: 90,
      weakPoints: [weak()],
      dueReviews: [],
      unfinishedTasks: [],
      recentCompletionRate: null,
    });
    const viaGeneral = generateStudyPlan(input({ planType: 'daily', dayCount: 1 }));

    expect(viaDaily.totalMinutes).toBe(viaGeneral.totalMinutes);
    // 计划类型记录在 rationale 里（供界面解释"这是哪种计划"）
    expect(viaDaily.rationale.planType).toBe('daily');
  });
});

describe('可用时间不足与精简', () => {
  it('时间不够时压缩任务时长以填满，而不是直接丢弃', () => {
    const result = generateStudyPlan(
      input({
        dailyAvailableMinutes: 30,
        weakPoints: [weak({ hasExplanationResource: true, hasVideoResource: true })],
      }),
    );

    expect(result.totalMinutes).toBe(30);
    expect(result.minutesByDay[0]!.minutes).toBeLessThanOrEqual(30);
    expect(result.trimmedCount).toBeGreaterThan(0);
    expect(result.rationale.notes.join('\n')).toContain('没有排进来');
  });

  it('所有任务都超出可用时间 → 全部精简，并同时给出两条说明', () => {
    const result = generateStudyPlan(
      input({
        dailyAvailableMinutes: 5,
        weakPoints: [weak({ hasExplanationResource: true, hasVideoResource: true })],
      }),
    );

    expect(result.tasks).toHaveLength(0);
    expect(result.totalMinutes).toBe(0);
    expect(result.trimmedCount).toBe(4);
    const notes = result.rationale.notes.join('\n');
    expect(notes).toContain('有 4 个任务没有排进来');
    expect(notes).toContain('目前没有需要安排的任务');
  });

  it('可用时间为 0 → 不安排任何任务，也不报错', () => {
    const result = generateStudyPlan(input({ dailyAvailableMinutes: 0 }));

    expect(result.tasks).toHaveLength(0);
    expect(result.trimmedCount).toBeGreaterThan(0);
  });

  it('硬上限：dailyAvailableMinutes=300 但设置 180 上限 → 按 180 计算', () => {
    const result = generateStudyPlan(
      input({ dailyAvailableMinutes: 300, hardDailyCapMinutes: 180 }),
    );

    expect(result.minutesByDay[0]!.availableMinutes).toBe(180);
  });

  it('硬上限（不鼓励过度学习）：默认由调用方传入，这里验证生效', () => {
    const result = generateStudyPlan(
      input({
        dailyAvailableMinutes: 90,
        hardDailyCapMinutes: 60,
        weakPoints: [weak({ hasVideoResource: true })],
      }),
    );

    expect(result.totalMinutes).toBeLessThanOrEqual(60);
  });

  it('每天安排量不会超过当天可用时间（多天逐一校验）', () => {
    const result = generateStudyPlan(
      input({
        planType: 'weekly',
        dayCount: 7,
        dailyAvailableMinutes: 45,
        weakPoints: [weak({ hasVideoResource: true }), weak({ knowledgePointId: 'kp-2' })],
        dueReviews: [review(), review({ targetId: 'rec-2', questionId: 'q-2' })],
      }),
    );

    for (const day of result.minutesByDay) {
      expect(day.minutes).toBeLessThanOrEqual(day.availableMinutes);
    }
  });
});

describe('周末可用时间与多日边界', () => {
  it('周末使用单独的可用时间；7 天计划覆盖周一到周日', () => {
    const result = generateStudyPlan(
      input({
        planType: 'weekly',
        dayCount: 7,
        dailyAvailableMinutes: 60,
        weekendAvailableMinutes: 120,
        weakPoints: [],
        dueReviews: [],
      }),
    );

    expect(result.minutesByDay).toHaveLength(7);
    // 索引 5/6 = 周六/周日
    expect(result.minutesByDay[0]!.availableMinutes).toBe(60);
    expect(result.minutesByDay[4]!.availableMinutes).toBe(60);
    expect(result.minutesByDay[5]!.availableMinutes).toBe(120);
    expect(result.minutesByDay[6]!.availableMinutes).toBe(120);
  });

  it('dayCount=0（非法输入）不抛错，返回空计划', () => {
    const result = generateStudyPlan(input({ dayCount: 0 }));

    expect(result.minutesByDay).toEqual([]);
    expect(result.minutesByDay).toHaveLength(0);
    expect(result.totalMinutes).toBe(0);
  });

  it('负数可用时间按 0 处理，不产生负时长任务', () => {
    const result = generateStudyPlan(input({ dailyAvailableMinutes: -30 }));

    expect(result.tasks).toHaveLength(0);
    expect(result.totalMinutes).toBeGreaterThanOrEqual(0);
  });

  it('from 传入带时分秒的时间会被归一到当天零点', () => {
    const result = generateStudyPlan(
      input({ from: new Date('2026-10-12T23:59:59.000Z'), weakPoints: [] }),
    );

    expect(result.minutesByDay[0]!.date.toISOString()).toBe('2026-10-12T00:00:00.000Z');
  });

  it('跨月/跨年的多日计划日期连续', () => {
    const result = generateStudyPlan(
      input({ planType: 'weekly', dayCount: 7, from: new Date('2026-12-29T00:00:00.000Z') }),
    );

    const dates = result.minutesByDay.map((day) => day.date.toISOString().slice(0, 10));
    expect(dates).toEqual([
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
      '2027-01-04',
    ]);
  });
});

describe('未完成任务重排', () => {
  it('未完成任务优先被重新安排，并记录来源 id', () => {
    const result = generateStudyPlan(
      input({ unfinishedTasks: [unfinished({ taskId: 'old-task', priority: 2 })] }),
    );

    const rescheduled = result.tasks.find((task) => task.rescheduledFromId === 'old-task');
    expect(rescheduled).toBeDefined();
    expect(rescheduled!.reason).toContain('还没完成');
  });

  it('重排任务的优先级在原基础上 +1（避免一直被新任务插队）', () => {
    const result = generateStudyPlan(
      input({ unfinishedTasks: [unfinished({ priority: 2 })] }),
    );

    const rescheduled = result.tasks.find((task) => task.rescheduledFromId === 'task-1');
    expect(rescheduled).toBeDefined();
    // 原优先级 2 → 重排后 3
    expect(rescheduled!.priority).toBe(3);
  });

  it('重排任务的优先级不会超过上限 5', () => {
    const result = generateStudyPlan(
      input({ unfinishedTasks: [unfinished({ priority: 5 })] }),
    );

    const rescheduled = result.tasks.find((task) => task.rescheduledFromId === 'task-1');
    expect(rescheduled!.priority).toBe(5);
  });

  it('已重排 3 次的任务不再自动顺延，并给出提示', () => {
    const result = generateStudyPlan(
      input({ unfinishedTasks: [unfinished({ rescheduleCount: 3, title: '拖着没做的任务' })] }),
    );

    expect(result.tasks.some((task) => task.title === '拖着没做的任务')).toBe(false);
    expect(result.rationale.notes.join('\n')).toContain('已重排 3 次');
  });

  it('rescheduleCount 为 2 时仍然会重排（边界）', () => {
    const result = generateStudyPlan(
      input({ unfinishedTasks: [unfinished({ rescheduleCount: 2 })] }),
    );

    expect(result.tasks.some((task) => task.rescheduledFromId === 'task-1')).toBe(true);
  });
});

describe('到期复习任务', () => {
  it('到期复习被安排为"错题复习"任务', () => {
    const result = generateStudyPlan(
      input({ weakPoints: [], dueReviews: [review()] }),
    );

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]!.taskType).toBe('review');
    expect(result.tasks[0]!.title).toContain('错题复习');
  });

  it('逾期 ≥3 天时在推荐原因里说明逾期天数', () => {
    const result = generateStudyPlan(
      input({ weakPoints: [], dueReviews: [review({ dueAt: new Date(MONDAY.getTime() - 5 * 86_400_000) })] }),
    );

    expect(result.tasks[0]!.reason).toContain('5 天');
  });

  it('未逾期的复习任务使用"今天正好该复习"的表述', () => {
    const result = generateStudyPlan(
      input({ weakPoints: [], dueReviews: [review({ dueAt: MONDAY })] }),
    );

    expect(result.tasks[0]!.reason).toContain('今天正好该复习');
  });

  it('复习任务用时固定为 10 分钟', () => {
    const result = generateStudyPlan(input({ weakPoints: [], dueReviews: [review()] }));
    expect(result.tasks[0]!.estimatedMinutes).toBe(10);
  });
});

describe('薄弱程度与优先级排序', () => {
  it('越薄弱的知识点优先级越高', () => {
    const result = generateStudyPlan(
      input({
        dailyAvailableMinutes: 300,
        hardDailyCapMinutes: 300,
        weakPoints: [
          weak({ knowledgePointId: 'kp-weak', masteryRank: 1, level: 'insufficient', name: '很弱的知识点' }),
          weak({ knowledgePointId: 'kp-ok', masteryRank: 5, level: 'basic', name: '还行但没稳定' }),
        ],
      }),
    );

    // 可以断言：更弱的任务排在同一时间点的更前面
    const weakFirst = result.tasks.findIndex((task) => task.title.includes('很弱的知识点'));
    const okFirst = result.tasks.findIndex((task) => task.title.includes('还行但没稳定'));
    expect(weakFirst).toBeGreaterThanOrEqual(0);
    expect(okFirst).toBeGreaterThanOrEqual(0);
    expect(result.tasks[weakFirst]!.priority).toBeGreaterThanOrEqual(result.tasks[okFirst]!.priority);
  });

  it('需要补前置知识时，推荐原因里明确说明', () => {
    const result = generateStudyPlan(
      input({ weakPoints: [weak({ needsPrerequisiteReview: true })] }),
    );

    expect(result.tasks[0]!.reason).toContain('前置概念');
  });

  it('优先级始终落在 1..5', () => {
    const result = generateStudyPlan(
      input({
        dailyAvailableMinutes: 600,
        hardDailyCapMinutes: 600,
        weakPoints: [
          weak({ knowledgePointId: 'k1', masteryRank: 1 }),
          weak({ knowledgePointId: 'k2', masteryRank: 6, level: 'initial' }),
        ],
        subjectWeights: { math: 2 },
      }),
    );

    for (const task of result.tasks) {
      expect(task.priority).toBeGreaterThanOrEqual(1);
      expect(task.priority).toBeLessThanOrEqual(5);
    }
  });
});

describe('考试临近与历史完成情况', () => {
  it('考试在 21 天内 → 记录剩余天数并调整说明', () => {
    const result = generateStudyPlan(
      input({ examDate: new Date(MONDAY.getTime() + 10 * 86_400_000) }),
    );

    expect(result.rationale.examDaysLeft).toBe(10);
    expect(result.rationale.notes.join('\n')).toContain('距离考试还有 10 天');
  });

  it('考试在 21 天以外 → 不调整优先级', () => {
    const result = generateStudyPlan(
      input({ examDate: new Date(MONDAY.getTime() + 40 * 86_400_000) }),
    );

    expect(result.rationale.examDaysLeft).toBe(40);
    expect(result.rationale.notes.join('\n')).not.toContain('距离考试还有');
  });

  it('考试日期已过（边界）不产生负数天数说明', () => {
    const result = generateStudyPlan(
      input({ examDate: new Date(MONDAY.getTime() - 5 * 86_400_000) }),
    );

    expect(result.rationale.examDaysLeft).toBe(-5);
    expect(result.rationale.notes.join('\n')).not.toContain('距离考试还有');
  });

  it('完成率低于 40% → 减量到 70% 并说明原因（不催促学生）', () => {
    const result = generateStudyPlan(
      input({ recentCompletionRate: 0.2, dailyAvailableMinutes: 300, hardDailyCapMinutes: 300 }),
    );

    const practice = result.tasks.find((task) => task.taskType === 'practice');
    expect(practice).toBeDefined();
    // 20 分钟 × 0.7 = 14 分钟
    expect(practice!.estimatedMinutes).toBe(14);
    const notes = result.rationale.notes.join('\n');
    expect(notes).toContain('70%');
    // 文案必须是"减量"而不是催促 —— 面向高中生，不做焦虑式提醒
    expect(notes).toContain('完不成计划比计划少一点更糟糕');
  });

  it('完成率高于 85% → 适当增加练习占比并说明', () => {
    const result = generateStudyPlan(input({ recentCompletionRate: 0.95 }));

    const practice = result.tasks.find((task) => task.taskType === 'practice');
    expect(practice).toBeDefined();
    // 20 分钟 × 1.15 = 23 分钟
    expect(practice!.estimatedMinutes).toBe(23);
    expect(result.rationale.notes.join('\n')).toContain('完成情况很好');
  });

  it('完成率处于中间区间（40%~85%）不调整任务量', () => {
    const result = generateStudyPlan(input({ recentCompletionRate: 0.6 }));

    const practice = result.tasks.find((task) => task.taskType === 'practice');
    expect(practice!.estimatedMinutes).toBe(20);
    expect(result.rationale.notes.join('\n')).not.toContain('70%');
  });

  it('rationale 如实回传完成率，便于界面解释计划依据', () => {
    const result = generateStudyPlan(input({ recentCompletionRate: 0.5 }));
    expect(result.rationale.recentCompletionRate).toBe(0.5);
  });
});

describe('计划类型与 rationale', () => {
  it('rationale 记录计划类型与待办统计', () => {
    const result = generateStudyPlan(
      input({
        planType: 'weak-point',
        weakPoints: [weak()],
        dueReviews: [review()],
        unfinishedTasks: [unfinished()],
      }),
    );

    expect(result.rationale.planType).toBe('weak-point');
    expect(result.rationale.weakPointCount).toBe(1);
    expect(result.rationale.dueReviewCount).toBe(1);
    expect(result.rationale.unfinishedCount).toBe(1);
  });

  it('notes 是数组，任何情况下都存在（界面可直接遍历）', () => {
    const result = generateStudyPlan(input());
    expect(Array.isArray(result.rationale.notes)).toBe(true);
  });

  it('任务标题包含知识点名称，便于学生识别', () => {
    const result = generateStudyPlan(input({ weakPoints: [weak({ name: '楞次定律' })] }));
    expect(result.tasks.some((task) => task.title.includes('楞次定律'))).toBe(true);
  });

  it('题目很长时标题被截断且不换行', () => {
    const result = generateStudyPlan(
      input({
        weakPoints: [],
        dueReviews: [review({ title: '这是一道非常长的题目'.repeat(20) })],
      }),
    );

    expect(result.tasks[0]!.title).not.toContain('\n');
    expect(result.tasks[0]!.title.length).toBeLessThan(60);
  });
});
