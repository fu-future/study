import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronLeft, ChevronRight, ExternalLink, Library, ShieldCheck } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from '@/components/ui/primitives';
import { getCurrentUser } from '@/lib/auth/current-user';
import { listSubjects } from '@/lib/repositories/subjects.repository';
import { countResourcesByVerification, listResources } from '@/lib/repositories/resources.repository';
import { RESOURCE_TYPES, RESOURCE_VERIFICATION } from '@/lib/domain/enums';
import { formatDate, isSafeExternalUrl } from '@/lib/utils';
import { previewText } from '@/lib/preview';
import { withQuery } from '@/lib/client-api';
import { ResourceFilterBar } from '@/components/resources/resource-filter-bar';

export const metadata: Metadata = { title: '学习资源' };

const PAGE_SIZE = 12;

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '—';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分钟`;
}

export default async function ResourcesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const subjectId = firstValue(params.subjectId);
  const resourceType = firstValue(params.resourceType);
  const verificationStatus = firstValue(params.verificationStatus);
  const page = Math.max(1, Number(firstValue(params.page)) || 1);

  const [subjects, result, verificationCounts] = await Promise.all([
    listSubjects(),
    listResources({
      subjectId: subjectId || undefined,
      resourceType: resourceType || undefined,
      verificationStatus: verificationStatus || undefined,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    countResourcesByVerification(),
  ]);

  const items = result.items;
  const total = result.total;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const subjectNames = new Map(subjects.map((subject) => [subject.id, subject.name]));

  function pageHref(target: number): string {
    return withQuery('/resources', {
      subjectId,
      resourceType,
      verificationStatus,
      page: target > 1 ? target : '',
    });
  }

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">学习资源</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          这里只收录真实存在的链接。带「已验证」标签的由管理员核验过；
          带「未核验」的来自外部搜索，需要你自己判断内容是否合适。
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">资源总数</p>
            <p className="mt-1 text-xl font-semibold">{total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between gap-2 p-4">
            <div>
              <p className="text-xs text-muted-foreground">已验证</p>
              <p className="mt-1 text-xl font-semibold">
                {verificationCounts.verified ?? 0}
              </p>
            </div>
            <ShieldCheck aria-hidden className="size-5 text-success" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">未核验</p>
            <p className="mt-1 text-xl font-semibold">{verificationCounts.unverified ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      <ResourceFilterBar
        subjects={subjects.map((subject) => ({ id: subject.id, name: subject.name }))}
        value={{ subjectId, resourceType, verificationStatus }}
      />

      {total === 0 ? (
        <EmptyState
          icon={<Library aria-hidden />}
          title={subjectId || resourceType || verificationStatus ? '这些条件下没有资源' : '资源库还是空的'}
          description={
            subjectId || resourceType || verificationStatus
              ? '可以清除筛选条件，或者换一个类型看看。'
              : '资源需要管理员手动添加并核验。在资源补齐之前，知识点页面里的系统讲解和练习同样可以用。'
          }
          action={
            <Button asChild variant="outline">
              <Link href="/knowledge">去知识点地图</Link>
            </Button>
          }
        />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">资源列表（共 {total} 条）</CardTitle>
              <CardDescription>第 {page} / {totalPages} 页</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[46rem] border-collapse text-sm">
                  <caption className="sr-only">学习资源列表</caption>
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th scope="col" className="px-2 py-2 font-medium">标题</th>
                      <th scope="col" className="px-2 py-2 font-medium">类型</th>
                      <th scope="col" className="px-2 py-2 font-medium">平台</th>
                      <th scope="col" className="px-2 py-2 font-medium">时长</th>
                      <th scope="col" className="px-2 py-2 font-medium">最后核验</th>
                      <th scope="col" className="px-2 py-2 font-medium">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((resource) => {
                      const safe = isSafeExternalUrl(resource.url);
                      const verified = resource.verificationStatus === 'verified';
                      return (
                        <tr key={resource.id} className="border-b align-top last:border-0">
                          <td className="px-2 py-3">
                            <div className="max-w-[22rem] space-y-1">
                              <div className="flex items-center gap-1.5">
                                {safe ? (
                                  <a
                                    href={resource.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-medium text-primary underline underline-offset-2"
                                  >
                                    {resource.title}
                                  </a>
                                ) : (
                                  <span className="font-medium">{resource.title}</span>
                                )}
                                {safe ? <ExternalLink aria-hidden className="size-3.5 text-muted-foreground" /> : null}
                              </div>
                              {resource.description ? (
                                <p className="text-xs text-muted-foreground">
                                  {previewText(resource.description, 80)}
                                </p>
                              ) : null}
                              {resource.subjectId ? (
                                <p className="text-xs text-muted-foreground">
                                  {subjectNames.get(resource.subjectId) ?? ''}
                                  {resource.grade ? ` · ${resource.grade}` : ''}
                                  {resource.difficulty ? ` · 难度 ${resource.difficulty}/5` : ''}
                                </p>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-2 py-3 text-muted-foreground">
                            {RESOURCE_TYPES[resource.resourceType as keyof typeof RESOURCE_TYPES] ??
                              resource.resourceType}
                          </td>
                          <td className="px-2 py-3 text-muted-foreground">{resource.platform || '—'}</td>
                          <td className="px-2 py-3 text-muted-foreground">
                            {resource.durationSeconds ? formatDuration(resource.durationSeconds) : '—'}
                          </td>
                          <td className="px-2 py-3 text-muted-foreground">
                            {resource.lastVerifiedAt ? formatDate(resource.lastVerifiedAt) : '未核验'}
                          </td>
                          <td className="px-2 py-3">
                            <Badge variant={verified ? 'success' : 'warning'}>
                              {RESOURCE_VERIFICATION[
                                resource.verificationStatus as keyof typeof RESOURCE_VERIFICATION
                              ] ?? resource.verificationStatus}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {totalPages > 1 ? (
            <nav className="flex items-center justify-between gap-3" aria-label="资源分页">
              {page > 1 ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href={pageHref(page - 1)} aria-label="上一页">
                    <ChevronLeft aria-hidden />
                    上一页
                  </Link>
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled aria-label="上一页（已经是第一页）">
                  <ChevronLeft aria-hidden />
                  上一页
                </Button>
              )}
              <p className="text-sm text-muted-foreground">
                第 {page} / {totalPages} 页
              </p>
              {page < totalPages ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href={pageHref(page + 1)} aria-label="下一页">
                    下一页
                    <ChevronRight aria-hidden />
                  </Link>
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled aria-label="下一页（已经是最后一页）">
                  下一页
                  <ChevronRight aria-hidden />
                </Button>
              )}
            </nav>
          ) : null}
        </>
      )}

      <Alert variant="muted" title="关于「时长」这一列">
        <p>
          只有在资源本身提供了时长时才会显示；拿不到的地方一律留空，不会估算一个看起来合理的数字。
        </p>
      </Alert>
    </div>
  );
}
