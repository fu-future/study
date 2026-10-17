'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useRouter } from 'next/navigation';
import { Check, X } from 'lucide-react';
import { Alert, Button, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { apiPost, toUserMessage } from '@/lib/client-api';

/**
 * 标记任务完成。
 *
 * 为什么还要填「实际用时」和「自评」：
 *   - 实际用时是下一次排计划时判断任务量的依据
 *   - 自评会作为掌握度证据的质量参考（「做完了但没底」和「做完了很确定」不一样）
 */
export function CompleteTaskDialog({
  taskId,
  taskTitle,
  estimatedMinutes,
}: {
  taskId: string;
  taskTitle: string;
  estimatedMinutes: number;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [actualMinutes, setActualMinutes] = React.useState(String(estimatedMinutes));
  const [selfAssessment, setSelfAssessment] = React.useState<'confident' | 'unsure'>('confident');
  const [note, setNote] = React.useState('');
  const [accuracy, setAccuracy] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const minutes = actualMinutes ? Number(actualMinutes) : null;
    const accuracyValue = accuracy ? Number(accuracy) / 100 : null;

    if (minutes !== null && (Number.isNaN(minutes) || minutes < 0 || minutes > 600)) {
      setError('实际用时请填 0 到 600 分钟之间的大概数字。');
      return;
    }
    if (accuracyValue !== null && (Number.isNaN(accuracyValue) || accuracyValue < 0 || accuracyValue > 1)) {
      setError('正确率请填 0 到 100 之间的百分数。');
      return;
    }

    setSubmitting(true);
    try {
      await apiPost(`/api/study-tasks/${taskId}/complete`, {
        actualMinutes: minutes,
        note: note.trim() || null,
        selfAssessment,
        accuracy: accuracyValue,
      });
      setDone(true);
      router.refresh();
      window.setTimeout(() => {
        setOpen(false);
      }, 800);
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setDone(false);
        }
      }}
    >
      <Dialog.Trigger asChild>
        <Button size="sm">
          <Check aria-hidden />
          完成
        </Button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-foreground/25" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(28rem,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border bg-card p-5 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold">记录这次完成情况</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                {taskTitle}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="关闭">
                <X aria-hidden />
              </Button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="mt-4 space-y-4" noValidate>
            <Field
              label="实际用时（分钟）"
              htmlFor="complete-minutes"
              hint={`预计 ${estimatedMinutes} 分钟。花得比预计多很正常，不用改数字去凑`}
            >
              <Input
                id="complete-minutes"
                type="number"
                min={0}
                max={600}
                value={actualMinutes}
                onChange={(event) => setActualMinutes(event.target.value)}
              />
            </Field>

            <Field
              label="做完之后的感觉"
              htmlFor="complete-assessment"
              hint="「还没底」也是有用的信息，会让系统安排一次更适合的练习"
            >
              <Select
                id="complete-assessment"
                value={selfAssessment}
                onChange={(event) => setSelfAssessment(event.target.value as 'confident' | 'unsure')}
              >
                <option value="confident">基本能自己做出来了</option>
                <option value="unsure">做完了，但还不太确定</option>
              </Select>
            </Field>

            <Field
              label="正确率（可选，百分数）"
              htmlFor="complete-accuracy"
              hint="如果这次是练习题，可以填一个大概的正确率，比如 80"
            >
              <Input
                id="complete-accuracy"
                type="number"
                min={0}
                max={100}
                value={accuracy}
                onChange={(event) => setAccuracy(event.target.value)}
              />
            </Field>

            <Field label="备注（可选）" htmlFor="complete-note">
              <Textarea
                id="complete-note"
                rows={2}
                maxLength={500}
                value={note}
                placeholder="比如：卡在第二步的变形上"
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>

            {error ? (
              <Alert variant="destructive" title="没有保存成功">
                <p>{error}</p>
              </Alert>
            ) : null}

            {done ? (
              <Alert variant="success">
                <p className="flex items-center gap-2">
                  <Check aria-hidden className="size-4" />
                  已记录，学习时长也一起更新了。
                </p>
              </Alert>
            ) : null}

            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" variant="outline" disabled={submitting}>
                  稍后再说
                </Button>
              </Dialog.Close>
              <Button type="submit" loading={submitting}>
                记录完成
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
