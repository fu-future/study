'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, Save } from 'lucide-react';
import { Alert, Badge, Button } from '@/components/ui/primitives';
import { ERROR_TYPES, errorTypeLabel } from '@/lib/domain/enums';
import { apiPatch, toUserMessage } from '@/lib/client-api';
import { cn } from '@/lib/utils';

/**
 * 错误原因编辑器。
 *
 * 刻意做成「学生可以覆盖 AI 判断」：editedByUser 会记下来，
 * 之后的分析不会再自动把 AI 的结论当成权威。
 */
export function ErrorTypeEditor({
  questionId,
  initial,
  editedByUser,
  confidenceNote,
}: {
  questionId: string;
  initial: string[];
  editedByUser?: boolean;
  confidenceNote?: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<string[]>(initial);
  const [saving, setSaving] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const dirty = React.useMemo(() => {
    if (selected.length !== initial.length) return true;
    const a = [...selected].sort().join(',');
    const b = [...initial].sort().join(',');
    return a !== b;
  }, [selected, initial]);

  function toggle(code: string) {
    setNotice(null);
    setSelected((current) =>
      current.includes(code) ? current.filter((item) => item !== code) : [...current, code].slice(0, 4),
    );
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await apiPatch(`/api/questions/${questionId}`, { mistake: { errorTypes: selected } });
      setNotice('已记录你的修改');
      router.refresh();
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {editedByUser ? <Badge variant="secondary">已由你修改过</Badge> : null}
        <span className="text-xs text-muted-foreground">最多选 4 项</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {Object.entries(ERROR_TYPES).map(([code, label]) => {
          const checked = selected.includes(code);
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
                disabled={saving}
                onChange={() => toggle(code)}
              />
              {label}
            </label>
          );
        })}
      </div>

      {confidenceNote ? <p className="text-xs text-muted-foreground">{confidenceNote}</p> : null}

      {selected.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          当前选择：{selected.map(errorTypeLabel).join('、')}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">还没有标注错误原因</p>
      )}

      {error ? (
        <Alert variant="destructive" title="保存没有成功">
          <p>{error}</p>
        </Alert>
      ) : null}

      {notice ? (
        <Alert variant="success">
          <p className="flex items-center gap-2">
            <Check aria-hidden className="size-4" />
            {notice}
          </p>
        </Alert>
      ) : null}

      <Button type="button" size="sm" loading={saving} disabled={!dirty} onClick={() => void handleSave()}>
        <Save aria-hidden />
        {dirty ? '保存修改' : '已是最新'}
      </Button>
    </div>
  );
}
