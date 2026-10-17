'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useRouter } from 'next/navigation';
import { Check, Plus, X } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Field,
  Input,
  Label,
  Select,
  Skeleton,
  Textarea,
} from '@/components/ui/primitives';
import { ERROR_TYPES } from '@/lib/domain/enums';
import { ApiError, apiGet, apiPost, toUserMessage, withQuery } from '@/lib/client-api';
import { cn } from '@/lib/utils';

/**
 * 手动录入错题。
 *
 * 表单字段与后端 questionCreateSchema 对齐：
 * 选项按「一行一个」拆分，错误原因最多选 4 个（后端也是这个上限）。
 */
export function MistakeEntryDialog({
  subjects,
  defaultSubjectId,
}: {
  subjects: { id: string; name: string }[];
  defaultSubjectId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  const [subjectId, setSubjectId] = React.useState(defaultSubjectId ?? subjects[0]?.id ?? '');
  const [stem, setStem] = React.useState('');
  const [choicesText, setChoicesText] = React.useState('');
  const [correctAnswer, setCorrectAnswer] = React.useState('');
  const [studentAnswer, setStudentAnswer] = React.useState('');
  const [explanation, setExplanation] = React.useState('');
  const [errorTypes, setErrorTypes] = React.useState<string[]>([]);
  const [knowledgePointIds, setKnowledgePointIds] = React.useState<string[]>([]);

  const [knowledgePoints, setKnowledgePoints] = React.useState<{ id: string; name: string }[]>([]);
  const [kpLoading, setKpLoading] = React.useState(false);
  const [kpError, setKpError] = React.useState<string | null>(null);

  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  // 打开时才按学科拉知识点，避免进入页面就发一堆请求
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setKpLoading(true);
    setKpError(null);
    apiGet<{ items: { id: string; name: string }[] }>(
      withQuery('/api/knowledge-points', { subjectId, limit: 100 }),
    )
      .then((data) => {
        if (!cancelled) setKnowledgePoints(data.items ?? []);
      })
      .catch((error) => {
        if (!cancelled) setKpError(toUserMessage(error));
      })
      .finally(() => {
        if (!cancelled) setKpLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, subjectId]);

  function resetForm() {
    setStem('');
    setChoicesText('');
    setCorrectAnswer('');
    setStudentAnswer('');
    setExplanation('');
    setErrorTypes([]);
    setKnowledgePointIds([]);
    setFieldErrors({});
    setFormError(null);
    setSaved(false);
  }

  function toggleErrorType(code: string) {
    setErrorTypes((current) =>
      current.includes(code) ? current.filter((item) => item !== code) : [...current, code].slice(0, 4),
    );
  }

  function toggleKnowledgePoint(id: string) {
    setKnowledgePointIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(0, 6),
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const localErrors: Record<string, string> = {};
    if (!subjectId) localErrors.subjectId = '请选择学科';
    if (!stem.trim()) localErrors.stem = '请填写题干';
    setFieldErrors(localErrors);
    if (Object.keys(localErrors).length > 0) return;

    const choices = choicesText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    setSubmitting(true);
    try {
      await apiPost('/api/questions', {
        subjectId,
        stem: stem.trim(),
        stemFormat: 'text',
        choices,
        correctAnswer: correctAnswer.trim() || null,
        explanation: explanation.trim() || null,
        studentAnswer: studentAnswer.trim() || null,
        errorTypes,
        knowledgePointIds,
        createMistake: true,
      });
      setSaved(true);
      // 让列表重新从服务端取数据（新错题会立刻出现在最前面）
      router.refresh();
      window.setTimeout(() => {
        setOpen(false);
        resetForm();
      }, 900);
    } catch (error) {
      if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) {
        setFieldErrors(error.fieldErrors);
      }
      setFormError(toUserMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetForm();
      }}
    >
      <Dialog.Trigger asChild>
        <Button>
          <Plus aria-hidden />
          手动录入题目
        </Button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-foreground/25" />
        <Dialog.Content className="scroll-thin fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(34rem,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border bg-card p-5 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold">手动录入错题</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                题干和错误原因是必填的核心信息，其余可以之后再补。录入后会立刻安排第一次复习。
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="关闭">
                <X aria-hidden />
              </Button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="mt-4 space-y-4" noValidate>
            {formError ? (
              <Alert variant="destructive" title="保存没有成功">
                <p>{formError}</p>
              </Alert>
            ) : null}

            <Field label="学科" htmlFor="entry-subject" error={fieldErrors.subjectId} required>
              <Select
                id="entry-subject"
                value={subjectId}
                onChange={(event) => {
                  setSubjectId(event.target.value);
                  setKnowledgePointIds([]);
                }}
                aria-invalid={Boolean(fieldErrors.subjectId)}
              >
                <option value="">请选择</option>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="题干"
              htmlFor="entry-stem"
              error={fieldErrors.stem}
              hint="可以直接把题目文字抄进来，数学公式用 $...$ 包裹也能正常显示"
              required
            >
              <Textarea
                id="entry-stem"
                rows={4}
                maxLength={6000}
                value={stem}
                onChange={(event) => setStem(event.target.value)}
                aria-invalid={Boolean(fieldErrors.stem)}
              />
            </Field>

            <Field
              label="选项（可选）"
              htmlFor="entry-choices"
              error={fieldErrors.choices}
              hint="一行一个选项，没有选项就留空"
            >
              <Textarea
                id="entry-choices"
                rows={4}
                value={choicesText}
                placeholder={'A. …\nB. …\nC. …\nD. …'}
                onChange={(event) => setChoicesText(event.target.value)}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="正确答案（可选）" htmlFor="entry-correct" error={fieldErrors.correctAnswer}>
                <Input
                  id="entry-correct"
                  value={correctAnswer}
                  maxLength={1000}
                  onChange={(event) => setCorrectAnswer(event.target.value)}
                />
              </Field>
              <Field label="我当时的答案（可选）" htmlFor="entry-student" error={fieldErrors.studentAnswer}>
                <Input
                  id="entry-student"
                  value={studentAnswer}
                  maxLength={1000}
                  onChange={(event) => setStudentAnswer(event.target.value)}
                />
              </Field>
            </div>

            <Field label="解析（可选）" htmlFor="entry-explanation" error={fieldErrors.explanation}>
              <Textarea
                id="entry-explanation"
                rows={3}
                maxLength={6000}
                value={explanation}
                onChange={(event) => setExplanation(event.target.value)}
              />
            </Field>

            <fieldset>
              <legend className="text-sm font-medium">
                错误原因
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  最多选 4 个（{errorTypes.length}/4）
                </span>
              </legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {Object.entries(ERROR_TYPES).map(([code, label]) => {
                  const checked = errorTypes.includes(code);
                  return (
                    <label
                      key={code}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[13px] transition-colors',
                        checked ? 'border-primary/40 bg-primary/10 text-primary' : 'hover:bg-muted',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="size-3.5 accent-[hsl(var(--primary))]"
                        checked={checked}
                        onChange={() => toggleErrorType(code)}
                      />
                      {label}
                    </label>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                不确定就选「暂时无法判断」，之后复习时再回来修改。
              </p>
            </fieldset>

            <div>
              <Label>关联知识点（可选，最多 6 个）</Label>
              <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border p-2">
                {kpLoading ? (
                  <div className="space-y-2 p-1" aria-busy="true">
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-5 w-1/2" />
                  </div>
                ) : kpError ? (
                  <Alert variant="muted" title="知识点没读出来">
                    <p>{kpError} 可以先不选，之后再补充。</p>
                  </Alert>
                ) : knowledgePoints.length === 0 ? (
                  <p className="p-1 text-xs text-muted-foreground">
                    这个学科下暂时没有可关联的知识点。可以先直接保存，知识点之后再补。
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {knowledgePoints.map((point) => {
                      const checked = knowledgePointIds.includes(point.id);
                      return (
                        <li key={point.id}>
                          <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-muted">
                            <input
                              type="checkbox"
                              className="size-3.5 accent-[hsl(var(--primary))]"
                              checked={checked}
                              onChange={() => toggleKnowledgePoint(point.id)}
                            />
                            <span className="truncate">{point.name}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>

            {saved ? (
              <Alert variant="success">
                <p className="flex items-center gap-2">
                  <Check aria-hidden className="size-4" />
                  已保存，并安排了第一次复习。
                </p>
              </Alert>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex flex-wrap gap-2">
                {errorTypes.length > 0 ? (
                  <Badge variant="secondary">已标注 {errorTypes.length} 项错误原因</Badge>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Dialog.Close asChild>
                  <Button type="button" variant="outline" disabled={submitting}>
                    取消
                  </Button>
                </Dialog.Close>
                <Button type="submit" loading={submitting}>
                  保存为错题
                </Button>
              </div>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
