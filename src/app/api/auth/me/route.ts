import { withApiHandler, jsonOk } from '@/lib/api/http';
import { getCurrentUser } from '@/lib/auth/current-user';

/**
 * 当前登录用户。
 *
 * 未登录**不是错误**（不走 requireUser）：前端需要一个稳定的接口
 * 来判断「该显示登录页还是应用主界面」，返回 user:null 比 401 更好用。
 */
export const GET = withApiHandler(async () => {
  return jsonOk({ user: await getCurrentUser() });
});
