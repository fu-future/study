import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/current-user';

/**
 * 根路由：按登录状态分流。
 * 不渲染任何内容 —— 只是把学生送到该去的地方。
 */
export default async function RootPage() {
  const user = await getCurrentUser();
  redirect(user ? '/dashboard' : '/login');
}
