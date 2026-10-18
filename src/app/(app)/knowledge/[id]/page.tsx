import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  ClipboardCheck,
  Info,
  Network,
  ShieldCheck,
  Sparkles,
  Target,
} from 'lucide-react';
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
  Progress,
} from '@/components/ui/primitives';
import { Markdown } from '@/components/markdown';
import { getCurrentUser } from '@/lib/auth/current-user';
import { findKnowledgePointById } from '@/lib/repositories/knowledge.repository';
import { listResourcesForKnowledgePoint } from '@/lib/repositories/resources.repository';
import { getSubjectNameMap } from '@/lib/repositories/subjects.repository';
import { diagnoseKnowledgePoint } from '@/lib/ai/services/knowledge-diagnosis.service';
import {
  ATTEMPT_CONTEXTS,
  errorTypeLabel,
  INDEPENDENCE_LEVELS,
  KP_REVIEW_STATUS,
  masteryLabel,
  type MasteryLevel,
} from '@/lib/domain/enums';
import { readStringArray } from '@/lib/db/json';
import { formatDate, formatDateTime, formatPercent } from '@/lib/utils';
import { ResourceSearchPanel } from '@/components/resources/resource-search-panel';

export const metadata: Metadata = { title: '知识点详情' };

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function levelVariant(level: string): 'success' | 'default' | 'warning' | 'outline' {
  switch (level) {
    case 'stable':
    case 'basic':
      return 'success';
    case 'initial':
      return 'default';
    case 'learning':
      return 'warning';
    default:
      return 'outline';
  }
}

export default async function KnowledgeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  // 默认生成 AI 说明；?narrative=false 可以跳过（AI 很慢或额度紧张时用）
  const withNarrative = firstValue(query.narrative) !== 'false';

  const knowledgePoint = await findKnowledgePointById(id);

  if (!knowledgePoint) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/knowledge">
            <ArrowLeft aria-hidden />
            返回知识点地图
          </Link>
        </Button>
        <EmptyState
          icon={<Network aria-hidden />}
          title="没有找到这个知识点"
          description="它可能已经被移除，或者链接不完整。可以回到知识点地图重新选择。"
          action={
            <Button asChild>
              <Link href="/knowledge">打开知识点地图</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const [subjectNames, storedResources, diagnosis] = await Promise.all([
    getSubjectNameMap(),
    listResourcesForKnowledgePoint(id),
    // 诊断本身是确定性的算法 + 数据库读取，不依赖 AI；
    // AI 只负责把结论翻译成人话，失败也不影响结论
    diagnoseKnowledgePoint(user.id, id, { withNarrative }),
  ]);

  const result = diagnosis.result;
  const commonMistakes = readStringArray(knowledgePoint.commonMistakes);
  const typicalQuestionTypes = readStringArray(knowledgePoint.typicalQuestionTypes);
  const verifiedResources = storedResources.filter((resource) => resource.verificationStatus === 'verified');
  const otherStoredResources = storedResources.filter(
    (resource) => resource.verificationStatus !== 'verified',
  );

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/knowledge">
          <ArrowLeft aria-hidden />
          返回知识点地图
        </Link>
      </Button>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{subjectNames.get(knowledgePoint.subjectId) ?? '未标学科'}</Badge>
          <Badge variant="outline">{knowledgePoint.grade}</Badge>
          <Badge variant="outline">难度 {knowledgePoint.difficulty}/5</Badge>
          <Badge
            variant={
              knowledgePoint.reviewStatus === 'reviewed'
                ? 'secondary'
                : knowledgePoint.reviewStatus === 'deprecated'
                  ? 'outline'
                  : 'warning'
            }
          >
            {KP_REVIEW_STATUS[knowledgePoint.reviewStatus as keyof typeof KP_REVIEW_STATUS] ??
              knowledgePoint.reviewStatus}
          </Badge>
          <Badge variant={levelVariant(result.level)}>{masteryLabel(result.level)}</Badge>
        </div>
        <h1 className="text-2xl font-semibold">{knowledgePoint.name}</h1>
        <p className="text-sm text-muted-foreground">{knowledgePoint.chapterPath}</p>
        {knowledgePoint.description ? (
          <p className="max-w-3xl text-sm leading-relaxed">{knowledgePoint.description}</p>
        ) : null}
      </header>

      {/* 诊断结论 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck aria-hidden className="size-4 text-primary" />
            掌握情况诊断
          </CardTitle>
          <CardDescription>
            结论来自算法对你真实作答记录的估计，更新于 {formatDateTime(diagnosis.updatedAt)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">掌握等级</p>
              <p className="mt-1 text-sm font-medium">{masteryLabel(result.level)}</p>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">估计分</p>
              <p className="mt-1 text-sm font-medium">
                {result.hasScore && result.score !== null ? `${Math.round(result.score)} / 100` : '还需要更多练习'}
              </p>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">证据条数</p>
              <p className="mt-1 text-sm font-medium">{result.evidenceCount} 条作答</p>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">近期正确率</p>
              <p className="mt-1 text-sm font-medium">
                {result.recentAccuracy !== null && result.recentSampleSize > 0
                  ? `${formatPercent(result.recentAccuracy)}（近 ${result.recentSampleSize} 次）`
                  : '窗口内暂无作答'}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>结论置信度</span>
              <span>{formatPercent(result.confidence)}</span>
            </div>
            <Progress value={result.confidence * 100} label="诊断结论的置信度" />
            {result.confidenceReasons.length > 0 ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                {result.confidenceReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
          </div>

          <Alert variant="info" title="下一步可以做什么">
            <p>{result.nextAction}</p>
          </Alert>

          {result.repeatedErrorTypes.length > 0 ? (
            <div>
              <p className="text-sm font-medium">重复出现的错误</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {result.repeatedErrorTypes.map((item) => (
                  <Badge key={item.type} variant="warning">
                    {errorTypeLabel(item.type)} × {item.count}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          {result.needsPrerequisiteReview ? (
            <Alert variant="warning" title="建议先补一下前置知识">
              {diagnosis.prerequisites.length > 0 ? (
                <>
                  <p>按知识结构，下面这些内容是这个知识点的前置：</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {diagnosis.prerequisites.map((prerequisite) => (
                      <Link key={prerequisite.id} href={`/knowledge/${prerequisite.id}`}>
                        <Badge variant="outline">{prerequisite.name}</Badge>
                      </Link>
                    ))}
                  </div>
                </>
              ) : (
                <p>算法认为前置知识可能还不牢固，但目录里暂时没有记录具体的前置关系。</p>
              )}
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {/* 讲解 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles aria-hidden className="size-4 text-primary" />
            这个知识点的讲解
          </CardTitle>
          <CardDescription>基于你目前的证据给出的说明，不是通用教材内容</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {diagnosis.narrative ? (
            <>
              {diagnosis.narrative.mock ? (
                <Alert variant="warning" title="当前是 Mock 模式">
                  <p>下面这段说明是示例结构，不是真实的 AI 讲解。诊断结论本身仍然是真实计算的。</p>
                </Alert>
              ) : null}
              <Markdown>{diagnosis.narrative.summary}</Markdown>

              {diagnosis.narrative.evidence.length > 0 ? (
                <div>
                  <p className="text-sm font-medium">它参考了这些证据</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {diagnosis.narrative.evidence.map((item, index) => (
                      <li key={`${index}-${item.observation}`}>{item.observation}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {diagnosis.narrative.nextActions.length > 0 ? (
                <div>
                  <p className="text-sm font-medium">可以马上做的几件事</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {diagnosis.narrative.nextActions.map((action) => (
                      <li key={action}>{action}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {diagnosis.narrative.uncertainty ? (
                <Alert variant="muted" title="这个判断不确定的地方">
                  <p>{diagnosis.narrative.uncertainty}</p>
                </Alert>
              ) : null}
            </>
          ) : (
            <Alert variant="muted" title="暂时没有生成文字说明">
              <p>
                {diagnosis.narrativeError ??
                  'AI 说明暂时不可用，但上面的诊断结论与依据都不受影响。'}
              </p>
              <Button variant="outline" size="sm" className="mt-2" asChild>
                <Link href={`/knowledge/${id}?narrative=true`}>重新生成说明</Link>
              </Button>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* 判断依据 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target aria-hidden className="size-4 text-primary" />
            判断依据（每次都保留）
          </CardTitle>
          <CardDescription>共 {diagnosis.evidence.length} 条作答证据，最近的在最下面</CardDescription>
        </CardHeader>
        <CardContent>
          {diagnosis.evidence.length === 0 ? (
            <Alert variant="muted" title="还没有作答证据">
              <p>
                这个知识点还没有你的作答记录，所以暂时不下结论。可以到错题本或练习里做几道相关题目，
                有了真实表现才会产生判断。
              </p>
            </Alert>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] border-collapse text-sm">
                <caption className="sr-only">支持该诊断结论的作答证据</caption>
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th scope="col" className="px-2 py-2 font-medium">结果</th>
                    <th scope="col" className="px-2 py-2 font-medium">题目</th>
                    <th scope="col" className="px-2 py-2 font-medium">场景</th>
                    <th scope="col" className="px-2 py-2 font-medium">独立性</th>
                    <th scope="col" className="px-2 py-2 font-medium">难度</th>
                    <th scope="col" className="px-2 py-2 font-medium">时间</th>
                  </tr>
                </thead>
                <tbody>
                  {diagnosis.evidence.map((item) => (
                    <tr key={item.attemptId} className="border-b last:border-0 align-top">
                      <td className="px-2 py-2">
                        <Badge variant={item.isCorrect ? 'success' : 'warning'}>
                          {item.isCorrect ? '答对' : '答错'}
                        </Badge>
                      </td>
                      <td className="px-2 py-2">
                        <Link
                          href={`/mistakes/${item.questionId}`}
                          className="text-primary underline underline-offset-2"
                        >
                          {item.questionStemPreview}
                        </Link>
                        {item.errorTypeLabels.length > 0 ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {item.errorTypeLabels.join('、')}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">
                        {ATTEMPT_CONTEXTS[item.context as keyof typeof ATTEMPT_CONTEXTS] ?? item.context}
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">
                        {INDEPENDENCE_LEVELS[item.independence as keyof typeof INDEPENDENCE_LEVELS] ??
                          item.independence}
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">{item.difficulty}/5</td>
                      <td className="px-2 py-2 text-muted-foreground">{formatDate(item.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 常见错误 / 典型题型 */}
      {commonMistakes.length > 0 || typicalQuestionTypes.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {commonMistakes.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">常见错误</CardTitle>
                <CardDescription>目录里记录的易错点，可以对照自己的错题看看</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {commonMistakes.map((mistake) => (
                    <li key={mistake}>{mistake}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {typicalQuestionTypes.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">典型题型</CardTitle>
                <CardDescription>这个知识点常以哪些形式出现</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {typicalQuestionTypes.map((type) => (
                    <li key={type}>{type}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {/* 资源区 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen aria-hidden className="size-4 text-primary" />
            这个知识点的学习资源
          </CardTitle>
          <CardDescription>资源库里与这个知识点关联的内容（按核验状态区分）</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {storedResources.length === 0 ? (
            <Alert variant="warning" title="暂无已验证的匹配资源">
              <p>
                资源库里还没有与这个知识点关联的内容。可以用下面的「找资源」看看能拿到什么；
                在拿到真实资源之前，建议先用错题和练习来推进。
              </p>
            </Alert>
          ) : (
            <>
              {verifiedResources.length > 0 ? (
                <section className="space-y-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <ShieldCheck aria-hidden className="size-4 text-success" />
                    已验证（{verifiedResources.length}）
                  </h3>
                  <ul className="space-y-2">
                    {verifiedResources.map((resource) => (
                      <li key={resource.id} className="rounded-lg border bg-card p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {/^https?:\/\//i.test(resource.url) ? (
                            <a
                              href={resource.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-medium text-primary underline underline-offset-2"
                            >
                              {resource.title}
                            </a>
                          ) : (
                            <span className="text-sm font-medium">{resource.title}</span>
                          )}
                          <Badge variant="success">已验证</Badge>
                          {resource.platform ? (
                            <span className="text-xs text-muted-foreground">{resource.platform}</span>
                          ) : null}
                          {resource.lastVerifiedAt ? (
                            <span className="text-xs text-muted-foreground">
                              最后核验：{formatDate(resource.lastVerifiedAt)}
                            </span>
                          ) : null}
                        </div>
                        {resource.description ? (
                          <p className="mt-1 text-xs text-muted-foreground">{resource.description}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {otherStoredResources.length > 0 ? (
                <section className="space-y-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <AlertTriangle aria-hidden className="size-4 text-warning" />
                    库内未核验（{otherStoredResources.length}）
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    这些内容已经在资源库里，但还没有经过人工核验，请自行判断。
                  </p>
                  <ul className="space-y-2">
                    {otherStoredResources.map((resource) => (
                      <li key={resource.id} className="rounded-lg border bg-card p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{resource.title}</span>
                          <Badge variant="warning">未核验</Badge>
                        </div>
                        {resource.description ? (
                          <p className="mt-1 text-xs text-muted-foreground">{resource.description}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          )}

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            掌握度只由你的作答表现决定，看视频或看讲解本身不会改变等级 —— 因为「看懂」和「会做」是两件事。
          </p>
        </CardContent>
      </Card>

      <ResourceSearchPanel knowledgePointId={id} />

      <Card className="border-dashed bg-muted/30">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-muted-foreground">
            想直接问点具体的？把卡住的地方写清楚，AI 会跟着你的思路讲。
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link href="/tutor">
              去提问
              <Sparkles aria-hidden />
            </Link>
          </Button>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        当前等级「{masteryLabel(result.level as MasteryLevel)}」只表示这个知识点现在走到哪一步，
        不代表你的整体水平。
      </p>
    </div>
  );
}
