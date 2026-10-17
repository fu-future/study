import { withApiHandler, jsonOk, readJsonBody } from '@/lib/api/http';
import { requireUser } from '@/lib/auth/current-user';
import { reviewBodySchema } from '@/lib/validation/schemas';
import { submitMistakeReview } from '@/lib/review/service';

/**
 * 提交一次错题复习。
 *
 * 与 /attempts 的区别：这里会推进间隔复习计划（下次复习时间被重新计算），
 * 因此只对已经有错题记录的题目有效 —— 该前提由服务层校验。
 */
export const POST = withApiHandler(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireUser();
    const { id } = await params;
    const body = reviewBodySchema.parse(await readJsonBody(request));

    const result = await submitMistakeReview({
      userId: user.id,
      questionId: id,
      input: {
        result: body.result,
        independence: body.independence,
        answer: body.answer ?? null,
        timeSpentSeconds: body.timeSpentSeconds ?? null,
      },
    });

    return jsonOk(result);
  },
);
