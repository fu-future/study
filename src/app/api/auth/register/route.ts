import { withApiHandler, jsonOk, readJsonBody } from '@/lib/api/http';
import { AppError } from '@/lib/errors';
import { getEnv } from '@/lib/env';
import { registerSchema } from '@/lib/validation/schemas';
import { hashPassword } from '@/lib/auth/password';
import { createSessionToken, sessionCookieOptions } from '@/lib/auth/session';
import { createUser, findUserByEmail } from '@/lib/repositories/users.repository';

/**
 * 自助注册。
 *
 * 是否开放由 ALLOW_SELF_SIGNUP 决定，且必须在写库之前判断 ——
 * 否则「关闭注册」只是前端的一层假象。
 */
export const POST = withApiHandler(async (request: Request) => {
  if (!getEnv().ALLOW_SELF_SIGNUP) {
    throw new AppError('FORBIDDEN', {
      userMessage: '本站已关闭自助注册，请联系管理员开通账号。',
    });
  }

  const body = registerSchema.parse(await readJsonBody(request));

  const existing = await findUserByEmail(body.email);
  if (existing) {
    throw new AppError('CONFLICT', {
      userMessage: '这个邮箱已经注册过了，直接登录即可。',
    });
  }

  const user = await createUser({
    email: body.email,
    displayName: body.displayName,
    // 明文密码在内存中完成哈希后即丢弃，永不落库
    passwordHash: await hashPassword(body.password),
  });

  const response = jsonOk({
    user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role },
  });

  // 注册即登录：直接写入会话 Cookie，避免「注册成功还要再登一次」的断裂感
  const { name, ...options } = sessionCookieOptions();
  response.cookies.set(name, createSessionToken(user.id), options);
  return response;
});
