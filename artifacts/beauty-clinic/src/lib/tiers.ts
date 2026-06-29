export type TierKey =
  | "loyal"
  | "classy"
  | "discount"
  | "priceshopper"
  | "anxious"
  | "referral"
  | "instagram"
  | "resultstrict";

export interface TierMeta {
  key: TierKey;
  emoji: string;
  label: string;
  description: string;
}

export const PATIENT_TIERS: TierMeta[] = [
  { key: "loyal", emoji: "💎", label: "وفادار واقعی", description: "مراجع همیشگی و وفادار که مرتب برمی‌گردد و به مطب اعتماد کامل دارد." },
  { key: "classy", emoji: "✨", label: "کلاس‌بالا", description: "مراجع با توقع بالا که کیفیت و تجربه‌ی لوکس برایش مهم‌تر از قیمت است." },
  { key: "discount", emoji: "🏷️", label: "تخفیف‌خواه", description: "مراجعی که همیشه دنبال تخفیف و پیشنهاد ویژه است." },
  { key: "priceshopper", emoji: "🔄", label: "قیمت‌گردان", description: "مراجعی که قیمت‌ها را با جاهای دیگر مقایسه می‌کند و دنبال ارزان‌ترین گزینه است." },
  { key: "anxious", emoji: "😰", label: "اضطرابی", description: "مراجع نگران و مضطرب که به اطمینان‌بخشی و توضیح بیشتر نیاز دارد." },
  { key: "referral", emoji: "🤝", label: "ارجاعی", description: "مراجعی که افراد دیگری را به مطب معرفی می‌کند." },
  { key: "instagram", emoji: "📱", label: "اینستاگرامی", description: "مراجعی که از طریق اینستاگرام و فضای مجازی با مطب آشنا شده است." },
  { key: "resultstrict", emoji: "🎯", label: "نتیجه‌محور سختگیر", description: "مراجعی که فقط نتیجه برایش مهم است و انتظار نتیجه‌ی دقیق و قطعی دارد." },
];

const TIER_MAP = new Map<string, TierMeta>(PATIENT_TIERS.map((t) => [t.key, t]));

export function getTier(key: string | null | undefined): TierMeta | null {
  if (!key) return null;
  return TIER_MAP.get(key) ?? null;
}
