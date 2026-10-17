import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'AI 高中学习教练',
    template: '%s · AI 高中学习教练',
  },
  description:
    '面向中国高中生的智能学习系统：答疑、错题本、知识点地图、薄弱诊断、学习计划与报告。',
  // 学习数据不应被搜索引擎索引
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f8fafc',
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
