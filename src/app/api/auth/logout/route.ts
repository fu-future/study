import { withApiHandler, jsonOk } from '@/lib/api/http';
import { sessionCookieOptions } from '@/lib/auth/session';

/**
 * 退出登录。
 * 无状态 Cookie 没有服务端会话可销毁，因此这里的全部意义就是
 * 「把浏览器上的那份凭证立刻作废」：清空值 + maxAge:0。
 */
export const POST = withApiHandler(async () => {
  const response = jsonOk({ loggedOut: true });

  const { name, ...options } = sessionCookieOptions();
  response.cookies.set(name, '', { ...options, maxAge: 0 });
  return response;
});
