#!/usr/bin/env node
import { cp, mkdir, copyFile, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * 把学习数据备份到 .data/backups/<时间戳>/。
 *
 * 备份什么：
 *   - SQLite 数据库文件（.data/dev.db）：账号、错题、作答、掌握度、计划都在里面
 *   - 上传的题目图片（.data/uploads）：数据库里只存文件名，图片本身在磁盘上
 *
 * ⚠️ 为什么建议先停服务再备份：
 *   SQLite 在写入过程中，数据库文件可能处于"写到一半"的状态。
 *   直接复制有可能拿到一个不一致的副本（虽然概率低）。
 *   停服务再备份最稳；不停也行，但要知道这个前提。
 *
 * 不备份 .env：里面有 API Key 与会话密钥，
 *   备份文件往往会被拷到网盘/U 盘，密钥跟着数据一起漂出去不是好事。
 */

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, '.data');
const BACKUP_ROOT = path.join(DATA_DIR, 'backups');

function timestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function directorySize(dir) {
  let total = 0;
  if (!existsSync(dir)) return 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await directorySize(full);
    else total += (await stat(full)).size;
  }
  return total;
}

async function main() {
  const dbFile = path.join(DATA_DIR, 'dev.db');
  if (!existsSync(dbFile)) {
    console.error(`找不到数据库文件：${dbFile}`);
    console.error('如果你改过 DATABASE_URL，请按实际路径手动备份。');
    process.exit(1);
  }

  const target = path.join(BACKUP_ROOT, timestamp());
  await mkdir(target, { recursive: true });

  await copyFile(dbFile, path.join(target, 'dev.db'));
  const dbSize = (await stat(dbFile)).size;

  const uploadsDir = path.join(DATA_DIR, 'uploads');
  let uploadsSize = 0;
  let uploadsCount = 0;
  if (existsSync(uploadsDir)) {
    uploadsSize = await directorySize(uploadsDir);
    uploadsCount = (await readdir(uploadsDir)).length;
    await cp(uploadsDir, path.join(target, 'uploads'), { recursive: true });
  }

  console.log('备份完成');
  console.log(`  位置：${path.relative(ROOT, target)}`);
  console.log(`  数据库：${formatBytes(dbSize)}`);
  console.log(`  图片：${uploadsCount} 个文件 / ${formatBytes(uploadsSize)}`);
  console.log('');
  console.log('恢复方法：停止服务，把备份里的 dev.db 与 uploads/ 覆盖回 .data/ 即可。');
  console.log('注意：备份里有学生的全部学习记录，不要随意上传到网盘或发给别人。');
}

await main();
