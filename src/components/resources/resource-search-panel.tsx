'use client';

import * as React from 'react';
import { AlertTriangle, ExternalLink, Info, Search, ShieldCheck, Sparkles } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ListSkeleton,
} from '@/components/ui/primitives';
import { Markdown } from '@/components/markdown';
import { RESOURCE_TYPES } from '@/lib/domain/enums';
import { apiPost, toUserMessage, type ResourceDto, type ResourceSearchResultDto } from '@/lib/client-api';
import { isSafeExternalUrl } from '@/lib/utils';

/**
 * 「找资源」面板。
 *
 * 三层结果必须**视觉上明确区分**（需求反复强调）：
 *   1. verified   —— 已验证（管理员核验过）
 *   2. unverified —— 搜索结果，未核验，必须显式标注
 *   3. internal   —— 系统生成的讲解与练习，不依赖外部链接，永远可用
 * 拿不到已验证资源时进入 degraded，界面把第 3 层推到最前面。
 */

function formatDuration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分钟`;
}

function typeLabel(code: string): string {
  return (RESOURCE_TYPES as Record<string, string>)[code] ?? code;
}

function ResourceRow({ resource, verified }: { resource: ResourceDto; verified: boolean }) {
  const safe = isSafeExternalUrl(resource.url);
  const duration = formatDuration(resource.durationSeconds);

  return (
    <li className="rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">
            {safe ? (
              <a
                href={resource.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary underline underline-offset-2"
              >
                {resource.title}
                <ExternalLink aria-hidden className="size-3.5" />
              </a>
            ) : (
              <span>{resource.title}</span>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{typeLabel(resource.resourceType)}</Badge>
            {resource.platform ? <span>{resource.platform}</span> : null}
            {duration ? <span>时长约 {duration}</span> : null}
            {resource.lastVerifiedAt ? (
              <span>最后核验：{new Date(resource.lastVerifiedAt).toLocaleDateString('zh-CN')}</span>
            ) : null}
          </div>
        </div>
        <Badge variant={verified ? 'success' : 'warning'}>{verified ? '已验证' : '未核验'}</Badge>
      </div>
      {resource.description ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{resource.description}</p>
      ) : null}
    </li>
  );
}

export function ResourceSearchPanel({ knowledgePointId }: { knowledgePointId: string }) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ResourceSearchResultDto | null>(null);

  async function handleSearch() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiPost<ResourceSearchResultDto>('/api/resources/search', { knowledgePointId });
      setResult(data);
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search aria-hidden className="size-4 text-primary" />
          找资源
        </CardTitle>
        <CardDescription>
          会先找资源库里已验证的内容；找不到时，会给你系统生成的讲解与练习兜底。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={() => void handleSearch()} loading={loading}>
          <Search aria-hidden />
          {result ? '再找一次' : '为这个知识点找资源'}
        </Button>

        {loading ? <ListSkeleton rows={2} /> : null}

        {error ? (
          <Alert variant="destructive" title="查找没有成功">
            <p>{error}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void handleSearch()}>
              重试
            </Button>
          </Alert>
        ) : null}

        {result ? (
          <div className="space-y-4">
            {result.message ? (
              <Alert variant={result.degraded ? 'warning' : 'info'} title={result.degraded ? '暂无已验证的匹配资源' : '检索说明'}>
                <p>{result.message}</p>
              </Alert>
            ) : null}

            {result.searchError ? (
              <Alert variant="muted" title="外部搜索没有完成">
                <p>原因：{result.searchError}。这不影响下面系统生成的讲解与练习。</p>
              </Alert>
            ) : null}

            {/* 1. 已验证 */}
            {result.verified.length > 0 ? (
              <section className="space-y-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <ShieldCheck aria-hidden className="size-4 text-success" />
                  已验证的资源（{result.verified.length}）
                </h3>
                <p className="text-xs text-muted-foreground">
                  这些链接由管理员核验过其内容与有效性，仍然建议你打开后自己判断是否适合。
                </p>
                <ul className="space-y-2">
                  {result.verified.map((resource) => (
                    <ResourceRow key={resource.id} resource={resource} verified />
                  ))}
                </ul>
              </section>
            ) : null}

            {/* 2. 系统内部材料（降级时优先展示） */}
            {result.internal.length > 0 ? (
              <section className="space-y-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Sparkles aria-hidden className="size-4 text-primary" />
                  系统生成的讲解与练习（不依赖外部链接）
                </h3>
                {result.internal.map((material) => (
                  <div key={`${material.kind}-${material.title}`} className="rounded-lg border bg-muted/30 p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{material.title}</p>
                      <Badge variant="outline">
                        {material.kind === 'explanation' ? '知识讲解' : '针对性练习'}
                      </Badge>
                      {material.isMock ? <Badge variant="warning">示例内容</Badge> : null}
                    </div>
                    {material.isMock ? (
                      <Alert variant="warning" className="mb-2">
                        <p>
                          当前是 Mock 模式，下面是示例结构而不是真实讲解。配置 AI_API_KEY 后可以获得真实内容。
                        </p>
                      </Alert>
                    ) : null}
                    <Markdown>{material.content}</Markdown>
                    {material.model ? (
                      <p className="mt-2 text-[11px] text-muted-foreground">生成模型：{material.model}</p>
                    ) : null}
                  </div>
                ))}
              </section>
            ) : null}

            {/* 3. 未核验的搜索结果 */}
            {result.unverified.length > 0 ? (
              <section className="space-y-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <AlertTriangle aria-hidden className="size-4 text-warning" />
                  搜索结果（{result.unverified.length} 条，未核验）
                </h3>
                <Alert variant="warning" title="以下内容未经核验">
                  <p>
                    它们来自外部搜索，我们没有核验过内容是否准确、链接是否长期有效，也没有验证过难度与年级是否匹配。
                    点开之后请自己判断，不要直接当作教材结论。
                  </p>
                </Alert>
                <ul className="space-y-2">
                  {result.unverified.map((resource) => (
                    <ResourceRow key={resource.id} resource={resource} verified={false} />
                  ))}
                </ul>
              </section>
            ) : null}

            {result.verified.length === 0 && result.unverified.length === 0 && result.internal.length === 0 ? (
              <Alert variant="muted" title="这次没有找到任何资源">
                <p>
                  可以先看看这个知识点的讲解与常见错误，或者过一会儿再试一次。
                </p>
              </Alert>
            ) : null}

            {result.searchKeywords.length > 0 ? (
              <div className="rounded-lg border border-dashed p-3">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Info aria-hidden className="size-4 text-muted-foreground" />
                  想自己去找？可以试试这些关键词
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {result.searchKeywords.map((keyword) => (
                    <li key={keyword}>
                      <Badge variant="outline" className="select-all">
                        {keyword}
                      </Badge>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  建议优先选择教材配套资源、学校老师推荐的平台，以及你所在地区使用的教辅。
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
