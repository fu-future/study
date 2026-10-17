import { withApiHandler, jsonOk, readQuery } from '@/lib/api/http';
import { requireUser } from '@/lib/auth/current-user';
import { reportQuerySchema } from '@/lib/validation/schemas';
import { buildWeeklyReport } from '@/lib/reports/weekly';

/**
 * 周报。
 *
 * 报告里的每个数字都来自真实记录，没有数据时字段为 null 而不是 0 ——
 * 路由不参与任何统计口径的加工，全部交给 reports 层，保证「报告只反映事实」。
 */
export const GET = withApiHandler(async (request: Request) => {
  const user = await requireUser();
  const query = reportQuerySchema.parse(readQuery(request.url));

  return jsonOk(await buildWeeklyReport(user.id, query.weekOffset));
});
