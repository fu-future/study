'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { UserPlus } from 'lucide-react';
import { Button, Field, Input } from '@/components/ui/primitives';
import { ApiError, apiPost, toUserMessage } from '@/lib/client-api';
import { FormErrorAlert } from '@/components/auth/auth-shell';

/**
 * 注册表单。
 *
 * 校验规则与后端 registerSchema 保持一致（邮箱格式、昵称 1-30 字、密码 ≥ 8 位），
 * 前端先拦一遍是为了即时反馈，真正的约束仍然以后端为准。
 */
export function RegisterForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const localErrors: Record<string, string> = {};
    if (!displayName.trim()) localErrors.displayName = '请填写昵称';
    else if (displayName.trim().length > 30) localErrors.displayName = '昵称请控制在 30 个字以内';
    if (!email.trim()) localErrors.email = '请填写邮箱';
    else if (!/^\S+@\S+\.\S+$/.test(email.trim())) localErrors.email = '邮箱格式看起来不太对';
    if (!password) localErrors.password = '请设置密码';
    else if (password.length < 8) localErrors.password = '密码至少 8 个字符';
    else if (password.length > 72) localErrors.password = '密码太长了';
    setFieldErrors(localErrors);
    if (Object.keys(localErrors).length > 0) return;

    setSubmitting(true);
    try {
      await apiPost('/api/auth/register', {
        displayName: displayName.trim(),
        email: email.trim(),
        password,
      });
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
      <FormErrorAlert title="注册没有成功" message={formError} />

      <Field
        label="昵称"
        htmlFor="register-name"
        error={fieldErrors.displayName}
        hint="只用于界面上的称呼，随时可以在设置里修改"
        required
      >
        <Input
          id="register-name"
          name="displayName"
          type="text"
          autoComplete="nickname"
          placeholder="比如：小徐"
          maxLength={30}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          aria-invalid={Boolean(fieldErrors.displayName)}
          disabled={submitting}
        />
      </Field>

      <Field label="邮箱" htmlFor="register-email" error={fieldErrors.email} required>
        <Input
          id="register-email"
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

      <Field
        label="密码"
        htmlFor="register-password"
        error={fieldErrors.password}
        hint="至少 8 个字符。不用很复杂，记得住更重要"
        required
      >
        <Input
          id="register-password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="至少 8 个字符"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={Boolean(fieldErrors.password)}
          disabled={submitting}
        />
      </Field>

      <Button type="submit" className="w-full" size="lg" loading={submitting}>
        {submitting ? null : <UserPlus aria-hidden />}
        创建账号
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        已经有账号了？
        <Link href="/login" className="ml-1 font-medium text-primary underline underline-offset-2">
          去登录
        </Link>
      </p>
    </form>
  );
}
