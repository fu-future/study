import * as React from 'react';
import { AlertCircle, GraduationCap } from 'lucide-react';
import { Alert } from '@/components/ui/primitives';

/**
 * 登录 / 注册页共用的外壳。
 * 刻意不写 'use client'：它是纯展示组件，服务端页面与客户端表单都能直接用。
 */
export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-4 py-10 sm:px-6"
    >
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_minmax(0,26rem)] lg:items-center">
        <section className="space-y-4">
          <div className="flex items-center gap-2 text-primary">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
              <GraduationCap aria-hidden className="size-5" />
            </span>
            <span className="text-sm font-semibold">AI 高中学习教练</span>
          </div>
          <h1 className="text-2xl font-semibold leading-snug sm:text-3xl">
            慢慢来，把不会的一点点补上
          </h1>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            这里不会给你打分，也不会催你。错题帮你整理，讲解跟着你的思路走，
            计划会按你每天真正有的时间来安排。
          </p>
        </section>

        <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
          <div className="mb-5 space-y-1">
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          {children}
        </section>
      </div>
    </main>
  );
}

/** 无法定位到具体字段时的顶部错误条（role=alert 由 Alert 的 destructive 分支提供）。 */
export function FormErrorAlert({ title, message }: { title: string; message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive" title={title}>
      <p className="flex items-start gap-2">
        <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>{message}</span>
      </p>
    </Alert>
  );
}
