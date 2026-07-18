import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// دسته‌بندی شخصیتی/رفتاری مراجعین — برای شناخت بهتر و برخورد متناسب با هر مراجع
export interface PatientTier {
  key: string;
  emoji: string;
  label: string;
  description: string;
}

export const PATIENT_TIERS: PatientTier[] = [
  { key: "loyal", emoji: "💎", label: "وفادار واقعی", description: "مراجع همیشگی و وفادار که مرتب برمی‌گردد و به مطب اعتماد کامل دارد." },
  { key: "classy", emoji: "✨", label: "کلاس‌بالا", description: "مراجع با توقع بالا که کیفیت و تجربه‌ی لوکس برایش مهم‌تر از قیمت است." },
  { key: "discount", emoji: "🏷️", label: "تخفیف‌خواه", description: "مراجعی که همیشه دنبال تخفیف و پیشنهاد ویژه است." },
  { key: "priceshopper", emoji: "🔄", label: "قیمت‌گردان", description: "مراجعی که قیمت‌ها را با جاهای دیگر مقایسه می‌کند و دنبال ارزان‌ترین گزینه است." },
  { key: "anxious", emoji: "😰", label: "اضطرابی", description: "مراجع نگران و مضطرب که به اطمینان‌بخشی و توضیح بیشتر نیاز دارد." },
  { key: "referral", emoji: "🤝", label: "ارجاعی", description: "مراجعی که افراد دیگری را به مطب معرفی می‌کند." },
  { key: "instagram", emoji: "📱", label: "اینستاگرامی", description: "مراجعی که از طریق اینستاگرام و فضای مجازی با مطب آشنا شده است." },
  { key: "resultstrict", emoji: "🎯", label: "نتیجه‌محور سختگیر", description: "مراجعی که فقط نتیجه برایش مهم است و انتظار نتیجه‌ی دقیق و قطعی دارد." },
];

const TIER_MAP = new Map(PATIENT_TIERS.map((t) => [t.key, t]));

export function getTier(key: string | null | undefined): PatientTier | null {
  return key ? TIER_MAP.get(key) ?? null : null;
}

export function TierBadge({
  tier,
  showLabel = false,
  className,
}: {
  tier: string | null | undefined;
  showLabel?: boolean;
  className?: string;
}) {
  const info = getTier(tier);
  if (!info) return null;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn("inline-flex items-center gap-1 align-middle cursor-default select-none", className)}>
            <span className="text-base leading-none">{info.emoji}</span>
            {showLabel && <span className="text-xs text-muted-foreground">{info.label}</span>}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <span className="font-medium">{info.label}</span> — {info.description}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
