import { execFile } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { DEV_DB_PATH, E2E_DB_PATH, E2E_DIST_DIR, E2E_ENV, E2E_UPLOAD_DIR, PROJECT_ROOT } from './env';

const execFileAsync = promisify(execFile);

/**
 * E2E 全局准备。
 *
 * 做四件事：
 *   1. 建立 E2E 专用目录（.data、上传目录）
 *   2. 若上次遗留的 `.next-e2e` 还在，**改名**保留而不是删除
 *      （本机沙箱会拦截批量删除；改名同样能让 Next 拿到干净的构建目录）
 *   3. 对 **E2E 专用数据库** 执行迁移（`prisma migrate deploy`）
 *      —— 顺带验证了迁移文件本身可用
 *   4. 写入演示数据（复用正式 seed 脚本，也顺带验证了它）
 *
 * 安全护栏：执行前后比对开发库 `dev.db` 的 mtime/大小，
 * 一旦发现被改动就直接抛错终止 —— E2E 绝不允许污染开发数据。
 */

async function fileSignature(filePath: string): Promise<string> {
  try {
    const info = await stat(filePath);
    return `${info.size}:${info.mtimeMs}`;
  } catch {
    return 'missing';
  }
}

function run(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const bin = process.platform === 'win32' ? `${command}.cmd` : command;
  return execFileAsync(bin, args, {
    cwd: PROJECT_ROOT,
    env: { ...process.env, ...E2E_ENV },
    maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
}

export default async function globalSetup(): Promise<void> {
  if (E2E_DB_PATH === DEV_DB_PATH) {
    throw new Error(
      '[e2e] 配置错误：E2E 数据库与开发数据库是同一个文件，会破坏开发数据。已中止。',
    );
  }

  const devDbBefore = await fileSignature(DEV_DB_PATH);

  console.log('[e2e] 开发库（只读保护）:', DEV_DB_PATH);
  console.log('[e2e] 测试库（本次使用）:', E2E_DB_PATH);

  await mkdir(path.join(PROJECT_ROOT, '.data'), { recursive: true });
  await mkdir(path.join(PROJECT_ROOT, E2E_UPLOAD_DIR), { recursive: true });

  // 注意：**不能**在这里清理 `.next-e2e`。
  // Playwright 会先启动 webServer 再执行 globalSetup，此时 dev server 已经占用
  // 了构建目录里的文件，rename 会失败（EPERM）。清理工作放在
  // `npm run test:e2e` 的 pretest 钩子里（脚本 scripts/reset-e2e-distdir.mjs），
  // 那时服务器还没起来。
  console.log(`[e2e] 构建目录：${E2E_DIST_DIR}（清理由 pretest 钩子负责）`);

  console.log('[e2e] 对测试库执行迁移…');
  const migrate = await run('npx', ['prisma', 'migrate', 'deploy']);
  const applied = migrate.stdout
    .split('\n')
    .filter((line) => line.includes('migration') || line.includes('applied') || line.includes('No pending'))
    .slice(0, 6)
    .join('\n');
  console.log(applied || migrate.stdout.slice(0, 500));

  console.log('[e2e] 写入演示数据…');
  const seed = await run('npx', ['prisma', 'db', 'seed']);
  console.log(
    seed.stdout
      .split('\n')
      .filter((line) => line.trim().startsWith('  ') || line.includes('演示数据写入完成'))
      .join('\n'),
  );

  const devDbAfter = await fileSignature(DEV_DB_PATH);
  if (devDbBefore !== devDbAfter) {
    throw new Error(
      `[e2e] 检测到开发数据库被改动（${devDbBefore} → ${devDbAfter}）。E2E 绝不允许污染开发数据，已中止。`,
    );
  }
  console.log('[e2e] 确认开发数据库未被触碰 ✅');
}
