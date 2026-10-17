import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Bot, CheckCircle2, Info, KeyRound, Server, ShieldCheck, XCircle } from 'lucide-react';
import {
  Alert,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/primitives';
import { getCurrentUser } from '@/lib/auth/current-user';
import { getStudentProfile, toProfileView } from '@/lib/repositories/users.repository';
import { listSubjects } from '@/lib/repositories/subjects.repository';
import { describeProviderStatus } from '@/lib/ai/registry';
import { describeEnvStatus } from '@/lib/env';
import { formatDate } from '@/lib/utils';
import { ProfileForm } from '@/components/settings/profile-form';
import { AccountActions } from '@/components/settings/account-actions';

export const metadata: Metadata = { title: '设置' };

/**
 * 设置页。
 *
 * 安全红线：这里展示的是「有没有配置」，**绝不展示任何密钥的值**。
 * 服务端只读取 env 的存在性与模型名，密钥永远不下发到浏览器。
 */
export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const [profile, subjects] = await Promise.all([
    getStudentProfile(user.id).then(toProfileView),
    listSubjects(),
  ]);

  const envStatus = describeEnvStatus();

  // 配置有问题时，describeProviderStatus 会抛错；这里兜底，保证设置页永远打得开
  const provider = await describeProviderStatus().catch(() => null);

  const capabilities = provider?.capabilities;

  const capabilityRows: { label: string; supported: boolean; note: string }[] = [
    {
      label: '文本生成',
      supported: Boolean(capabilities?.text),
      note: '讲解、答疑、复盘都依赖它',
    },
    {
      label: '流式输出',
      supported: Boolean(capabilities?.streaming),
      note: '边生成边显示，长回答不用等',
    },
    {
      label: '结构化输出',
      supported: Boolean(capabilities?.structured),
      note: '错题分析、计划说明需要结构化结果',
    },
    {
      label: '图片理解',
      supported: Boolean(capabilities?.vision),
      note: capabilities?.vision
        ? '支持上传题目图片识别'
        : '当前模型不支持图片识别，上传后会提示改用手动录入',
    },
  ];

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">设置</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          账号：{user.email}（{user.displayName}）· 注册于 {formatDate(user.createdAt)}
        </p>
      </header>

      <ProfileForm
        profile={{
          id: profile.id,
          grade: profile.grade,
          curriculumId: profile.curriculumId,
          textbookVersion: profile.textbookVersion,
          electiveSubjects: profile.electiveSubjects,
          studyGoal: profile.studyGoal,
          examDate: profile.examDate ? profile.examDate.toISOString() : null,
          dailyAvailableMinutes: profile.dailyAvailableMinutes,
          weekdayAvailableMinutes: profile.weekdayAvailableMinutes,
          weekendAvailableMinutes: profile.weekendAvailableMinutes,
          reminderEnabled: profile.reminderEnabled,
          reminderTime: profile.reminderTime,
          onboardingCompleted: profile.onboardingCompleted,
        }}
        subjects={subjects.map((subject) => ({
          id: subject.id,
          code: subject.code,
          name: subject.name,
          isElective: subject.isElective,
        }))}
      />

      {/* AI 配置状态 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot aria-hidden className="size-4 text-primary" />
            AI 配置状态
          </CardTitle>
          <CardDescription>
            这里只显示「配置成了什么样」，不会显示任何密钥内容。密钥只在服务端使用。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!provider ? (
            <Alert variant="destructive" title="读取 AI 配置失败">
              <p>
                当前环境变量可能不完整，AI 功能会不可用。请对照下面的变量名检查 <code>.env</code> 文件。
              </p>
            </Alert>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={provider.isRealProvider ? 'success' : 'warning'}>
                  {provider.isRealProvider ? '已接入真实模型' : 'Mock 模式'}
                </Badge>
                <span className="text-sm">
                  {provider.label}
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{provider.id}</span>
                </span>
              </div>

              {!provider.isRealProvider ? (
                <Alert variant="warning" title="当前是 Mock 模式">
                  <p>
                    所有 AI 回复都是示例结构，用来演示流程，不是真实讲解。
                    在 <code>.env</code> 里配置 <code>AI_PROVIDER</code> 与 <code>AI_API_KEY</code>
                    之后重启服务，就能获得真实内容。
                  </p>
                </Alert>
              ) : null}

              <dl className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border bg-card p-3">
                  <dt className="text-xs text-muted-foreground">默认模型</dt>
                  <dd className="mt-1 font-mono text-sm">{provider.defaultModel}</dd>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <dt className="text-xs text-muted-foreground">视觉（图片理解）模型</dt>
                  <dd className="mt-1 font-mono text-sm">{provider.visionModel ?? '未配置'}</dd>
                </div>
                <div className="flex items-center gap-2 rounded-lg border bg-card p-3">
                  <KeyRound aria-hidden className="size-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">API Key</p>
                    <p className="mt-0.5 text-sm">
                      {envStatus.aiConfigured ? '已配置（内容不显示）' : '未配置'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-lg border bg-card p-3">
                  <Server aria-hidden className="size-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">数据源</p>
                    <p className="mt-0.5 text-sm">
                      {envStatus.dbDialect === 'sqlite'
                        ? 'SQLite（本地文件）'
                        : envStatus.dbDialect === 'postgresql'
                          ? 'PostgreSQL'
                          : '未识别'}
                    </p>
                  </div>
                </div>
              </dl>

              <div>
                <p className="text-sm font-medium">当前 provider 的能力</p>
                <ul className="mt-2 space-y-1.5">
                  {capabilityRows.map((row) => (
                    <li key={row.label} className="flex items-start gap-2 text-sm">
                      {row.supported ? (
                        <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                      ) : (
                        <XCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span>
                        {row.label}
                        <span className="ml-2 text-xs text-muted-foreground">{row.note}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                {capabilities?.structuredFallback && capabilities.structuredFallback !== 'none' ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    结构化输出的兜底方式：{capabilities.structuredFallback}
                  </p>
                ) : null}
              </div>
            </>
          )}

          {envStatus.errors.length > 0 ? (
            <Alert variant="destructive" title="环境变量存在问题">
              <ul className="list-disc space-y-1 pl-5">
                {envStatus.errors.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Alert>
          ) : null}

          {envStatus.missing.length > 0 ? (
            <Alert variant="warning" title="缺少这些变量">
              <p className="font-mono text-xs">{envStatus.missing.join('、')}</p>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {/* .env 配置指引 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info aria-hidden className="size-4 text-primary" />
            如何配置 <code>.env</code>
          </CardTitle>
          <CardDescription>
            在项目根目录创建 <code>.env</code>（可以从 <code>.env.example</code> 复制），填写下面的变量后重启开发服务。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <pre className="scroll-thin overflow-x-auto rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed">
            <code>{`# 数据库（第一阶段用本地 SQLite，无需额外服务）
DATABASE_URL=file:../.data/dev.db

# 会话签名密钥（至少 32 个字符）
# 生成：node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_SECRET=

# AI Provider：mock | deepseek | openai-compatible
AI_PROVIDER=mock
# 选 deepseek / openai-compatible 时必填（密钥只在服务端使用）
AI_API_KEY=
AI_BASE_URL=
AI_MODEL=
# 图片理解模型；留空表示不支持图片识别
AI_VISION_MODEL=

# 资源检索：internal-only（默认，只用已核验资源）| tavily | custom-json
RESOURCE_SEARCH_PROVIDER=internal-only
RESOURCE_SEARCH_API_KEY=

# 是否允许自助注册（第一位使用者创建完账号后可以改回 false）
ALLOW_SELF_SIGNUP=true`}</code>
          </pre>
          <Alert variant="muted" title="关于密钥的安全说明">
            <p className="flex items-start gap-2">
              <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
              密钥只在服务端读取，不会写进页面、日志或接口返回。请不要把填好密钥的 <code>.env</code> 提交到版本库。
            </p>
          </Alert>
        </CardContent>
      </Card>

      <AccountActions displayName={user.displayName} />
    </div>
  );
}
