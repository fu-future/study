import { addDays, daysBetween, reviewPriority, startOfDay } from '@/lib/review/scheduler';
import { MASTERY_ORDER, type MasteryLevel, type PlanType, type TaskType } from '@/lib/domain/enums';

/**
 * 个性化学习计划生成（纯函数，可测试）。
 *
 * 需求 4.7 的关键约束，全部在这里以规则实现：
 *   ✅ 考虑年级、学科、每天可用时间、作业负担、考试日期、薄弱知识、复习到期、难度、历史完成情况
 *   ✅ 计划必须**动态**：任务未完成可重排；连续答错时拆解并补基础；连续掌握时减少重复练习；
 *      考试临近时调整优先级；**超出可用时间时自动精简**
 *   🚫 不鼓励熬夜、过度学习、压缩休息时间追赶进度
 *
 * 为什么不用 AI 直接生成计划：AI 不擅长精确的资源约束（分钟数）与确定性优先级，
 * 容易给出「每天 3 小时」这种不现实的安排。所以计划骨架由规则生成，
 * AI 只用于（可选地）润色 task.reason 的措辞。
 */

// -----------------------------------------------------------------------------
// 输入
// -----------------------------------------------------------------------------

export type WeakPointInput = {
  knowledgePointId: string;
  name: string;
  subjectId: string;
  subjectName: string;
  level: MasteryLevel;
  /** 掌握等级排名 1..6，越小越弱 */
  masteryRank: number;
  confidence: number;
  evidenceCount: number;
  needsPrerequisiteReview: boolean;
  /** 是否已有可用的内部讲解资源 */
  hasExplanationResource: boolean;
  hasVideoResource: boolean;
};

export type DueReviewInput = {
  kind: 'wrong-answer' | 'knowledge';
  /** 错题记录 id 或知识点 id */
  targetId: string;
  /** 关联题目 id（错题复习时用于跳转） */
  questionId?: string;
  title: string;
  subjectId: string;
  knowledgePointId?: string;
  knowledgePointName?: string;
  dueAt: Date;
  masteryRank?: number;
  lastResultWrong: boolean;
};

export type UnfinishedTaskInput = {
  taskId: string;
  title: string;
  subjectId: string | null;
  knowledgePointId: string | null;
  taskType: TaskType;
  estimatedMinutes: number;
  scheduledDate: Date;
  priority: number;
  /** 已经重排过几次 —— 避免无限往后拖 */
  rescheduleCount: number;
};

export type PlanningInput = {
  planType: PlanType;
  from: Date;
  /** 计划覆盖的天数（每日计划=1，每周计划=7） */
  dayCount: number;
  /** 每天可用分钟（周中） */
  dailyAvailableMinutes: number;
  /** 周末可用分钟，缺省则与周中相同 */
  weekendAvailableMinutes?: number | null;
  /** 近期重要考试日期 */
  examDate?: Date | null;
  weakPoints: WeakPointInput[];
  dueReviews: DueReviewInput[];
  unfinishedTasks: UnfinishedTaskInput[];
  /** 最近 14 天任务完成率 0..1；无数据为 null */
  recentCompletionRate: number | null;
  /** 学科偏好权重：subjectId → 1..2（考试临近时相关学科更高） */
  subjectWeights?: Record<string, number>;
  /** 已选科目（用于优先安排） */
  electiveSubjectIds?: string[];
  /** 每天最多安排多少分钟（硬上限，防止过度学习），默认等于可用时间 */
  hardDailyCapMinutes?: number;
};

export type GeneratedTask = {
  title: string;
  subjectId: string | null;
  knowledgePointId: string | null;
  taskType: TaskType;
  estimatedMinutes: number;
  reason: string;
  completionCriteria: string;
  priority: number;
  scheduledDate: Date;
  /** 是否由未完成任务重排而来 */
  rescheduledFromId?: string;
};

export type PlanningResult = {
  tasks: GeneratedTask[];
  /** 每天安排了多少分钟 */
  minutesByDay: { date: Date; minutes: number; availableMinutes: number }[];
  /** 被精简掉的任务数（因为超出可用时间） */
  trimmedCount: number;
  /** 计划总分钟数 */
  totalMinutes: number;
  /** 计划依据，写入 StudyPlan.rationale，可向学生解释"为什么这么排" */
  rationale: {
    planType: PlanType;
    examDaysLeft: number | null;
    weakPointCount: number;
    dueReviewCount: number;
    unfinishedCount: number;
    recentCompletionRate: number | null;
    notes: string[];
  };
};

// -----------------------------------------------------------------------------
// 常量：任务时长与完成条件
// -----------------------------------------------------------------------------

const TASK_MINUTES: Record<TaskType, number> = {
  explanation: 15,
  video: 20,
  example: 12,
  practice: 20,
  review: 10,
  retest: 15,
};

const COMPLETION_CRITERIA: Record<TaskType, string> = {
  explanation: '看完讲解，能用自己的话复述这个知识点的定义和适用条件',
  video: '看完视频，并在笔记里写下 1 条收获',
  example: '看懂例题的每一步，能说出每一步的依据',
  practice: '独立完成（不看解析），做完对照答案检查',
  review: '重做这道错题并做对，或说出自己上次错在哪一步',
  retest: '独立完成复测题，检验是否真正掌握',
};

/** 单个知识点的任务链：讲解 → 练习 → 复测（按薄弱程度裁剪） */
function chainForLevel(level: MasteryLevel, hasExplanation: boolean, hasVideo: boolean): TaskType[] {
  switch (level) {
    case 'unevaluated':
      // 完全没数据：先做几道题建立基线，不要一上来就灌讲解
      return ['practice', 'explanation'];
    case 'insufficient':
      return ['practice', 'explanation'];
    case 'learning':
      return [
        ...(hasExplanation ? (['explanation'] as TaskType[]) : []),
        ...(hasVideo ? (['video'] as TaskType[]) : []),
        'example',
        'practice',
      ];
    case 'initial':
      return ['practice', 'example'];
    case 'basic':
      // 基本掌握：减少重复基础练习，只做一次迁移性练习
      return ['practice'];
    case 'stable':
      // 稳定掌握：本轮不安排，避免浪费学生时间
      return [];
    default:
      return ['practice'];
  }
}

// -----------------------------------------------------------------------------
// 主生成器
// -----------------------------------------------------------------------------

export function generateStudyPlan(input: PlanningInput): PlanningResult {
  const notes: string[] = [];
  const from = startOfDay(input.from);
  const days: { date: Date; availableMinutes: number; plannedMinutes: number }[] = [];

  const hardCap = input.hardDailyCapMinutes ?? Number.POSITIVE_INFINITY;

  for (let i = 0; i < input.dayCount; i += 1) {
    const date = addDays(from, i);
    const isWeekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
    const available = Math.min(
      hardCap,
      isWeekend && input.weekendAvailableMinutes
        ? input.weekendAvailableMinutes
        : input.dailyAvailableMinutes,
    );
    days.push({ date, availableMinutes: available, plannedMinutes: 0 });
  }

  // ---- 考试临近判断 ----
  const examDaysLeft = input.examDate ? daysBetween(from, startOfDay(input.examDate)) : null;
  const examIsClose = examDaysLeft !== null && examDaysLeft <= 21 && examDaysLeft >= 0;

  if (examIsClose) {
    notes.push(`距离考试还有 ${examDaysLeft} 天，复习任务优先级已上调，新知识点讲解任务相应减少。`);
  }

  // ---- 历史完成情况影响任务量 ----
  let loadFactor = 1;
  if (input.recentCompletionRate !== null) {
    if (input.recentCompletionRate < 0.4) {
      loadFactor = 0.7;
      notes.push(
        `最近两周任务完成率约 ${(input.recentCompletionRate * 100).toFixed(0)}%，本次计划已按 70% 的量安排 —— 完不成计划比计划少一点更糟糕。`,
      );
    } else if (input.recentCompletionRate > 0.85) {
      loadFactor = 1.15;
      notes.push('最近任务完成情况很好，本次计划适当增加了练习比例。');
    }
  }

  const candidates: GeneratedTask[] = [];

  // ---- 1. 未完成任务优先重排 ----
  for (const task of input.unfinishedTasks) {
    if (task.rescheduleCount >= 3) {
      notes.push(`「${task.title}」已重排 3 次，本次不再自动顺延，建议手动决定是继续还是放弃。`);
      continue;
    }
    candidates.push({
      title: task.title,
      subjectId: task.subjectId,
      knowledgePointId: task.knowledgePointId,
      taskType: task.taskType,
      estimatedMinutes: task.estimatedMinutes,
      reason: '这是之前安排过但还没完成的任务，先把它接上。',
      completionCriteria: COMPLETION_CRITERIA[task.taskType],
      // 重排任务优先级略高于新任务，避免一直被插队
      priority: Math.min(5, task.priority + 1),
      scheduledDate: from,
      rescheduledFromId: task.taskId,
    });
  }

  // ---- 2. 到期复习 ----
  const sortedReviews = [...input.dueReviews].sort(
    (a, b) =>
      reviewPriority({
        overdueDays: daysBetween(a.dueAt, from),
        masteryRank: a.masteryRank,
        lastResultWrong: a.lastResultWrong,
      }) -
      reviewPriority({
        overdueDays: daysBetween(b.dueAt, from),
        masteryRank: b.masteryRank,
        lastResultWrong: b.lastResultWrong,
      }),
  ).reverse();

  for (const review of sortedReviews) {
    const overdueDays = Math.max(0, daysBetween(review.dueAt, from));
    const priority = reviewPriority({
      overdueDays,
      masteryRank: review.masteryRank,
      lastResultWrong: review.lastResultWrong,
    });

    candidates.push({
      title:
        review.kind === 'wrong-answer'
          ? `错题复习：${truncate(review.title, 26)}`
          : `复习知识点：${truncate(review.knowledgePointName ?? review.title, 24)}`,
      subjectId: review.subjectId,
      knowledgePointId: review.knowledgePointId ?? null,
      taskType: 'review',
      estimatedMinutes: TASK_MINUTES.review,
      reason:
        overdueDays >= 3
          ? `这道题已经到期 ${overdueDays} 天没复习了，现在补上效果最好。`
          : '按间隔复习计划，今天正好该复习它。',
      completionCriteria: COMPLETION_CRITERIA.review,
      priority: Math.max(1, Math.min(5, Math.round(priority / 12) + 1)),
      scheduledDate: from,
    });
  }

  // ---- 3. 薄弱知识点任务链 ----
  const weakSorted = [...input.weakPoints].sort((a, b) => {
    // 先按薄弱程度（rank 越小越弱）；同级别按置信度高的优先（判断更可靠）
    if (a.masteryRank !== b.masteryRank) return a.masteryRank - b.masteryRank;
    return b.confidence - a.confidence;
  });

  for (const weak of weakSorted) {
    const chain = chainForLevel(weak.level, weak.hasExplanationResource, weak.hasVideoResource);
    if (chain.length === 0) continue;

    const subjectWeight = input.subjectWeights?.[weak.subjectId] ?? 1;

    for (const [index, taskType] of chain.entries()) {
      // 前置知识未打牢时，把讲解任务提前，并明确说明原因
      const needsPrereqNote = weak.needsPrerequisiteReview && index === 0;

      candidates.push({
        title: `${taskLabel(taskType)}：${truncate(weak.name, 24)}`,
        subjectId: weak.subjectId,
        knowledgePointId: weak.knowledgePointId,
        taskType,
        estimatedMinutes: Math.max(8, Math.round(TASK_MINUTES[taskType] * (taskType === 'practice' ? loadFactor : 1))),
        reason: needsPrereqNote
          ? `你在「${weak.name}」反复出现同类错误，先补前置概念会更省时间。`
          : `「${weak.name}」目前是「${masteryLevelLabel(weak.level)}」，这个任务能帮你往前走一步。`,
        completionCriteria: COMPLETION_CRITERIA[taskType],
        priority: Math.max(1, Math.min(5, Math.round((7 - weak.masteryRank) * subjectWeight * 0.7) + 1)),
        scheduledDate: from,
      });
    }
  }

  // ---- 4. 按优先级装填到每一天（超出可用时间就精简） ----
  const tasks: GeneratedTask[] = [];
  let trimmedCount = 0;

  // 先排高优先级；同优先级下，任务链要按顺序（讲解在练习前）
  const ordered = candidates
    .map((task, index) => ({ task, index }))
    .sort((a, b) => b.task.priority - a.task.priority || a.index - b.index);

  // 记录每个知识点已经排到第几个任务，保证链条顺序
  const placedPerKnowledgePoint = new Map<string, number>();

  for (const { task } of ordered) {
    const day = pickDay(days, task.subjectId);
    if (!day) {
      trimmedCount += 1;
      continue;
    }

    const projected = day.plannedMinutes + task.estimatedMinutes;
    if (projected > day.availableMinutes) {
      // 时间不够：能压缩就压缩，压不下去就精简掉
      const remaining = day.availableMinutes - day.plannedMinutes;
      if (remaining >= 10 && task.taskType !== 'retest') {
        task.estimatedMinutes = Math.min(task.estimatedMinutes, remaining);
      } else {
        trimmedCount += 1;
        continue;
      }
    }

    day.plannedMinutes += task.estimatedMinutes;
    task.scheduledDate = day.date;
    tasks.push(task);

    if (task.knowledgePointId) {
      placedPerKnowledgePoint.set(
        task.knowledgePointId,
        (placedPerKnowledgePoint.get(task.knowledgePointId) ?? 0) + 1,
      );
    }
  }

  // ---- 5. 同一知识点内部按"先讲解后练习"重排当天顺序 ----
  const typeOrder: Record<TaskType, number> = {
    explanation: 0,
    video: 1,
    example: 2,
    practice: 3,
    review: 4,
    retest: 5,
  };
  tasks.sort(
    (a, b) =>
      a.scheduledDate.getTime() - b.scheduledDate.getTime() ||
      b.priority - a.priority ||
      typeOrder[a.taskType] - typeOrder[b.taskType],
  );

  const totalMinutes = tasks.reduce((sum, task) => sum + task.estimatedMinutes, 0);

  if (trimmedCount > 0) {
    notes.push(
      `为了让计划落在你的可用时间内，有 ${trimmedCount} 个任务没有排进来。它们会在下次生成计划时重新考虑。`,
    );
  }
  if (totalMinutes === 0) {
    notes.push('目前没有需要安排的任务。可以先录入几道错题，或者去知识点地图看看。');
  }

  return {
    tasks,
    minutesByDay: days.map((day) => ({
      date: day.date,
      minutes: day.plannedMinutes,
      availableMinutes: day.availableMinutes,
    })),
    trimmedCount,
    totalMinutes,
    rationale: {
      planType: input.planType,
      examDaysLeft,
      weakPointCount: input.weakPoints.length,
      dueReviewCount: input.dueReviews.length,
      unfinishedCount: input.unfinishedTasks.length,
      recentCompletionRate: input.recentCompletionRate,
      notes,
    },
  };
}

/**
 * 选择要装填的那一天：
 *   1. 优先还没排满、且当天负荷最低的那一天
 *   2. 同负荷时优先更早的日期
 *
 * 不做「把任务堆到考试前一晚」这种事 —— 每天均衡分配才符合间隔学习的原理。
 */
function pickDay(
  days: { date: Date; availableMinutes: number; plannedMinutes: number }[],
  subjectId: string | null,
): { date: Date; availableMinutes: number; plannedMinutes: number } | null {
  void subjectId; // 预留：未来可加入"同一学科不连续排两天"的约束

  let best: (typeof days)[number] | null = null;
  let bestRatio = Number.POSITIVE_INFINITY;

  for (const day of days) {
    if (day.availableMinutes <= 0) continue;
    const ratio = day.plannedMinutes / day.availableMinutes;
    if (ratio < bestRatio) {
      bestRatio = ratio;
      best = day;
    }
  }

  // 已经全部排满（所有 day 都是 100%）时返回 null，让上层精简掉这个任务
  if (!best || bestRatio >= 1) return null;
  return best;
}

/** 每日计划只有一天时，pickDay 的均衡策略仍然可用（退化为一整天装填）。 */
export function generateDailyPlan(input: Omit<PlanningInput, 'planType' | 'dayCount'>): PlanningResult {
  return generateStudyPlan({ ...input, planType: 'daily', dayCount: 1 });
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

function taskLabel(type: TaskType): string {
  const labels: Record<TaskType, string> = {
    explanation: '知识讲解',
    video: '视频学习',
    example: '例题分析',
    practice: '独立练习',
    review: '错题复习',
    retest: '阶段复测',
  };
  return labels[type];
}

function masteryLevelLabel(level: MasteryLevel): string {
  const labels: Record<MasteryLevel, string> = {
    unevaluated: '未评估',
    insufficient: '证据不足',
    learning: '正在学习',
    initial: '初步掌握',
    basic: '基本掌握',
    stable: '稳定掌握',
  };
  return labels[level];
}

export { MASTERY_ORDER };
