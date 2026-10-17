/**
 * 列表页用的纯文本预览工具（服务端安全）。
 *
 * 为什么不直接用 src/components/markdown.tsx 的 plainPreview：
 * 那个文件带 'use client'，在服务端组件里调用它的普通函数会报
 * 「Attempted to call ... from the server」。这里的逻辑与它保持一致，
 * 但没有任何客户端依赖，服务端组件可以放心使用。
 */
export function previewText(text: string, max = 120): string {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, ' [代码] ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' [公式] ')
    .replace(/\$[^$\n]*\$/g, ' [公式] ')
    .replace(/[#>*_`]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max)}…`;
}
