import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'AI 高中学习教练',
    template: '%s · AI 高中学习教练',
  },
  description:
    '面向中国高中生的智能学习系统：答疑、错题本、知识点地图、薄弱诊断、学习计划与报告。',
  applicationName: 'AI 高中学习教练',
  // 学习数据不应被搜索引擎索引
  robots: { index: false, follow: false },
  // iOS「添加到主屏幕」以全屏方式打开，不出现 Safari 的地址栏
  appleWebApp: {
    capable: true,
    title: '学习教练',
    statusBarStyle: 'default',
  },
  // 题干里的长数字不希望被手机识别成电话号码
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // viewportFit: cover 才会启用 env(safe-area-inset-*)，
  // 底部 Tab 栏需要它才能让开 iPhone 的 Home 指示条。
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)', color: '#f8fafc' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-background">
        {/* 键盘用户跳过导航 */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
        >
          跳到主要内容
        </a>
        {children}
      </body>
    </html>
  );
}
