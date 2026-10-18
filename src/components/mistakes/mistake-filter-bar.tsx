'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw, Search } from 'lucide-react';
import { Button, Field, Select } from '@/components/ui/primitives';
import { ERROR_TYPES, errorTypeLabel } from '@/lib/domain/enums';
import { withQuery } from '@/lib/client-api';

/**
 * 错题本筛选条。
 *
 * 筛选状态放在 URL 里（而不是组件 state）：这样刷新、分享链接、
 * 浏览器后退都能保留筛选条件，也方便服务端组件直接读 searchParams。
 */
export type MistakeFilterValue = {
  subjectId: string;
  knowledgePointId: string;
  errorType: string;
  reviewFilter: 'due' | 'not-scheduled' | 'all';
};

const REVIEW_FILTER_LABELS: { value: MistakeFilterValue['reviewFilter']; label: string }[] = [
  { value: 'all', label: '全部错题' },
  { value: 'due', label: '今天该复习' },
  { value: 'not-scheduled', label: '还没排复习' },
];

export function MistakeFilterBar({
  subjects,
  knowledgePoints,
  value,
}: {
  subjects: { id: string; name: string }[];
  knowledgePoints: { id: string; name: string }[];
  value: MistakeFilterValue;
}) {
  const router = useRouter();

  function push(next: Partial<MistakeFilterValue>) {
    const merged = { ...value, ...next };
    router.push(
      withQuery('/mistakes', {
        subjectId: merged.subjectId,
        knowledgePointId: merged.knowledgePointId,
        errorType: merged.errorType,
        // 'all' 是默认值，不必写进 URL
        reviewFilter: merged.reviewFilter === 'all' ? '' : merged.reviewFilter,
      }),
    );
  }

  const hasFilter =
    Boolean(value.subjectId) ||
    Boolean(value.knowledgePointId) ||
    Boolean(value.errorType) ||
    value.reviewFilter !== 'all';

  return (
    <div className="rounded-xl border bg-card p-3 sm:p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="学科" htmlFor="filter-subject">
          <Select
            id="filter-subject"
            value={value.subjectId}
            onChange={(event) => push({ subjectId: event.target.value, knowledgePointId: '' })}
          >
            <option value="">全部学科</option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="知识点"
          htmlFor="filter-knowledge"
          hint={value.subjectId ? undefined : '先选学科，列表会更短'}
        >
          <Select
            id="filter-knowledge"
            value={value.knowledgePointId}
            onChange={(event) => push({ knowledgePointId: event.target.value })}
          >
            <option value="">全部知识点</option>
            {knowledgePoints.map((point) => (
              <option key={point.id} value={point.id}>
                {point.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="错误原因" htmlFor="filter-error-type">
          <Select
            id="filter-error-type"
            value={value.errorType}
            onChange={(event) => push({ errorType: event.target.value })}
          >
            <option value="">全部原因</option>
            {Object.keys(ERROR_TYPES).map((code) => (
              <option key={code} value={code}>
                {errorTypeLabel(code)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="复习状态" htmlFor="filter-review">
          <Select
            id="filter-review"
            value={value.reviewFilter}
            onChange={(event) =>
              push({ reviewFilter: event.target.value as MistakeFilterValue['reviewFilter'] })
            }
          >
            {REVIEW_FILTER_LABELS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Search aria-hidden className="size-3.5" />
          {hasFilter ? '正在按上面的条件筛选' : '当前显示全部错题'}
        </p>
        {hasFilter ? (
          <Button variant="ghost" size="sm" onClick={() => router.push('/mistakes')}>
            <RotateCcw aria-hidden />
            清除筛选
          </Button>
        ) : null}
      </div>
    </div>
  );
}
