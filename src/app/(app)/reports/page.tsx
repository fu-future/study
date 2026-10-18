import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Info,
  Lightbulb,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
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
import { Markdown } from '@/components/markdown';
import { getCurrentUser } from '@/lib/auth/current-user';
import { buildWeeklyReport } from '@/lib/reports/weekly';
import { MASTERY_ORDER, masteryLabel } from '@/lib/domain/enums';
import { formatMinutes, formatPercent } from '@/lib/utils';
import { withQuery } from '@/lib/client-api';

export const metadata: Metadata = { title: '学习报告' };

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const rawOffset = Number(firstValue(params.weekOffset));
  const weekOffset = Number.isFinite(rawOffset) ? Math.min(52, Math.max(0, Math.trunc(rawOffset))) : 0;

  const report = await buildWeeklyReport(user.id, weekOffset);
  const maxDayMinutes = Math.max(1, ...report.studyTime.byDay.map((day) => day.minutes));
  const evaluatedCount = MASTERY_ORDER.reduce((sum, level) => sum + (report.mastery.distribution[level] ?? 0), 0) -
    (report.mastery.distribution.unevaluated ?? 0);

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold">学习报告</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          报告只统计真实发生的事情。数据不够时，这里会直接说「还看不出来」，
          而不是给你一个看起来完整、其实没有依据的数字。
        </p>
      </header>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm font-medium">{report.range.label}</p>
            <p className="text-xs text-muted-foreground">
              {new Date(report.range.from).toLocaleDateString('zh-CN')} 起的一周
            </p>
          </div>
          <div className="flex gap-2">
            {weekOffset < 52 ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={withQuery('/reports', { weekOffset: weekOffset + 1 })} aria-label="看更早一周">
                  <ChevronLeft aria-hidden />
                  更早一周
                </Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled aria-label="已经是最早的可查看周">
                <ChevronLeft aria-hidden />
                更早一周
              </Button>
            )}
            {weekOffset > 0 ? (
              <Button variant="outline" size="sm" asChild>
                <Link
                  href={withQuery('/reports', { weekOffset: weekOffset - 1 === 0 ? '' : weekOffset - 1 })}
                  aria-label="看更晚一周"
                >
                  更晚一周
                  <ChevronRight aria-hidden />
                </Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled aria-label="已经是本周">
                更晚一周
                <ChevronRight aria-hidden />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {!report.hasEnoughData ? (
        <EmptyState
          icon={<BarChart3 aria-hidden />}
          title="这一周还没有足够的数据"
          description="本周没有任务记录，也没有作答记录，所以报告里暂时没有可看的数字。做几道题或者生成一份计划之后，这里就会丰富起来。"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link href="/planner">生成学习计划</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/mistakes">去错题本</Link>
              </Button>
            </div>
          }
        />
      ) : null}

      {/* 指标一：学习时间 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 aria-hidden className="size-4 text-primary" />
            学习时间
          </CardTitle>
          <CardDescription>来自你实际记录的学习时段（完成任务的用时也计在这里）</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {report.studyTime.sessions === 0 ? (
            <p className="text-sm text-muted-foreground">这一周没有记录学习时长。</p>
          ) : (
            <>
              <p className="text-2xl font-semibold">{formatMinutes(report.studyTime.totalMinutes)}</p>
              <p className="text-xs text-muted-foreground">{report.studyTime.sessions} 次记录</p>
              <div className="space-y-1.5">
                {report.studyTime.byDay.map((day) => (
                  <div key={day.date} className="flex items-center gap-3">
                    <span className="w-16 shrink-0 text-xs text-muted-foreground">
                      {new Date(`${day.date}T00:00:00.000Z`).toLocaleDateString('zh-CN', {
                        month: 'numeric',
                        day: 'numeric',
                        timeZone: 'UTC',
                      })}
                    </span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary/70"
                        style={{ width: `${Math.round((day.minutes / maxDayMinutes) * 100)}%` }}
                      />
                    </div>
                    <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
                      {day.minutes > 0 ? formatMinutes(day.minutes) : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 指标二：任务完成情况 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList aria-hidden className="size-4 text-primary" />
            任务完成率
          </CardTitle>
          <CardDescription>只统计计划里排到这一周的任务</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {report.tasks.total === 0 ? (
            <p className="text-sm text-muted-foreground">
              这一周没有安排任务，所以没有完成率可言。
            </p>
          ) : (
            <>
              <p className="text-2xl font-semibold">{formatPercent(report.tasks.completionRate)}</p>
              <Progress value={(report.tasks.completionRate ?? 0) * 100} label="本周任务完成率" />
              <ul className="grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-4">
                <li>共 {report.tasks.total} 项</li>
                <li>已完成 {report.tasks.completed} 项</li>
                <li>待完成 {report.tasks.pending} 项</li>
                <li>已跳过 {report.tasks.skipped} 项</li>
              </ul>
              <p className="text-xs text-muted-foreground">
                计划用时 {formatMinutes(report.tasks.estimatedMinutes)}
                {report.tasks.actualMinutes > 0
                  ? ` · 实际用时 ${formatMinutes(report.tasks.actualMinutes)}`
                  : ''}
              </p>
              {report.tasks.completedList.length > 0 ? (
                <details className="rounded-lg border bg-muted/30 p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    看看这周完成了什么（{report.tasks.completedList.length} 项）
                  </summary>
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {report.tasks.completedList.map((task) => (
                      <li key={task.id}>
                        {task.title} · {formatMinutes(task.minutes)}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {/* 指标三：练习正确率 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp aria-hidden className="size-4 text-primary" />
            练习正确率
          </CardTitle>
          <CardDescription>来自你的真实作答记录，包含练习与错题复习</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {report.practice.total === 0 ? (
            <p className="text-sm text-muted-foreground">这一周还没有作答记录。</p>
          ) : (
            <>
              <p className="text-2xl font-semibold">{formatPercent(report.practice.accuracy)}</p>
              <Progress
                value={(report.practice.accuracy ?? 0) * 100}
                tone={(report.practice.accuracy ?? 0) >= 0.7 ? 'success' : 'primary'}
                label="本周练习正确率"
              />
              <p className="text-xs text-muted-foreground">
                答对 {report.practice.correct} / {report.practice.total} 题
                {report.practice.total < 5 ? ' · 记录还少，先当作参考' : ''}
              </p>

              {report.practice.bySubject.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[20rem] border-collapse text-sm">
                    <caption className="sr-only">分学科的正确率</caption>
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th scope="col" className="px-2 py-2 font-medium">学科</th>
                        <th scope="col" className="px-2 py-2 font-medium">作答</th>
                        <th scope="col" className="px-2 py-2 font-medium">答对</th>
                        <th scope="col" className="px-2 py-2 font-medium">正确率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.practice.bySubject.map((row) => (
                        <tr key={row.subjectId} className="border-b last:border-0">
                          <td className="px-2 py-2">{row.subjectName}</td>
                          <td className="px-2 py-2 text-muted-foreground">{row.total}</td>
                          <td className="px-2 py-2 text-muted-foreground">{row.correct}</td>
                          <td className="px-2 py-2">{formatPercent(row.accuracy)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {/* 指标四：知识掌握估计 */}
      <Card>
        <CardHeader>
          <CardTitle>知识掌握估计</CardTitle>
          <CardDescription>
            这是算法根据作答证据给出的估计，与前三个指标不是同一件事
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {evaluatedCount === 0 ? (
            <p className="text-sm text-muted-foreground">
              这一周还没有产生任何掌握度评估。掌握度只在真实作答之后才会更新。
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {MASTERY_ORDER.map((level) => (
                <li key={level} className="rounded-lg border bg-card p-3 text-center">
                  <p className="text-lg font-semibold">{report.mastery.distribution[level] ?? 0}</p>
                  <p className="text-xs text-muted-foreground">{masteryLabel(level)}</p>
                </li>
              ))}
            </ul>
          )}

          {report.mastery.improved.length > 0 ? (
            <div>
              <p className="text-sm font-medium">这一周有推进的知识点</p>
              <ul className="mt-1.5 space-y-1.5">
                {report.mastery.improved.map((item) => (
                  <li key={item.knowledgePointId} className="flex flex-wrap items-center gap-2 text-sm">
                    <Link
                      href={`/knowledge/${item.knowledgePointId}`}
                      className="text-primary underline underline-offset-2"
                    >
                      {item.name}
                    </Link>
                    <Badge variant="success">{item.levelLabel}</Badge>
                    {item.subjectName ? (
                      <span className="text-xs text-muted-foreground">{item.subjectName}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {report.mastery.needsWork.length > 0 ? (
            <div>
              <p className="text-sm font-medium">还需要再走几步的知识点</p>
              <ul className="mt-1.5 space-y-1.5">
                {report.mastery.needsWork.map((item) => (
                  <li key={item.knowledgePointId} className="text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/knowledge/${item.knowledgePointId}`}
                        className="text-primary underline underline-offset-2"
                      >
                        {item.name}
                      </Link>
                      <Badge variant="warning">{item.levelLabel}</Badge>
                    </div>
                    {item.nextAction ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">{item.nextAction}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {report.mastery.insufficientEvidence > 0 ? (
            <Alert variant="muted">
              <p>
                还有 {report.mastery.insufficientEvidence} 个知识点证据不足，暂时不下结论。
                多做几道相关题目，判断会慢慢变得可靠。
              </p>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* 重复错误 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">重复出现的错误类型</CardTitle>
            <CardDescription>本周答错的作答里标注的错误原因分布</CardDescription>
          </CardHeader>
          <CardContent>
            {report.repeatedErrors.length === 0 ? (
              <p className="text-sm text-muted-foreground">这一周没有记录到重复的错误类型。</p>
            ) : (
              <ul className="space-y-2">
                {report.repeatedErrors.map((item) => {
                  const max = Math.max(...report.repeatedErrors.map((row) => row.count), 1);
                  return (
                    <li key={item.type} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span>{item.label}</span>
                        <span className="text-muted-foreground">{item.count} 次</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-warning/70"
                          style={{ width: `${Math.round((item.count / max) * 100)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* 复习与错题 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">复习与错题概况</CardTitle>
            <CardDescription>间隔复习的执行情况</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ul className="space-y-1.5">
              <li className="flex justify-between">
                <span className="text-muted-foreground">复习计划总数</span>
                <span>{report.review.total}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-muted-foreground">当前到期</span>
                <span>{report.review.dueNow}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-muted-foreground">已完成过至少一次</span>
                <span>{report.review.done}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-muted-foreground">已逾期</span>
                <span>{report.review.overdue}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-muted-foreground">本周安排</span>
                <span>{report.review.scheduledThisWeek}</span>
              </li>
            </ul>

            <div className="border-t pt-3">
              <ul className="space-y-1.5">
                <li className="flex justify-between">
                  <span className="text-muted-foreground">错题总数</span>
                  <span>{report.mistakes.total}</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-muted-foreground">本周新录入</span>
                  <span>{report.mistakes.newThisWeek}</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-muted-foreground">已订正</span>
                  <span>{report.mistakes.resolved}</span>
                </li>
              </ul>
            </div>

            <Button variant="outline" size="sm" asChild>
              <Link href="/mistakes">
                <RefreshCw aria-hidden />
                去错题本复习
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* 下一周建议 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lightbulb aria-hidden className="size-4 text-primary" />
            下一周可以怎么做
          </CardTitle>
          <CardDescription>这些建议由规则生成，每条都能对应到上面的数据</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            {report.suggestions.map((suggestion) => (
              <li key={suggestion}>{suggestion}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* 证据与不确定性 —— 必须展示 */}
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Info aria-hidden className="size-4 text-muted-foreground" />
            这份报告的证据与不确定的地方
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {report.evidenceNotes.map((note) => (
              <li key={note}>
                <Markdown>{note}</Markdown>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
