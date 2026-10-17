import { withApiHandler, jsonOk, readJsonBody } from '@/lib/api/http';
import { requireUser } from '@/lib/auth/current-user';
import { attemptBodySchema } from '@/lib/validation/schemas';
import { submitAttempt } from '@/lib/review/service';

/**
 * 提交一次作答（练习 / 复测）。
 *
 * 作答是「证据」的入口：它会追加一条 AnswerAttempt、刷新错题汇总，
 * 并重新估计相关知识点的掌握度。服务层负责编排，路由只做校验与转发。
 */
export const POST = withApiHandler(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireUser();
    const { id } = await params;
    const body = attemptBodySchema.parse(await readJsonBody(request));

    const result = await submitAttempt({
      userId: user.id,
      questionId: id,
      input: {
        answer: body.answer ?? null,
        isCorrect: body.isCorrect,
        independence: body.independence,
        difficultySnapshot: body.difficultySnapshot,
        timeSpentSeconds: body.timeSpentSeconds ?? null,
        errorTypes: body.errorTypes,
        note: body.note ?? null,
        context: body.context,
      },
    });

    return jsonOk(result);
  },
);
