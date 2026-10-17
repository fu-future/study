import { withApiHandler, jsonOk, readQuery } from '@/lib/api/http';
import { requireUser } from '@/lib/auth/current-user';
import { planQuerySchema } from '@/lib/validation/schemas';
import { listUserPlans } from '@/lib/ai/services/study-planning.service';

/** 学习计划列表（按创建时间倒序，已归档的不会出现）。 */
export const GET = withApiHandler(async (request: Request) => {
  const user = await requireUser();
  const query = planQuerySchema.parse(readQuery(request.url));

  return jsonOk({ items: await listUserPlans(user.id, query.limit) });
});
