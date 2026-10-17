import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * 密码哈希（scrypt）。
 *
 * 选 scrypt 而不是 bcrypt/argon2 的原因：Node 内置，不需要额外原生依赖，
 * 对于一个「只装 Node 就能跑」的第一版来说是合适的默认方案。
 *
 * 存储格式：`scrypt$N$r$p$<saltHex>$<hashHex>`
 *   - 参数写进字符串，将来调整成本参数时可以平滑升级
 *   - 明文密码永不落库、永不进日志
 */

const KEY_LEN = 64;
const SALT_BYTES = 16;

// Node 的 scrypt 默认 N=16384,r=8,p=1，这里显式写出来以便未来升级
const N = 16384;
const R = 8;
const P = 1;

export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('密码至少需要 8 个字符');
  }
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password, salt, KEY_LEN);
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/**
 * 校验密码。使用 timingSafeEqual 做定长时间比较，避免时序侧信道。
 * 任何格式异常都返回 false，不抛错（避免把内部结构暴露给登录接口）。
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6) return false;

    const [algo, nStr, rStr, pStr, saltHex, hashHex] = parts as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    if (algo !== 'scrypt') return false;

    const n = Number(nStr);
    const r = Number(rStr);
    const p = Number(pStr);
    if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    if (salt.length === 0 || expected.length === 0) return false;

    const derived = (await scrypt(password, salt, expected.length)) as Buffer;
    if (derived.length !== expected.length) return false;

    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
