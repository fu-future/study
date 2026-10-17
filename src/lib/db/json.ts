import { z } from 'zod';

/**
 * JSON TEXT 读写工具。
 *
 * 背景：为了让数据模型同时兼容 SQLite 与 PostgreSQL，schema 里没有使用 Json 类型，
 * 结构化的小数据一律以 TEXT 存 JSON 字符串（见 prisma/schema.prisma 顶部约定）。
 * 本模块负责这一层的安全序列化/反序列化 —— 任何损坏或不合规的旧数据都不会让页面崩掉，
 * 而是回退到安全默认值，并把问题交给调用方决定是否修复。
 */

/** 安全序列化：循环引用、undefined 等异常输入都会退化为可用的默认值。 */
export function toJsonText(value: unknown, fallback = '[]'): string {
  try {
    const text = JSON.stringify(value);
    return typeof text === 'string' ? text : fallback;
  } catch {
    return fallback;
  }
}

export type ParseResult<T> = {
  value: T;
  /** 解析或校验失败时为 true —— 调用方应把它当作「脏数据」提示，而不是静默忽略 */
  degraded: boolean;
};

/**
 * 解析 JSON TEXT 并用 Zod 校验。
 * 任何失败都返回 fallback，同时把 degraded 标为 true。
 */
export function parseJsonText<T>(raw: string | null | undefined, schema: z.ZodType<T>, fallback: T): ParseResult<T> {
  if (raw === null || raw === undefined || raw === '') {
    return { value: fallback, degraded: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { value: fallback, degraded: true };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    return { value: fallback, degraded: true };
  }

  return { value: result.data, degraded: false };
}

// -----------------------------------------------------------------------------
// 常用类型的便捷读写
// -----------------------------------------------------------------------------

const stringArraySchema = z.array(z.string());

/** 读取字符串数组字段（如 choices / errorTypes / commonMistakes） */
export function readStringArray(raw: string | null | undefined): string[] {
  return parseJsonText(raw, stringArraySchema, []).value;
}

/** 写入字符串数组字段，自动去重并裁掉空串 */
export function writeStringArray(values: readonly string[] | null | undefined): string {
  const cleaned = Array.from(new Set((values ?? []).map((v) => String(v).trim()).filter(Boolean)));
  return toJsonText(cleaned);
}

const numberRecordSchema = z.record(z.string(), z.number());

/** 读取 { [key]: number } 字段（如 repeatedErrorTypes 统计） */
export function readNumberRecord(raw: string | null | undefined): Record<string, number> {
  return parseJsonText(raw, numberRecordSchema, {}).value;
}

export function writeNumberRecord(record: Record<string, number>): string {
  const cleaned: Record<string, number> = {};
  for (const [key, value] of Object.entries(record)) {
    if (Number.isFinite(value)) cleaned[key] = value;
  }
  return toJsonText(cleaned, '{}');
}

const objectSchema = z.record(z.string(), z.unknown());

/** 读取任意对象字段（如 rationale / metadata / result） */
export function readObject(raw: string | null | undefined): Record<string, unknown> {
  return parseJsonText(raw, objectSchema, {}).value;
}

export function writeObject(value: Record<string, unknown> | null | undefined): string {
  return toJsonText(value ?? {}, '{}');
}
