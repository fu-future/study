import type { User } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { readSessionFromCookies } from '@/lib/auth/session';
import { findUserById } from '@/lib/repositories/users.repository';

/**
 * 当前登录用户的解析入口。
 *
 * 所有需要身份的 API 都必须走 requireUser()：
 *   - 未登录 → 抛 AppError('UNAUTHORIZED')，由 API 包装层转成 401
 *   - 已归档用户 → 同样视为未登录，避免「删号后 Cookie 仍可用」
 *
 * 注意：这里返回的是「谁在请求」。**数据归属校验**是在 repository 层完成的
 * （每个查询都带 userId 条件），两层配合才能保证用户间数据隔离。
 */

export type SessionUser = Pick<User, 'id' | 'email' | 'displayName' | 'role' | 'createdAt'>;

export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await readSessionFromCookies();
  if (!session) return null;

  const user = await findUserById(session.uid);
  if (!user || user.isArchived) return null;

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt,
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new AppError('UNAUTHORIZED', {
      userMessage: '请先登录再继续。',
    });
  }
  return user;
}

export function isAdmin(user: SessionUser): boolean {
  return user.role === 'admin';
}

/** 管理员专用操作（如导入官方知识点、维护资源库）的守卫。 */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!isAdmin(user)) {
    throw new AppError('FORBIDDEN', {
      userMessage: '该操作仅管理员可用。',
    });
  }
  return user;
}
