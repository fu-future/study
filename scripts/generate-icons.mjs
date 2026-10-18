import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * 生成应用图标（PWA / 添加到主屏幕 / 浏览器标签页）。
 *
 * 为什么用 Playwright 而不是装 sharp / canvas：
 *   项目里已经有 Playwright（E2E 用），它本身就是"把 HTML 渲染成位图"的可靠工具，
 *   为了一次性生成三张图标再引入一个原生依赖不值得。
 *
 * 产物：
 *   src/app/icon.png        512×512  —— Next 自动作为 favicon
 *   src/app/apple-icon.png  180×180  —— iOS 添加到主屏幕时用
 *   public/icons/icon-192.png / icon-512.png —— manifest 里引用
 */

const ROOT = process.cwd();

// 用 lucide 的 graduation-cap 路径，和导航栏品牌图标保持一致
const SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#1d4ed8"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <!-- 顶部一道柔光，避免纯色显得死板 -->
  <circle cx="128" cy="96" r="220" fill="#ffffff" opacity="0.10"/>
  <g transform="translate(256 250) scale(11) translate(-12 -12)"
     fill="none" stroke="#ffffff" stroke-width="1.9"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/>
    <path d="M22 10v6"/>
    <path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>
  </g>
</svg>`;

const page_html = `<!doctype html>
<html><head><meta charset="utf-8"/>
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  svg { display: block; }
</style></head>
<body>${SVG}</body></html>`;

async function main() {
  const browser = await chromium.launch();
  const targets = [
    { file: path.join(ROOT, 'src/app/icon.png'), size: 512 },
    { file: path.join(ROOT, 'src/app/apple-icon.png'), size: 180 },
    { file: path.join(ROOT, 'public/icons/icon-192.png'), size: 192 },
    { file: path.join(ROOT, 'public/icons/icon-512.png'), size: 512 },
  ];

  await mkdir(path.join(ROOT, 'public/icons'), { recursive: true });

  for (const target of targets) {
    const page = await browser.newPage({
      viewport: { width: target.size, height: target.size },
      deviceScaleFactor: 1,
    });
    await page.setContent(page_html, { waitUntil: 'load' });
    await page.screenshot({ path: target.file, omitBackground: false });
    await page.close();
    console.log(`已生成 ${path.relative(ROOT, target.file)} (${target.size}×${target.size})`);
  }

  await browser.close();
}

await main();
