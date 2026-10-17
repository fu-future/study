import { withApiHandler, jsonOk } from '@/lib/api/http';
import { requireUser } from '@/lib/auth/current-user';
import { listSubjects } from '@/lib/repositories/subjects.repository';

/**
 * 学科列表。
 *
 * 学科是全局参考数据（不含任何用户数据），但仍要求登录：
 * 这是个人学习工具，未登录的请求没有任何合理用途，少开一个匿名入口。
 */
export const GET = withApiHandler(async () => {
  await requireUser();
  return jsonOk({ items: await listSubjects() });
});
