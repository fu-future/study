import { withApiHandler, jsonOk, readJsonBody } from '@/lib/api/http';
import { requireUser } from '@/lib/auth/current-user';
import { profilePatchSchema } from '@/lib/validation/schemas';
import {
  getStudentProfile,
  toProfileView,
  updateStudentProfile,
} from '@/lib/repositories/users.repository';
import { listCurriculums, listSubjects } from '@/lib/repositories/subjects.repository';

/**
 * 学习档案。
 *
 * GET 与 PATCH 返回同一个结构：前端改完档案后可以直接用返回值刷新界面，
 * 不必再补一次 GET。学科与教材版本一起下发，省掉额外请求。
 */

async function buildPayload(userId: string, user: Awaited<ReturnType<typeof requireUser>>) {
  const [profile, subjects, curriculums] = await Promise.all([
    getStudentProfile(userId),
    listSubjects(),
    listCurriculums(),
  ]);
  return { user, profile: toProfileView(profile), subjects, curriculums };
}

export const GET = withApiHandler(async () => {
  const user = await requireUser();
  return jsonOk(await buildPayload(user.id, user));
});

export const PATCH = withApiHandler(async (request: Request) => {
  const user = await requireUser();
  const input = profilePatchSchema.parse(await readJsonBody(request));

  // 考试日期在 schema 里是字符串（表单原样提交），落库前在这里转成 Date ——
  // 边界层负责类型转换，repository 只接受已经规整好的数据。
  const examDate =
    input.examDate === undefined
      ? undefined
      : input.examDate === null
        ? null
        : new Date(input.examDate);

  await updateStudentProfile(user.id, {
    grade: input.grade,
    curriculumId: input.curriculumId,
    textbookVersion: input.textbookVersion,
    electiveSubjects: input.electiveSubjects,
    studyGoal: input.studyGoal,
    examDate,
    dailyAvailableMinutes: input.dailyAvailableMinutes,
    weekdayAvailableMinutes: input.weekdayAvailableMinutes,
    weekendAvailableMinutes: input.weekendAvailableMinutes,
    reminderEnabled: input.reminderEnabled,
    reminderTime: input.reminderTime,
    preferences: input.preferences,
    onboardingCompleted: input.onboardingCompleted,
  });

  return jsonOk(await buildPayload(user.id, user));
});
