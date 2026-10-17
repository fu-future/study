import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard';
import { getCurrentUser } from '@/lib/auth/current-user';
import { getStudentProfile, toProfileView } from '@/lib/repositories/users.repository';
import { listSubjects } from '@/lib/repositories/subjects.repository';

export const metadata: Metadata = { title: '开始使用' };

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const [profile, subjects] = await Promise.all([
    getStudentProfile(user.id).then(toProfileView),
    listSubjects(),
  ]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">先花一分钟做个设定</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          不需要很精确，大致符合你现在的状态就好。后面随时可以在「设置」里改，
          改动不会影响已经记录的学习数据。
        </p>
      </header>

      <OnboardingWizard
        subjects={subjects.map((subject) => ({
          id: subject.id,
          code: subject.code,
          name: subject.name,
          isElective: subject.isElective,
        }))}
        initial={{
          grade: profile.grade,
          textbookVersion: profile.textbookVersion ?? '',
          electiveSubjects: profile.electiveSubjects,
          studyGoal: profile.studyGoal ?? '',
          examDate: profile.examDate ? profile.examDate.toISOString().slice(0, 10) : '',
          dailyAvailableMinutes: profile.dailyAvailableMinutes || 90,
        }}
      />
    </div>
  );
}
