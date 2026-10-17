import { ListSkeleton, Skeleton } from '@/components/ui/primitives';

/**
 * 路由切换时的加载占位。
 * 覆盖整个 (app) 分组：进入任一页面都会先看到骨架屏，而不是白屏。
 */
export default function AppLoading() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
      <ListSkeleton rows={3} />
    </div>
  );
}
