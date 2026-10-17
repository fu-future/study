import path from 'node:path';

/**
 * E2E 运行环境定义（Playwright 配置与 globalSetup 共用，保证两边完全一致）。
 *
 * ⚠️ 隔离原则：E2E 有自己的端口、数据库、上传目录、构建目录，
 *    **不会**读写开发用的 `.data/dev.db` 与 `.data/uploads`。
 *
 * ⚠️ 这里没有任何降级开关：认证、数据归属校验、上传限制全部保持生产行为，
 *    因为「它们是否真的生效」正是 E2E 要验证的内容之一。
 *
 * 注意：这里用 `process.cwd()` 而不是 `import.meta.url` ——
 * Playwright 会把配置编译成 CommonJS 再加载，`import.meta` 在 CJS 下不可用。
 * 因此 E2E **必须在项目根目录执行**（`npm run test:e2e` 已满足）。
 */
export const PROJECT_ROOT = process.cwd();

export const E2E_PORT = Number(process.env.E2E_PORT || 3300);
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

/** 独立的 SQLite 文件（相对 prisma/ 目录解析 → <项目根>/.data/e2e.db） */
export const E2E_DATABASE_URL = 'file:../.data/e2e.db';

/** 独立的上传目录（相对项目根） */
export const E2E_UPLOAD_DIR = '.data/e2e-uploads';

/** 独立的构建目录，避免与开发服务器争抢 `.next` */
export const E2E_DIST_DIR = '.next-e2e';

/** 传给 Next 服务与 Prisma CLI 的环境变量 */
export const E2E_ENV: Record<string, string> = {
  DATABASE_URL: E2E_DATABASE_URL,
  UPLOAD_DIR: E2E_UPLOAD_DIR,
  NEXT_DIST_DIR: E2E_DIST_DIR,
  AI_PROVIDER: 'mock',
  AI_BASE_URL: '',
  AI_API_KEY: '',
  AI_MODEL: '',
  AI_VISION_MODEL: '',
  AI_TIMEOUT_MS: '30000',
  AI_MAX_RETRIES: '2',
  AI_MAX_INPUT_CHARS: '24000',
  AI_MAX_OUTPUT_TOKENS: '2048',
  // 限流放宽（否则并发用例会互相触发限流），但**限流功能本身仍开启**
  AI_RATE_LIMIT_PER_MINUTE: '200',
  RESOURCE_SEARCH_PROVIDER: 'internal-only',
  RESOURCE_SEARCH_API_KEY: '',
  RESOURCE_SEARCH_BASE_URL: '',
  RESOURCE_SEARCH_TIMEOUT_MS: '8000',
  APP_URL: E2E_BASE_URL,
  // 仅用于本地 E2E 的签名密钥；不是生产密钥，也不含任何真实凭据
  SESSION_SECRET: 'e2e-test-only-secret-not-for-production-0123456789',
  UPLOAD_MAX_BYTES: '5242880',
  DATA_RETENTION_DAYS: '730',
  ALLOW_SELF_SIGNUP: 'true',
  LOG_LEVEL: 'warn',
};

/** 开发库与 E2E 库的绝对路径（用于安全断言：E2E 绝不触碰开发库） */
export const DEV_DB_PATH = path.join(PROJECT_ROOT, '.data', 'dev.db');
export const E2E_DB_PATH = path.join(PROJECT_ROOT, '.data', 'e2e.db');
