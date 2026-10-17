'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw } from 'lucide-react';
import { Button, Field, Select } from '@/components/ui/primitives';
import { RESOURCE_TYPES, RESOURCE_VERIFICATION } from '@/lib/domain/enums';
import { withQuery } from '@/lib/client-api';

/** 资源库筛选条：按类型 / 学科 / 核验状态筛选。 */
export function ResourceFilterBar({
  subjects,
  value,
}: {
  subjects: { id: string; name: string }[];
  value: { subjectId: string; resourceType: string; verificationStatus: string };
}) {
  const router = useRouter();

  function push(next: Partial<typeof value>) {
    const merged = { ...value, ...next };
    router.push(
      withQuery('/resources', {
        subjectId: merged.subjectId,
        resourceType: merged.resourceType,
        verificationStatus: merged.verificationStatus,
      }),
    );
  }

  const hasFilter = Boolean(value.subjectId) || Boolean(value.resourceType) || Boolean(value.verificationStatus);

  return (
    <div className="rounded-xl border bg-card p-3 sm:p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="资源类型" htmlFor="res-type">
          <Select
            id="res-type"
            value={value.resourceType}
            onChange={(event) => push({ resourceType: event.target.value })}
          >
            <option value="">全部类型</option>
            {Object.entries(RESOURCE_TYPES).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="学科" htmlFor="res-subject">
          <Select
            id="res-subject"
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

        <Field
          label="核验状态"
          htmlFor="res-verification"
          hint="「未核验」的内容需要你自己判断准确性"
        >
          <Select
            id="res-verification"
            value={value.verificationStatus}
            onChange={(event) => push({ verificationStatus: event.target.value })}
          >
            <option value="">全部状态</option>
            {Object.entries(RESOURCE_VERIFICATION).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {hasFilter ? (
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => router.push('/resources')}>
            <RotateCcw aria-hidden />
            清除筛选
          </Button>
        </div>
      ) : null}
    </div>
  );
}
