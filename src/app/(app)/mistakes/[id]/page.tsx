import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ArrowLeft,
  BookX,
  CheckCircle2,
  ClipboardList,
  Clock,
  History,
  MessageCircle,
  Sparkles,
  XCircle,
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
} from '@/components/ui/primitives';
import { Markdown } from '@/components/markdown';
import { getCurrentUser } from '@/lib/auth/current-user';
import { getQuestionDetail } from '@/lib/questions/service';
import {
  ATTEMPT_CONTEXTS,
  errorTypeLabel,
  INDEPENDENCE_LEVELS,
  masteryLabel,
  REVIEW_RESULTS,
  WRONG_RECORD_STATUSES,
} from '@/lib/domain/enums';
import { formatDate, formatDateTime } from '@/lib/utils';
import { ErrorTypeEditor } from '@/components/mistakes/error-type-editor';
import { ReviewPanel } from '@/components/mistakes/review-panel';

export const metadata: Metadata = { title: '错题详情' };

export default async function MistakeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  // 题目不存在 / 不属于当前用户时不抛错，给一个能走下去的页面
  const detail = await getQuestionDetail(user.id, id).catch(() => null);

  if (!detail) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/mistakes">
            <ArrowLeft aria-hidden />
            返回错题本
          </Link>
        </Button>
        <EmptyState
          icon={<BookX aria-hidden />}
          title="没有找到这道题"
          description="它可能已经被归档，或者这个链接不属于你。可以回到错题本重新选择。"
          action={
            <Button asChild>
              <Link href="/mistakes">打开错题本</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const { question, attempts, wrongRecord, reviewHistory } = detail;
  const choices = question.choices ?? [];
  const nextReview = wrongRecord?.nextReviewAt ? new Date(wrongRecord.nextReviewAt) : null;
  const isDue = nextReview ? nextReview.getTime() <= Date.now() : false;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/mistakes">
            <ArrowLeft aria-hidden />
            返回错题本
          </Link>
        </Button>
        <Button asChild>
          <Link href={`/tutor?questionId=${question.id}`}>
            <MessageCircle aria-hidden />
            让 AI 帮我复盘
          </Link>
        </Button>
      </div>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{question.subjectName || '未标学科'}</Badge>
          {wrongRecord ? (
            <Badge
              variant={
                wrongRecord.status === 'resolved'
                  ? 'success'
                  : wrongRecord.status === 'needs-review'
                    ? 'warning'
                    : 'default'
              }
            >
              {WRONG_RECORD_STATUSES[wrongRecord.status as keyof typeof WRONG_RECORD_STATUSES] ??
                wrongRecord.status}
            </Badge>
          ) : null}
          {isDue ? <Badge variant="warning">今天该复习</Badge> : null}
          {question.grade ? <Badge variant="outline">{question.grade}</Badge> : null}
        </div>
        <h1 className="text-xl font-semibold leading-relaxed sm:text-2xl">
          {question.chapter ? `${question.chapter} · ` : ''}
          错题详情
        </h1>
      </header>

      {/* 题目 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList aria-hidden className="size-4 text-primary" />
            题目
          </CardTitle>
          <CardDescription>
            录入于 {formatDate(question.createdAt)}
            {question.sourceNote ? ` · 来源：${question.sourceNote}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {question.imageUrl ? (
            <div className="overflow-hidden rounded-lg border">
              {/* 题目图片保存在受保护的目录里，只能通过带鉴权的 /api/files 读取 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={question.imageUrl}
                alt="本题的原图"
                loading="lazy"
                className="max-h-[28rem] w-full object-contain"
              />
            </div>
          ) : null}

          {question.stem ? (
            question.stemFormat === 'markdown' || question.stemFormat === 'latex' ? (
              <Markdown>{question.stem}</Markdown>
            ) : (
              <p className="whitespace-pre-wrap text-[15px] leading-7">{question.stem}</p>
            )
          ) : (
            <p className="text-sm text-muted-foreground">题干还没有录入。</p>
          )}

          {choices.length > 0 ? (
            <ul className="space-y-1.5">
              {choices.map((choice) => (
                <li key={choice} className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                  {choice}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">我当时的答案</p>
              <p className="mt-1 text-sm">{wrongRecord?.studentAnswer || '（没有记录）'}</p>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">正确答案</p>
              <p className="mt-1 text-sm">{question.correctAnswer || '（还没有填写）'}</p>
            </div>
          </div>

          {question.explanation ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">解析</p>
              <div className="rounded-lg border bg-muted/30 p-3">
                <Markdown>{question.explanation}</Markdown>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              这道题还没有解析。可以点上面的「让 AI 帮我复盘」，让 AI 带着你一步步想。
            </p>
          )}
        </CardContent>
      </Card>

      {/* 错误原因（可编辑） */}
      <Card>
        <CardHeader>
          <CardTitle>错误原因</CardTitle>
          <CardDescription>
            这里的判断可能来自 AI 分析，也可能是你自己标的。都可以改 —— 你的判断更重要。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ErrorTypeEditor
            questionId={question.id}
            initial={wrongRecord?.errorTypes ?? []}
            editedByUser={wrongRecord?.editedByUser}
            confidenceNote={question.mistake?.confidenceNote}
          />

          {wrongRecord?.likelyCauses && wrongRecord.likelyCauses.length > 0 ? (
            <div className="mt-4 space-y-1.5">
              <p className="text-sm font-medium">分析给出的可能原因</p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {wrongRecord.likelyCauses.map((cause) => (
                  <li key={cause}>{cause}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* 知识点 */}
      <Card>
        <CardHeader>
          <CardTitle>关联知识点</CardTitle>
          <CardDescription>掌握度是按知识点估计的，关联越准，诊断越有用</CardDescription>
        </CardHeader>
        <CardContent>
          {question.knowledgePoints.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              还没有关联知识点。可以在录入时选择，或在「知识点地图」里找到对应内容后回来补充。
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {question.knowledgePoints.map((point) => (
                <Link key={point.id} href={`/knowledge/${point.id}`}>
                  <Badge variant={point.isPrimary ? 'default' : 'outline'}>{point.name}</Badge>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 复习操作区 */}
      <Card className="border-primary/20 bg-primary/[0.03]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles aria-hidden className="size-4 text-primary" />
            复习这道题
          </CardTitle>
          <CardDescription>
            {nextReview
              ? isDue
                ? `按计划今天该复习了（原定 ${formatDate(nextReview)}）`
                : `下次复习安排在 ${formatDate(nextReview)}，也可以现在就做`
              : '这道题还没有复习安排，做完这次会建立第一次间隔复习'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ReviewPanel questionId={question.id} />
        </CardContent>
      </Card>

      {/* 作答历史 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History aria-hidden className="size-4 text-primary" />
            作答历史
          </CardTitle>
          <CardDescription>每一次作答都会保留，不会被后来的结果覆盖</CardDescription>
        </CardHeader>
        <CardContent>
          {attempts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              还没有作答记录。上面的复习结果记录之后，这里会留下第一次记录。
            </p>
          ) : (
            <ol className="relative space-y-4 border-l pl-4">
              {attempts.map((attempt) => (
                <li key={attempt.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-primary" aria-hidden />
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={attempt.isCorrect ? 'success' : 'warning'}>
                      {attempt.isCorrect ? '答对' : '答错'}
                    </Badge>
                    <Badge variant="outline">
                      {ATTEMPT_CONTEXTS[attempt.context as keyof typeof ATTEMPT_CONTEXTS] ?? attempt.context}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {INDEPENDENCE_LEVELS[attempt.independence as keyof typeof INDEPENDENCE_LEVELS] ??
                        attempt.independence}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock aria-hidden className="size-3.5" />
                      {formatDateTime(attempt.createdAt)}
                    </span>
                  </div>
                  {attempt.answer ? (
                    <p className="mt-1 text-sm">
                      <span className="text-muted-foreground">当时写的：</span>
                      {attempt.answer}
                    </p>
                  ) : null}
                  {attempt.errorTypes.length > 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      标注的原因：{attempt.errorTypes.map(errorTypeLabel).join('、')}
                    </p>
                  ) : null}
                  {attempt.note ? <p className="mt-1 text-xs text-muted-foreground">{attempt.note}</p> : null}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {/* 复习历史 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 aria-hidden className="size-4 text-primary" />
            复习历史
          </CardTitle>
          <CardDescription>每次复习的结果与间隔都会被追加记录，不会覆盖</CardDescription>
        </CardHeader>
        <CardContent>
          {reviewHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有复习记录。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[26rem] border-collapse text-sm">
                <caption className="sr-only">复习历史记录</caption>
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th scope="col" className="px-2 py-2 font-medium">
                      时间
                    </th>
                    <th scope="col" className="px-2 py-2 font-medium">
                      结果
                    </th>
                    <th scope="col" className="px-2 py-2 font-medium">
                      间隔
                    </th>
                    <th scope="col" className="px-2 py-2 font-medium">
                      难度系数
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {reviewHistory.map((entry, index) => (
                    <tr key={`${entry.at}-${index}`} className="border-b last:border-0">
                      <td className="px-2 py-2 text-muted-foreground">{formatDateTime(entry.at)}</td>
                      <td className="px-2 py-2">
                        {REVIEW_RESULTS[entry.result as keyof typeof REVIEW_RESULTS] ?? entry.result}
                      </td>
                      <td className="px-2 py-2">{entry.intervalDays} 天</td>
                      <td className="px-2 py-2 text-muted-foreground">{entry.easeFactor.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {wrongRecord?.lastReviewedAt ? (
        <Alert variant="muted">
          <p className="flex items-center gap-2">
            <Clock aria-hidden className="size-4" />
            上次复习：{formatDateTime(wrongRecord.lastReviewedAt)} ·
            结果：
            {REVIEW_RESULTS[wrongRecord.lastReviewResult as keyof typeof REVIEW_RESULTS] ??
              wrongRecord.lastReviewResult ??
              '未记录'}
            · 累计作答 {wrongRecord.attemptCount} 次（其中答对 {wrongRecord.correctCount} 次）
          </p>
        </Alert>
      ) : null}

      <Card className="border-dashed bg-muted/30">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <XCircle aria-hidden className="size-4 text-warning" />
            这道题每次的掌握度变化都会记在知识点的诊断里，可以和其它错题一起看。
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link href="/knowledge">打开知识点地图</Link>
          </Button>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        小提示：掌握程度的描述用的是「{masteryLabel('learning')}」「{masteryLabel('basic')}」这类词语，
        只表示「现在到哪一步了」，不是评价你这个人。
      </p>
    </div>
  );
}
