'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BarChart3,
  BookX,
  CalendarDays,
  GraduationCap,
  LayoutDashboard,
  Library,
  LogOut,
  Menu,
  MessageCircle,
  Network,
  Settings,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/primitives';

/**
 * 应用导航。
 *
 * 响应式策略：
 *   - 桌面 / 平板（≥ lg）：左侧固定侧边栏
 *   - 手机（< lg）：顶栏 + 抽屉，避免底部 Tab 被系统手势条挡住
 * 无障碍：抽屉打开时锁定滚动、Esc 关闭、当前页用 aria-current 标记。
 */

const NAV_ITEMS = [
  { href: '/dashboard', label: '学习仪表盘', icon: LayoutDashboard },
  { href: '/tutor', label: 'AI 答疑', icon: MessageCircle },
  { href: '/mistakes', label: '错题本', icon: BookX },
  { href: '/knowledge', label: '知识点地图', icon: Network },
  { href: '/resources', label: '学习资源', icon: Library },
  { href: '/planner', label: '学习计划', icon: CalendarDays },
  { href: '/reports', label: '学习报告', icon: BarChart3 },
  { href: '/settings', label: '设置', icon: Settings },
] as const;

export function AppNav({
  displayName,
  grade,
  aiModeBadge,
}: {
  displayName: string;
  grade?: string | null;
  /** 例如「Mock 模式」—— 让学生知道当前 AI 是否真实可用 */
  aiModeBadge?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [loggingOut, setLoggingOut] = React.useState(false);

  // 路由变化时自动关闭抽屉
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Esc 关闭 + 打开时锁定背景滚动
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  const navList = (
    <nav aria-label="主导航" className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon aria-hidden className="size-4 shrink-0" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  const brand = (
    <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <GraduationCap aria-hidden className="size-4" />
      </span>
      <span className="text-sm leading-tight">
        学习教练
        <span className="block text-[11px] font-normal text-muted-foreground">
          {grade ? `${grade} · ` : ''}
          {displayName}
        </span>
      </span>
    </Link>
  );

  return (
    <>
      {/* 顶部栏（手机）+ 品牌（桌面） */}
      <header className="no-print sticky top-0 z-30 flex items-center justify-between gap-3 border-b bg-card/95 px-4 py-2.5 backdrop-blur lg:hidden">
        {brand}
        <Button
          variant="outline"
          size="icon"
          aria-label={open ? '关闭菜单' : '打开菜单'}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X aria-hidden /> : <Menu aria-hidden />}
        </Button>
      </header>

      {/* 桌面侧边栏 */}
      <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 flex-col justify-between border-r bg-card px-3 py-4 lg:flex">
        <div className="space-y-4">
          <div className="px-2">{brand}</div>
          {navList}
        </div>
        <div className="space-y-2 px-2">
          {aiModeBadge ? (
            <p className="rounded-lg bg-muted px-2.5 py-2 text-[11px] leading-snug text-muted-foreground">
              {aiModeBadge}
            </p>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={handleLogout}
            loading={loggingOut}
          >
            <LogOut aria-hidden />
            退出登录
          </Button>
        </div>
      </aside>

      {/* 手机抽屉 */}
      {open ? (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="关闭菜单"
            className="absolute inset-0 bg-foreground/20"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-0 flex h-full w-72 max-w-[85vw] flex-col justify-between border-l bg-card px-3 py-4 shadow-xl">
            <div className="space-y-4">
              <div className="px-2">{brand}</div>
              {navList}
            </div>
            <div className="space-y-2 px-2">
              {aiModeBadge ? (
                <p className="rounded-lg bg-muted px-2.5 py-2 text-[11px] leading-snug text-muted-foreground">
                  {aiModeBadge}
                </p>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={handleLogout}
                loading={loggingOut}
              >
                <LogOut aria-hidden />
                退出登录
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
