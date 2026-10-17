import type { Prisma, StudyPlan, StudySession, StudyTask } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { readObject, toJsonText } from '@/lib/db/json';

/**
 * 学习计划、任务与实际学习时段的数据访问层。
 *
 * 「计划必须是动态的」体现在数据层面：
 *   - 任务状态可流转，且重排时通过 rescheduledFromId 保留调整痕迹
 *   - 任务完成结果、实际耗时都记录下来，成为下次生成的输入
 */

export type StudyTaskView = Omit<StudyTask, 'result'> & { result: Record<string, unknown> };
export type StudyPlanView = Omit<StudyPlan, 'rationale'> & { rationale: Record<string, unknown> };

export function toTaskView(task: StudyTask): StudyTaskView {
  return { ...task, result: readObject(task.result) };
}

export function toPlanView(plan: StudyPlan): StudyPlanView {
  return { ...plan, rationale: readObject(plan.rationale) };
}

// -----------------------------------------------------------------------------
// 计划
// -----------------------------------------------------------------------------

export async function createStudyPlan(
  userId: string,
  input: {
    title: string;
    planType: string;
    goal?: string | null;
    startDate: Date;
    endDate: Date;
    generatedBy?: string;
    rationale?: Record<string, unknown>;
    plannedMinutes?: number;
    availableMinutes?: number;
    status?: string;
  },
): Promise<StudyPlan> {
  return prisma.studyPlan.create({
    data: {
      userId,
      title: input.title,
      planType: input.planType,
      goal: input.goal ?? null,
      startDate: input.startDate,
      endDate: input.endDate,
      generatedBy: input.generatedBy ?? 'rule-engine',
      rationale: toJsonText(input.rationale ?? {}, '{}'),
      plannedMinutes: input.plannedMinutes ?? 0,
      availableMinutes: input.availableMinutes ?? 0,
      status: input.status ?? 'active',
    },
  });
}

/** 同一时间只保留一个 active 的同类计划，避免任务重复堆叠。 */
export async function archiveActivePlans(userId: string, planType: string): Promise<void> {
  await prisma.studyPlan.updateMany({
    where: { userId, planType, status: 'active' },
    data: { status: 'archived', isArchived: true },
  });
}

export async function findStudyPlanForUser(userId: string, planId: string): Promise<StudyPlan | null> {
  return prisma.studyPlan.findFirst({ where: { id: planId, userId, isArchived: false } });
}

export async function listStudyPlans(userId: string, options: { limit?: number } = {}): Promise<StudyPlan[]> {
  return prisma.studyPlan.findMany({
    where: { userId, isArchived: false },
    orderBy: { createdAt: 'desc' },
    take: options.limit ?? 20,
  });
}

export async function listPlanTasks(planId: string) {
  return prisma.studyTask.findMany({
    where: { planId },
    include: {
      subject: { select: { id: true, code: true, name: true } },
      knowledgePoint: { select: { id: true, name: true, chapterPath: true } },
    },
    orderBy: [{ scheduledDate: 'asc' }, { priority: 'desc' }],
  });
}

export async function updatePlanSummary(
  userId: string,
  planId: string,
  patch: {
    plannedMinutes?: number;
    availableMinutes?: number;
    status?: string;
    rationale?: Record<string, unknown>;
  },
): Promise<void> {
  await prisma.studyPlan.updateMany({
    where: { id: planId, userId },
    data: {
      ...(patch.plannedMinutes === undefined ? {} : { plannedMinutes: patch.plannedMinutes }),
      ...(patch.availableMinutes === undefined ? {} : { availableMinutes: patch.availableMinutes }),
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.rationale === undefined ? {} : { rationale: toJsonText(patch.rationale, '{}') }),
    },
  });
}

// -----------------------------------------------------------------------------
// 任务
// -----------------------------------------------------------------------------

export type CreateTaskInput = {
  planId?: string | null;
  title: string;
  subjectId?: string | null;
  knowledgePointId?: string | null;
  resourceId?: string | null;
  taskType: string;
  estimatedMinutes: number;
  reason: string;
  completionCriteria?: string | null;
  priority?: number;
  scheduledDate: Date;
  dueDate?: Date | null;
  status?: string;
  rescheduledFromId?: string | null;
};

export async function createStudyTasks(userId: string, tasks: CreateTaskInput[]): Promise<StudyTask[]> {
  if (tasks.length === 0) return [];

  // SQLite 下逐条写入比 createMany 更容易拿到返回值；任务量级很小（每天几条），可接受。
  const created: StudyTask[] = [];
  for (const task of tasks) {
    created.push(
      await prisma.studyTask.create({
        data: {
          userId,
          planId: task.planId ?? null,
          title: task.title,
          subjectId: task.subjectId ?? null,
          knowledgePointId: task.knowledgePointId ?? null,
          resourceId: task.resourceId ?? null,
          taskType: task.taskType,
          estimatedMinutes: task.estimatedMinutes,
          reason: task.reason,
          completionCriteria: task.completionCriteria ?? null,
          priority: task.priority ?? 3,
          scheduledDate: task.scheduledDate,
          dueDate: task.dueDate ?? null,
          status: task.status ?? 'pending',
          rescheduledFromId: task.rescheduledFromId ?? null,
        },
      }),
    );
  }
  return created;
}

export async function findStudyTaskForUser(userId: string, taskId: string): Promise<StudyTask | null> {
  return prisma.studyTask.findFirst({ where: { id: taskId, userId } });
}

export type TaskFilter = {
  planId?: string;
  from?: Date;
  to?: Date;
  status?: string;
  taskType?: string;
  subjectId?: string;
  limit?: number;
};

export async function listStudyTasks(
  userId: string,
  filter: TaskFilter = {},
): Promise<StudyTask[]> {
  const where: Prisma.StudyTaskWhereInput = { userId };
  if (filter.planId) where.planId = filter.planId;
  if (filter.status) where.status = filter.status;
  if (filter.taskType) where.taskType = filter.taskType;
  if (filter.subjectId) where.subjectId = filter.subjectId;
  if (filter.from || filter.to) {
    where.scheduledDate = {
      ...(filter.from ? { gte: filter.from } : {}),
      ...(filter.to ? { lte: filter.to } : {}),
    };
  }

  return prisma.studyTask.findMany({
    where,
    include: {
      subject: { select: { id: true, code: true, name: true } },
      knowledgePoint: { select: { id: true, name: true, chapterPath: true } },
    },
    orderBy: [{ scheduledDate: 'asc' }, { priority: 'desc' }, { createdAt: 'asc' }],
    take: filter.limit ?? 200,
  });
}

export async function updateStudyTask(
  userId: string,
  taskId: string,
  patch: {
    status?: string;
    scheduledDate?: Date;
    priority?: number;
    estimatedMinutes?: number;
    completedAt?: Date | null;
    actualMinutes?: number | null;
    result?: Record<string, unknown>;
    title?: string;
    reason?: string;
  },
): Promise<StudyTask> {
  const result = await prisma.studyTask.updateMany({
    where: { id: taskId, userId },
    data: {
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.scheduledDate === undefined ? {} : { scheduledDate: patch.scheduledDate }),
      ...(patch.priority === undefined ? {} : { priority: patch.priority }),
      ...(patch.estimatedMinutes === undefined ? {} : { estimatedMinutes: patch.estimatedMinutes }),
      ...(patch.completedAt === undefined ? {} : { completedAt: patch.completedAt }),
      ...(patch.actualMinutes === undefined ? {} : { actualMinutes: patch.actualMinutes }),
      ...(patch.result === undefined ? {} : { result: toJsonText(patch.result, '{}') }),
      ...(patch.title === undefined ? {} : { title: patch.title }),
      ...(patch.reason === undefined ? {} : { reason: patch.reason }),
    },
  });

  if (result.count === 0) throw new Error('STUDY_TASK_NOT_FOUND_OR_FORBIDDEN');

  const updated = await prisma.studyTask.findUnique({ where: { id: taskId } });
  if (!updated) throw new Error('STUDY_TASK_NOT_FOUND_OR_FORBIDDEN');
  return updated;
}

export async function getTaskStats(
  userId: string,
  range: { from: Date; to: Date },
): Promise<{ total: number; completed: number; skipped: number; estimatedMinutes: number; actualMinutes: number }> {
  const where: Prisma.StudyTaskWhereInput = {
    userId,
    scheduledDate: { gte: range.from, lte: range.to },
  };

  const tasks = await prisma.studyTask.findMany({
    where,
    select: { status: true, estimatedMinutes: true, actualMinutes: true },
  });

  let completed = 0;
  let skipped = 0;
  let estimatedMinutes = 0;
  let actualMinutes = 0;

  for (const task of tasks) {
    if (task.status === 'completed') completed += 1;
    if (task.status === 'skipped') skipped += 1;
    estimatedMinutes += task.estimatedMinutes;
    actualMinutes += task.actualMinutes ?? 0;
  }

  return { total: tasks.length, completed, skipped, estimatedMinutes, actualMinutes };
}

// -----------------------------------------------------------------------------
// 实际学习时段（用于「学习时间」这一独立指标）
// -----------------------------------------------------------------------------

export async function createStudySession(
  userId: string,
  input: {
    studyTaskId?: string | null;
    startedAt: Date;
    endedAt?: Date | null;
    durationMinutes: number;
    mode?: string;
    subjectId?: string | null;
    note?: string | null;
  },
): Promise<StudySession> {
  return prisma.studySession.create({
    data: {
      userId,
      studyTaskId: input.studyTaskId ?? null,
      startedAt: input.startedAt,
      endedAt: input.endedAt ?? null,
      durationMinutes: input.durationMinutes,
      mode: input.mode ?? 'task',
      subjectId: input.subjectId ?? null,
      note: input.note ?? null,
    },
  });
}

export async function sumStudyMinutes(
  userId: string,
  range: { from: Date; to: Date },
): Promise<{ totalMinutes: number; sessions: number }> {
  const result = await prisma.studySession.aggregate({
    where: { userId, startedAt: { gte: range.from, lte: range.to } },
    _sum: { durationMinutes: true },
    _count: { _all: true },
  });

  return { totalMinutes: result._sum.durationMinutes ?? 0, sessions: result._count._all };
}

export async function listRecentSessions(userId: string, limit = 20): Promise<StudySession[]> {
  return prisma.studySession.findMany({
    where: { userId },
    orderBy: { startedAt: 'desc' },
    take: limit,
  });
}
