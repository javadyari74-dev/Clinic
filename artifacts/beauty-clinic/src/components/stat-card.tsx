import * as React from "react";
import { cn } from "@/lib/utils";

/** رنگ‌های کارت آمار؛ همه در خانوادهٔ زرشکی/صورتی به‌جز amber و teal برای معنای خاص */
export type StatTone = "rose" | "wine" | "pink" | "crimson" | "plum" | "amber" | "teal";

const TONES: Record<StatTone, string> = {
  rose: "from-[#be185d] to-[#9d174d]",
  wine: "from-[#7f1d1d] to-[#4c1010]",
  pink: "from-[#db2777] to-[#f472b6]",
  crimson: "from-[#9f1239] to-[#e11d48]",
  plum: "from-[#86198f] to-[#c026d3]",
  amber: "from-[#b45309] to-[#f59e0b]",
  teal: "from-[#0f766e] to-[#14b8a6]",
};

/**
 * کارت آمار رنگی (گرادیان) با نمودار ستونی کوچک اختیاری.
 * `spark`: چند عدد برای ستون‌های کوچک؛ آخری پررنگ است.
 */
export function StatCard({
  title,
  value,
  sub,
  icon,
  tone = "rose",
  spark,
  onClick,
  className,
  testId,
}: {
  title: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: StatTone;
  spark?: number[];
  onClick?: () => void;
  className?: string;
  testId?: string;
}) {
  const max = spark && spark.length ? Math.max(...spark, 1) : 1;
  return (
    <div
      data-testid={testId}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      className={cn(
        "relative overflow-hidden rounded-3xl p-5 text-white bg-gradient-to-bl shadow-[0_12px_30px_-14px_rgba(127,29,29,0.55)]",
        TONES[tone],
        onClick && "cursor-pointer transition-transform hover:-translate-y-0.5",
        className,
      )}
    >
      <span aria-hidden className="pointer-events-none absolute -left-10 -top-10 h-28 w-28 rounded-full bg-white/10" />
      <div className="relative flex items-start justify-between gap-2">
        <span className="text-sm text-white/85">{title}</span>
        {icon && <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/15 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-white">{icon}</span>}
      </div>
      <div className="relative mt-2 text-2xl font-extrabold tracking-tight">{value}</div>
      {sub && <div className="relative mt-1 text-xs text-white/85">{sub}</div>}
      {spark && spark.length > 0 && (
        <div aria-hidden className="relative mt-3 flex h-7 items-end gap-1">
          {spark.map((v, i) => (
            <i
              key={i}
              className={cn("flex-1 rounded-t-[4px]", i === spark.length - 1 ? "bg-white" : "bg-white/45")}
              style={{ height: `${Math.max(12, (v / max) * 100)}%` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
