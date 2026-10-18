import type { MetadataRoute } from 'next';

/**
 * PWA 清单。
 *
 * 为什么需要它：
 *   学生几乎不会每次打开浏览器再输网址。有了 manifest，手机浏览器可以
 *   「添加到主屏幕」，之后从桌面图标直接进入、全屏无地址栏，
 *   观感上和装了一个 App 没有区别 —— 而实现成本只有这一个文件。
 *
 * 注意：这里不注册 Service Worker，也就不做离线缓存。
 *   学习数据每次都要拉最新的，缓存旧内容（比如三天前的掌握度）比不能离线更糟。
 *   没有 SW 的站点在 iOS 上依然可以「添加到主屏幕」并全屏运行。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AI 高中学习教练',
    short_name: '学习教练',
    description: '答疑、错题本、知识点地图、薄弱诊断、学习计划与学习报告。',
    lang: 'zh-CN',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#f8fafc',
    theme_color: '#2563eb',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // maskable：安卓会把图标裁成圆形/圆角，留出安全区才不会切掉内容
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
