import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  BookX,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Clock,
  Info,
  MessageCircle,
  Network,
  Sparkles,
  TrendingUp,
  Upload,
} from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  EmptyState,
  Progress,
} from '@/components/ui/primitives';
import { getCurrentUser } from '@/lib/auth/current-user';
import { getStudentProfile, toProfileView } from '@/lib/repositories/users.repository';
import { getSubjectNameMap } from '@/lib/repositories/subjects.repository';
import {
  getTaskStats,
  listRecentSessions,
  listStudyTasks,
  sumStudyMinutes,
} from '@/lib/repositories/plans.repository';
import { listDueReviews } from '@/lib/repositories/review.repository';
import { getMasteryDistribution, listWeakMastery } from '@/lib/repositories/mastery.repository';
import { getWrongRecordStats } from '@/lib/repositories/mistakes.repository';
import { getAttemptStats } from '@/lib/repositories/questions.repository';
import { MASTERY_ORDER, masteryLabel, taskTypeLabel } from '@/lib/domain/enums';
import { addDays, formatDate, formatMinutes, formatPercent, formatRelative, startOfTodayUtc } from '@/lib/utils';

export const metadata: Metadata = { title: '学习仪表盘' };

/**
 * 学习仪表盘。
 *
 * 数据全部来自真实记录（任务 / 作答 / 复习计划 / 掌握度估计），
 * **没有数据的地方就显示「还没有记录」，绝不补一条好看的曲线**。
 *
 * 本周三个指标刻意分开显示 —— 学习时间、任务完成率、练习正确率是三种不同的东西，
 * 合在一起会让人误以为「时间花够了就等于学好了」。
 */
export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const profile = toProfileView(await getStudentProfile(user.id));
  if (!profile.onboardingCompleted) redirect('/onboarding');

  const today = startOfTodayUtc();
  const tomorrow = addDays(today, 1);
  // 本周一 00:00（UTC 归一，与任务排期口径一致）
  const weekStart = addDays(today, -((today.getUTCDay() + 6) % 7));

  const [
    todayTasks,
    dueReviews,
    weakPoints,
    distribution,
    mistakeStats,
    weekTaskStats,
    weekMinutes,
    weekAttempts,
    recentSessions,
    subjectNames,
  ] = await Promise.all([
    listStudyTasks(user.id, { from: today, to: tomorrow }),
    listDueReviews(user.id, { limit: 5 }),
    listWeakMastery(user.id, { limit: 5 }),
    getMasteryDistribution(user.id),
    getWrongRecordStats(user.id),
    getTaskStats(user.id, { from: weekStart, to: tomorrow }),
    sumStudyMinutes(user.id, { from: weekStart, to: new Date() }),
    getAttemptStats(user.id, { since: weekStart }),
    listRecentSessions(user.id, 6),
    getSubjectNameMap(),
  ]);

  const completedToday = todayTasks.filter((task) => task.status === 'completed');
  const pendingToday = todayTasks.filter((task) => task.status !== 'completed' && task.status !== 'skipped');
  const masteryTotal = MASTERY_ORDER.reduce((sum, level) => sum + (distribution[level] ?? 0), 0);
  const evaluatedCount = masteryTotal - (distribution.unevaluated ?? 0);

  const weekCompletionRate = weekTaskStats.total > 0 ? weekTaskStats.completed / weekTaskStats.total : null;
  const weekAccuracy = weekAttempts.total > 0 ? weekAttempts.correct / weekAttempts.total : null;
  const weekAvailableMinutes = Math.max(
    1,
    (profile.weekdayAvailableMinutes ?? profile.dailyAvailableMinutes) * 5 +
      (profile.weekendAvailableMinutes ?? profile.dailyAvailableMinutes) * 2,
  );

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">
          {user.displayName}，今天好
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {profile.grade ? `${profile.grade} · ` : ''}
          今天安排可做的事情，按顺序来就行；做不完也没关系，计划明天会重新排。
        </p>
        {profile.studyGoal ? (
          <p className="text-sm text-muted-foreground">
            你写下的目标：<span className="text-foreground">{profile.studyGoal}</span>
          </p>
        ) : null}
      </header>

      {/* 快速入口 */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium">有题不会？直接问</p>
              <p className="text-sm text-muted-foreground">AI 会跟着你的思路一步步引导，不直接甩答案。</p>
            </div>
            <Button asChild>
              <Link href="/tutor">
                <MessageCircle aria-hidden />
                去提问
              </Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium">把错的题拍下来</p>
              <p className="text-sm text-muted-foreground">整理成错题本，之后按间隔安排复习。</p>
            </div>
            <Button asChild variant="outline">
              <Link href="/mistakes">
                <Upload aria-hidden />
                上传错题
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* 今日任务 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays aria-hidden className="size-4 text-primary" />
            今日学习任务
          </CardTitle>
          <CardDescription>
            {todayTasks.length === 0
              ? '今天还没有安排任务'
              : `共 ${todayTasks.length} 项，已完成 ${completedToday.length} 项`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {todayTasks.length === 0 ? (
            <EmptyState
              icon={<CalendarDays aria-hidden />}
              title="今天还没有任务"
              description="可以去「学习计划」里按你的可用时间生成一份今日安排；也可以先浏览知识点地图，挑一个想补的地方。"
              action={
                <Button asChild>
                  <Link href="/planner">去生成今日计划</Link>
                </Button>
              }
            />
          ) : (
            <>
              {pendingToday.length > 0 ? (
                <ul className="space-y-2">
                  {pendingToday.slice(0, 5).map((task) => (
                    <li
                      key={task.id}
                      className="flex items-start gap-3 rounded-lg border bg-card p-3"
                    >
                      <CircleDashed aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-medium">{task.title}</p>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {task.subjectId && subjectNames.get(task.subjectId) ? (
                            <Badge variant="secondary">{subjectNames.get(task.subjectId)}</Badge>
                          ) : null}
                          <Badge variant="outline">{taskTypeLabel(task.taskType)}</Badge>
                          <span className="flex items-center gap-1">
                            <Clock aria-hidden className="size-3.5" />
                            约 {formatMinutes(task.estimatedMinutes)}
                          </span>
                        </div>
                        <p className="text-xs leading-relaxed text-muted-foreground">{task.reason}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}

              {completedToday.length > 0 ? (
                <details className="rounded-lg border bg-muted/30 p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    今天已完成 {completedToday.length} 项
                  </summary>
                  <ul className="mt-2 space-y-1.5">
                    {completedToday.map((task) => (
                      <li key={task.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CheckCircle2 aria-hidden className="size-4 shrink-0 text-success" />
                        <span className="truncate">{task.title}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          )}
        </CardContent>
        <CardFooter className="justify-between">
          <p className="text-xs text-muted-foreground">完成后在「学习计划」里标记，才算真正完成。</p>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/planner">
              查看全部
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        </CardFooter>
      </Card>

      {/* 本周进度：三个指标分开 */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">本周学习时长</CardTitle>
            <CardDescription>来自你实际记录的学习时段</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {weekMinutes.sessions === 0 ? (
              <p className="text-sm text-muted-foreground">本周还没有记录学习时长。</p>
            ) : (
              <>
                <p className="text-2xl font-semibold">{formatMinutes(weekMinutes.totalMinutes)}</p>
                <Progress
                  value={weekMinutes.totalMinutes}
                  max={weekAvailableMinutes}
                  tone={weekMinutes.totalMinutes > weekAvailableMinutes ? 'warning' : 'primary'}
                  label="本周学习时长与你可用时间的对比"
                />
                <p className="text-xs text-muted-foreground">
                  {weekMinutes.sessions} 次记录 · 你设置的可用时间约每周 {formatMinutes(weekAvailableMinutes)}
                  {weekMinutes.totalMinutes > weekAvailableMinutes ? '（已经超出，注意休息）' : ''}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">本周任务完成率</CardTitle>
            <CardDescription>只统计计划里排到本周的任务</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {weekCompletionRate === null ? (
              <p className="text-sm text-muted-foreground">本周还没有安排任务，暂时算不出完成率。</p>
            ) : (
              <>
                <p className="text-2xl font-semibold">{formatPercent(weekCompletionRate)}</p>
                <Progress value={weekCompletionRate * 100} label="本周任务完成率" />
                <p className="text-xs text-muted-foreground">
                  完成 {weekTaskStats.completed} / {weekTaskStats.total} 项
                  {weekTaskStats.skipped > 0 ? ` · 跳过 ${weekTaskStats.skipped} 项` : ''}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">本周练习正确率</CardTitle>
            <CardDescription>来自你的真实作答记录</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {weekAccuracy === null ? (
              <p className="text-sm text-muted-foreground">本周还没有练习记录，先去错题本或知识点页做几道题吧。</p>
            ) : (
              <>
                <p className="text-2xl font-semibold">{formatPercent(weekAccuracy)}</p>
                <Progress
                  value={weekAccuracy * 100}
                  tone={weekAccuracy >= 0.7 ? 'success' : 'primary'}
                  label="本周练习正确率"
                />
                <p className="text-xs text-muted-foreground">
                  答对 {weekAttempts.correct} / {weekAttempts.total} 题
                  {weekAttempts.total < 5 ? ' · 记录还少，参考价值有限' : ''}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* 待复习错题 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookX aria-hidden className="size-4 text-primary" />
              待复习的错题
            </CardTitle>
            <CardDescription>
              {mistakeStats.total === 0
                ? '错题本还是空的'
                : `错题本共 ${mistakeStats.total} 道，今天该复习 ${mistakeStats.due} 道`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {dueReviews.length === 0 ? (
              <EmptyState
                icon={<BookX aria-hidden />}
                title={mistakeStats.total === 0 ? '还没有错题记录' : '今天没有到期的复习'}
                description={
                  mistakeStats.total === 0
                    ? '把做错的题拍下来或手动录入，系统会按 1 天、3 天、7 天… 的间隔提醒你复习。'
                    : '按间隔复习安排，今天的复习都完成了。新录入的错题会自动排进日程。'
                }
                action={
                  <Button asChild variant="outline">
                    <Link href="/mistakes">打开错题本</Link>
                  </Button>
                }
              />
            ) : (
              <ul className="space-y-2">
                {dueReviews.map((review) => {
                  const item = review.wrongAnswerRecord;
                  const questionId = item?.question.id;
                  return (
                    <li key={review.id} className="rounded-lg border bg-card p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {item?.question.stem
                              ? item.question.stem.replace(/\s+/g, ' ').slice(0, 48)
                              : review.knowledgePoint?.name
                                ? `复习知识点：${review.knowledgePoint.name}`
                                : '待复习内容'}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            到期时间：{formatDate(review.dueAt)}
                          </p>
                        </div>
                        {questionId ? (
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/mistakes/${questionId}`}>
                              去复习
                              <ChevronRight aria-hidden />
                            </Link>
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* 薄弱知识点 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp aria-hidden className="size-4 text-primary" />
              最近发现的薄弱知识点
            </CardTitle>
            <CardDescription>只看已经有真实作答证据的，不做无根据的猜测</CardDescription>
          </CardHeader>
          <CardContent>
            {weakPoints.length === 0 ? (
              <EmptyState
                icon={<Network aria-hidden />}
                title="暂时没有可以判断的薄弱点"
                description={
                  evaluatedCount === 0
                    ? '还没有足够的作答记录。做几道题之后，这里会显示哪些知识点需要再补一补。'
                    : '目前没有被标记为「正在学习 / 初步掌握」的知识点。想主动加练的话，可以去知识点地图挑一个。'
                }
                action={
                  <Button asChild variant="outline">
                    <Link href="/knowledge">打开知识点地图</Link>
                  </Button>
                }
              />
            ) : (
              <ul className="space-y-2">
                {weakPoints.map((row) => (
                  <li key={row.id} className="rounded-lg border bg-card p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link
                        href={`/knowledge/${row.knowledgePointId}`}
                        className="text-sm font-medium text-primary underline underline-offset-2"
                      >
                        {row.knowledgePoint.name}
                      </Link>
                      <div className="flex items-center gap-2">
                        <Badge variant={row.level === 'initial' ? 'warning' : 'secondary'}>
                          {masteryLabel(row.level)}
                        </Badge>
                        {row.recentAccuracy !== null && row.recentSampleSize > 0 ? (
                          <span className="text-xs text-muted-foreground">
                            近 {row.recentSampleSize} 次正确率 {formatPercent(row.recentAccuracy)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {row.knowledgePoint.chapterPath}
                    </p>
                    {row.nextAction ? (
                      <p className="mt-1 text-xs leading-relaxed text-foreground">{row.nextAction}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 掌握度分布 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">知识掌握估计分布</CardTitle>
          <CardDescription>
            这是算法根据你的作答记录给出的估计，只统计已经有评估记录的知识点
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {evaluatedCount === 0 ? (
            <Alert variant="muted" title="还没有可以统计的掌握度记录">
              <p>
                掌握程度只在你有真实作答之后才会产生。可以先从错题本或知识点地图挑几道题练手 ——
                有了证据，这里的数字才有意义。
              </p>
            </Alert>
          ) : (
            <>
              <ul className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {MASTERY_ORDER.map((level) => (
                  <li key={level} className="rounded-lg border bg-card p-3 text-center">
                    <p className="text-lg font-semibold">{distribution[level] ?? 0}</p>
                    <p className="text-xs text-muted-foreground">{masteryLabel(level)}</p>
                  </li>
                ))}
              </ul>
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                「证据不足」表示练习次数还不够，系统不会为了好看而给出一个结论。
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* 最近学习记录 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock aria-hidden className="size-4 text-primary" />
            最近学习记录
          </CardTitle>
          <CardDescription>来自你自己记录的学习时段与完成任务</CardDescription>
        </CardHeader>
        <CardContent>
          {recentSessions.length === 0 ? (
            <EmptyState
              icon={<Clock aria-hidden />}
              title="还没有学习记录"
              description="完成任务时填一下实际用时，这里就会留下记录。想手动记一笔也可以在学习计划里完成任意一个任务。"
              action={
                <Button asChild variant="outline">
                  <Link href="/planner">去学习计划</Link>
                </Button>
              }
            />
          ) : (
            <ul className="divide-y">
              {recentSessions.map((session) => (
                <li key={session.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm">
                      {session.subjectId ? subjectNames.get(session.subjectId) ?? '学习' : '学习'}
                      {session.note ? ` · ${session.note}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">{formatRelative(session.startedAt)}</p>
                  </div>
                  <Badge variant="secondary">{formatMinutes(session.durationMinutes)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="border-dashed bg-muted/30">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles aria-hidden className="size-4 text-primary" />
            想更清楚地看这一周的节奏？学习报告里会把证据和不确定的地方都写出来。
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link href="/reports">打开学习报告</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
