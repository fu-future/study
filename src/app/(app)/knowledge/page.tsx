import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronLeft, ChevronRight, Info, Network } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
} from '@/components/ui/primitives';
import { getCurrentUser } from '@/lib/auth/current-user';
import { listSubjects } from '@/lib/repositories/subjects.repository';
import { listKnowledgePoints } from '@/lib/repositories/knowledge.repository';
import { listMasteryWithKnowledgePoint } from '@/lib/repositories/mastery.repository';
import { KP_REVIEW_STATUS, MASTERY_ORDER, masteryLabel } from '@/lib/domain/enums';
import { readStringArray } from '@/lib/db/json';
import { formatPercent } from '@/lib/utils';
import { previewText } from '@/lib/preview';
import { withQuery } from '@/lib/client-api';
import { KnowledgeFilterBar } from '@/components/knowledge/knowledge-filter-bar';

export const metadata: Metadata = { title: '知识点地图' };

const PAGE_SIZE = 12;

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function masteryVariant(level: string): 'success' | 'default' | 'warning' | 'outline' {
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

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const subjectId = firstValue(params.subjectId);
  const grade = firstValue(params.grade);
  const search = firstValue(params.search);
  // 默认展示掌握度：学生最想看的其实是「我走到哪一步了」
  const withMastery = firstValue(params.withMastery) !== 'false';
  const page = Math.max(1, Number(firstValue(params.page)) || 1);

  const [subjects, knowledgeResult, masteryRows] = await Promise.all([
    listSubjects(),
    listKnowledgePoints({
      subjectId: subjectId || undefined,
      grade: grade || undefined,
      search: search || undefined,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    withMastery
      ? listMasteryWithKnowledgePoint(user.id, { subjectId: subjectId || undefined })
      : Promise.resolve([]),
  ]);

  const items = knowledgeResult.items;
  const total = knowledgeResult.total;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const masteryByPoint = new Map(masteryRows.map((row) => [row.knowledgePointId, row]));

  // 按章节路径分组展示，比一条条平铺更容易看出知识结构
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const key = item.chapterPath?.trim() || '未归类章节';
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }

  const subjectOptions = subjects.map((subject) => ({ id: subject.id, name: subject.name }));

  function pageHref(target: number): string {
    return withQuery('/knowledge', {
      subjectId,
      grade,
      search,
      withMastery: withMastery ? '' : 'false',
      page: target > 1 ? target : '',
    });
  }

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">知识点地图</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          按章节整理的知识目录。点开任意一个知识点，可以看到它当前的掌握情况、判断依据，
          以及可以用的讲解与练习。
        </p>
      </header>

      <KnowledgeFilterBar
        subjects={subjectOptions}
        value={{ subjectId, grade, search, withMastery }}
      />

      {total === 0 ? (
        <EmptyState
          icon={<Network aria-hidden />}
          title={subjectId || grade || search ? '这些条件下没有找到知识点' : '知识点目录还在建设中'}
          description={
            subjectId || grade || search
              ? '可以换一个学科或清空搜索词再试。'
              : '管理员可以导入 CSV 或手动添加知识点。目录建好之后，这里的掌握度和诊断就会自动生效。'
          }
          action={
            subjectId || grade || search ? (
              <Button asChild variant="outline">
                <Link href="/knowledge">查看全部知识点</Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            共 {total} 个知识点，第 {page} / {totalPages} 页 · 按章节分组
          </p>

          <div className="space-y-4">
            {[...groups.entries()].map(([chapterPath, groupItems]) => (
              <section key={chapterPath} className="space-y-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                  <span className="h-4 w-1 rounded-full bg-primary/40" aria-hidden />
                  {chapterPath}
                </h2>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {groupItems.map((point) => {
                    const mastery = masteryByPoint.get(point.id);
                    const commonMistakes = readStringArray(point.commonMistakes);

                    return (
                      <Card key={point.id}>
                        <CardContent className="space-y-2 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <Link
                              href={`/knowledge/${point.id}`}
                              className="font-medium leading-snug text-primary underline underline-offset-2"
                            >
                              {point.name}
                            </Link>
                            <Badge
                              variant={
                                point.reviewStatus === 'reviewed'
                                  ? 'secondary'
                                  : point.reviewStatus === 'deprecated'
                                    ? 'outline'
                                    : 'warning'
                              }
                            >
                              {KP_REVIEW_STATUS[point.reviewStatus as keyof typeof KP_REVIEW_STATUS] ??
                                point.reviewStatus}
                            </Badge>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant="outline">难度 {point.difficulty}/5</Badge>
                            {point.grade ? <span>{point.grade}</span> : null}
                            {point.code ? <span className="font-mono">{point.code}</span> : null}
                          </div>

                          {point.description ? (
                            <p className="text-xs leading-relaxed text-muted-foreground">
                              {previewText(point.description, 90)}
                            </p>
                          ) : null}

                          {commonMistakes.length > 0 ? (
                            <p className="text-xs text-muted-foreground">
                              常见错误 {commonMistakes.length} 条：{previewText(commonMistakes[0], 40)}
                            </p>
                          ) : null}

                          {withMastery ? (
                            mastery ? (
                              <div className="flex flex-wrap items-center gap-2 text-xs">
                                <Badge variant={masteryVariant(mastery.level)}>
                                  {masteryLabel(mastery.level)}
                                </Badge>
                                <span className="text-muted-foreground">
                                  证据 {mastery.evidenceCount} 条
                                  {mastery.recentAccuracy !== null && mastery.recentSampleSize > 0
                                    ? ` · 近期正确率 ${formatPercent(mastery.recentAccuracy)}`
                                    : ''}
                                </span>
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground">还没有练习记录</p>
                            )
                          ) : null}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          {totalPages > 1 ? (
            <nav className="flex items-center justify-between gap-3" aria-label="知识点分页">
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

      <Alert variant="muted" title="掌握度是怎么来的">
        <p className="flex items-start gap-2">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          等级只由你的真实作答记录（正确率、是否独立完成、题目难度、复测表现）推算，范围从
          「{masteryLabel(MASTERY_ORDER[0])}」到「{masteryLabel(MASTERY_ORDER[MASTERY_ORDER.length - 1])}」。
          练习次数不够时会显示「{masteryLabel('insufficient')}」，而不是随便给一个结论。
        </p>
      </Alert>
    </div>
  );
}
