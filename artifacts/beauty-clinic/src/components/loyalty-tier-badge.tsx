import { Badge } from "@/components/ui/badge";

// سطح عضویت در باشگاه مشتریان (بر اساس خرید ۱۲ ماه اخیر) — جدا از «تیپ رفتاری»
// مراجع در tier-badge.tsx
export type LoyaltyTierKey = "bronze" | "silver" | "gold" | "diamond";

export const LOYALTY_TIER_META: Record<LoyaltyTierKey, { label: string; emoji: string; className: string }> = {
  bronze: { label: "برنزی", emoji: "🥉", className: "bg-orange-100 text-orange-800 border-orange-200" },
  silver: { label: "نقره‌ای", emoji: "🥈", className: "bg-slate-100 text-slate-700 border-slate-300" },
  gold: { label: "طلایی", emoji: "🥇", className: "bg-amber-100 text-amber-800 border-amber-300" },
  diamond: { label: "الماسی", emoji: "💎", className: "bg-sky-100 text-sky-800 border-sky-300" },
};

export const LOYALTY_TIER_KEYS: LoyaltyTierKey[] = ["bronze", "silver", "gold", "diamond"];

export function loyaltyTierLabel(tier: string | null | undefined): string {
  return LOYALTY_TIER_META[(tier ?? "bronze") as LoyaltyTierKey]?.label ?? "برنزی";
}

export function LoyaltyTierBadge({ tier, className = "" }: { tier: string | null | undefined; className?: string }) {
  const meta = LOYALTY_TIER_META[(tier ?? "bronze") as LoyaltyTierKey] ?? LOYALTY_TIER_META.bronze;
  return (
    <Badge variant="outline" className={`gap-1 ${meta.className} ${className}`}>
      <span aria-hidden>{meta.emoji}</span>
      {meta.label}
    </Badge>
  );
}
