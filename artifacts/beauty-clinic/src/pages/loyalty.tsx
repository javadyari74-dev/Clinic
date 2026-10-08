import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useGetLoyaltySettings,
  useUpdateLoyaltySettings,
  useGetLoyaltyOverview,
  useListLoyaltyMembers,
  useAdjustLoyaltyPoints,
  useRetroLoyaltyCashback,
  getGetLoyaltySettingsQueryKey,
  getGetLoyaltyOverviewQueryKey,
  getListLoyaltyMembersQueryKey,
} from "@workspace/api-client-react";
import type { LoyaltySettings, LoyaltyMember, RetroCashbackResult } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorNotice } from "@/components/error-notice";
import { Textarea } from "@/components/ui/textarea";
import { PersianDatePicker } from "@/components/persian-date-picker";
import { LoyaltyTierBadge, LOYALTY_TIER_KEYS, LOYALTY_TIER_META, type LoyaltyTierKey } from "@/components/loyalty-tier-badge";
import { formatCurrency, formatShamsiDate, toPersianDigits } from "@/lib/format";
import { txSign, txAmountText } from "@/lib/loyalty-format";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Award, Users, Coins, Settings2, Hourglass, Gift, Search, PlusCircle, MessageSquare, Wallet, History } from "lucide-react";

const TYPE_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  cashback: { label: "اعتبار سود", variant: "default" },
  earn: { label: "کسب امتیاز", variant: "default" },
  redeem: { label: "استفاده", variant: "secondary" },
  reverse: { label: "برگردان", variant: "outline" },
  expire: { label: "انقضا", variant: "destructive" },
  birthday: { label: "هدیهٔ تولد", variant: "default" },
  referral: { label: "معرفی دوست", variant: "default" },
  adjust: { label: "دستی", variant: "outline" },
};

type NumericField =
  | "silverMin" | "goldMin" | "diamondMin"
  | "silverRate" | "goldRate" | "diamondRate"
  | "expiryMonths" | "birthdayBonus" | "referralBonus";

const NUMERIC_FIELDS: NumericField[] = [
  "silverMin", "goldMin", "diamondMin",
  "silverRate", "goldRate", "diamondRate",
  "expiryMonths", "birthdayBonus", "referralBonus",
];

const num = (v: string) => Number.parseInt(v.replace(/[^\d]/g, ""), 10);
const pct = (n: number) => `${toPersianDigits(+n.toFixed(2))}٪`;

function rateText(rate: number) {
  return rate === 100 ? "عادی" : `${toPersianDigits(+(rate / 100).toFixed(2))} برابر`;
}

// ─── تب نمای کلی ───────────────────────────────────────────────────────────────

function OverviewTab({ settings }: { settings: LoyaltySettings | undefined }) {
  const { data: overview } = useGetLoyaltyOverview();
  const tierMin: Record<LoyaltyTierKey, number> = {
    bronze: 0,
    silver: settings?.silverMin ?? 0,
    gold: settings?.goldMin ?? 0,
    diamond: settings?.diamondMin ?? 0,
  };
  const tierRateOf: Record<LoyaltyTierKey, number> = {
    bronze: 100,
    silver: settings?.silverRate ?? 100,
    gold: settings?.goldRate ?? 100,
    diamond: settings?.diamondRate ?? 100,
  };
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Users className="h-4 w-4" /> اعضای باشگاه
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{toPersianDigits(overview?.totalMembers ?? 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Gift className="h-4 w-4 text-emerald-600" /> اعتبار هدیه‌شده تا امروز
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold text-emerald-700">{formatCurrency(overview?.totalRewards ?? 0)}</p>
            <p className="text-xs text-muted-foreground mt-1">سود خدمت، تولد و معرفی</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Wallet className="h-4 w-4 text-amber-600" /> موجودی کیف پول اعضا
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold text-amber-600">{formatCurrency(overview?.walletTotal ?? 0)}</p>
            <p className="text-xs text-muted-foreground mt-1">قابل استفاده در صندوق</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Hourglass className="h-4 w-4 text-orange-600" /> در شرف انقضا (۳۰ روز)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold text-orange-600">{formatCurrency(overview?.expiringSoonAmount ?? 0)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {settings?.expiryMonths ? `${toPersianDigits(overview?.expiringSoonMembers ?? 0)} عضو` : "انقضا غیرفعال است"}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {LOYALTY_TIER_KEYS.map((t) => (
          <Card key={t} className={LOYALTY_TIER_META[t].className.replace(/text-\S+/g, "")}>
            <CardContent className="pt-5 space-y-1">
              <div className="flex items-center justify-between">
                <LoyaltyTierBadge tier={t} />
                <span className="text-2xl font-bold">{toPersianDigits(overview?.membersByTier?.[t] ?? 0)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t === "bronze"
                  ? "همهٔ اعضای تازه"
                  : tierMin[t] > 0
                    ? `خرید ۱۲ ماه از ${formatCurrency(tierMin[t])}`
                    : "غیرفعال"}
              </p>
              <p className="text-xs text-muted-foreground">
                اعتبار: {pct(((settings?.profitRewardPercent ?? 0) * tierRateOf[t]) / 100)} سود هر خدمت
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Coins className="h-4 w-4 text-primary" />
            آخرین تراکنش‌های باشگاه
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">مراجع</TableHead>
                <TableHead className="text-right">نوع</TableHead>
                <TableHead className="text-right">مبلغ</TableHead>
                <TableHead className="text-right">شرح</TableHead>
                <TableHead className="text-right">تاریخ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(overview?.recent ?? []).map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell className="font-medium">
                    <Link href={`/patients/${tx.patientId}`} className="text-primary hover:underline">
                      {tx.patientName ?? "—"}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={TYPE_LABELS[tx.type]?.variant ?? "outline"}>{TYPE_LABELS[tx.type]?.label ?? tx.type}</Badge>
                  </TableCell>
                  <TableCell className={`font-bold whitespace-nowrap ${txSign(tx) > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {txAmountText(tx)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-72 truncate">{tx.description ?? "—"}</TableCell>
                  <TableCell className="text-sm">{formatShamsiDate(tx.createdAt, true)}</TableCell>
                </TableRow>
              ))}
              {!overview?.recent?.length && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    هنوز تراکنشی ثبت نشده
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── تب اعضا ───────────────────────────────────────────────────────────────────

function MembersTab({ settings }: { settings: LoyaltySettings | undefined }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { data: members } = useListLoyaltyMembers();
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<LoyaltyTierKey | "all">("all");
  const [adjusting, setAdjusting] = useState<LoyaltyMember | null>(null);
  const [amountInput, setAmountInput] = useState("");
  const [direction, setDirection] = useState<"add" | "remove">("add");
  const [description, setDescription] = useState("");

  const adjust = useAdjustLoyaltyPoints({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListLoyaltyMembersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetLoyaltyOverviewQueryKey() });
        toast({ title: "کیف پول مراجع به‌روزرسانی شد" });
        setAdjusting(null);
      },
      onError: (err) => {
        const msg = (err as { data?: { error?: string } })?.data?.error;
        toast({ title: msg || "تغییر اعتبار ناموفق بود", variant: "destructive" });
      },
    },
  });

  const filtered = useMemo(() => {
    const term = q.trim();
    return (members ?? []).filter(
      (m) =>
        (tier === "all" || m.tier === tier) &&
        (!term || m.patientName.includes(term) || (m.phone ?? "").includes(term) || (m.fileNumber ?? "").includes(term)),
    );
  }, [members, q, tier]);

  function openAdjust(m: LoyaltyMember) {
    setAdjusting(m);
    setAmountInput("");
    setDirection("add");
    setDescription("");
  }

  function submitAdjust() {
    const n = num(amountInput);
    if (!adjusting || !Number.isFinite(n) || n <= 0) {
      toast({ title: "مبلغ را وارد کنید", variant: "destructive" });
      return;
    }
    adjust.mutate({
      data: { patientId: adjusting.patientId, amount: direction === "add" ? n : -n, description: description.trim() },
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[14rem]">
            <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجوی نام، تلفن یا شماره پرونده" className="pr-9" />
          </div>
          <Button size="sm" variant={tier === "all" ? "default" : "outline"} onClick={() => setTier("all")}>
            همه ({toPersianDigits(members?.length ?? 0)})
          </Button>
          {LOYALTY_TIER_KEYS.map((t) => (
            <Button key={t} size="sm" variant={tier === t ? "default" : "outline"} onClick={() => setTier(t)}>
              {LOYALTY_TIER_META[t].emoji} {LOYALTY_TIER_META[t].label} ({toPersianDigits((members ?? []).filter((m) => m.tier === t).length)})
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">مراجع</TableHead>
              <TableHead className="text-right">سطح</TableHead>
              <TableHead className="text-right">کیف پول</TableHead>
              <TableHead className="text-right">اعتبار هدیه‌شده</TableHead>
              <TableHead className="text-right">خرید ۱۲ ماه</TableHead>
              <TableHead className="text-right">عضویت از</TableHead>
              {isAdmin && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((m) => (
              <TableRow key={m.patientId}>
                <TableCell>
                  <Link href={`/patients/${m.patientId}`} className="font-medium text-primary hover:underline">
                    {m.patientName}
                  </Link>
                  <div className="text-xs text-muted-foreground" dir="ltr">{m.phone ?? ""}</div>
                </TableCell>
                <TableCell><LoyaltyTierBadge tier={m.tier} /></TableCell>
                <TableCell className="font-bold text-amber-700 whitespace-nowrap">{formatCurrency(m.walletBalance)}</TableCell>
                <TableCell className="text-sm text-emerald-700 whitespace-nowrap">{formatCurrency(m.totalRewards)}</TableCell>
                <TableCell className="text-sm whitespace-nowrap">{formatCurrency(m.spend12m)}</TableCell>
                <TableCell className="text-sm">{formatShamsiDate(m.joinedAt)}</TableCell>
                {isAdmin && (
                  <TableCell>
                    <Button variant="ghost" size="sm" className="gap-1" onClick={() => openAdjust(m)}>
                      <PlusCircle className="h-3.5 w-3.5" /> تغییر اعتبار
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={isAdmin ? 7 : 6} className="text-center text-muted-foreground py-8">
                  {members?.length ? "عضوی با این مشخصات پیدا نشد" : "هنوز عضوی در باشگاه نیست"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={!!adjusting} onOpenChange={(o) => !o && setAdjusting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>تغییر اعتبار کیف پول {adjusting?.patientName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              موجودی فعلی: <span className="font-bold text-foreground">{formatCurrency(adjusting?.walletBalance ?? 0)}</span>
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant={direction === "add" ? "default" : "outline"} onClick={() => setDirection("add")}>افزودن</Button>
              <Button size="sm" variant={direction === "remove" ? "destructive" : "outline"} onClick={() => setDirection("remove")}>کسر</Button>
            </div>
            <div>
              <Label className="text-sm mb-1.5 block">مبلغ (تومان)</Label>
              <Input inputMode="numeric" dir="ltr" value={amountInput} onChange={(e) => setAmountInput(e.target.value.replace(/[^\d]/g, ""))} />
            </div>
            <div>
              <Label className="text-sm mb-1.5 block">توضیح (اختیاری)</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="مثلاً جبران تأخیر نوبت" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAdjusting(null)}>انصراف</Button>
            <Button onClick={submitAdjust} disabled={adjust.isPending}>{adjust.isPending ? "در حال ثبت..." : "ثبت"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── اعتبار سود پرداخت‌های قبلی (فقط مدیر) ─────────────────────────────────────

const RETRO_SMS_DEFAULT =
  "{نام} عزیز، {اعتبار} تومان اعتبار هدیه بابت خدمات قبلی به کیف پول شما در باشگاه مشتریان اضافه شد. موجودی کیف پول: {موجودی} تومان.";

function RetroCashbackCard({ settings }: { settings: LoyaltySettings | undefined }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [preview, setPreview] = useState<RetroCashbackResult | null>(null);
  const [sendSmsOn, setSendSmsOn] = useState(true);
  const [smsText, setSmsText] = useState(RETRO_SMS_DEFAULT);
  const [confirming, setConfirming] = useState(false);

  const retro = useRetroLoyaltyCashback({
    mutation: {
      onError: (err) => {
        const msg = (err as { data?: { error?: string } })?.data?.error;
        toast({ title: msg || "محاسبه ناموفق بود", variant: "destructive" });
      },
    },
  });

  // با تغییر بازه، پیش‌نمایش قبلی دیگر معتبر نیست
  useEffect(() => setPreview(null), [from, to]);

  const range = { from: from || null, to: to || null };

  function runPreview() {
    retro.mutate({ data: { ...range, apply: false } }, { onSuccess: (r) => setPreview(r) });
  }

  function runApply() {
    retro.mutate(
      { data: { ...range, apply: true, smsText: sendSmsOn ? smsText.trim() : null } },
      {
        onSuccess: (r) => {
          setConfirming(false);
          setPreview(null);
          queryClient.invalidateQueries({ queryKey: getListLoyaltyMembersQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetLoyaltyOverviewQueryKey() });
          toast({
            title: `${formatCurrency(r.total)} به کیف پول ${toPersianDigits(r.patients.length)} مراجع اضافه شد`,
            description: sendSmsOn
              ? `پیامک: ${toPersianDigits(r.smsSent)} ارسال${r.smsFailed ? `، ${toPersianDigits(r.smsFailed)} ناموفق` : ""}`
              : undefined,
          });
        },
      },
    );
  }

  const disabled = !settings?.enabled || !(settings?.profitRewardPercent > 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <History className="h-5 w-5 text-amber-600" />
          اعتبار سود پرداخت‌های قبلی
        </CardTitle>
        <CardDescription>
          برای پرداخت‌هایی که پیش از راه‌اندازی اعتبار سود ثبت شده‌اند. اعتبار با همان قاعدهٔ صندوق
          ({pct(settings?.profitRewardPercent ?? 0)} سود خدمت با ضریب سطح فعلی مراجع) حساب می‌شود و
          نوبت‌هایی که قبلاً اعتبار گرفته‌اند دوباره حساب نمی‌شوند. بازه را خالی بگذارید تا همهٔ پرداخت‌های قبلی حساب شوند.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-sm mb-1.5 block">از تاریخ</Label>
            <PersianDatePicker value={from} onChange={setFrom} placeholder="از ابتدا" />
          </div>
          <div>
            <Label className="text-sm mb-1.5 block">تا تاریخ</Label>
            <PersianDatePicker value={to} onChange={setTo} placeholder="تا امروز" />
          </div>
          {(from || to) && (
            <Button variant="ghost" size="sm" onClick={() => { setFrom(""); setTo(""); }}>پاک کردن بازه</Button>
          )}
          <Button variant="outline" onClick={runPreview} disabled={disabled || retro.isPending}>
            {retro.isPending && !confirming ? "در حال محاسبه..." : "محاسبه"}
          </Button>
        </div>
        {disabled && (
          <p className="text-sm text-amber-700">ابتدا باشگاه و درصد اعتبار سود را در تب «تنظیمات» فعال کنید.</p>
        )}

        {preview && (preview.total === 0 ? (
          <p className="text-sm text-muted-foreground">در این بازه پرداختی بدون اعتبار سود پیدا نشد.</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
              {toPersianDigits(preview.appointments)} نوبت از {toPersianDigits(preview.patients.length)} مراجع —
              جمع اعتبار: <span className="font-bold">{formatCurrency(preview.total)}</span>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">مراجع</TableHead>
                    <TableHead className="text-right">تعداد نوبت</TableHead>
                    <TableHead className="text-right">اعتبار</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.patients.map((p) => (
                    <TableRow key={p.patientId}>
                      <TableCell>{p.name}</TableCell>
                      <TableCell>{toPersianDigits(p.appointments)}</TableCell>
                      <TableCell className="font-bold text-emerald-700 whitespace-nowrap">{formatCurrency(p.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Switch id="retro-sms" checked={sendSmsOn} onCheckedChange={setSendSmsOn} />
                <Label htmlFor="retro-sms">ارسال پیامک به این مراجعین</Label>
              </div>
              {sendSmsOn && (
                <>
                  <Textarea value={smsText} onChange={(e) => setSmsText(e.target.value)} rows={3} />
                  <p className="text-xs text-muted-foreground">
                    متغیرها: {"{نام}"}، {"{اعتبار}"} (اعتبار همین واریز)، {"{موجودی}"} (موجودی کیف پول بعد از واریز)
                  </p>
                </>
              )}
            </div>
            <Button onClick={() => setConfirming(true)} disabled={retro.isPending} className="gap-1">
              <Wallet className="h-4 w-4" /> واریز به کیف پول مراجعین
            </Button>
          </div>
        ))}
      </CardContent>

      <Dialog open={confirming} onOpenChange={(o) => !o && !retro.isPending && setConfirming(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>تأیید واریز اعتبار</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            {formatCurrency(preview?.total ?? 0)} به کیف پول {toPersianDigits(preview?.patients.length ?? 0)} مراجع اضافه می‌شود
            {sendSmsOn ? " و برای هر کدام پیامک فرستاده می‌شود" : ""}. ادامه می‌دهید؟
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={retro.isPending}>انصراف</Button>
            <Button onClick={runApply} disabled={retro.isPending}>{retro.isPending ? "در حال واریز..." : "واریز"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── تب تنظیمات ────────────────────────────────────────────────────────────────

function SettingsTab({ settings }: { settings: LoyaltySettings | undefined }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [percent, setPercent] = useState("");
  const [values, setValues] = useState<Record<NumericField, string>>(
    () => Object.fromEntries(NUMERIC_FIELDS.map((f) => [f, ""])) as Record<NumericField, string>,
  );

  useEffect(() => {
    if (!settings) return;
    setEnabled(settings.enabled);
    setPercent(String(settings.profitRewardPercent));
    setValues(Object.fromEntries(NUMERIC_FIELDS.map((f) => [f, String(settings[f])])) as Record<NumericField, string>);
  }, [settings]);

  const update = useUpdateLoyaltySettings({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetLoyaltySettingsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetLoyaltyOverviewQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListLoyaltyMembersQueryKey() });
        toast({ title: "تنظیمات باشگاه ذخیره شد" });
      },
      onError: () => toast({ title: "ذخیره تنظیمات ناموفق بود", variant: "destructive" }),
    },
  });

  const set = (f: NumericField) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((prev) => ({ ...prev, [f]: e.target.value.replace(/[^\d]/g, "") }));
  const n = (f: NumericField) => num(values[f]);

  function handleSave() {
    const parsed = Object.fromEntries(NUMERIC_FIELDS.map((f) => [f, n(f)])) as Record<NumericField, number>;
    const profitRewardPercent = Number.parseFloat(percent.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace("٫", "."));
    if (!Number.isFinite(profitRewardPercent) || profitRewardPercent < 0 || profitRewardPercent > 100) {
      toast({ title: "درصد اعتبار سود باید بین ۰ تا ۱۰۰ باشد", variant: "destructive" });
      return;
    }
    for (const f of NUMERIC_FIELDS) {
      if (!Number.isFinite(parsed[f])) {
        toast({ title: "همهٔ کادرها را با عدد پر کنید", variant: "destructive" });
        return;
      }
    }
    const steps = [parsed.silverMin, parsed.goldMin, parsed.diamondMin].filter((v) => v > 0);
    if (steps.some((v, i) => i > 0 && v <= steps[i - 1])) {
      toast({ title: "مرز هر سطح باید از سطح قبلی بیشتر باشد", variant: "destructive" });
      return;
    }
    if ([parsed.silverRate, parsed.goldRate, parsed.diamondRate].some((r) => r < 100)) {
      toast({ title: "ضریب امتیاز سطح‌ها نمی‌تواند کمتر از ۱۰۰٪ باشد", variant: "destructive" });
      return;
    }
    if (!settings) return;
    update.mutate({
      data: {
        enabled,
        ...parsed,
        profitRewardPercent,
        // تنظیمات امتیاز قدیمی (بر اساس مبلغ) بدون تغییر می‌مانند
        earnAmount: settings.earnAmount,
        redeemValue: settings.redeemValue,
        minRedeem: settings.minRedeem,
      },
    });
  }

  const tierRows: Array<{ tier: LoyaltyTierKey; min: NumericField; rate: NumericField }> = [
    { tier: "silver", min: "silverMin", rate: "silverRate" },
    { tier: "gold", min: "goldMin", rate: "goldRate" },
    { tier: "diamond", min: "diamondMin", rate: "diamondRate" },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Settings2 className="h-4 w-4 text-primary" /> پاداش: اعتبار از سود خدمت</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="loyalty-enabled" className="font-medium cursor-pointer">فعال‌سازی باشگاه مشتریان</Label>
              <p className="text-xs text-muted-foreground mt-1">
                هر مراجع با اولین پرداخت خودکار عضو می‌شود. با فعال‌سازی، همهٔ مراجعینی که قبلاً پرداخت داشته‌اند هم یک‌جا عضو می‌شوند (بدون پیامک خوش‌آمد).
              </p>
            </div>
            <Switch id="loyalty-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>
          <div className="grid gap-4 md:grid-cols-[16rem_1fr] items-start">
            <div>
              <Label className="text-sm mb-1.5 block">اعتبار از سود هر خدمت (٪)</Label>
              <Input inputMode="decimal" dir="ltr" value={percent} onChange={(e) => setPercent(e.target.value.replace(/[^\d.٫۰-۹]/g, ""))} />
            </div>
            <div className="rounded-md bg-muted/50 p-3 text-sm leading-7 text-muted-foreground">
              سود خدمت = مبلغ پرداخت − هزینهٔ خدمت (حق‌الزحمهٔ پزشک + مواد + سایر، همان‌که در «خدمات» تعریف شده).
              این درصد از سود (با ضریب سطح مراجع) به‌صورت اعتبار تومانی به <b>کیف پول</b> مراجع شارژ می‌شود، در تاریخچهٔ باشگاه ثبت می‌شود و در پیامک پرداخت اعلام می‌شود.
              <br />
              مثال: سود ۱۰٬۰۰۰٬۰۰۰ تومان × {pct(Number.parseFloat(percent) || 0)} = {formatCurrency(Math.floor(((Number.parseFloat(percent) || 0) * 100_000) / 1000) * 1000)} اعتبار (گرد به پایین تا هزار تومان).
              بخشی از پرداخت که از کیف پول خرج شده، اعتبار تازه نمی‌سازد.
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Award className="h-4 w-4 text-amber-600" /> سطح‌ها</CardTitle>
          <CardDescription>
            سطح هر عضو خودکار از روی مجموع پرداخت‌های ۱۲ ماه اخیرش تعیین می‌شود و ضریب سطح، درصد اعتبار سود را بیشتر می‌کند. ارتقای سطح با پیامک اطلاع داده می‌شود؛ اگر خرید ۱۲ ماهه کم شود، سطح بی‌صدا پایین می‌آید. برای غیرفعال کردن یک سطح، مرز آن را ۰ بگذارید.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {tierRows.map(({ tier, min, rate }) => (
            <div key={tier} className="grid items-end gap-3 md:grid-cols-[8rem_1fr_1fr]">
              <LoyaltyTierBadge tier={tier} className="justify-center py-1.5" />
              <div>
                <Label className="text-xs mb-1 block text-muted-foreground">حداقل خرید ۱۲ ماه (تومان)</Label>
                <Input inputMode="numeric" dir="ltr" value={values[min]} onChange={set(min)} />
              </div>
              <div>
                <Label className="text-xs mb-1 block text-muted-foreground">
                  ضریب (٪) — {rateText(n(rate) || 100)}، یعنی {pct(((Number.parseFloat(percent) || 0) * (n(rate) || 100)) / 100)} سود
                </Label>
                <Input inputMode="numeric" dir="ltr" value={values[rate]} onChange={set(rate)} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Gift className="h-4 w-4 text-pink-600" /> انقضا و هدیه‌ها</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div>
            <Label className="text-sm mb-1.5 block">انقضای اعتبار هدیه (ماه پس از دریافت)</Label>
            <Input inputMode="numeric" dir="ltr" value={values.expiryMonths} onChange={set("expiryMonths")} />
            <p className="text-xs text-muted-foreground mt-1">
              {n("expiryMonths") > 0
                ? `اعتبار هدیهٔ خرج‌نشده ${toPersianDigits(n("expiryMonths"))} ماه پس از دریافت از کیف پول کم می‌شود (هنگام خرج، اول اعتبار هدیهٔ قدیمی‌تر مصرف می‌شود؛ پولی که خود مراجع شارژ کرده هرگز منقضی نمی‌شود). یک هفته قبل پیامک هشدار می‌رود`
                : "۰ = اعتبار هدیه هرگز منقضی نمی‌شود"}
            </p>
          </div>
          <div>
            <Label className="text-sm mb-1.5 block">اعتبار هدیهٔ تولد (تومان)</Label>
            <Input inputMode="numeric" dir="ltr" value={values.birthdayBonus} onChange={set("birthdayBonus")} />
            <p className="text-xs text-muted-foreground mt-1">در روز تولد شمسی؛ در پیامک تبریک تولد خودکار هم گفته می‌شود (۰ = خاموش)</p>
          </div>
          <div>
            <Label className="text-sm mb-1.5 block">اعتبار معرفی دوست (تومان)</Label>
            <Input inputMode="numeric" dir="ltr" value={values.referralBonus} onChange={set("referralBonus")} />
            <p className="text-xs text-muted-foreground mt-1">وقتی مراجعی که معرفش «مراجع» دیگری است اولین پرداختش را انجام دهد، به معرف داده می‌شود (۰ = خاموش)</p>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/sms" className="text-sm text-primary hover:underline flex items-center gap-1">
          <MessageSquare className="h-4 w-4" /> پیامک‌های باشگاه (خوش‌آمد، ارتقا، انقضا، معرفی) در پنل پیامکی تنظیم می‌شوند
        </Link>
        <Button onClick={handleSave} disabled={update.isPending}>
          {update.isPending ? "در حال ذخیره..." : "ذخیره تنظیمات"}
        </Button>
      </div>
    </div>
  );
}

export default function Loyalty() {
  const { data: settings, isError, refetch } = useGetLoyaltySettings();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [tab, setTab] = useState("overview");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Award className="h-7 w-7 text-amber-600" />
          باشگاه مشتریان
        </h1>
        <p className="text-muted-foreground mt-1">
          عضویت خودکار با اولین پرداخت، سطح‌بندی بر اساس خرید، و اعتبار کیف پول از سود هر خدمت که در صندوق قابل استفاده است
        </p>
      </div>

      {isError && <ErrorNotice onRetry={() => refetch()} />}

      {settings && !settings.enabled && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="pt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-amber-900">
              باشگاه مشتریان خاموش است. با روشن کردن آن در تب «تنظیمات»، همهٔ مراجعینی که قبلاً پرداخت داشته‌اند خودکار عضو می‌شوند.
            </p>
            <Button size="sm" variant="outline" onClick={() => setTab("settings")}>رفتن به تنظیمات</Button>
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">نمای کلی</TabsTrigger>
          <TabsTrigger value="members">اعضا</TabsTrigger>
          <TabsTrigger value="settings">تنظیمات</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><OverviewTab settings={settings} /></TabsContent>
        <TabsContent value="members">
          <div className="space-y-4">
            {isAdmin && <RetroCashbackCard settings={settings} />}
            <MembersTab settings={settings} />
          </div>
        </TabsContent>
        <TabsContent value="settings"><SettingsTab settings={settings} /></TabsContent>
      </Tabs>
    </div>
  );
}
