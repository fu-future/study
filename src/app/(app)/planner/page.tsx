import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CalendarDays, CheckCircle2, Clock, Info, Moon, Target } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Progress,
} from '@/components/ui/primitives';
import { getCurrentUser } from '@/lib/auth/current-user';
import { getStudentProfile, toProfileView } from '@/lib/repositories/users.repository';
import { listPlanTasks, listStudyPlans, toPlanView } from '@/lib/repositories/plans.repository';
import {
  planTypeLabel,
  taskTypeLabel,
  TASK_STATUSES,
} from '@/lib/domain/enums';
import { formatDate, formatMinutes } from '@/lib/utils';
import { PlanGenerateButtons } from '@/components/planner/plan-generate-buttons';
import { CompleteTaskDialog } from '@/components/planner/complete-task-dialog';

export const metadata: Metadata = { title: '学习计划' };

/** 单个计划任务的视图类型（来自 repository 的 include 结果）。 */
type PlanTask = Awaited<ReturnType<typeof listPlanTasks>>[number];

function statusVariant(status: string): 'default' | 'secondary' | 'outline' | 'success' | 'warning' {
  switch (status) {
    case 'completed':
      return 'success';
    case 'in-progress':
      return 'default';
    case 'skipped':
      return 'outline';
    case 'rescheduled':
      return 'warning';
    default:
      return 'secondary';
  }
}

function priorityLabel(priority: number): string {
  if (priority >= 5) return '最优先';
  if (priority === 4) return '较优先';
  if (priority === 3) return '常规';
  return '可以缓一缓';
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function PlannerPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const profile = toProfileView(await getStudentProfile(user.id));
  const plans = await listStudyPlans(user.id, { limit: 10 });
  const activePlan = plans.find((plan) => plan.status === 'active') ?? null;
  const tasks: PlanTask[] = activePlan ? await listPlanTasks(activePlan.id) : [];

  const rationale = activePlan ? toPlanView(activePlan).rationale : {};
  const notes = Array.isArray(rationale.notes)
    ? rationale.notes.filter((note): note is string => typeof note === 'string')
    : [];
  const rationaleNumbers = {
    examDaysLeft: typeof rationale.examDaysLeft === 'number' ? rationale.examDaysLeft : null,
    weakPointCount: typeof rationale.weakPointCount === 'number' ? rationale.weakPointCount : null,
    dueReviewCount: typeof rationale.dueReviewCount === 'number' ? rationale.dueReviewCount : null,
    unfinishedCount: typeof rationale.unfinishedCount === 'number' ? rationale.unfinishedCount : null,
  };

  // 按天分组（任务排期以 UTC 零点为准）
  const tasksByDay = new Map<string, PlanTask[]>();
  for (const task of tasks) {
    const key = dayKey(task.scheduledDate);
    const bucket = tasksByDay.get(key);
    if (bucket) bucket.push(task);
    else tasksByDay.set(key, [task]);
  }

  function availableMinutesFor(date: Date): number {
    const isWeekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
    if (isWeekend) return profile.weekendAvailableMinutes ?? profile.dailyAvailableMinutes;
    return profile.weekdayAvailableMinutes ?? profile.dailyAvailableMinutes;
  }

  const days = [...tasksByDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  const completedCount = tasks.filter((task) => task.status === 'completed').length;
  const totalMinutes = tasks.reduce((sum, task) => sum + task.estimatedMinutes, 0);

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">学习计划</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          计划会按你每天真正空出来的时间来排。任务超出可用时间会被自动减掉，
          而不是堆在列表里让你觉得「做不完」。
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">生成计划</CardTitle>
          <CardDescription>
            根据薄弱知识点、到期复习、考试日期和你最近两周的完成情况生成
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PlanGenerateButtons hasPlan={Boolean(activePlan)} />
        </CardContent>
      </Card>

      {!activePlan ? (
        <EmptyState
          icon={<CalendarDays aria-hidden />}
          title="还没有学习计划"
          description="点上面的「生成今日计划」或「生成本周计划」，系统会按你的可用时间排一份出来。如果目前没有错题和练习记录，计划会比较简单 —— 那也正常。"
          action={<PlanGenerateButtons hasPlan={false} />}
        />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target aria-hidden className="size-4 text-primary" />
                {activePlan.title}
              </CardTitle>
              <CardDescription>
                {planTypeLabel(activePlan.planType)} ·{' '}
                {TASK_STATUSES[activePlan.status as keyof typeof TASK_STATUSES] ?? activePlan.status} ·{' '}
                {formatDate(activePlan.startDate)} – {formatDate(activePlan.endDate)}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {activePlan.goal ? (
                <p className="text-sm">
                  <span className="text-muted-foreground">这次的目标：</span>
                  {activePlan.goal}
                </p>
              ) : null}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-lg border bg-card p-3">
                  <p className="text-xs text-muted-foreground">任务数</p>
                  <p className="mt-1 text-sm font-medium">
                    {tasks.length} 个（已完成 {completedCount} 个）
                  </p>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <p className="text-xs text-muted-foreground">计划时长</p>
                  <p className="mt-1 text-sm font-medium">{formatMinutes(totalMinutes)}</p>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <p className="text-xs text-muted-foreground">每天可用</p>
                  <p className="mt-1 text-sm font-medium">
                    {formatMinutes(profile.weekdayAvailableMinutes ?? profile.dailyAvailableMinutes)}
                  </p>
                </div>
              </div>

              {notes.length > 0 ? (
                <Alert variant="muted" title="计划是怎么排的">
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </Alert>
              ) : null}

              <div className="flex flex-wrap gap-2 text-xs">
                {rationaleNumbers.examDaysLeft !== null ? (
                  <Badge variant="outline">距考试 {rationaleNumbers.examDaysLeft} 天</Badge>
                ) : null}
                {rationaleNumbers.weakPointCount !== null ? (
                  <Badge variant="outline">薄弱知识点 {rationaleNumbers.weakPointCount} 个</Badge>
                ) : null}
                {rationaleNumbers.dueReviewCount !== null ? (
                  <Badge variant="outline">到期复习 {rationaleNumbers.dueReviewCount} 项</Badge>
                ) : null}
                {rationaleNumbers.unfinishedCount !== null ? (
                  <Badge variant="outline">顺延任务 {rationaleNumbers.unfinishedCount} 项</Badge>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {tasks.length === 0 ? (
            <EmptyState
              icon={<Info aria-hidden />}
              title="这份计划里还没有任务"
              description="目前没有需要安排的内容。可以先录入几道错题，或者去知识点地图挑一个想补的地方，再重新生成计划。"
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button asChild variant="outline">
                    <Link href="/mistakes">去错题本</Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href="/knowledge">去知识点地图</Link>
                  </Button>
                </div>
              }
            />
          ) : (
            <div className="space-y-4">
              {days.map(([key, dayTasks]) => {
                const date = new Date(`${key}T00:00:00.000Z`);
                const planned = dayTasks.reduce((sum, task) => sum + task.estimatedMinutes, 0);
                const available = availableMinutesFor(date);
                const over = planned > available;

                return (
                  <Card key={key}>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <CalendarDays aria-hidden className="size-4 text-primary" />
                        {formatDate(date)}
                        <span className="text-xs font-normal text-muted-foreground">
                          {dayTasks.length} 个任务
                        </span>
                      </CardTitle>
                      <CardDescription>
                        安排了 {formatMinutes(planned)} / 可用 {formatMinutes(available)}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <Progress
                        value={planned}
                        max={available}
                        tone={over ? 'warning' : 'primary'}
                        label={`${formatDate(date)} 已安排时间与可用时间的对比`}
                      />
                      {over ? (
                        <p className="text-xs text-warning">
                          这天的安排超过了你自己设置的可用时间。可以把某个任务改到别的日子，或者跳过其中一个 ——
                          实在做不完，少做一点比熬夜补更划算。
                        </p>
                      ) : null}

                      <ul className="space-y-2">
                        {dayTasks.map((task) => (
                          <li key={task.id} className="rounded-lg border bg-card p-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0 space-y-1">
                                <p className="text-sm font-medium">{task.title}</p>
                                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                  {task.subject ? <Badge variant="secondary">{task.subject.name}</Badge> : null}
                                  <Badge variant="outline">{taskTypeLabel(task.taskType)}</Badge>
                                  <Badge variant={statusVariant(task.status)}>
                                    {TASK_STATUSES[task.status as keyof typeof TASK_STATUSES] ?? task.status}
                                  </Badge>
                                  <Badge variant="outline">{priorityLabel(task.priority)}</Badge>
                                  <span className="flex items-center gap-1">
                                    <Clock aria-hidden className="size-3.5" />
                                    {formatMinutes(task.estimatedMinutes)}
                                  </span>
                                </div>
                              </div>
                              {task.status !== 'completed' ? (
                                <CompleteTaskDialog
                                  taskId={task.id}
                                  taskTitle={task.title}
                                  estimatedMinutes={task.estimatedMinutes}
                                />
                              ) : (
                                <Badge variant="success">
                                  <CheckCircle2 aria-hidden className="size-3.5" />
                                  已完成
                                </Badge>
                              )}
                            </div>

                            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                              <span className="text-foreground">为什么安排它：</span>
                              {task.reason}
                            </p>

                            {task.completionCriteria ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                完成条件：{task.completionCriteria}
                              </p>
                            ) : null}

                            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                              {task.knowledgePoint ? (
                                <Link
                                  href={`/knowledge/${task.knowledgePoint.id}`}
                                  className="text-primary underline underline-offset-2"
                                >
                                  {task.knowledgePoint.name}
                                </Link>
                              ) : null}
                              {task.knowledgePoint?.chapterPath ? (
                                <span className="text-muted-foreground">{task.knowledgePoint.chapterPath}</span>
                              ) : null}
                              {task.actualMinutes !== null ? (
                                <span className="text-muted-foreground">
                                  实际用时 {formatMinutes(task.actualMinutes)}
                                </span>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {plans.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">历史计划</CardTitle>
            <CardDescription>之前的计划会保留，方便回头看当时是怎么安排的</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {plans.map((plan) => (
                <li key={plan.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm">
                      {plan.title}
                      {plan.id === activePlan?.id ? (
                        <Badge variant="default" className="ml-2">
                          当前
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {planTypeLabel(plan.planType)} · {formatDate(plan.startDate)} –{' '}
                      {formatDate(plan.endDate)} · {formatMinutes(plan.plannedMinutes)}
                    </p>
                  </div>
                  <Badge variant="outline">
                    {TASK_STATUSES[plan.status as keyof typeof TASK_STATUSES] ?? plan.status}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Alert variant="muted" title="关于休息">
        <p className="flex items-start gap-2">
          <Moon aria-hidden className="mt-0.5 size-4 shrink-0" />
          计划只会用掉你填的可用时间，不会要求你熬夜或压缩睡眠。如果某天状态不好，
          少做一两项也完全可以 —— 计划明天会重新排。
        </p>
      </Alert>
    </div>
  );
}
