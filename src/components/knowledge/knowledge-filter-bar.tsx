'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw, Search } from 'lucide-react';
import { Button, Field, Input, Select } from '@/components/ui/primitives';
import { GRADES } from '@/lib/domain/enums';
import { withQuery } from '@/lib/client-api';

/**
 * 知识点地图的筛选条。
 * 搜索用输入框 + 提交按钮（而不是每次按键就请求），避免边打字边刷新页面。
 */
export function KnowledgeFilterBar({
  subjects,
  value,
}: {
  subjects: { id: string; name: string }[];
  value: { subjectId: string; grade: string; search: string; withMastery: boolean };
}) {
  const router = useRouter();
  const [search, setSearch] = React.useState(value.search);

  function push(next: Partial<{ subjectId: string; grade: string; search: string; withMastery: boolean }>) {
    const merged = { ...value, ...next };
    router.push(
      withQuery('/knowledge', {
        subjectId: merged.subjectId,
        grade: merged.grade,
        search: merged.search,
        withMastery: merged.withMastery ? 'true' : '',
      }),
    );
  }

  const hasFilter =
    Boolean(value.subjectId) || Boolean(value.grade) || Boolean(value.search) || value.withMastery;

  return (
    <div className="rounded-xl border bg-card p-3 sm:p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="学科" htmlFor="kp-subject">
          <Select
            id="kp-subject"
            value={value.subjectId}
            onChange={(event) => push({ subjectId: event.target.value })}
          >
            <option value="">全部学科</option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="年级" htmlFor="kp-grade">
          <Select id="kp-grade" value={value.grade} onChange={(event) => push({ grade: event.target.value })}>
            <option value="">全部年级</option>
            {GRADES.map((grade) => (
              <option key={grade} value={grade}>
                {grade}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="搜索" htmlFor="kp-search" hint="可以搜名称、章节或编号">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              push({ search: search.trim() });
            }}
            className="flex gap-2"
          >
            <Input
              id="kp-search"
              value={search}
              placeholder="例如：导数"
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button type="submit" variant="outline" size="icon" aria-label="搜索知识点">
              <Search aria-hidden />
            </Button>
          </form>
        </Field>

        <Field label="掌握度" htmlFor="kp-mastery" hint="显示你在每个知识点上的掌握等级">
          <Select
            id="kp-mastery"
            value={value.withMastery ? 'true' : 'false'}
            onChange={(event) => push({ withMastery: event.target.value === 'true' })}
          >
            <option value="false">只看目录</option>
            <option value="true">只看目录 + 我的掌握度</option>
          </Select>
        </Field>
      </div>

      {hasFilter ? (
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => router.push('/knowledge')}>
            <RotateCcw aria-hidden />
            清除筛选
          </Button>
        </div>
      ) : null}
    </div>
  );
}
