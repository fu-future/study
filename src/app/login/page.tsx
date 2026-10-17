import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/current-user';
import { AuthShell } from '@/components/auth/auth-shell';
import { LoginForm } from '@/components/auth/login-form';

export const metadata: Metadata = { title: '登录' };

export default async function LoginPage() {
  // 已登录就不必再看登录页
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');

  return (
    <AuthShell title="登录" description="用注册时的邮箱和密码进来。">
      <LoginForm />
    </AuthShell>
  );
}
