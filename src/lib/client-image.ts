import { ApiError } from '@/lib/client-api';

/**
 * 上传前的图片预处理（纯浏览器端，不依赖任何服务端能力）。
 *
 * 为什么必须有这一步：
 *   手机相机直出照片普遍 3–12 MB，而后端单图上限是 5 MB。学生在手机上拍完直接上传，
 *   十有八九会撞到「图片太大」。而且为了几道题给服务器塞十几兆流量也不合理。
 *   压到长边 1600px、JPEG 0.88 之后通常只有 200–500 KB，
 *   打印体题目在这个分辨率下正文高度约 20px，OCR 依然清晰。
 *
 * 另一个作用：iPhone 的 HEIC 照片浏览器不一定能交给服务端识别。
 *   Safari 能解码 HEIC，于是这里顺手把它转成 JPEG —— 学生不用改手机设置也能直接拍。
 *
 * 三种结果：
 *   - 已经够小且格式受支持 → 原样返回（不重新编码，避免白白损失清晰度）
 *   - 需要处理 → 缩放到长边 1600px 后重编码
 *   - 浏览器解不开（常见于安卓 Chrome 遇到 HEIC）→ 抛出可读的错误，引导学生改用截图
 */

export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** 长边上限。再大对识别精度几乎没有帮助，只会拖慢上传和模型推理 */
export const MAX_IMAGE_EDGE = 1600;

/** 低于这个体积且格式受支持时原样上传 */
const SKIP_BELOW_BYTES = 900 * 1024;

export type PreparedImage = {
  file: File;
  /** 是否做过重编码 */
  compressed: boolean;
  originalBytes: number;
  bytes: number;
  width: number;
  height: number;
};

function isAcceptedType(type: string): boolean {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type);
}

type Decoded = {
  width: number;
  height: number;
  source: CanvasImageSource;
  release: () => void;
};

/**
 * 把 File 解码成可绘制的图像。
 *
 * 优先用 createImageBitmap（快、不占 DOM）；失败时退回 <img> 解码 ——
 * 少数浏览器的 createImageBitmap 不支持某些编码，但 <img> 能显示。
 */
async function decodeImage(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        width: bitmap.width,
        height: bitmap.height,
        source: bitmap,
        release: () => bitmap.close(),
      };
    } catch {
      // 继续尝试 <img>
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('decode-failed'));
      element.src = url;
    });
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      source: image,
      release: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new ApiError(
      '这张图片浏览器打不开（iPhone 的 HEIC 照片在部分浏览器会这样）。可以在相册里先截图再上传，或把相机格式改成「兼容性最佳」。',
      { code: 'IMAGE_UNSUPPORTED', status: 0 },
    );
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

export async function prepareImageForUpload(file: File): Promise<PreparedImage> {
  const declaredType = (file.type || '').toLowerCase();

  // 够小 + 格式受支持：完全不动它
  if (isAcceptedType(declaredType) && file.size <= SKIP_BELOW_BYTES) {
    return {
      file,
      compressed: false,
      originalBytes: file.size,
      bytes: file.size,
      width: 0,
      height: 0,
    };
  }

  const decoded = await decodeImage(file);

  try {
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
      // 极端情况下拿不到 2D 上下文（内存不足等），直接交回原图让服务端去判断
      return {
        file,
        compressed: false,
        originalBytes: file.size,
        bytes: file.size,
        width: decoded.width,
        height: decoded.height,
      };
    }

    // 透明底的 PNG 直接转 JPEG 会变黑底，所以先铺一层白
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(decoded.source, 0, 0, width, height);

    // 截图类（PNG）多半是文字，保持 PNG 更清晰；照片一律走 JPEG
    const keepPng = declaredType === 'image/png' && file.size < 3 * 1024 * 1024;
    const outputType = keepPng ? 'image/png' : 'image/jpeg';
    const blob = await toBlob(canvas, outputType, 0.88);

    if (!blob) {
      return {
        file,
        compressed: false,
        originalBytes: file.size,
        bytes: file.size,
        width: decoded.width,
        height: decoded.height,
      };
    }

    // 格式本来就不受支持（例如 HEIC）时必须换成新文件；
    // 否则压完反而更大就没必要换（保住原始画质）。
    const mustConvert = !isAcceptedType(declaredType);
    if (!mustConvert && blob.size >= file.size) {
      return {
        file,
        compressed: false,
        originalBytes: file.size,
        bytes: file.size,
        width: decoded.width,
        height: decoded.height,
      };
    }

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'question';
    const extension = keepPng ? 'png' : 'jpg';
    const nextFile = new File([blob], `${baseName}.${extension}`, {
      type: outputType,
      lastModified: Date.now(),
    });

    return {
      file: nextFile,
      compressed: true,
      originalBytes: file.size,
      bytes: nextFile.size,
      width,
      height,
    };
  } finally {
    decoded.release();
  }
}
