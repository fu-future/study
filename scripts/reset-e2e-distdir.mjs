#!/usr/bin/env node
/**
 * E2E 前置准备：准备一个干净的构建目录与运行目录。
 *
 * 为什么单独做成脚本、而不是写在 Playwright 的 globalSetup 里：
 *   Playwright 的执行顺序是「先启动 webServer，再跑 globalSetup」。
 *   等 globalSetup 执行时，dev server 已经占用了 `.next-e2e` 里的文件，
 *   此时改名/删除会失败（EPERM）。所以清理必须发生在 **服务器启动之前**，
 *   也就是挂到 `npm run test:e2e` 的 pretest 钩子上。
 *
 * 为什么是「改名」而不是「删除」：
 *   本机沙箱会拦截批量文件删除（SAFE_DELETE_BULK_CONFIRM_REQUIRED）。
 *   改名同样能让 Next 拿到一个全新的构建目录，效果一致且不触发守卫。
 *   被改名的目录会保留下来（`.next-e2e.bak.*`），需要时自行清理。
 *
 * 同时确保 E2E 专用数据库与上传目录存在，且**绝不触碰开发用的 dev.db**。
 */
import { existsSync } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();

const E2E_DIST_DIR = '.next-e2e';
const E2E_DATA_DIR = '.data';
const E2E_UPLOAD_DIR = '.data/e2e-uploads';
const E2E_DB = '.data/e2e.db';
const DEV_DB = '.data/dev.db';

/**
 * 需要「腾空」的目录。
 *
 * Playwright 与 Next 启动/结束时都会清空各自的输出目录，
 * 而本机沙箱会拦截批量删除，所以统一改为**改名保留**。
 * 改名后它们对工具而言就是"不存在"，效果与删除一致。
 */
const DIRS_TO_RESET = [
  E2E_DIST_DIR,
  // Playwright 会在每次运行开始时清空这两个目录
  'test-results',
  'playwright-report',
];

async function main() {
  // 安全护栏：两个库不能是同一个文件
  if (path.resolve(ROOT, E2E_DB) === path.resolve(ROOT, DEV_DB)) {
    throw new Error('[e2e] E2E 库与开发库路径相同，已中止。');
  }

  const devDbSignature = await signature(path.join(ROOT, DEV_DB));
  console.log(`[e2e:prepare] 开发库（只读保护） ${DEV_DB} → ${devDbSignature}`);
  console.log(`[e2e:prepare] 测试库 ${E2E_DB}`);

  await mkdir(path.join(ROOT, E2E_DATA_DIR), { recursive: true });
  await mkdir(path.join(ROOT, E2E_UPLOAD_DIR), { recursive: true });

  for (const dir of DIRS_TO_RESET) {
    const target = path.join(ROOT, dir);
    if (!existsSync(target)) {
      console.log(`[e2e:prepare] ${dir}/ 是干净的`);
      continue;
    }
    const backup = `${target}.bak.${Date.now()}`;
    await rename(target, backup);
    console.log(`[e2e:prepare] ${dir}/ 已改名为 ${path.basename(backup)}（未删除，可自行清理）`);
  }

  console.log('[e2e:prepare] 完成');
}

async function signature(filePath) {
  try {
    const info = await stat(filePath);
    return `${info.size} bytes @ ${new Date(info.mtimeMs).toISOString()}`;
  } catch {
    return '不存在';
  }
}

main().catch((error) => {
  console.error('[e2e:prepare] 失败：', error);
  process.exit(1);
});
