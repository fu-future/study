'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CalendarPlus, Check, Sparkles } from 'lucide-react';
import { Alert, Button } from '@/components/ui/primitives';
import { apiPost, toUserMessage, type GeneratePlanResultDto } from '@/lib/client-api';
import { formatMinutes } from '@/lib/utils';

/**
 * 生成学习计划的按钮。
 *
 * 计划由规则引擎生成（考虑可用时间、薄弱点、到期复习、考试日期），
 * 所以生成结果是可解释的 —— 生成完会把任务的推荐理由一起展示出来。
 */
export function PlanGenerateButtons({ hasPlan }: { hasPlan: boolean }) {
  const router = useRouter();
  const [pending, setPending] = React.useState<'daily' | 'weekly' | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  async function generate(planType: 'daily' | 'weekly') {
    setPending(planType);
    setError(null);
    setNotice(null);
    try {
      const data = await apiPost<GeneratePlanResultDto>('/api/study-plans/generate', { planType });
      const taskCount = data.tasks?.length ?? 0;
      const total = data.totalMinutes ?? 0;
      const trimmed = data.trimmedCount ?? 0;
      setNotice(
        taskCount === 0
          ? '这次没有生成任务 —— 目前没有需要安排的内容。可以先录入几道错题，或者去知识点地图挑一个想补的地方。'
          : `已生成 ${taskCount} 个任务，共约 ${formatMinutes(total)}${
              trimmed > 0 ? `。有 ${trimmed} 个任务因为超出你可用的时间没有排进来` : ''
            }。`,
      );
      router.refresh();
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void generate('daily')} loading={pending === 'daily'} disabled={pending !== null}>
          {pending === 'daily' ? null : <CalendarPlus aria-hidden />}
          生成今日计划
        </Button>
        <Button
          variant="outline"
          onClick={() => void generate('weekly')}
          loading={pending === 'weekly'}
          disabled={pending !== null}
        >
          {pending === 'weekly' ? null : <Sparkles aria-hidden />}
          生成本周计划
        </Button>
      </div>

      {hasPlan ? (
        <p className="text-xs text-muted-foreground">
          重新生成会归档当前的同类型计划，避免任务重复堆在一起。已经完成的任务记录不会被删除。
        </p>
      ) : null}

      {notice ? (
        <Alert variant="success">
          <p className="flex items-start gap-2">
            <Check aria-hidden className="mt-0.5 size-4 shrink-0" />
            {notice}
          </p>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive" title="生成没有成功">
          <p>{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            disabled={pending !== null}
            onClick={() => void generate('daily')}
          >
            重试
          </Button>
        </Alert>
      ) : null}
    </div>
  );
}
