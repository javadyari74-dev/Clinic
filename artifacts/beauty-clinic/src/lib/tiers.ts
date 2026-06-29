export type TierKey =
  | "vip"
  | "gold"
  | "silver"
  | "bronze"
  | "new"
  | "referrer"
  | "inactive"
  | "baddebt";

export interface TierMeta {
  key: TierKey;
  emoji: string;
  label: string;
  description: string;
}

export const PATIENT_TIERS: TierMeta[] = [
  { key: "vip", emoji: "⭐", label: "ویژه (VIP)", description: "ارزشمندترین مراجعان" },
  { key: "gold", emoji: "💎", label: "طلایی", description: "مشتری وفادار با خرید بالا" },
  { key: "silver", emoji: "🥈", label: "نقره‌ای", description: "مشتری منظم" },
  { key: "bronze", emoji: "🥉", label: "برنزی", description: "مشتری عادی" },
  { key: "new", emoji: "🌱", label: "جدید", description: "مراجع تازه‌وارد" },
  { key: "referrer", emoji: "🤝", label: "معرف", description: "افراد زیادی معرفی کرده" },
  { key: "inactive", emoji: "😴", label: "غیرفعال", description: "مدتی مراجعه نکرده" },
  { key: "baddebt", emoji: "⚠️", label: "بدحساب", description: "سابقه‌ی پرداخت نامنظم" },
];

const TIER_MAP = new Map<string, TierMeta>(PATIENT_TIERS.map((t) => [t.key, t]));

export function getTier(key: string | null | undefined): TierMeta | null {
  if (!key) return null;
  return TIER_MAP.get(key) ?? null;
}
