import { withApiHandler, jsonOk, readJsonBody } from '@/lib/api/http';
import { AppError } from '@/lib/errors';
import { requireUser } from '@/lib/auth/current-user';
import { planGenerateBodySchema } from '@/lib/validation/schemas';
import { generatePlanForUser } from '@/lib/ai/services/study-planning.service';

/**
 * 生成学习计划。
 *
 * 任务骨架由规则引擎生成（AI 不参与决策）：可用时间、到期复习、薄弱点
 * 这些都是精确计算，规则比模型更可靠，也更容易向学生解释「为什么这么排」。
 */
export const POST = withApiHandler(async (request: Request) => {
  const user = await requireUser();
  const body = planGenerateBodySchema.parse(await readJsonBody(request));

  // 日期来自表单，先确认能解析再交给计划生成器，避免 Invalid Date 渗进排期计算
  let from: Date | undefined;
  if (body.from) {
    const parsed = new Date(body.from);
    if (Number.isNaN(parsed.getTime())) {
      throw new AppError('VALIDATION_ERROR', { userMessage: '起始日期格式不正确。' });
    }
    from = parsed;
  }

  const result = await generatePlanForUser({
    userId: user.id,
    planType: body.planType,
    dayCount: body.dayCount,
    from,
    replaceUnfinished: body.replaceUnfinished,
  });

  return jsonOk(result);
});
