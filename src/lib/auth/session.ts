import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { getEnv } from '@/lib/env';

/**
 * 会话管理（签名 Cookie）。
 *
 * 设计取舍：
 *   - 第一版是单机部署的学习工具，用「HMAC 签名的无状态 Cookie」而不是引入
 *     NextAuth / 数据库 session 表 —— 少一个依赖、少一张表，安全边界依然清晰。
 *   - Cookie 只装 { uid, exp }，不含任何个人信息；签名用 SESSION_SECRET。
 *   - httpOnly + sameSite=lax，生产环境加 secure。
 *   - 所有需要身份的 API 都通过 requireUser() 校验，未授权一律 401，
 *     数据查询一律带 userId 过滤（见 repositories 层），从而保证用户间数据隔离。
 */

export const SESSION_COOKIE_NAME = 'sc_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 天

type SessionPayload = {
  uid: string;
  exp: number; // Unix 秒
};

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

function sign(data: string): string {
  const { SESSION_SECRET } = getEnv();
  return createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
}

/** 生成会话 Cookie 的值：`<payload>.<signature>` */
export function createSessionToken(userId: string, now = Date.now()): string {
  const payload: SessionPayload = {
    uid: userId,
    exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
  };
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

/**
 * 校验并解析会话 Token。
 * 签名不匹配、格式错误、已过期都返回 null（不区分原因，避免信息泄漏）。
 */
export function verifySessionToken(token: string | undefined | null, now = Date.now()): SessionPayload | null {
  if (!token) return null;

  const dot = token.lastIndexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;

  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const expected = sign(body);
  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<SessionPayload>;
    if (typeof decoded.uid !== 'string' || typeof decoded.exp !== 'number') return null;
    if (decoded.exp * 1000 <= now) return null;
    return { uid: decoded.uid, exp: decoded.exp };
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProd,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  };
}

/** 从请求上下文（Server Component / Route Handler）读取当前会话。 */
export async function readSessionFromCookies(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}

/** CSRF 兜底：为同源写操作生成一次性随机值（可选增强，不阻断主流程）。 */
export function generateCsrfToken(): string {
  return randomBytes(16).toString('hex');
}
