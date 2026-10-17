import { generateStudyPlan, type GeneratedTask, type PlanningInput } from '@/lib/planning/generator';
import { addDays, startOfDay } from '@/lib/review/scheduler';
import {
  archiveActivePlans,
  createStudyPlan,
  createStudyTasks,
  listPlanTasks,
  listStudyPlans,
  listStudyTasks,
  toPlanView,
  updatePlanSummary,
  getTaskStats,
} from '@/lib/repositories/plans.repository';
import { listMasteryWithKnowledgePoint } from '@/lib/repositories/mastery.repository';
import { listDueReviews } from '@/lib/repositories/review.repository';
import { listResourcesForKnowledgePoint } from '@/lib/repositories/resources.repository';
import { getStudentProfile, toProfileView } from '@/lib/repositories/users.repository';
import { listSubjects } from '@/lib/repositories/subjects.repository';
import { MASTERY_ORDER, type MasteryLevel, type PlanType, type TaskType } from '@/lib/domain/enums';
import { AppError } from '@/lib/errors';

/**
 * 个性化学习计划服务（需求 4.7）。
 *
 * 分工说明：
 *   - **任务骨架由确定性规则生成**（src/lib/planning/generator.ts），因为
 *     "每天只有 90 分钟" 这种资源约束是精确计算，AI 做不好。
 *   - AI 不参与决策。第一版刻意不用 AI 生成计划 —— 需求也要求
 *     「不要鼓励熬夜、过度学习」，规则引擎更容易保证这一点。
 */

export type GeneratedPlanView = {
  plan: ReturnType<typeof toPlanView>;
  tasks: {
    id: string;
    title: string;
    subjectId: string | null;
    subjectName: string | null;
    knowledgePointId: string | null;
    knowledgePointName: string | null;
    taskType: TaskType;
    estimatedMinutes: number;
    reason: string;
    completionCriteria: string | null;
    priority: number;
    status: string;
    scheduledDate: string;
    dueDate: string | null;
  }[];
  minutesByDay: { date: string; minutes: number; availableMinutes: number }[];
  trimmedCount: number;
  totalMinutes: number;
};

const PLAN_DAY_COUNT: Record<PlanType, number> = {
  daily: 1,
  weekly: 7,
  'exam-prep': 7,
  'weak-point': 5,
  'mistake-review': 3,
  makeup: 2,
};

export async function generatePlanForUser(params: {
  userId: string;
  planType: PlanType;
  dayCount?: number;
  from?: Date;
  replaceUnfinished?: boolean;
}): Promise<GeneratedPlanView> {
  const profile = toProfileView(await getStudentProfile(params.userId));
  const subjects = await listSubjects();
  const subjectById = new Map(subjects.map((s) => [s.id, s]));

  const from = startOfDay(params.from ?? new Date());
  const dayCount = params.dayCount ?? PLAN_DAY_COUNT[params.planType];

  // ---- 收集输入 ----

  // 1. 薄弱知识点（掌握度「正在学习 / 初步掌握」，或需要回补前置知识）
  const masteryRows = await listMasteryWithKnowledgePoint(params.userId);
  const weakPoints = masteryRows
    .filter((row) => {
      // 只处理「值得花时间」的：明确薄弱的，或需要补前置的
      const weakLevels: MasteryLevel[] = ['learning', 'initial', 'insufficient'];
      return weakLevels.includes(row.level as MasteryLevel) || row.needsPrerequisiteReview;
    })
    .slice(0, 12)
    .map((row) => ({
      knowledgePointId: row.knowledgePointId,
      name: row.knowledgePoint.name,
      subjectId: row.knowledgePoint.subjectId,
      subjectName: subjectById.get(row.knowledgePoint.subjectId)?.name ?? '',
      level: row.level as MasteryLevel,
      masteryRank: Math.max(1, MASTERY_ORDER.indexOf(row.level as never) + 1),
      confidence: row.confidence,
      evidenceCount: row.evidenceCount,
      needsPrerequisiteReview: row.needsPrerequisiteReview,
      hasExplanationResource: false,
      hasVideoResource: false,
    }));

  // 资源可用性：决定任务链里要不要放「看讲解 / 看视频」
  for (const weak of weakPoints) {
    const resources = await listResourcesForKnowledgePoint(weak.knowledgePointId);
    weak.hasExplanationResource = resources.some(
      (r) => r.resourceType === 'explanation' || r.resourceType === 'textbook',
    );
    weak.hasVideoResource = resources.some((r) => r.resourceType === 'video');
  }

  // 2. 到期复习（只取今天及更早的）
  const due = await listDueReviews(params.userId, { before: addDays(from, dayCount), limit: 40 });
  const dueReviews = due.map((schedule) => {
    const masteryRow = masteryRows.find(
      (row) => row.knowledgePointId === schedule.knowledgePointId,
    );

    return {
      kind: schedule.wrongAnswerRecordId ? ('wrong-answer' as const) : ('knowledge' as const),
      targetId: schedule.wrongAnswerRecordId ?? schedule.knowledgePointId ?? schedule.id,
      questionId: schedule.wrongAnswerRecord?.question.id,
      title: schedule.wrongAnswerRecord?.question.stem?.slice(0, 40) ?? schedule.knowledgePoint?.name ?? '复习',
      subjectId: schedule.wrongAnswerRecord?.question.subjectId ?? schedule.knowledgePoint?.subjectId ?? '',
      knowledgePointId: schedule.knowledgePointId ?? undefined,
      knowledgePointName: schedule.knowledgePoint?.name,
      dueAt: schedule.dueAt,
      masteryRank: masteryRow
        ? Math.max(1, MASTERY_ORDER.indexOf(masteryRow.level as never) + 1)
        : 4,
      lastResultWrong: schedule.lastResult === 'wrong',
    };
  });

  // 3. 未完成任务
  const pendingTasks = await listStudyTasks(params.userId, { status: 'pending' });
  const unfinishedTasks = pendingTasks
    .filter((task) => task.scheduledDate.getTime() < addDays(from, dayCount).getTime())
    .slice(0, 10)
    .map((task) => ({
      taskId: task.id,
      title: task.title,
      subjectId: task.subjectId,
      knowledgePointId: task.knowledgePointId,
      taskType: task.taskType as TaskType,
      estimatedMinutes: task.estimatedMinutes,
      scheduledDate: task.scheduledDate,
      priority: task.priority,
      rescheduleCount: 0,
    }));

  // 4. 历史完成情况（近 14 天）
  const stats = await getTaskStats(params.userId, {
    from: addDays(from, -14),
    to: from,
  });
  const recentCompletionRate = stats.total > 0 ? stats.completed / stats.total : null;

  // 5. 考试临近时提升相关学科的权重
  const examDate = profile.examDate;
  const subjectWeights: Record<string, number> = {};
  if (examDate) {
    const daysLeft = Math.round((examDate.getTime() - from.getTime()) / 86_400_000);
    if (daysLeft <= 21 && daysLeft >= 0) {
      for (const subject of subjects) subjectWeights[subject.id] = 1.3;
    }
  }

  // ---- 生成 ----
  const input: PlanningInput = {
    planType: params.planType,
    from,
    dayCount,
    dailyAvailableMinutes: profile.dailyAvailableMinutes,
    weekendAvailableMinutes: profile.weekendAvailableMinutes,
    examDate,
    weakPoints,
    dueReviews,
    unfinishedTasks: params.replaceUnfinished ? [] : unfinishedTasks,
    recentCompletionRate,
    subjectWeights,
    electiveSubjectIds: profile.electiveSubjects.
      map((code) => subjectById.get(code) ?? subjects.find((s) => s.code === code))
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .map((s) => s.id),
    // 硬上限：即使学生自己填了 300 分钟，第一版也不安排超过这个数，避免鼓励过度学习
    hardDailyCapMinutes: Math.min(profile.dailyAvailableMinutes, 180),
  };

  const result = generateStudyPlan(input);

  if (result.tasks.length === 0 && params.planType === 'daily') {
    // 不是错误，但要如实告知 —— 界面会显示空状态
    return {
      plan: toPlanView(
        await createEmptyPlanPlaceholder(params.userId, params.planType, from, dayCount, result.rationale),
      ),
      tasks: [],
      minutesByDay: result.minutesByDay.map((d) => ({
        date: d.date.toISOString(),
        minutes: d.minutes,
        availableMinutes: d.availableMinutes,
      })),
      trimmedCount: 0,
      totalMinutes: 0,
    };
  }

  // ---- 落库 ----
  if (params.planType === 'daily') {
    // 每日计划重复生成时，把上一个日计划归档，避免任务重复堆叠
    await archiveActivePlans(params.userId, 'daily');
  }

  const plan = await createStudyPlan(params.userId, {
    title: buildPlanTitle(params.planType, from, result.tasks.length),
    planType: params.planType,
    goal: profile.studyGoal,
    startDate: from,
    endDate: addDays(from, dayCount - 1),
    generatedBy: 'rule-engine',
    rationale: result.rationale as unknown as Record<string, unknown>,
    plannedMinutes: result.totalMinutes,
    availableMinutes: result.minutesByDay.reduce((sum, d) => sum + d.availableMinutes, 0),
    status: 'active',
  });

  await createStudyTasks(
    params.userId,
    result.tasks.map((task: GeneratedTask) => ({
      planId: plan.id,
      title: task.title,
      subjectId: task.subjectId,
      knowledgePointId: task.knowledgePointId,
      taskType: task.taskType,
      estimatedMinutes: task.estimatedMinutes,
      reason: task.reason,
      completionCriteria: task.completionCriteria,
      priority: task.priority,
      scheduledDate: task.scheduledDate,
      rescheduledFromId: task.rescheduledFromId ?? null,
    })),
  );

  const taskRows = await listPlanTasks(plan.id);
  const nameById = new Map(masteryRows.map((row) => [row.knowledgePointId, row.knowledgePoint.name]));

  return {
    plan: toPlanView(plan),
    tasks: taskRows.map((task) => ({
      id: task.id,
      title: task.title,
      subjectId: task.subjectId,
      subjectName: subjectById.get(task.subjectId ?? '')?.name ?? null,
      knowledgePointId: task.knowledgePointId,
      knowledgePointName: task.knowledgePointId
        ? (nameById.get(task.knowledgePointId) ?? task.knowledgePoint?.name ?? null)
        : null,
      taskType: task.taskType as TaskType,
      estimatedMinutes: task.estimatedMinutes,
      reason: task.reason,
      completionCriteria: task.completionCriteria,
      priority: task.priority,
      status: task.status,
      scheduledDate: task.scheduledDate.toISOString(),
      dueDate: task.dueDate?.toISOString() ?? null,
    })),
    minutesByDay: result.minutesByDay.map((d) => ({
      date: d.date.toISOString(),
      minutes: d.minutes,
      availableMinutes: d.availableMinutes,
    })),
    trimmedCount: result.trimmedCount,
    totalMinutes: result.totalMinutes,
  };
}

async function createEmptyPlanPlaceholder(
  userId: string,
  planType: PlanType,
  from: Date,
  dayCount: number,
  rationale: Record<string, unknown>,
) {
  return createStudyPlan(userId, {
    title: buildPlanTitle(planType, from, 0),
    planType,
    startDate: from,
    endDate: addDays(from, dayCount - 1),
    generatedBy: 'rule-engine',
    rationale,
    plannedMinutes: 0,
    availableMinutes: 0,
    status: 'active',
  });
}

function buildPlanTitle(planType: PlanType, from: Date, taskCount: number): string {
  const label = {
    daily: '今日计划',
    weekly: '本周计划',
    'exam-prep': '考前复习计划',
    'weak-point': '薄弱知识专项',
    'mistake-review': '错题复习计划',
    makeup: '临时补课任务',
  }[planType];

  const dateLabel = `${from.getMonth() + 1}月${from.getDate()}日`;
  return taskCount > 0 ? `${dateLabel} ${label}` : `${dateLabel} ${label}（暂无任务）`;
}

/** 生成计划前的可行性预检：可用时间 vs 待办量。 */
export async function checkPlanFeasibility(userId: string): Promise<{
  availableMinutes: number;
  plannedMinutes: number;
  overloaded: boolean;
  message: string | null;
}> {
  const profile = toProfileView(await getStudentProfile(userId));
  const pending = await listStudyTasks(userId, { status: 'pending' });
  const plannedMinutes = pending.reduce((sum, task) => sum + task.estimatedMinutes, 0);

  const overloaded = plannedMinutes > profile.dailyAvailableMinutes * 1.2;

  return {
    availableMinutes: profile.dailyAvailableMinutes,
    plannedMinutes,
    overloaded,
    message: overloaded
      ? `今天待办任务约 ${plannedMinutes} 分钟，超过了你设定的 ${profile.dailyAvailableMinutes} 分钟。可以重新生成计划，系统会自动精简。`
      : null,
  };
}

export async function listUserPlans(userId: string, limit = 20) {
  return (await listStudyPlans(userId, { limit })).map(toPlanView);
}

export { updatePlanSummary };
export function notFoundPlan(): never {
  throw new AppError('NOT_FOUND', { userMessage: '没有找到这个学习计划。' });
}
