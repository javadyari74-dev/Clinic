import { useEffect, useRef, useState } from "react";
import { useNotifyLoyaltyMembers } from "@workspace/api-client-react";
import type { LoyaltyNotifyResult } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { LOYALTY_TIER_KEYS, LOYALTY_TIER_META, type LoyaltyTierKey } from "@/components/loyalty-tier-badge";
import { useToast } from "@/hooks/use-toast";
import { toastApiError } from "@/lib/api-error";
import { toPersianDigits } from "@/lib/format";
import { MessageSquare, Send } from "lucide-react";

// ─── پیام دستی باشگاه ──────────────────────────────────────────────────────────
// به یک عضو (target) یا همهٔ اعضا (target = null با فیلتر سطح/موجودی/انقضا)، در هر لحظه.
// متن‌های آماده با متغیرهایی که برای هر نفر جدا پر می‌شوند.

const SITE = " www.drjavadyari.ir";

const PRESETS: Array<{ key: string; label: string; text: string; onlyExpiring?: boolean }> = [
  {
    key: "balance",
    label: "موجودی کیف پول",
    text: "{نام} عزیز، موجودی کیف پول شما در باشگاه مشتریان مطب زیبایی دکتر یاری {موجودی} تومان است و در مراجعهٔ بعدی می‌توانید از آن استفاده کنید." + SITE,
  },
  {
    key: "expiry",
    label: "یادآوری انقضای اعتبار",
    text: "{نام} عزیز، {مبلغ_انقضا} تومان از اعتبار کیف پول شما در مطب زیبایی دکتر یاری تا {تاریخ_انقضا} منقضی می‌شود. برای استفاده از آن نوبت بگیرید." + SITE,
    onlyExpiring: true,
  },
  {
    key: "both",
    label: "موجودی + انقضا",
    text: "{نام} عزیز، موجودی کیف پول شما در مطب زیبایی دکتر یاری {موجودی} تومان است که {مبلغ_انقضا} تومان آن تا {تاریخ_انقضا} منقضی می‌شود. برای استفاده از آن نوبت بگیرید." + SITE,
    onlyExpiring: true,
  },
];

const VARIABLES = ["{نام}", "{موجودی}", "{مبلغ_انقضا}", "{تاریخ_انقضا}", "{سطح}"];
const USES_EXPIRY = /\{\s*(مبلغ_انقضا|تاریخ_انقضا)\s*\}/;

export function LoyaltyNotifyDialog({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** عضو مشخص؛ null = ارسال گروهی به اعضا */
  target: { patientId: number; patientName: string } | null;
}) {
  const { toast } = useToast();
  const bulk = target === null;
  const [preset, setPreset] = useState(PRESETS[0].key);
  const [message, setMessage] = useState(PRESETS[0].text);
  const [tiers, setTiers] = useState<LoyaltyTierKey[]>([]);
  const [onlyWithBalance, setOnlyWithBalance] = useState(true);
  const [onlyExpiring, setOnlyExpiring] = useState(false);
  const [days, setDays] = useState("30");
  const [preview, setPreview] = useState<LoyaltyNotifyResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const previewMutation = useNotifyLoyaltyMembers();
  const sendMutation = useNotifyLoyaltyMembers({
    mutation: {
      onSuccess: (r) => {
        setConfirming(false);
        onOpenChange(false);
        toast({
          title: r.failed > 0 ? "ارسال پیام با خطای جزئی انجام شد" : "پیام ارسال شد",
          description: `${toPersianDigits(r.sent)} ارسال${r.failed ? `، ${toPersianDigits(r.failed)} ناموفق (جزئیات در گزارش پیامک‌ها)` : ""}`,
          variant: r.failed > 0 && r.sent === 0 ? "destructive" : undefined,
        });
      },
      onError: (err) => {
        setConfirming(false);
        toastApiError(err, "ارسال پیام ناموفق بود");
      },
    },
  });

  // هر بار باز شدن: متن آماده اول
  useEffect(() => {
    if (!open) return;
    setPreset(PRESETS[0].key);
    setMessage(PRESETS[0].text);
    setTiers([]);
    setOnlyWithBalance(true);
    setOnlyExpiring(false);
    setDays("30");
    setPreview(null);
  }, [open, target?.patientId]);

  const body = () => ({
    message,
    patientIds: target ? [target.patientId] : undefined,
    tiers: bulk && tiers.length > 0 ? tiers : undefined,
    onlyWithBalance: bulk ? onlyWithBalance : undefined,
    onlyExpiring: bulk ? onlyExpiring : undefined,
    expiringWithinDays: Number.parseInt(days, 10) || 30,
  });

  // پیش‌نمایش زنده (با کمی تأخیر پس از تغییر متن یا فیلترها)
  useEffect(() => {
    if (!open || !message.trim()) { setPreview(null); return; }
    const t = setTimeout(() => {
      previewMutation.mutate({ data: { ...body(), dryRun: true } }, { onSuccess: setPreview });
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, message, tiers, onlyWithBalance, onlyExpiring, days, target?.patientId]);

  function choosePreset(key: string) {
    const p = PRESETS.find((x) => x.key === key);
    if (!p) return;
    setPreset(key);
    setMessage(p.text);
    if (bulk) setOnlyExpiring(!!p.onlyExpiring);
  }

  function insertVariable(v: string) {
    const el = textRef.current;
    if (!el) { setMessage((m) => m + v); return; }
    const start = el.selectionStart ?? message.length;
    const end = el.selectionEnd ?? message.length;
    setMessage(message.slice(0, start) + v + message.slice(end));
    setPreset("custom");
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + v.length, start + v.length); });
  }

  function toggleTier(t: LoyaltyTierKey) {
    setTiers((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  function send() {
    if (!message.trim()) {
      toast({ title: "متن پیام خالی است", variant: "destructive" });
      return;
    }
    if (bulk) { setConfirming(true); return; }
    sendMutation.mutate({ data: body() });
  }

  const count = preview?.total ?? 0;
  const first = preview?.recipients[0];
  const expiryMissing = !!first && USES_EXPIRY.test(message) && first.expiringAmount === 0;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !sendMutation.isPending && onOpenChange(o)}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-amber-600" />
              {bulk ? "ارسال پیام به اعضای باشگاه" : `ارسال پیام به ${target?.patientName}`}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label className="text-sm mb-1.5 block">پیام آماده</Label>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <Button key={p.key} type="button" size="sm" variant={preset === p.key ? "default" : "outline"} onClick={() => choosePreset(p.key)}>
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <Label htmlFor="loyalty-notify-text" className="text-sm mb-1.5 block">متن پیام (قابل ویرایش)</Label>
              <Textarea
                id="loyalty-notify-text"
                ref={textRef}
                rows={4}
                value={message}
                onChange={(e) => { setMessage(e.target.value); setPreset("custom"); }}
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {VARIABLES.map((v) => (
                  <Button key={v} type="button" size="sm" variant="secondary" className="h-7 text-xs" onClick={() => insertVariable(v)}>
                    {v}
                  </Button>
                ))}
              </div>
            </div>

            {bulk && (
              <div className="space-y-3 rounded-lg border p-3">
                <div>
                  <Label className="text-sm mb-1.5 block">گیرندگان</Label>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant={tiers.length === 0 ? "default" : "outline"} onClick={() => setTiers([])}>همهٔ اعضا</Button>
                    {LOYALTY_TIER_KEYS.map((t) => (
                      <Button key={t} type="button" size="sm" variant={tiers.includes(t) ? "default" : "outline"} onClick={() => toggleTier(t)}>
                        {LOYALTY_TIER_META[t].emoji} {LOYALTY_TIER_META[t].label}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch id="notify-balance" checked={onlyWithBalance} onCheckedChange={setOnlyWithBalance} />
                  <Label htmlFor="notify-balance">فقط اعضایی که موجودی کیف پول دارند</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch id="notify-expiring" checked={onlyExpiring} onCheckedChange={setOnlyExpiring} />
                  <Label htmlFor="notify-expiring">فقط اعضایی که اعتبارشان در حال انقضاست</Label>
                </div>
              </div>
            )}

            {USES_EXPIRY.test(message) && (
              <div className="flex items-center gap-2 text-sm">
                <Label htmlFor="notify-days" className="shrink-0">«در حال انقضا» یعنی ظرف</Label>
                <Input id="notify-days" className="w-20" inputMode="numeric" dir="ltr" value={days} onChange={(e) => setDays(e.target.value.replace(/[^\d]/g, ""))} />
                <span>روز آینده</span>
              </div>
            )}

            <div className="rounded-lg bg-muted/50 p-3 space-y-2 text-sm">
              <div className="font-medium">
                پیش‌نمایش
                {bulk && preview && <span className="text-muted-foreground font-normal"> — {toPersianDigits(count)} گیرنده</span>}
              </div>
              {previewMutation.isPending && !preview && <p className="text-muted-foreground">در حال آماده‌سازی…</p>}
              {preview && count === 0 && <p className="text-amber-700">هیچ عضوی با این شرایط پیدا نشد.</p>}
              {first && (
                <p className="whitespace-pre-wrap leading-7">
                  {bulk && <span className="text-muted-foreground">({first.name}) </span>}
                  {first.text}
                </p>
              )}
              {expiryMissing && (
                <p className="text-amber-700 text-xs">
                  این مراجع در {toPersianDigits(days || "30")} روز آینده اعتبار در حال انقضا ندارد؛ مبلغ انقضا «۰» نوشته می‌شود.
                </p>
              )}
              {first && !first.phone && <p className="text-red-600 text-xs">شماره موبایل این مراجع ثبت نشده است.</p>}
              {preview?.usesPattern && (
                <p className="text-xs text-muted-foreground">
                  ارسال خدماتی (پترن) فعال است: متن پترن «پیام باشگاه» با نام، موجودی، مبلغ و تاریخ انقضا فرستاده می‌شود، نه این متن.
                </p>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sendMutation.isPending}>انصراف</Button>
            <Button onClick={send} disabled={sendMutation.isPending || !message.trim() || (preview !== null && count === 0)} className="gap-1">
              <Send className="h-4 w-4" />
              {sendMutation.isPending ? "در حال ارسال..." : bulk ? `ارسال${preview ? ` به ${toPersianDigits(count)} نفر` : ""}` : "ارسال"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirming} onOpenChange={(o) => !sendMutation.isPending && setConfirming(o)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>تأیید ارسال گروهی</DialogTitle>
          </DialogHeader>
          <p className="text-sm">پیام برای {toPersianDigits(count)} عضو باشگاه فرستاده می‌شود. ادامه می‌دهید؟</p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={sendMutation.isPending}>انصراف</Button>
            <Button onClick={() => sendMutation.mutate({ data: body() })} disabled={sendMutation.isPending}>
              {sendMutation.isPending ? "در حال ارسال..." : "ارسال"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
