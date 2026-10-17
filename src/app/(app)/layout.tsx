import * as React from 'react';
import { redirect } from 'next/navigation';
import { AppNav } from '@/components/app-nav';
import { getCurrentUser } from '@/lib/auth/current-user';
import { getStudentProfile, toProfileView } from '@/lib/repositories/users.repository';
import { describeProviderStatus } from '@/lib/ai/registry';

/**
 * 受保护布局。
 *
 * 这里刻意不用 requireUser()：它抛出的 AppError 在这个位置没有 API 包装层去接，
 * 会变成 500 页面。用 getCurrentUser() 判断并 redirect 才是页面该有的行为。
 *
 * 布局本身只负责「导航 + 主内容容器」，不加载任何业务数据 ——
 * 每个页面自己决定要什么，避免一次渲染烤一堆无关查询。
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const profile = toProfileView(await getStudentProfile(user.id));

  // AI 状态只用于侧栏的一句提示：配置坏了也不该让整个应用打不开
  let aiModeBadge: string | null = null;
  try {
    const provider = await describeProviderStatus();
    aiModeBadge = provider.isRealProvider
      ? `当前 AI：${provider.label} · ${provider.defaultModel}`
      : '当前为 Mock 模式：AI 回复为示例结构，配置 AI_API_KEY 后可获得真实讲解';
  } catch {
    aiModeBadge = '未能读取 AI 配置，请到「设置」页查看配置指引。';
  }

  return (
    <div className="min-h-screen lg:flex">
      <AppNav displayName={user.displayName} grade={profile.grade} aiModeBadge={aiModeBadge} />
      <div id="main" className="mx-auto w-full max-w-5xl flex-1 p-4 sm:p-6">
        {children}
      </div>
    </div>
  );
}
