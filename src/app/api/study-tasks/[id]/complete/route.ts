import { withApiHandler, jsonOk, readJsonBody } from '@/lib/api/http';
import { AppError } from '@/lib/errors';
import { requireUser } from '@/lib/auth/current-user';
import { taskCompleteBodySchema } from '@/lib/validation/schemas';
import {
  createStudySession,
  findStudyTaskForUser,
  toTaskView,
  updateStudyTask,
} from '@/lib/repositories/plans.repository';

/**
 * 完成任务。
 *
 * 一次「完成」写两张表，缺一不可：
 *   1. StudyTask —— 任务状态与结果（任务完成率指标的来源）
 *   2. StudySession —— 真实学习时段（学习时间指标的来源）
 * 两者刻意分开统计，避免把「计划了 30 分钟」当成「学了 30 分钟」。
 */
export const POST = withApiHandler(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireUser();
    const { id } = await params;
    const body = taskCompleteBodySchema.parse(await readJsonBody(request));

    const existing = await findStudyTaskForUser(user.id, id);
    if (!existing) {
      throw new AppError('NOT_FOUND', { userMessage: '没有找到这个学习任务。' });
    }

    const now = new Date();

    const updated = await updateStudyTask(user.id, id, {
      status: 'completed',
      completedAt: now,
      actualMinutes: body.actualMinutes ?? null,
      // 学生的自评与正确率都要留下来，它们是「是否真的掌握」的参考信号
      result: {
        accuracy: body.accuracy ?? null,
        note: body.note ?? null,
        selfAssessment: body.selfAssessment,
      },
    });

    // 没填实际时长时用预计时长兜底，保证「学习时间」这一指标不会凭空缺失
    const durationMinutes = body.actualMinutes ?? updated.estimatedMinutes;

    const session = await createStudySession(user.id, {
      studyTaskId: updated.id,
      startedAt: new Date(now.getTime() - durationMinutes * 60_000),
      endedAt: now,
      durationMinutes,
      mode: 'task',
      subjectId: updated.subjectId,
      note: body.note ?? null,
    });

    return jsonOk({ task: toTaskView(updated), session });
  },
);
