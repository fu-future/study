import { AppError, type ErrorCode } from '@/lib/errors';

/**
 * AI 层的错误类型。
 *
 * 为什么要单独一层：AI 的失败模式比普通业务多（超时、上游 5xx、限流、
 * 模型不支持某个能力、结构化输出不合规）。把这些区分开，界面才能给出
 * 可操作的提示，而不是一律「服务器错误」。
 */

export type AiErrorCode =
  | 'AI_NOT_CONFIGURED'
  | 'AI_TIMEOUT'
  | 'AI_UPSTREAM_ERROR'
  | 'AI_CAPABILITY_UNSUPPORTED'
  | 'AI_INVALID_OUTPUT'
  | 'AI_RATE_LIMITED'
  | 'AI_INPUT_TOO_LONG'
  | 'AI_ABORTED';

export class AiError extends AppError {
  readonly aiCode: AiErrorCode;
  /** 上游返回的状态码（如果有），便于排查，但不含响应体全文 */
  readonly upstreamStatus?: number;

  constructor(
    code: AiErrorCode,
    options: {
      message?: string;
      userMessage?: string;
      details?: unknown;
      cause?: unknown;
      upstreamStatus?: number;
    } = {},
  ) {
    // 复用 AppError 的 HTTP 映射，保持 API 层统一
    super(mapToAppErrorCode(code), options);
    this.name = 'AiError';
    this.aiCode = code;
    this.upstreamStatus = options.upstreamStatus;
  }
}

function mapToAppErrorCode(code: AiErrorCode): ErrorCode {
  switch (code) {
    case 'AI_NOT_CONFIGURED':
      return 'AI_NOT_CONFIGURED';
    case 'AI_TIMEOUT':
      return 'AI_TIMEOUT';
    case 'AI_CAPABILITY_UNSUPPORTED':
      return 'AI_CAPABILITY_UNSUPPORTED';
    case 'AI_INVALID_OUTPUT':
      return 'AI_INVALID_OUTPUT';
    case 'AI_RATE_LIMITED':
      return 'RATE_LIMITED';
    case 'AI_INPUT_TOO_LONG':
      return 'VALIDATION_ERROR';
    case 'AI_ABORTED':
      return 'INTERNAL_ERROR';
    case 'AI_UPSTREAM_ERROR':
    default:
      return 'AI_UPSTREAM_ERROR';
  }
}

/** 上游是否值得重试：超时、5xx、429 值得；4xx（参数/权限）不值得。 */
export function isRetryableAiError(error: unknown): boolean {
  if (!(error instanceof AiError)) return false;
  switch (error.aiCode) {
    case 'AI_TIMEOUT':
    case 'AI_UPSTREAM_ERROR':
    case 'AI_INVALID_OUTPUT':
      return true;
    case 'AI_RATE_LIMITED':
      // 上游限流可以重试，但要退避；这里交给上层退避策略
      return true;
    default:
      return false;
  }
}

export function notConfigured(providerId: string): AiError {
  return new AiError('AI_NOT_CONFIGURED', {
    message: `AI provider "${providerId}" 未正确配置`,
    userMessage:
      'AI 尚未配置。当前可以使用 Mock 模式继续开发和测试，或在 .env 中填写 AI_API_KEY 后重启。',
  });
}

export function capabilityUnsupported(capability: string, providerId: string, hint?: string): AiError {
  return new AiError('AI_CAPABILITY_UNSUPPORTED', {
    message: `provider "${providerId}" 不支持 ${capability}`,
    userMessage: hint ?? `当前配置的模型不支持「${capability}」。可以改用手动录入，或更换模型配置。`,
  });
}
