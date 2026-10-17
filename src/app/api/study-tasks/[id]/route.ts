import { withApiHandler, jsonOk, readJsonBody } from '@/lib/api/http';
import { AppError } from '@/lib/errors';
import { requireUser } from '@/lib/auth/current-user';
import { taskPatchSchema } from '@/lib/validation/schemas';
import {
  findStudyTaskForUser,
  toTaskView,
  updateStudyTask,
} from '@/lib/repositories/plans.repository';

/**
 * 修改任务（改期 / 调优先级 / 改预计时长 / 直接改状态）。
 *
 * 先查归属再更新：updateStudyTask 内部用 updateMany + userId，
 * 不属于自己的任务只会返回 count=0，这里显式转成 404。
 */
export const PATCH = withApiHandler(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireUser();
    const { id } = await params;
    const body = taskPatchSchema.parse(await readJsonBody(request));

    const existing = await findStudyTaskForUser(user.id, id);
    if (!existing) {
      throw new AppError('NOT_FOUND', { userMessage: '没有找到这个学习任务。' });
    }

    let scheduledDate: Date | undefined;
    if (body.scheduledDate) {
      const parsed = new Date(body.scheduledDate);
      if (Number.isNaN(parsed.getTime())) {
        throw new AppError('VALIDATION_ERROR', { userMessage: '日期格式不正确。' });
      }
      scheduledDate = parsed;
    }

    const updated = await updateStudyTask(user.id, id, {
      status: body.status,
      scheduledDate,
      priority: body.priority,
      estimatedMinutes: body.estimatedMinutes,
      result: body.result,
    });

    return jsonOk({ task: toTaskView(updated) });
  },
);
