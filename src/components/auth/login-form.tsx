'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogIn } from 'lucide-react';
import { Button, Field, Input } from '@/components/ui/primitives';
import { ApiError, apiPost, toUserMessage } from '@/lib/client-api';
import { FormErrorAlert } from '@/components/auth/auth-shell';

/**
 * 登录表单。
 *
 * 错误分两级展示：
 *   - 服务端能定位到字段的（details = { 字段: 消息 }）→ 标在对应输入框下面
 *   - 其余（账号密码不匹配、网络异常）→ 顶部 Alert，带 role="alert"
 */
export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    // 客户端先做一次轻校验，避免明显无效的请求打到服务端
    const localErrors: Record<string, string> = {};
    if (!email.trim()) localErrors.email = '请填写邮箱';
    else if (!/^\S+@\S+\.\S+$/.test(email.trim())) localErrors.email = '邮箱格式看起来不太对';
    if (!password) localErrors.password = '请填写密码';
    setFieldErrors(localErrors);
    if (Object.keys(localErrors).length > 0) return;

    setSubmitting(true);
    try {
      await apiPost('/api/auth/login', { email: email.trim(), password });
      router.push('/dashboard');
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) {
        setFieldErrors(error.fieldErrors);
      }
      setFormError(toUserMessage(error));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <FormErrorAlert title="登录没有成功" message={formError} />

      <Field label="邮箱" htmlFor="login-email" error={fieldErrors.email} required>
        <Input
          id="login-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={Boolean(fieldErrors.email)}
          disabled={submitting}
        />
      </Field>

      <Field label="密码" htmlFor="login-password" error={fieldErrors.password} required>
        <Input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="请输入密码"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={Boolean(fieldErrors.password)}
          disabled={submitting}
        />
      </Field>

      <Button type="submit" className="w-full" size="lg" loading={submitting}>
        {submitting ? null : <LogIn aria-hidden />}
        登录
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        还没有账号？
        <Link href="/register" className="ml-1 font-medium text-primary underline underline-offset-2">
          创建一个
        </Link>
      </p>
    </form>
  );
}
