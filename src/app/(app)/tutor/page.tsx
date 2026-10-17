import * as React from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/current-user';
import { listSubjects } from '@/lib/repositories/subjects.repository';
import { TutorClient } from '@/components/tutor/tutor-client';
import { ListSkeleton } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'AI 答疑' };

export default async function TutorPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const subjects = await listSubjects();

  return (
    // TutorClient 里用到了 useSearchParams（从错题入口带 questionId 进来），
    // 用 Suspense 包一层，避免在预渲染阶段报缺少边界。
    <React.Suspense fallback={<ListSkeleton rows={3} />}>
      <TutorClient
        subjects={subjects.map((subject) => ({
          id: subject.id,
          code: subject.code,
          name: subject.name,
          isElective: subject.isElective,
        }))}
      />
    </React.Suspense>
  );
}
