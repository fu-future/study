/**
 * 统一错误类型。
 *
 * 目的：
 *   1. 让 API 层能把任意异常映射成稳定的 HTTP 状态码与错误码，而不是把堆栈泄给浏览器。
 *   2. 对 AI 相关错误做细分（超时 / 限流 / 能力不支持 / 输出不合规），
 *      以便前端给出可操作的提示，也便于 /settings 展示。
 *   3. 绝不把密钥、完整提示词、SQL 语句放进 message。
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'AI_NOT_CONFIGURED'
  | 'AI_TIMEOUT'
  | 'AI_UPSTREAM_ERROR'
  | 'AI_CAPABILITY_UNSUPPORTED'
  | 'AI_INVALID_OUTPUT'
  | 'UPLOAD_REJECTED'
  | 'UNSUPPORTED'
  | 'INTERNAL_ERROR';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  AI_NOT_CONFIGURED: 503,
  AI_TIMEOUT: 504,
  AI_UPSTREAM_ERROR: 502,
  AI_CAPABILITY_UNSUPPORTED: 501,
  AI_INVALID_OUTPUT: 502,
  UPLOAD_REJECTED: 400,
  UNSUPPORTED: 501,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** 面向用户的、可操作的提示（中文，不含内部细节） */
  readonly userMessage: string;
  /** 可选的补充信息（字段级错误等），会原样返回给前端 */
  readonly details?: unknown;

  constructor(
    code: ErrorCode,
    options: { message?: string; userMessage?: string; details?: unknown; cause?: unknown } = {},
  ) {
    super(options.message ?? code, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.userMessage = options.userMessage ?? defaultUserMessage(code);
    this.details = options.details;
  }
}

function defaultUserMessage(code: ErrorCode): string {
  switch (code) {
    case 'VALIDATION_ERROR':
      return '提交的内容有误，请检查后重试。';
    case 'UNAUTHORIZED':
      return '请先登录。';
    case 'FORBIDDEN':
      return '你没有权限访问这份内容。';
    case 'NOT_FOUND':
      return '没有找到对应的内容。';
    case 'CONFLICT':
      return '这条内容已存在。';
    case 'RATE_LIMITED':
      return '提问太快了，休息一下再继续吧。';
    case 'AI_NOT_CONFIGURED':
      return 'AI 尚未配置。当前是示例（Mock）模式，可在「设置」中查看配置指引。';
    case 'AI_TIMEOUT':
      return 'AI 响应超时了，可以稍后再试，或把问题拆小一点。';
    case 'AI_UPSTREAM_ERROR':
      return 'AI 服务暂时不可用，请稍后重试。';
    case 'AI_CAPABILITY_UNSUPPORTED':
      return '当前配置的模型不支持这个功能，可以选择手动录入或更换模型配置。';
    case 'AI_INVALID_OUTPUT':
      return 'AI 返回的内容格式不符合要求，请重试一次。';
    case 'UPLOAD_REJECTED':
      return '文件不符合要求，请检查格式和大小。';
    case 'UNSUPPORTED':
      return '该功能尚未实现。';
    case 'INTERNAL_ERROR':
    default:
      return '服务器出了点问题，请稍后重试。';
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** 把任意异常规整成 AppError；非 AppError 一律视为内部错误，不泄露原始信息。 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  return new AppError('INTERNAL_ERROR', {
    message: error instanceof Error ? error.message : String(error),
    cause: error,
  });
}
