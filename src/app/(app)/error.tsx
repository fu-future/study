'use client';

import { RefreshCw } from 'lucide-react';
import { Alert, Button } from '@/components/ui/primitives';

/**
 * 页面级错误兜底。
 *
 * 服务端组件里抛出的异常（数据库读不到、上游服务失败等）会落到这里。
 * 只显示一句人话 + 重试，不把堆栈或 SQL 暴露给学生。
 */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">这个页面暂时没能打开</h1>
      <Alert variant="destructive" title="加载失败了">
        <p>
          可能是网络波动，或者服务器正在忙。你刚才的操作一般不会丢失，
          可以先重试一次；如果一直打不开，可以回到学习仪表盘继续做别的。
        </p>
      </Alert>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => reset()}>
          <RefreshCw aria-hidden />
          重试
        </Button>
        <Button variant="outline" asChild>
          <a href="/dashboard">回到学习仪表盘</a>
        </Button>
      </div>
    </div>
  );
}
