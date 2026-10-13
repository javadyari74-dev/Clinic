import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * سرتیتر صفحه‌ها: بنر گرادیان زرشکی → صورتی با عنوان، توضیح و دکمه‌ها.
 * دکمه‌های داخل `actions` خودکار سفید و قرصی می‌شوند تا روی گرادیان خوانا باشند.
 */
export function PageHeader({
  title,
  description,
  icon,
  actions,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  /** محتوای اضافه زیر عنوان (مثلاً نشان‌ها یا آمار کوچک) */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-3xl px-6 py-5 md:px-7 md:py-6 text-white",
        "bg-gradient-to-r from-[#7f1d1d] via-[#be185d] to-[#ec4899] shadow-[0_14px_40px_-16px_rgba(127,29,29,0.55)]",
        "flex flex-col gap-4 md:flex-row md:items-center md:justify-between",
        className,
      )}
    >
      <span aria-hidden className="pointer-events-none absolute -left-16 -top-28 h-64 w-64 rounded-full bg-white/10" />
      <span aria-hidden className="pointer-events-none absolute left-40 -bottom-24 h-40 w-40 rounded-full bg-white/5" />
      <div className="relative min-w-0">
        <h1 className="flex items-center gap-2 text-2xl md:text-[26px] font-extrabold tracking-tight [&_svg]:h-6 [&_svg]:w-6">
          {icon}
          {title}
        </h1>
        {description && <p className="mt-1 text-sm md:text-[15px] text-white/85">{description}</p>}
        {children && <div className="mt-2">{children}</div>}
      </div>
      {actions && (
        <div
          className={cn(
            "relative flex flex-wrap items-center gap-2",
            // دکمه‌ها روی گرادیان: سفید و قرصی
            "[&_button]:rounded-full [&_button]:border-white/0 [&_button]:bg-white [&_button]:text-primary [&_button]:font-bold",
            "[&_button]:shadow-[0_6px_18px_-6px_rgba(0,0,0,0.3)] [&_button:hover]:bg-white/90",
            "[&_input]:bg-white [&_input]:text-foreground [&_input]:border-white/0",
          )}
        >
          {actions}
        </div>
      )}
    </div>
  );
}
