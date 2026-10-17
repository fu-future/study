import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Vitest 配置。
 *
 * 口径说明：
 *   - 只跑 src 目录下的单元测试文件：测试针对的是「纯函数业务逻辑」
 *     （诊断算法 / 复习调度 / 前置知识图 / 计划生成），它们不依赖数据库、
 *     不依赖 AI、不读环境变量，因此可以在完全离线的环境里稳定运行。
 *   - 明确排除 `e2e/**`：那里是 Playwright 的 spec，运行方式与环境完全不同，
 *     混进来会互相干扰。
 *   - `@/` 别名与 tsconfig.paths 保持一致，否则测试导入路径会和源码不一致。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**', 'e2e/**'],
    reporters: ['default'],
    // 纯函数测试，不需要并发隔离以外的环境准备
    globals: false,
  },
});
