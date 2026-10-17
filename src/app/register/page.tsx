import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Alert } from '@/components/ui/primitives';
import { getCurrentUser } from '@/lib/auth/current-user';
import { countUsers } from '@/lib/repositories/users.repository';
import { AuthShell } from '@/components/auth/auth-shell';
import { RegisterForm } from '@/components/auth/register-form';

export const metadata: Metadata = { title: '创建账号' };

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');

  // 用真实的用户数判断是不是「第一位使用者」，而不是写死一句可能不成立的说明
  const userCount = await countUsers();

  return (
    <AuthShell title="创建账号" description="填三个信息就可以开始了，之后都能在设置里改。">
      <div className="space-y-4">
        {userCount === 0 ? (
          <Alert variant="info" title="还没有任何账号">
            <p>
              当前系统里一个账号都还没有，所以这份数据是全新的。第一位使用者可以直接用这个页面创建账号，
              不需要邀请码。
            </p>
          </Alert>
        ) : null}
        <RegisterForm />
      </div>
    </AuthShell>
  );
}
