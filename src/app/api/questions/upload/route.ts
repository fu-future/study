import { withApiHandler, jsonOk } from '@/lib/api/http';
import { AppError } from '@/lib/errors';
import { requireUser } from '@/lib/auth/current-user';
import { saveQuestionImage, uploadUrl } from '@/lib/storage/uploads';

/**
 * 题目图片上传。
 *
 * 只接受 multipart/form-data 的 `file` 字段。
 * 真正的格式校验（魔数）与大小上限在 storage 层完成 —— 这里只做
 * 「有没有文件」这一层判断，避免把二进制内容读进内存后才发现没传文件。
 */
export const POST = withApiHandler(async (request: Request) => {
  await requireUser();

  const formData = await request.formData();
  const file = formData.get('file');

  if (!(file instanceof File)) {
    throw new AppError('VALIDATION_ERROR', { userMessage: '请选择要上传的题目图片。' });
  }
  if (file.size <= 0) {
    throw new AppError('UPLOAD_REJECTED', { userMessage: '这个文件是空的，请重新选择。' });
  }

  const stored = await saveQuestionImage({
    bytes: Buffer.from(await file.arrayBuffer()),
    declaredMime: file.type || null,
    originalName: file.name,
  });

  return jsonOk({
    uploadId: stored.id,
    mimeType: stored.mimeType,
    bytes: stored.bytes,
    url: uploadUrl(stored.id),
  });
});
