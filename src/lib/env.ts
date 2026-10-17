import { z } from 'zod';

/**
 * 环境变量校验（服务端专用）。
 *
 * 设计要点：
 *   1. 只在**服务端**执行。任何客户端组件都不得引入本模块（会在运行时抛错保护）。
 *   2. 启动时一次性校验，缺失或非法直接抛错，避免「跑起来了但功能是坏的」。
 *   3. 密钥类变量的值**永远不出现在错误信息里**，只报字段名。
 *   4. 业务逻辑不读 process.env —— 统一从这里取，保证「业务逻辑不依赖 SQLite 文件路径」。
 */

if (typeof window !== 'undefined') {
  throw new Error(
    '[env] 环境变量模块只能在服务端使用。客户端组件请通过 API 路由获取数据，切勿直接读取服务端配置。',
  );
}

// -----------------------------------------------------------------------------
// Schema
// -----------------------------------------------------------------------------

const providerSchema = z.enum(['mock', 'deepseek', 'openai-compatible']);
const resourceProviderSchema = z.enum(['internal-only', 'tavily', 'custom-json']);

const rawSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // 数据库：第一阶段是 SQLite 文件；未来可选 PostgreSQL。
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL 不能为空')
    .refine(
      (v) => v.startsWith('file:') || v.startsWith('postgresql://') || v.startsWith('postgres://'),
      'DATABASE_URL 必须是以 file: 开头的 SQLite 路径，或以 postgresql:// 开头的连接串',
    ),

  // AI Provider
  AI_PROVIDER: providerSchema.default('mock'),
  AI_BASE_URL: z.string().url('AI_BASE_URL 必须是合法 URL').or(z.literal('')).optional(),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  AI_VISION_MODEL: z.string().optional(),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().max(300_000).default(30_000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  AI_MAX_INPUT_CHARS: z.coerce.number().int().positive().default(24_000),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().max(32_000).default(2_048),
  AI_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),

  // 资源检索 Provider
  RESOURCE_SEARCH_PROVIDER: resourceProviderSchema.default('internal-only'),
  RESOURCE_SEARCH_API_KEY: z.string().optional(),
  RESOURCE_SEARCH_BASE_URL: z.string().url().or(z.literal('')).optional(),
  RESOURCE_SEARCH_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(8_000),

  // 应用
  APP_URL: z.string().url().default('http://localhost:3000'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET 至少需要 32 个字符'),

  // 上传
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().max(50 * 1024 * 1024).default(5 * 1024 * 1024),
  UPLOAD_DIR: z.string().default('.data/uploads'),
  DATA_RETENTION_DAYS: z.coerce.number().int().positive().default(730),

  ALLOW_SELF_SIGNUP: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Env = z.infer<typeof rawSchema> & {
  /** 当前数据源方言。业务逻辑不应依赖它，只用于日志/诊断与迁移提示。 */
  dbDialect: 'sqlite' | 'postgresql';
  /** AI Provider 是否已配置好可用凭证 */
  aiConfigured: boolean;
};

// -----------------------------------------------------------------------------
// 解析
// -----------------------------------------------------------------------------

/** 只在错误信息里暴露字段名与原因，绝不回显变量值（可能含密钥）。 */
function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

let cached: Env | null = null;

/**
 * 读取并校验环境变量。结果会被缓存。
 * 测试环境可通过 `resetEnvCache()` 在修改 process.env 后重新解析。
 */
export function getEnv(): Env {
  if (cached) return cached;

  const parsed = rawSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `[env] 环境变量校验失败，请对照 .env.example 检查 .env：\n${formatIssues(parsed.error)}`,
    );
  }

  const value = parsed.data;

  // Provider 级别的交叉校验：选了一个真实 provider 却没有 key，就明确报错，
  // 而不是等到第一次调用 AI 时才失败。mock 不需要 key。
  if (value.AI_PROVIDER !== 'mock' && !value.AI_API_KEY) {
    throw new Error(
      `[env] AI_PROVIDER=${value.AI_PROVIDER} 需要 AI_API_KEY，但该变量为空。` +
        `本地开发可先设为 AI_PROVIDER=mock（无需密钥）。`,
    );
  }
  if (value.AI_PROVIDER === 'openai-compatible' && !value.AI_BASE_URL) {
    throw new Error('[env] AI_PROVIDER=openai-compatible 需要同时设置 AI_BASE_URL。');
  }

  const dbDialect: Env['dbDialect'] = value.DATABASE_URL.startsWith('file:') ? 'sqlite' : 'postgresql';

  cached = {
    ...value,
    dbDialect,
    aiConfigured: value.AI_PROVIDER !== 'mock' && Boolean(value.AI_API_KEY),
  };

  return cached;
}

/** 仅在测试中使用：清空缓存，让下次 getEnv() 重新解析 process.env。 */
export function resetEnvCache(): void {
  cached = null;
}

/**
 * 不抛错的探测版本，用于 /api/health 与 /settings 页面展示配置状态。
 * 只返回「有没有配」，不返回任何值。
 */
export function describeEnvStatus(): {
  ok: boolean;
  missing: string[];
  dbDialect: 'sqlite' | 'postgresql' | 'unknown';
  aiProvider: string;
  aiConfigured: boolean;
  aiVisionConfigured: boolean;
  errors: string[];
} {
  const parsed = rawSchema.safeParse(process.env);

  if (!parsed.success) {
    return {
      ok: false,
      missing: parsed.error.issues.map((i) => i.path.join('.') || '(root)'),
      dbDialect: 'unknown',
      aiProvider: (process.env.AI_PROVIDER ?? 'mock') as string,
      aiConfigured: false,
      aiVisionConfigured: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  }

  const v = parsed.data;
  const errors: string[] = [];
  if (v.AI_PROVIDER !== 'mock' && !v.AI_API_KEY) {
    errors.push(`AI_PROVIDER=${v.AI_PROVIDER} 但未设置 AI_API_KEY`);
  }
  if (v.AI_PROVIDER === 'openai-compatible' && !v.AI_BASE_URL) {
    errors.push('AI_PROVIDER=openai-compatible 但未设置 AI_BASE_URL');
  }

  return {
    ok: errors.length === 0,
    missing: [],
    dbDialect: v.DATABASE_URL.startsWith('file:') ? 'sqlite' : 'postgresql',
    aiProvider: v.AI_PROVIDER,
    aiConfigured: v.AI_PROVIDER !== 'mock' && Boolean(v.AI_API_KEY),
    aiVisionConfigured: Boolean(v.AI_VISION_MODEL),
    errors,
  };
}
