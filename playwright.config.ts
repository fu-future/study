import { defineConfig, devices } from '@playwright/test';
import { E2E_BASE_URL, E2E_ENV, E2E_PORT } from './e2e/env';

/**
 * Playwright 配置。
 *
 * ┌─ 隔离原则（非常重要）────────────────────────────────────────────────────┐
 * │ 1. 专用端口 3300：**不会**碰正在运行的开发服务器（3100）。              │
 * │ 2. 专用数据库 `.data/e2e.db`：**绝不**清理或写入开发库 `.data/dev.db`。 │
 * │ 3. 专用上传目录 `.data/e2e-uploads`：与开发时的上传文件隔离。           │
 * │ 4. 专用构建目录 `.next-e2e`：避免与开发服务器争抢 `.next`。             │
 * │ 5. 每个用例自己注册独立账号（带随机后缀），用例之间数据互不干扰。        │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * 环境定义集中在 `e2e/env.ts`，保证 webServer 与 globalSetup 用的是同一套变量。
 * 本配置**不关闭任何安全校验** —— 认证、数据归属、上传限制全部保持开启，
 * 因为它们是否真的生效正是要验证的对象。
 */
export default defineConfig({
  testDir: './e2e',
  // 只跑 *.spec.ts，避免把 env.ts / global-setup.ts / helpers.ts 当成用例
  testMatch: /.*\.spec\.ts$/,
  globalSetup: './e2e/global-setup.ts',

  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  // 串行执行：多个 worker 同时打 dev server 会触发重复编译，反而更慢更不稳
  workers: 1,
  fullyParallel: false,

  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: E2E_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: `npx next dev -p ${E2E_PORT}`,
    // 用 health 接口作为就绪探测：它同时验证了数据库连通性
    url: `${E2E_BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...E2E_ENV, PORT: String(E2E_PORT) },
  },
});
