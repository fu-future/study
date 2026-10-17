import { addDays, startOfDay } from '@/lib/review/scheduler';
import { getTaskStats, sumStudyMinutes, listStudyTasks, listRecentSessions } from '@/lib/repositories/plans.repository';
import {
  getAttemptStats,
  getAttemptStatsBySubject,
  getAttemptStatsByKnowledgePoint,
} from '@/lib/repositories/questions.repository';
import { getMasteryDistribution, listMasteryWithKnowledgePoint } from '@/lib/repositories/mastery.repository';
import { getReviewStats, listReviewSchedules } from '@/lib/repositories/review.repository';
import { getWrongRecordStats, listWrongAnswerRecords } from '@/lib/repositories/mistakes.repository';
import { listSubjects } from '@/lib/repositories/subjects.repository';
import { ERROR_TYPES, errorTypeLabel, masteryLabel, type ErrorType } from '@/lib/domain/enums';
import { readStringArray } from '@/lib/db/json';
import { prisma } from '@/lib/db/client';

/**
 * 学习报告（需求 4.8）。
 *
 * 红线：**所有统计必须来自真实记录**。
 *   本文件不做任何估算或补全 —— 没有数据的字段就是 null / 0，
 *   界面据 null 显示「本周暂无记录」而不是显示 0% 这种会误导的数字。
 *
 * 四个指标严格区分（需求明确要求不要混为一谈）：
 *   1. 学习时间  studyTimeMinutes —— 来自 StudySession
 *   2. 任务完成率 taskCompletionRate —— 来自 StudyTask 状态
 *   3. 练习正确率 practiceAccuracy —— 来自 AnswerAttempt
 *   4. 知识掌握估计 mastery —— 来自 UserKnowledgeMastery（算法输出，前面三者都是它的输入）
 */

export type WeeklyReport = {
  range: { from: string; to: string; label: string };

  /** 指标一：学习时间（分钟） */
  studyTime: {
    totalMinutes: number;
    sessions: number;
    /** 按天分布，用于画柱状图 */
    byDay: { date: string; minutes: number }[];
  };

  /** 指标二：任务完成情况 */
  tasks: {
    total: number;
    completed: number;
    skipped: number;
    pending: number;
    /** 完成率；total 为 0 时为 null（不是 0%） */
    completionRate: number | null;
    estimatedMinutes: number;
    actualMinutes: number;
    completedList: { id: string; title: string; subjectId: string | null; completedAt: string | null; minutes: number }[];
  };

  /** 指标三：练习正确率 */
  practice: {
    total: number;
    correct: number;
    /** 正确率；total 为 0 时为 null */
    accuracy: number | null;
    bySubject: { subjectId: string; subjectName: string; total: number; correct: number; accuracy: number }[];
  };

  /** 指标四：知识掌握估计（来自算法，不是另一次统计） */
  mastery: {
    distribution: Record<string, number>;
    /** 本周有推进的知识点（等级达到 basic/stable 且本周更新过） */
    improved: { knowledgePointId: string; name: string; level: string; levelLabel: string; subjectName: string }[];
    /** 仍需加强的知识点 */
    needsWork: { knowledgePointId: string; name: string; level: string; levelLabel: string; subjectName: string; nextAction: string | null }[];
    /** 证据不足、还不能下结论的知识点数 */
    insufficientEvidence: number;
  };

  /** 重复出现的错误类型 */
  repeatedErrors: { type: string; label: string; count: number }[];

  /** 复习任务完成情况 */
  review: { total: number; dueNow: number; done: number; overdue: number; scheduledThisWeek: number };

  /** 错题本概况 */
  mistakes: { total: number; due: number; resolved: number; newThisWeek: number };

  /** 下一周建议（规则生成，可解释） */
  suggestions: string[];

  /** 诊断的证据与不确定性说明 —— 需求要求必须呈现 */
  evidenceNotes: string[];

  /** 是否有足够的真实数据来支撑这份报告 */
  hasEnoughData: boolean;
};

/** 计算某一周的起止（周一 00:00 → 周日 23:59:59，UTC 归一）。 */
export function weekRange(weekOffset = 0, now = new Date()): { from: Date; to: Date; label: string } {
  const today = startOfDay(now);
  // JS getUTCDay: 0=周日, 1=周一 …
  const dayOfWeek = today.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;

  const thisMonday = addDays(today, -daysSinceMonday - weekOffset * 7);
  const from = thisMonday;
  const to = addDays(thisMonday, 7);

  const fmt = (date: Date) => `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
  const label = weekOffset === 0 ? '本周' : `第 ${weekOffset} 周前`;

  return { from, to, label: `${label}（${fmt(from)} – ${fmt(addDays(to, -1))}）` };
}

export async function buildWeeklyReport(
  userId: string,
  weekOffset = 0,
  now = new Date(),
): Promise<WeeklyReport> {
  const range = weekRange(weekOffset, now);
  const subjects = await listSubjects();
  const subjectName = new Map(subjects.map((s) => [s.id, s.name]));

  // ---- 1. 学习时间 ----
  const sessionSummary = await sumStudyMinutes(userId, { from: range.from, to: range.to });
  const sessions = await listRecentSessions(userId, 200);
  const byDayMap = new Map<string, number>();
  for (const session of sessions) {
    if (session.startedAt < range.from || session.startedAt >= range.to) continue;
    const key = session.startedAt.toISOString().slice(0, 10);
    byDayMap.set(key, (byDayMap.get(key) ?? 0) + session.durationMinutes);
  }
  const byDay = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(range.from, index);
    const key = date.toISOString().slice(0, 10);
    return { date: key, minutes: byDayMap.get(key) ?? 0 };
  });

  // ---- 2. 任务 ----
  const taskStats = await getTaskStats(userId, { from: range.from, to: addDays(range.to, -1) });
  const weekTasks = await listStudyTasks(userId, { from: range.from, to: addDays(range.to, -1), limit: 200 });
  const pending = weekTasks.filter((task) => task.status === 'pending' || task.status === 'in-progress').length;
  const completedList = weekTasks
    .filter((task) => task.status === 'completed')
    .map((task) => ({
      id: task.id,
      title: task.title,
      subjectId: task.subjectId,
      completedAt: task.completedAt?.toISOString() ?? null,
      minutes: task.actualMinutes ?? task.estimatedMinutes,
    }));

  // ---- 3. 练习 ----
  const attemptStats = await getAttemptStats(userId, { since: range.from });
  const bySubjectRaw = await getAttemptStatsBySubject(userId, { from: range.from, to: range.to });
  const bySubject = [...bySubjectRaw.entries()].map(([subjectId, bucket]) => ({
    subjectId,
    subjectName: subjectName.get(subjectId) ?? '其他',
    total: bucket.total,
    correct: bucket.correct,
    accuracy: bucket.total > 0 ? bucket.correct / bucket.total : 0,
  }));

  // 本周错误类型分布（来自真实作答）
  const weekAttempts = await prisma.answerAttempt.findMany({
    where: { userId, createdAt: { gte: range.from, lt: range.to } },
    select: { errorTypes: true, isCorrect: true },
  });
  const errorCounts = new Map<string, number>();
  for (const attempt of weekAttempts) {
    if (attempt.isCorrect) continue;
    for (const type of readStringArray(attempt.errorTypes)) {
      errorCounts.set(type, (errorCounts.get(type) ?? 0) + 1);
    }
  }
  const repeatedErrors = [...errorCounts.entries()]
    .map(([type, count]) => ({
      type,
      label: errorTypeLabel(type),
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  // ---- 4. 掌握估计 ----
  const distribution = await getMasteryDistribution(userId);
  const masteryRows = await listMasteryWithKnowledgePoint(userId);

  const improved = masteryRows
    .filter(
      (row) =>
        (row.level === 'basic' || row.level === 'stable') &&
        row.lastEvaluatedAt !== null &&
        row.lastEvaluatedAt >= range.from &&
        row.lastEvaluatedAt < range.to,
    )
    .map((row) => ({
      knowledgePointId: row.knowledgePointId,
      name: row.knowledgePoint.name,
      level: row.level,
      levelLabel: masteryLabel(row.level),
      subjectName: subjectName.get(row.knowledgePoint.subjectId) ?? '',
    }));

  const needsWork = masteryRows
    .filter((row) => row.level === 'learning' || row.level === 'initial')
    .slice(0, 10)
    .map((row) => ({
      knowledgePointId: row.knowledgePointId,
      name: row.knowledgePoint.name,
      level: row.level,
      levelLabel: masteryLabel(row.level),
      subjectName: subjectName.get(row.knowledgePoint.subjectId) ?? '',
      nextAction: row.nextAction,
    }));

  const insufficientEvidence =
    (distribution.unevaluated ?? 0) + (distribution.insufficient ?? 0);

  // ---- 5. 复习 ----
  const reviewStats = await getReviewStats(userId);
  const schedules = await listReviewSchedules(userId, { limit: 200 });
  const scheduledThisWeek = schedules.filter(
    (schedule) => schedule.dueAt >= range.from && schedule.dueAt < range.to,
  ).length;

  // ---- 6. 错题 ----
  const mistakeStats = await getWrongRecordStats(userId);
  const allMistakes = await listWrongAnswerRecords(userId, { limit: 200 });
  const newThisWeek = allMistakes.items.filter(
    (record) => record.createdAt >= range.from && record.createdAt < range.to,
  ).length;

  // ---- 7. 建议（规则生成，逐条可解释） ----
  const suggestions = buildSuggestions({
    completionRate: taskStats.total > 0 ? taskStats.completed / taskStats.total : null,
    practiceAccuracy: attemptStats.total > 0 ? attemptStats.correct / attemptStats.total : null,
    dueReviews: reviewStats.dueNow,
    overdueReviews: reviewStats.overdue,
    needsWorkCount: needsWork.length,
    repeatedErrors,
    insufficientEvidence,
    studyMinutes: sessionSummary.totalMinutes,
  });

  // ---- 8. 证据与不确定性（需求明确要求呈现） ----
  const evidenceNotes: string[] = [
    '掌握程度是**估计值**，来自你的真实作答记录（正确率、是否独立完成、题目难度、复测表现），需要后续练习持续验证。',
    `本次报告基于 ${attemptStats.total} 条作答记录与 ${taskStats.total} 个任务记录生成。`,
  ];
  if (insufficientEvidence > 0) {
    evidenceNotes.push(
      `有 ${insufficientEvidence} 个知识点目前证据不足，暂时无法给出结论 —— 界面会显示「还需要更多练习」，而不是给出一个不准确的数字。`,
    );
  }
  if (attemptStats.total < 5) {
    evidenceNotes.push(
      '本周作答记录较少（少于 5 条），报告中的正确率参考价值有限，建议多做几道题后再看趋势。',
    );
  }
  if (reviewStats.overdue > 0) {
    evidenceNotes.push(
      `有 ${reviewStats.overdue} 项复习已逾期。不会影响掌握度判断，但间隔太久复习效果会下降。`,
    );
  }

  const hasEnoughData = attemptStats.total + taskStats.total > 0;

  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString(), label: range.label },
    studyTime: {
      totalMinutes: sessionSummary.totalMinutes,
      sessions: sessionSummary.sessions,
      byDay,
    },
    tasks: {
      total: taskStats.total,
      completed: taskStats.completed,
      skipped: taskStats.skipped,
      pending,
      completionRate: taskStats.total > 0 ? taskStats.completed / taskStats.total : null,
      estimatedMinutes: taskStats.estimatedMinutes,
      actualMinutes: taskStats.actualMinutes,
      completedList,
    },
    practice: {
      total: attemptStats.total,
      correct: attemptStats.correct,
      accuracy: attemptStats.total > 0 ? attemptStats.correct / attemptStats.total : null,
      bySubject,
    },
    mastery: {
      distribution,
      improved,
      needsWork,
      insufficientEvidence,
    },
    repeatedErrors,
    review: {
      total: reviewStats.total,
      dueNow: reviewStats.dueNow,
      done: reviewStats.done,
      overdue: reviewStats.overdue,
      scheduledThisWeek,
    },
    mistakes: {
      total: mistakeStats.total,
      due: mistakeStats.due,
      resolved: mistakeStats.resolved,
      newThisWeek,
    },
    suggestions,
    evidenceNotes,
    hasEnoughData,
  };
}

function buildSuggestions(input: {
  completionRate: number | null;
  practiceAccuracy: number | null;
  dueReviews: number;
  overdueReviews: number;
  needsWorkCount: number;
  repeatedErrors: { type: string; label: string; count: number }[];
  insufficientEvidence: number;
  studyMinutes: number;
}): string[] {
  const suggestions: string[] = [];

  // 完成率低：先减量，而不是催促
  if (input.completionRate !== null && input.completionRate < 0.5) {
    suggestions.push(
      '最近计划完成率偏低，下一周不妨把每天的任务量调小一些。完成少量任务比列一堆做不完更有帮助。',
    );
  }

  if (input.overdueReviews > 0) {
    suggestions.push(
      `有 ${input.overdueReviews} 项复习已经逾期。可以先把它们清掉，再做新题 —— 这样性价比最高。`,
    );
  } else if (input.dueReviews > 0) {
    suggestions.push(`今天有 ${input.dueReviews} 项复习到期，先花 10-15 分钟把它们做完。`);
  }

  const topError = input.repeatedErrors[0];
  if (topError && topError.count >= 3) {
    suggestions.push(
      `「${topError.label}」这一周出现了 ${topError.count} 次，是最集中的问题。建议专门练一组针对性题目，而不是继续刷整套卷子。`,
    );
  }

  if (input.practiceAccuracy !== null && input.practiceAccuracy < 0.5) {
    suggestions.push(
      '练习正确率偏低，说明当前题目难度可能超出准备程度。可以回到相关知识点的基础题，把前置概念补稳再往上走。',
    );
  }

  if (input.needsWorkCount > 5) {
    suggestions.push(
      `有 ${input.needsWorkCount} 个知识点处于「正在学习 / 初步掌握」阶段。一次集中攻 2-3 个就够了，摊开反而都记不牢。`,
    );
  }

  if (input.insufficientEvidence > 3) {
    suggestions.push(
      '不少知识点还没有足够的练习记录来判断掌握情况。可以每天安排 10 分钟做几道相关题，先把"证据"补齐。',
    );
  }

  if (input.studyMinutes > 0 && input.studyMinutes > 60 * 30) {
    suggestions.push(
      '这一周学习时间很长了，注意留出休息和睡眠时间。学习效率和睡眠是正相关的，累的时候硬撑效果会变差。',
    );
  }

  if (suggestions.length === 0) {
    suggestions.push('本周节奏挺稳的，按现在的安排继续就好。');
  }

  return suggestions.slice(0, 5);
}

export { listMasteryWithKnowledgePoint, getAttemptStatsByKnowledgePoint };
export const ALL_ERROR_TYPES = Object.keys(ERROR_TYPES) as ErrorType[];
