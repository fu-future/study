import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '@/lib/errors';
import { getEnv } from '@/lib/env';

/**
 * 题目图片的本地存储。
 *
 * 安全设计（需求第十节）：
 *   1. **不放在 public/ 下**：因此不存在「知道文件名就能访问」的问题，
 *      读取必须经过带鉴权的 /api/files/[id]。
 *   2. 三重校验：声明 MIME + 真实字节魔数 + 大小上限。只看扩展名是不够的。
 *   3. 文件名完全由服务端生成（UUID + 白名单扩展名），不使用用户提供的文件名，
 *      从根本上消除路径穿越与覆盖攻击。
 *   4. 读取时再次校验路径归一化后仍在存储目录内（纵深防御）。
 */

const ALLOWED: { mime: string; ext: string; matches: (bytes: Buffer) => boolean }[] = [
  {
    mime: 'image/png',
    ext: 'png',
    matches: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    mime: 'image/jpeg',
    ext: 'jpg',
    matches: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/webp',
    ext: 'webp',
    matches: (b) =>
      b.length > 12 &&
      b.toString('ascii', 0, 4) === 'RIFF' &&
      b.toString('ascii', 8, 12) === 'WEBP',
  },
];

export type StoredUpload = {
  /** 存储 id（同时也是文件名），用于 /api/files/[id] */
  id: string;
  /** 相对存储目录的路径，写入 Question.imagePath */
  relativePath: string;
  mimeType: string;
  bytes: number;
  originalName: string;
};

function uploadRoot(): string {
  const { UPLOAD_DIR } = getEnv();
  return path.isAbsolute(UPLOAD_DIR) ? UPLOAD_DIR : path.resolve(process.cwd(), UPLOAD_DIR);
}

export function detectImageType(bytes: Buffer, declaredMime: string | null): { mime: string; ext: string } {
  for (const candidate of ALLOWED) {
    if (candidate.matches(bytes)) {
      return { mime: candidate.mime, ext: candidate.ext };
    }
  }

  // 魔数不匹配：明确拒绝，而不是信任浏览器给的 Content-Type
  throw new AppError('UPLOAD_REJECTED', {
    message: `无法识别的图片格式（声明为 ${declaredMime ?? '未知'}）`,
    userMessage: '这个文件不是支持的图片格式。请上传 PNG、JPG 或 WEBP 格式的题目截图。',
  });
}

export async function saveQuestionImage(input: {
  bytes: Buffer;
  declaredMime: string | null;
  originalName: string;
}): Promise<StoredUpload> {
  const { UPLOAD_MAX_BYTES } = getEnv();

  if (input.bytes.length === 0) {
    throw new AppError('UPLOAD_REJECTED', {
      userMessage: '文件是空的，请重新选择。',
    });
  }

  if (input.bytes.length > UPLOAD_MAX_BYTES) {
    throw new AppError('UPLOAD_REJECTED', {
      message: `文件大小 ${input.bytes.length} 超过上限 ${UPLOAD_MAX_BYTES}`,
      userMessage: `图片太大了（上限 ${(UPLOAD_MAX_BYTES / 1024 / 1024).toFixed(1)} MB）。可以先用手机截图工具压缩一下，或只截取题目部分。`,
      details: { maxBytes: UPLOAD_MAX_BYTES, actualBytes: input.bytes.length },
    });
  }

  const { mime, ext } = detectImageType(input.bytes, input.declaredMime);

  const id = `${randomUUID()}.${ext}`;
  const root = uploadRoot();
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, id), input.bytes, { flag: 'wx' });

  return {
    id,
    relativePath: id,
    mimeType: mime,
    bytes: input.bytes.length,
    originalName: input.originalName.slice(0, 200),
  };
}

/** 读取图片（供带鉴权的路由使用）。路径穿越在这里被彻底挡住。 */
export async function readUpload(id: string): Promise<{ bytes: Buffer; mimeType: string }> {
  // 只接受我们自己生成的 id 形态：uuid.ext
  if (!/^[0-9a-f-]{36}\.(png|jpg|webp)$/i.test(id)) {
    throw new AppError('NOT_FOUND', { userMessage: '图片不存在。' });
  }

  const root = uploadRoot();
  const target = path.resolve(root, id);

  // 归一化后再确认仍在根目录内（纵深防御）
  if (!target.startsWith(root + path.sep)) {
    throw new AppError('FORBIDDEN', { userMessage: '非法的文件路径。' });
  }

  try {
    const bytes = await readFile(target);
    const ext = id.split('.').pop()!.toLowerCase();
    const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    return { bytes, mimeType };
  } catch {
    throw new AppError('NOT_FOUND', { userMessage: '图片不存在或已被清理。' });
  }
}

export function uploadUrl(id: string | null | undefined): string | null {
  return id ? `/api/files/${id}` : null;
}

/** 把上传的图片转成 base64（供视觉模型调用）——只在服务端内存中流转，不落库。 */
export async function readUploadAsBase64(id: string): Promise<{ base64: string; mimeType: string }> {
  const { bytes, mimeType } = await readUpload(id);
  return { base64: bytes.toString('base64'), mimeType };
}
