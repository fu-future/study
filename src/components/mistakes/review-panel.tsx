'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, CircleDashed, HelpCircle, RefreshCw, XCircle } from 'lucide-react';
import { Alert, Button, Field, Input, Select } from '@/components/ui/primitives';
import {
  INDEPENDENCE_LEVELS,
  masteryLabel,
  type Independence,
  type ReviewResult,
} from '@/lib/domain/enums';
import { apiPost, toUserMessage, type ReviewOutcomeDto } from '@/lib/client-api';
import { cn, formatDate, formatPercent } from '@/lib/utils';

/**
 * 复习操作区。
 *
 * 三个按钮分别对应「做对了 / 部分对 / 做错了」——这是间隔复习算法的核心输入，
 * 所以按钮文案刻意不说「对/错」，减少非黑即白的压力。
 *
 * 「是否独立完成」也必须问：看了解析才做对，不能算作掌握。
 */

const RESULT_OPTIONS: {
  value: ReviewResult;
  label: string;
  hint: string;
  icon: React.ReactNode;
}[] = [
  {
    value: 'correct',
    label: '做对了',
    hint: '能自己讲出思路',
    icon: <CheckCircle2 aria-hidden className="size-4" />,
  },
  {
    value: 'partial',
    label: '部分对',
    hint: '方向对，但中间有卡住',
    icon: <CircleDashed aria-hidden className="size-4" />,
  },
  {
    value: 'wrong',
    label: '做错了',
    hint: '还是没能做出来',
    icon: <XCircle aria-hidden className="size-4" />,
  },
];

export function ReviewPanel({ questionId }: { questionId: string }) {
  const router = useRouter();
  const [result, setResult] = React.useState<ReviewResult | null>(null);
  const [independence, setIndependence] = React.useState<Independence>('independent');
  const [answer, setAnswer] = React.useState('');
  const [timeSpent, setTimeSpent] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [outcome, setOutcome] = React.useState<ReviewOutcomeDto | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!result) {
      setError('请先选一个这次复习的结果。');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const data = await apiPost<ReviewOutcomeDto>(`/api/questions/${questionId}/review`, {
        result,
        independence,
        answer: answer.trim() || null,
        timeSpentSeconds: timeSpent ? Number(timeSpent) : null,
      });
      setOutcome(data);
      setAnswer('');
      setTimeSpent('');
      // 让服务端的作答历史 / 复习历史重新取一遍
      router.refresh();
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <fieldset>
          <legend className="text-sm font-medium">这次复习的结果</legend>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {RESULT_OPTIONS.map((option) => {
              const active = result === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setResult(option.value)}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors',
                    active ? 'border-primary/40 bg-primary/10' : 'hover:bg-muted',
                  )}
                >
                  <span
                    className={cn(
                      'flex items-center gap-2 text-sm font-medium',
                      active ? 'text-primary' : undefined,
                    )}
                  >
                    {option.icon}
                    {option.label}
                  </span>
                  <span className="text-xs text-muted-foreground">{option.hint}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="这次是怎么做出来的"
            htmlFor="review-independence"
            hint="看了解析才做对，和独立做对，在掌握度上是两件不同的事"
          >
            <Select
              id="review-independence"
              value={independence}
              onChange={(event) => setIndependence(event.target.value as Independence)}
            >
              {Object.entries(INDEPENDENCE_LEVELS).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="这次用的时间（秒，可选）"
            htmlFor="review-time"
            hint="大概写一下就好，用来估计你真正熟练的速度"
          >
            <Input
              id="review-time"
              type="number"
              min={0}
              max={36000}
              value={timeSpent}
              onChange={(event) => setTimeSpent(event.target.value)}
            />
          </Field>
        </div>

        <Field
          label="这次写的答案（可选）"
          htmlFor="review-answer"
          hint="写下来方便以后回看，也能帮助判断是哪一步出问题"
        >
          <Input
            id="review-answer"
            value={answer}
            maxLength={1000}
            onChange={(event) => setAnswer(event.target.value)}
          />
        </Field>

        {error ? (
          <Alert variant="destructive" title="没有记录成功">
            <p>{error}</p>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" loading={submitting} disabled={!result}>
            <RefreshCw aria-hidden />
            记录这次复习
          </Button>
          <p className="text-xs text-muted-foreground">
            记录后复习间隔会自动调整，做对的话下次会隔得更久。
          </p>
        </div>
      </form>

      {outcome ? (
        <Alert variant="success" title="已记录这次复习">
          <div className="space-y-2">
            {outcome.review ? (
              <p>
                下次复习：
                <span className="font-medium">{formatDate(outcome.review.dueAt)}</span>
                （间隔 {outcome.review.intervalDays} 天
                {outcome.review.overdueDays > 0 ? `，本次已逾期 ${outcome.review.overdueDays} 天` : ''}）
              </p>
            ) : (
              <p>复习时间已经更新，具体安排可以稍后在错题本列表里看到。</p>
            )}

            {outcome.mastery.length > 0 ? (
              <div>
                <p className="font-medium">相关知识点掌握度变化</p>
                <ul className="mt-1 space-y-1">
                  {outcome.mastery.map((row) => (
                    <li key={row.knowledgePointId} className="flex flex-wrap items-center gap-2 text-sm">
                      <span>{row.knowledgePointName}</span>
                      <span className="text-muted-foreground">
                        {masteryLabel(row.level)} · 证据 {row.evidenceCount} 条
                        {row.recentAccuracy !== null ? ` · 近期正确率 ${formatPercent(row.recentAccuracy)}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-muted-foreground">
                  这个估计只反映当前的作答证据，练习次数越多越可靠。
                </p>
              </div>
            ) : (
              <p className="flex items-center gap-1.5 text-sm">
                <HelpCircle aria-hidden className="size-3.5" />
                这道题还没有关联知识点，所以暂时没有掌握度变化。可以在下面补充关联。
              </p>
            )}
          </div>
        </Alert>
      ) : null}
    </div>
  );
}
