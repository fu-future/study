import { withApiHandler, jsonOk, readJsonBody } from '@/lib/api/http';
import { AppError } from '@/lib/errors';
import { loginSchema } from '@/lib/validation/schemas';
import { verifyPassword } from '@/lib/auth/password';
import { createSessionToken, sessionCookieOptions } from '@/lib/auth/session';
import { findUserByEmail, touchLastSeen } from '@/lib/repositories/users.repository';

/**
 * 登录。
 *
 * 「用户不存在」与「密码错误」返回完全相同的错误 —— 否则攻击者可以
 * 通过响应差异逐个试出哪些邮箱已注册（用户枚举）。
 */
export const POST = withApiHandler(async (request: Request) => {
  const body = loginSchema.parse(await readJsonBody(request));

  const user = await findUserByEmail(body.email);
  const invalidCredentials = new AppError('UNAUTHORIZED', {
    userMessage: '邮箱或密码不正确。',
  });

  if (!user) throw invalidCredentials;
  if (!(await verifyPassword(body.password, user.passwordHash))) throw invalidCredentials;

  // 登录时间只用于「最近活跃」，失败不应影响登录本身
  await touchLastSeen(user.id);

  const response = jsonOk({
    user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role },
  });

  const { name, ...options } = sessionCookieOptions();
  response.cookies.set(name, createSessionToken(user.id), options);
  return response;
});
