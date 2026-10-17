import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError, toAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * API 统一响应与异常处理。
 *
 * 约定：所有响应体形状一致，前端可以统一处理。
 *   成功：{ ok: true, data: ... }
 *   失败：{ ok: false, error: { code, message, details? } }
 *
 * 安全要点：
 *   - 5xx 只返回通用提示，绝不把堆栈/SQL/密钥回传浏览器。
 *   - Zod 校验错误会以字段级 details 返回，方便表单直接定位。
 */

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = {
  ok: false;
  error: { code: string; message: string; details?: unknown };
};

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ ok: true, data } satisfies ApiSuccess<T>, init);
}

export function jsonError(error: AppError): NextResponse<ApiFailure> {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: error.code,
        message: error.userMessage,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    } satisfies ApiFailure,
    { status: error.status },
  );
}

/** 把 Zod 错误转成字段级 details，前端表单可直接标红对应输入框。 */
function zodToDetails(error: ZodError): Record<string, string> {
  const details: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!details[key]) details[key] = issue.message;
  }
  return details;
}

/**
 * 包装 Route Handler：统一处理 Zod 校验错误、AppError 与未知异常。
 */
export function withApiHandler<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>,
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof ZodError) {
        return jsonError(
          new AppError('VALIDATION_ERROR', {
            message: 'Zod validation failed',
            userMessage: '提交的内容有误，请检查标红的字段。',
            details: zodToDetails(error),
          }),
        );
      }

      const appError = toAppError(error);

      if (appError.status >= 500) {
        // 服务端错误才记日志，4xx 属于正常业务流转
        logger.error('api.unhandled', {
          code: appError.code,
          message: appError.message,
        });
      }

      return jsonError(appError);
    }
  };
}

/** 解析 JSON 请求体；空体返回 {}，坏 JSON 抛 400（而不是 500）。 */
export async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('VALIDATION_ERROR', {
      userMessage: '请求体不是合法的 JSON。',
    });
  }
}

/** 解析查询参数为普通对象（同名多次出现时取最后一个）。 */
export function readQuery(url: string): Record<string, string> {
  const params = new URL(url).searchParams;
  const result: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
}
