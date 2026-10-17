'use client';

import * as React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { cn, isSafeExternalUrl } from '@/lib/utils';

/**
 * Markdown + 数学公式渲染（AI 输出专用）。
 *
 * ┌─ 安全设计（需求：AI 输出中的 Markdown 不得作为不可信 HTML 直接执行）─────┐
 * │ 1. **不启用 rehype-raw**：因此 Markdown 里的原生 HTML 会被当作纯文本转义输出， │
 * │    不会进入 DOM。这是最根本的一层防护 —— 不解析 HTML，就没有 XSS 面。        │
 * │ 2. `urlTransform`：把链接/图片地址限制在 http / https / mailto，              │
 * │    阻断 javascript: 与 data: 这类可执行协议。                                │
 * │ 3. 外链统一加 rel="noopener noreferrer" target="_blank"，防 opener 劫持。    │
 * │ 4. 不引入 rehype-sanitize：它在 KaTeX 之前运行会剥掉公式节点，之后运行又会    │
 * │    破坏公式排版；而第 1 条已经覆盖了「不执行不可信 HTML」这个目标。          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

/** 只放行安全协议。返回空串会让 react-markdown 丢弃该 URL。 */
function safeUrlTransform(url: string): string {
  if (!url) return '';
  // 站内相对链接允许
  if (url.startsWith('/') || url.startsWith('#')) return url;
  if (isSafeExternalUrl(url)) return url;
  if (url.startsWith('mailto:')) return url;
  return '';
}

const components: Components = {
  a({ href, children, ...props }) {
    const safe = href ? safeUrlTransform(href) : '';
    if (!safe) {
      // 危险或非法链接退化为纯文本，而不是渲染成可点击元素
      return <span {...props}>{children}</span>;
    }
    const isExternal = /^https?:\/\//i.test(safe);
    return (
      <a
        href={safe}
        {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        {...props}
      >
        {children}
      </a>
    );
  },

  img({ src, alt, ...props }) {
    const safe = typeof src === 'string' ? safeUrlTransform(src) : '';
    if (!safe) return <span className="text-muted-foreground">[图片]</span>;
    // 用原生 img 而不是 next/image：AI 输出里的图片地址是动态的，无法预配置域名
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={safe} alt={alt ?? ''} loading="lazy" className="max-w-full rounded-lg" {...props} />;
  },

  table({ children, ...props }) {
    return (
      <div className="scroll-thin my-3 overflow-x-auto">
        <table {...props}>{children}</table>
      </div>
    );
  },
};

export type MarkdownProps = {
  children: string;
  className?: string;
  /** 流式输出中：在末尾显示光标 */
  streaming?: boolean;
};

export function Markdown({ children, className, streaming = false }: MarkdownProps) {
  return (
    <div className={cn('prose-study break-words', className)}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        urlTransform={safeUrlTransform}
        components={components}
      >
        {children}
      </ReactMarkdown>
      {streaming ? (
        <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-primary align-text-bottom" aria-hidden />
      ) : null}
    </div>
  );
}

/** 纯文本预览（列表页不渲染完整 Markdown，避免长公式撑破卡片） */
export function plainPreview(text: string, max = 120): string {
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
