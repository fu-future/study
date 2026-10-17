import { NextResponse } from 'next/server';
import { withApiHandler } from '@/lib/api/http';
import { requireUser } from '@/lib/auth/current-user';
import { readUpload } from '@/lib/storage/uploads';

/**
 * 读取题目图片。
 *
 * 图片刻意不放在 public/ 下，因此这里是唯一的访问通道 ——
 * 必须登录才能读，这样即使文件名（UUID）泄漏也无法被未授权者取走。
 * 路径穿越由 storage 层的形态校验 + 归一化双重拦截。
 */
export const GET = withApiHandler(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await requireUser();
    const { id } = await params;

    const { bytes, mimeType } = await readUpload(id);

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': mimeType,
        // 私有缓存：允许浏览器短期缓存，但禁止代理把它当成公共资源
        'Cache-Control': 'private, max-age=3600',
      },
    });
  },
);
