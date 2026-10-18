import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * 基础 UI 原语（shadcn/ui 风格，基于 Radix + Tailwind）。
 *
 * 集中在一个文件里而不是每个组件一个文件：第一版组件数量少（10 个左右），
 * 集中放置更容易保持视觉一致，也降低文件跳转成本。
 * 组件变多之后再按 shadcn 约定拆分即可。
 */

// -----------------------------------------------------------------------------
// Button
// -----------------------------------------------------------------------------

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        outline: 'border border-input bg-card hover:bg-muted',
        ghost: 'hover:bg-muted',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        link: 'text-primary underline underline-offset-4 hover:no-underline',
      },
      size: {
        // 手机上 h-11（44px）是苹果与微信都推荐的最小触控高度；桌面没必要这么高
        default: 'h-11 px-4 py-2 sm:h-10',
        sm: 'h-9 rounded-md px-3 text-[13px] sm:h-8',
        lg: 'h-12 rounded-lg px-6 sm:h-11',
        icon: 'h-11 w-11 sm:h-9 sm:w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    loading?: boolean;
  };

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, loading = false, children, disabled, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      // 加载中同时禁用并声明 aria-busy，屏幕阅读器能感知状态
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="animate-spin" aria-hidden />
          {children}
        </>
      ) : (
        children
      )}
    </Comp>
  );
});

// -----------------------------------------------------------------------------
// Card
// -----------------------------------------------------------------------------

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-xl border bg-card text-card-foreground shadow-sm', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 p-4 pb-2 sm:p-5 sm:pb-3', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-base font-semibold leading-tight', className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 pt-2 sm:p-5 sm:pt-3', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center gap-2 p-4 pt-0 sm:p-5 sm:pt-0', className)} {...props} />;
}

// -----------------------------------------------------------------------------
// 表单控件
// -----------------------------------------------------------------------------

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          // 用 text-base（16px）而不是 text-sm：iOS Safari 在输入框字号小于 16px 时
          // 会在聚焦瞬间自动放大整个页面，学生打完字页面就错位了。桌面仍用 14px。
          'flex h-11 w-full rounded-lg border border-input bg-card px-3 py-2 text-base placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60 sm:h-10 sm:text-sm',
          'aria-[invalid=true]:border-destructive',
          className,
        )}
        {...props}
      />
    );
  },
);

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[88px] w-full rounded-lg border border-input bg-card px-3 py-2 text-base placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm',
        'aria-[invalid=true]:border-destructive',
        className,
      )}
      {...props}
    />
  );
});

/** 原生 select —— 移动端体验更好，且无需额外 JS。 */
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        'flex h-11 w-full appearance-none rounded-lg border border-input bg-card bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat px-3 py-2 pr-9 text-base disabled:opacity-60 sm:h-10 sm:text-sm',
        // 用内联 SVG 做下拉箭头，避免额外依赖
        "bg-[url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});

export function Label({
  className,
  required,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return (
    <label className={cn('text-sm font-medium text-foreground', className)} {...props}>
      {children}
      {required ? (
        <span className="ml-0.5 text-destructive" aria-hidden>
          *
        </span>
      ) : null}
    </label>
  );
}

/** 表单字段包装：统一 标签 + 控件 + 错误提示 + 帮助文本 的结构 */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} required={required}>
        {label}
      </Label>
      {children}
      {hint && !error ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p className="text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Badge
// -----------------------------------------------------------------------------

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[12px] font-medium',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/10 text-primary',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border text-muted-foreground',
        success: 'border-transparent bg-success/12 text-success',
        warning: 'border-transparent bg-warning/12 text-warning',
        // 刻意不用鲜红：错误状态用低饱和的玫红，避免"你又错了"的压迫感
        soft: 'border-transparent bg-destructive/10 text-destructive',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

// -----------------------------------------------------------------------------
// Progress（带无障碍属性）
// -----------------------------------------------------------------------------

export function Progress({
  value,
  max = 100,
  label,
  className,
  tone = 'primary',
}: {
  value: number;
  max?: number;
  label?: string;
  className?: string;
  tone?: 'primary' | 'success' | 'warning';
}) {
  const safeMax = max <= 0 ? 1 : max;
  const percent = Math.max(0, Math.min(100, (value / safeMax) * 100));
  const toneClass =
    tone === 'success' ? 'bg-success' : tone === 'warning' ? 'bg-warning' : 'bg-primary';

  return (
    <div
      className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)}
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-label={label}
    >
      <div className={cn('h-full rounded-full transition-all', toneClass)} style={{ width: `${percent}%` }} />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Alert
// -----------------------------------------------------------------------------

const alertVariants = cva('rounded-xl border p-3.5 text-sm sm:p-4', {
  variants: {
    variant: {
      info: 'border-primary/20 bg-primary/5 text-foreground',
      success: 'border-success/25 bg-success/5 text-foreground',
      warning: 'border-warning/30 bg-warning/5 text-foreground',
      destructive: 'border-destructive/25 bg-destructive/5 text-foreground',
      muted: 'border-border bg-muted/50 text-muted-foreground',
    },
  },
  defaultVariants: { variant: 'info' },
});

export type AlertProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof alertVariants> & { title?: string };

export function Alert({ className, variant, title, children, ...props }: AlertProps) {
  return (
    <div
      className={cn(alertVariants({ variant }), className)}
      // 错误与警告用 role=alert，让屏幕阅读器主动播报
      role={variant === 'destructive' || variant === 'warning' ? 'alert' : 'status'}
      {...props}
    >
      {title ? <p className="mb-1 font-medium">{title}</p> : null}
      <div className="[&_a]:underline [&_a]:underline-offset-2">{children}</div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// EmptyState / Skeleton
// -----------------------------------------------------------------------------

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-card/50 px-6 py-10 text-center',
        className,
      )}
    >
      {icon ? <div className="text-muted-foreground [&_svg]:size-8">{icon}</div> : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}

/** 数据加载占位（列表页统一使用） */
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="rounded-xl border bg-card p-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-2 h-3 w-2/3" />
          <Skeleton className="mt-2 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}
