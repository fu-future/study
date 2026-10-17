import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BookX, ChevronLeft, ChevronRight, Clock, ListChecks } from 'lucide-react';
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
import { listMistakeSummaries } from '@/lib/questions/service';
import { errorTypeLabel, WRONG_RECORD_STATUSES } from '@/lib/domain/enums';
import { formatDate, formatRelative } from '@/lib/utils';
import { previewText } from '@/lib/preview';
import { withQuery } from '@/lib/client-api';
import { MistakeFilterBar, type MistakeFilterValue } from '@/components/mistakes/mistake-filter-bar';
import { MistakeEntryDialog } from '@/components/mistakes/mistake-entry-dialog';
import { MistakeUploadDialog } from '@/components/mistakes/mistake-upload-dialog';

export const metadata: Metadata = { title: '错题本' };

const PAGE_SIZE = 10;

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function statusVariant(status: string): 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'soft' {
  switch (status) {
    case 'resolved':
      return 'success';
    case 'needs-review':
      return 'warning';
    case 'reviewing':
      return 'default';
    case 'analyzing':
      return 'secondary';
    case 'archived':
      return 'outline';
    default:
      return 'secondary';
  }
}

export default async function MistakesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const subjectId = firstValue(params.subjectId);
  const knowledgePointId = firstValue(params.knowledgePointId);
  const errorType = firstValue(params.errorType);
  const reviewFilterParam = firstValue(params.reviewFilter);
  const reviewFilter: MistakeFilterValue['reviewFilter'] =
    reviewFilterParam === 'due' || reviewFilterParam === 'not-scheduled' ? reviewFilterParam : 'all';
  const page = Math.max(1, Number(firstValue(params.page)) || 1);

  const [subjects, knowledgePointResult, mistakeResult] = await Promise.all([
    listSubjects(),
    listKnowledgePoints({ subjectId: subjectId || undefined, limit: 200 }),
    listMistakeSummaries(user.id, {
      subjectId: subjectId || undefined,
      knowledgePointId: knowledgePointId || undefined,
      errorType: errorType || undefined,
      reviewFilter,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
  ]);

  const items = mistakeResult.items;
  const total = mistakeResult.total;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const now = Date.now();

  const filterValue: MistakeFilterValue = { subjectId, knowledgePointId, errorType, reviewFilter };
  const subjectOptions = subjects.map((subject) => ({ id: subject.id, name: subject.name }));
  const knowledgePointOptions = knowledgePointResult.items.map((point) => ({
    id: point.id,
    name: point.name,
  }));

  function pageHref(target: number): string {
    return withQuery('/mistakes', {
      subjectId,
      knowledgePointId,
      errorType,
      reviewFilter: reviewFilter === 'all' ? '' : reviewFilter,
      page: target > 1 ? target : '',
    });
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">错题本</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            错题不是「没学好」的证据，而是最省时间的复习清单。录入时会自动安排复习时间，
            做对之后间隔会慢慢拉长。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <MistakeEntryDialog subjects={subjectOptions} defaultSubjectId={subjectId || undefined} />
          <MistakeUploadDialog subjects={subjectOptions} defaultSubjectId={subjectId || undefined} />
        </div>
      </header>

      <MistakeFilterBar
        subjects={subjectOptions}
        knowledgePoints={knowledgePointOptions}
        value={filterValue}
      />

      {total === 0 ? (
        <EmptyState
          icon={<BookX aria-hidden />}
          title={
            subjectId || knowledgePointId || errorType || reviewFilter !== 'all'
              ? '这些条件下还没有错题'
              : '错题本还是空的'
          }
          description={
            subjectId || knowledgePointId || errorType || reviewFilter !== 'all'
              ? '可以试试清除筛选条件，或者换一个学科看看。'
              : '做错的题可以拍照上传，让系统帮你整理题干和错误原因；也可以直接手动录入。'
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <MistakeEntryDialog subjects={subjectOptions} />
              <MistakeUploadDialog subjects={subjectOptions} />
            </div>
          }
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            共 {total} 道错题（第 {page} / {totalPages} 页）
          </p>

          <ul className="space-y-3">
            {items.map((item) => {
              const mistake = item.mistake;
              const dueAt = mistake?.nextReviewAt ? new Date(mistake.nextReviewAt) : null;
              const isDue = dueAt ? dueAt.getTime() <= now : false;

              return (
                <li key={item.id}>
                  <Card>
                    <CardContent className="space-y-3 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">{item.subjectName || '未标学科'}</Badge>
                        {mistake ? (
                          <Badge variant={statusVariant(mistake.status)}>
                            {WRONG_RECORD_STATUSES[mistake.status as keyof typeof WRONG_RECORD_STATUSES] ??
                              mistake.status}
                          </Badge>
                        ) : (
                          <Badge variant="outline">没有错题记录</Badge>
                        )}
                        {isDue ? <Badge variant="warning">今天该复习</Badge> : null}
                        {mistake?.errorTypes.map((type) => (
                          <Badge key={type} variant="outline">
                            {errorTypeLabel(type)}
                          </Badge>
                        ))}
                      </div>

                      <Link
                        href={`/mistakes/${item.id}`}
                        className="block text-sm font-medium leading-relaxed hover:underline"
                      >
                        {previewText(item.stem || '（题干未录入）', 150)}
                      </Link>

                      {item.knowledgePoints.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {item.knowledgePoints.map((point) => (
                            <Link key={point.id} href={`/knowledge/${point.id}`}>
                              <Badge variant={point.isPrimary ? 'default' : 'outline'}>{point.name}</Badge>
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">还没有关联知识点</p>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="flex items-center gap-1">
                            <ListChecks aria-hidden className="size-3.5" />
                            作答 {mistake?.attemptCount ?? 0} 次 · 答对 {mistake?.correctCount ?? 0} 次
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock aria-hidden className="size-3.5" />
                            {dueAt
                              ? isDue
                                ? `该复习了（${formatDate(dueAt)} 到期）`
                                : `下次复习：${formatDate(dueAt)}`
                              : '还没有安排复习'}
                          </span>
                          <span>录入于 {formatRelative(item.createdAt)}</span>
                        </div>
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/mistakes/${item.id}`}>
                            打开复习
                            <ChevronRight aria-hidden />
                          </Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>

          {totalPages > 1 ? (
            <nav className="flex items-center justify-between gap-3" aria-label="错题分页">
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

      <Alert variant="muted" title="关于错题本的一点说明">
        <p>
          这里记录的是「你已经做过的题」，所以不会出现任何估算出来的掌握度。
          想看某个知识点的掌握情况，可以去知识点地图对应页面。
        </p>
      </Alert>
    </div>
  );
}
