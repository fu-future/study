import { getEnv } from '@/lib/env';

/**
 * 轻量结构化日志。
 *
 * 目标：可观测但不泄密。
 *   - 绝不记录密码、API Key、完整提示词、学生答案原文、文件内容。
 *   - 开发环境输出带时间戳的可读行；生产环境输出单行 JSON，便于采集。
 *   - 不做远程上报，避免把学习数据发到第三方。
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** 已知的敏感字段名 —— 出现即脱敏，作为最后一道防线。 */
const SENSITIVE_KEY_PATTERN = /(password|passwd|secret|token|apikey|api_key|authorization|cookie)/i;

function maskValue(value: unknown): unknown {
  if (typeof value === 'string') {
    // 长字符串整体打码，长度保留，便于排查「是不是超长」
    return value.length > 8 ? `[redacted:${value.length}]` : '[redacted]';
  }
  return '[redacted]';
}

function sanitize(meta: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      safe[key] = maskValue(value);
      continue;
    }
    if (value === null || value === undefined) {
      safe[key] = value;
    } else if (typeof value === 'object') {
      // 只做一层展开，避免日志体积失控
      if (Array.isArray(value)) {
        safe[key] = `[array:${value.length}]`;
      } else {
        safe[key] = sanitize(value as Record<string, unknown>);
      }
    } else if (typeof value === 'string' && value.length > 400) {
      safe[key] = `${value.slice(0, 400)}…[+${value.length - 400}]`;
    } else {
      safe[key] = value;
    }
  }
  return safe;
}

let cachedLevel: Level | null = null;

function currentLevel(): Level {
  if (cachedLevel) return cachedLevel;
  try {
    cachedLevel = getEnv().LOG_LEVEL;
  } catch {
    // 环境变量还没配好时也要能打日志（否则报错信息会被吞掉）
    cachedLevel = 'info';
  }
  return cachedLevel;
}

function emit(level: Level, event: string, meta?: Record<string, unknown>): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[currentLevel()]) return;

  const payload = meta ? sanitize(meta) : undefined;
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${event}`;
    if (level === 'error') console.error(line, payload ?? '');
    else if (level === 'warn') console.warn(line, payload ?? '');
    else console.log(line, payload ?? '');
    return;
  }

  const record = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...(payload ?? {}),
  });
  if (level === 'error') console.error(record);
  else console.log(record);
}

export const logger = {
  debug: (event: string, meta?: Record<string, unknown>) => emit('debug', event, meta),
  info: (event: string, meta?: Record<string, unknown>) => emit('info', event, meta),
  warn: (event: string, meta?: Record<string, unknown>) => emit('warn', event, meta),
  error: (event: string, meta?: Record<string, unknown>) => emit('error', event, meta),
};
