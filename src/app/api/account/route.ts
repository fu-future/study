import { withApiHandler, jsonOk } from '@/lib/api/http';
import { requireUser } from '@/lib/auth/current-user';
import { sessionCookieOptions } from '@/lib/auth/session';
import { archiveUser } from '@/lib/repositories/users.repository';

/**
 * 注销账户（软删除）。
 *
 * 只把 isArchived 置真，不做物理删除：学习记录的价值不该被一次误点抹掉，
 * 而且所有查询层都会过滤已归档用户，效果上等同于「账号不可再用」。
 * 同时清掉会话 Cookie，避免当前浏览器还拿着一个失效身份的凭证。
 */
export const DELETE = withApiHandler(async () => {
  const user = await requireUser();

  await archiveUser(user.id);

  const response = jsonOk({ archived: true });

  const { name, ...options } = sessionCookieOptions();
  response.cookies.set(name, '', { ...options, maxAge: 0 });
  return response;
});
