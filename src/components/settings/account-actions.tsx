'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Download, ShieldAlert, Trash2, X } from 'lucide-react';
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives';
import { apiDelete, toUserMessage } from '@/lib/client-api';

/**
 * 数据权利相关操作：导出 / 归档账号。
 *
 * 删除做成两步确认，而且文案必须说清楚：这是**归档**，不会立刻物理删除，
 * 避免学生以为点了就永久消失。
 */
export function AccountActions({ displayName }: { displayName: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [stage, setStage] = React.useState<'explain' | 'confirm'>('explain');
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleArchive() {
    setSubmitting(true);
    setError(null);
    try {
      await apiDelete('/api/account');
      router.push('/login');
      router.refresh();
    } catch (err) {
      setError(toUserMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download aria-hidden className="size-4 text-primary" />
            导出我的学习数据
          </CardTitle>
          <CardDescription>
            下载一份包含学习档案、错题、作答记录与计划的文件。数据是你自己的，随时可以带走。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" asChild>
            <a href="/api/account/export" download>
              <Download aria-hidden />
              下载数据文件
            </a>
          </Button>
        </CardContent>
      </Card>

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <ShieldAlert aria-hidden className="size-4 text-warning" />
            归档账号
          </CardTitle>
          <CardDescription>
            归档后你会立即退出登录，账号不再出现在任何列表里。
            <span className="text-foreground">这是归档，不会立刻物理删除数据</span>
            —— 保留一段时间是为了避免误操作，也方便你在必要时找回。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Dialog.Root
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              if (!next) {
                setStage('explain');
                setAcknowledged(false);
                setError(null);
              }
            }}
          >
            <Dialog.Trigger asChild>
              <Button variant="outline">
                <Trash2 aria-hidden />
                归档我的账号
              </Button>
            </Dialog.Trigger>

            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-40 bg-foreground/25" />
              <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(30rem,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border bg-card p-5 shadow-xl">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Dialog.Title className="text-lg font-semibold">
                      {stage === 'explain' ? '归档账号前，先确认一下' : '最后再确认一次'}
                    </Dialog.Title>
                    <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                      {stage === 'explain'
                        ? `${displayName}，下面是归档会发生的事情。`
                        : '点下按钮之后，账号会立刻进入归档状态。'}
                    </Dialog.Description>
                  </div>
                  <Dialog.Close asChild>
                    <Button variant="ghost" size="icon" aria-label="关闭">
                      <X aria-hidden />
                    </Button>
                  </Dialog.Close>
                </div>

                <div className="mt-4 space-y-3">
                  <Alert variant="warning" title="归档会发生什么">
                    <ul className="list-disc space-y-1 pl-5">
                      <li>你会立即退出登录，无法再用这个账号进入。</li>
                      <li>错题、作答记录与学习计划会一并隐藏，不再参与任何统计。</li>
                      <li>数据是归档而不是立即物理删除，保留期内仍有可能恢复。</li>
                      <li>如果你只是暂时不想用，直接停用一段时间也不会影响数据。</li>
                    </ul>
                  </Alert>

                  {stage === 'explain' ? (
                    <>
                      <label className="flex cursor-pointer items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-1 size-4 accent-[hsl(var(--primary))]"
                          checked={acknowledged}
                          onChange={(event) => setAcknowledged(event.target.checked)}
                        />
                        <span>我已经了解这是归档、不是立即删除，也确认希望继续。</span>
                      </label>

                      <div className="flex justify-end gap-2">
                        <Dialog.Close asChild>
                          <Button type="button" variant="outline">
                            我再想想
                          </Button>
                        </Dialog.Close>
                        <Button
                          type="button"
                          variant="destructive"
                          disabled={!acknowledged}
                          onClick={() => setStage('confirm')}
                        >
                          继续
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="flex items-start gap-2 text-sm">
                        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
                        如果想保留数据，现在关掉这个窗口还来得及；需要的话也可以先下载一份数据文件。
                      </p>

                      {error ? (
                        <Alert variant="destructive" title="归档没有成功">
                          <p>{error}</p>
                        </Alert>
                      ) : null}

                      <div className="flex justify-end gap-2">
                        <Dialog.Close asChild>
                          <Button type="button" variant="outline" disabled={submitting}>
                            取消
                          </Button>
                        </Dialog.Close>
                        <Button
                          type="button"
                          variant="destructive"
                          loading={submitting}
                          onClick={() => void handleArchive()}
                        >
                          确认归档
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </CardContent>
      </Card>
    </>
  );
}
