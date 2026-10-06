import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useGetLoyaltySettings,
  useUpdateLoyaltySettings,
  useGetLoyaltyOverview,
  useListLoyaltyMembers,
  useAdjustLoyaltyPoints,
  getGetLoyaltySettingsQueryKey,
  getGetLoyaltyOverviewQueryKey,
  getListLoyaltyMembersQueryKey,
} from "@workspace/api-client-react";
import type { LoyaltySettings, LoyaltyMember } from "@workspace/api-client-react";
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
import { LoyaltyTierBadge, LOYALTY_TIER_KEYS, LOYALTY_TIER_META, type LoyaltyTierKey } from "@/components/loyalty-tier-badge";
import { formatCurrency, formatShamsiDate, toPersianDigits } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Award, Users, Coins, Settings2, Hourglass, Gift, Search, PlusCircle, MessageSquare, TrendingDown } from "lucide-react";

const TYPE_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  earn: { label: "کسب", variant: "default" },
  redeem: { label: "استفاده", variant: "secondary" },
  reverse: { label: "برگردان", variant: "outline" },
  expire: { label: "انقضا", variant: "destructive" },
  birthday: { label: "هدیهٔ تولد", variant: "default" },
  referral: { label: "معرفی دوست", variant: "default" },
  adjust: { label: "دستی", variant: "outline" },
};

type NumericField =
  | "earnAmount" | "redeemValue" | "minRedeem"
  | "silverMin" | "goldMin" | "diamondMin"
  | "silverRate" | "goldRate" | "diamondRate"
  | "expiryMonths" | "birthdayBonus" | "referralBonus";

const NUMERIC_FIELDS: NumericField[] = [
  "earnAmount", "redeemValue", "minRedeem",
  "silverMin", "goldMin", "diamondMin",
  "silverRate", "goldRate", "diamondRate",
  "expiryMonths", "birthdayBonus", "referralBonus",
];

const num = (v: string) => Number.parseInt(v.replace(/[^\d]/g, ""), 10);

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
  const value = (points: number) => formatCurrency(points * (settings?.redeemValue ?? 0));

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
              <Coins className="h-4 w-4 text-amber-600" /> امتیاز در دست اعضا
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-amber-600">{toPersianDigits(overview?.totalOutstanding ?? 0)}</p>
            <p className="text-xs text-muted-foreground mt-1">معادل {value(overview?.totalOutstanding ?? 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-rose-600" /> استفاده‌شده تا امروز
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-rose-600">{toPersianDigits(overview?.totalRedeemed ?? 0)}</p>
            <p className="text-xs text-muted-foreground mt-1">معادل {value(overview?.totalRedeemed ?? 0)} تخفیف</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Hourglass className="h-4 w-4 text-orange-600" /> در شرف انقضا (۳۰ روز)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-orange-600">{toPersianDigits(overview?.expiringSoonPoints ?? 0)}</p>
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
              <p className="text-xs text-muted-foreground">امتیاز: {rateText(tierRateOf[t])}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Coins className="h-4 w-4 text-primary" />
            آخرین تراکنش‌های امتیازی
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">مراجع</TableHead>
                <TableHead className="text-right">نوع</TableHead>
                <TableHead className="text-right">امتیاز</TableHead>
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
                  <TableCell className={`font-mono font-bold ${tx.delta > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {tx.delta > 0 ? "+" : "−"}
                    {toPersianDigits(Math.abs(tx.delta))}
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
  const [points, setPoints] = useState("");
  const [direction, setDirection] = useState<"add" | "remove">("add");
  const [description, setDescription] = useState("");

  const adjust = useAdjustLoyaltyPoints({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListLoyaltyMembersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetLoyaltyOverviewQueryKey() });
        toast({ title: "امتیاز مراجع به‌روزرسانی شد" });
        setAdjusting(null);
      },
      onError: (err) => {
        const msg = (err as { data?: { error?: string } })?.data?.error;
        toast({ title: msg || "تغییر امتیاز ناموفق بود", variant: "destructive" });
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
    setPoints("");
    setDirection("add");
    setDescription("");
  }

  function submitAdjust() {
    const n = num(points);
    if (!adjusting || !Number.isFinite(n) || n <= 0) {
      toast({ title: "تعداد امتیاز را وارد کنید", variant: "destructive" });
      return;
    }
    adjust.mutate({
      data: { patientId: adjusting.patientId, points: direction === "add" ? n : -n, description: description.trim() },
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
              <TableHead className="text-right">امتیاز</TableHead>
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
                <TableCell>
                  <span className="font-mono font-bold">{toPersianDigits(m.balance)}</span>
                  <div className="text-xs text-muted-foreground">{formatCurrency(m.balance * (settings?.redeemValue ?? 0))}</div>
                </TableCell>
                <TableCell className="font-mono text-sm">{formatCurrency(m.spend12m)}</TableCell>
                <TableCell className="text-sm">{formatShamsiDate(m.joinedAt)}</TableCell>
                {isAdmin && (
                  <TableCell>
                    <Button variant="ghost" size="sm" className="gap-1" onClick={() => openAdjust(m)}>
                      <PlusCircle className="h-3.5 w-3.5" /> تغییر امتیاز
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={isAdmin ? 6 : 5} className="text-center text-muted-foreground py-8">
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
            <DialogTitle>تغییر امتیاز {adjusting?.patientName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              موجودی فعلی: <span className="font-bold text-foreground">{toPersianDigits(adjusting?.balance ?? 0)}</span> امتیاز
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant={direction === "add" ? "default" : "outline"} onClick={() => setDirection("add")}>افزودن</Button>
              <Button size="sm" variant={direction === "remove" ? "destructive" : "outline"} onClick={() => setDirection("remove")}>کسر</Button>
            </div>
            <div>
              <Label className="text-sm mb-1.5 block">تعداد امتیاز</Label>
              <Input inputMode="numeric" dir="ltr" value={points} onChange={(e) => setPoints(e.target.value.replace(/[^\d]/g, ""))} />
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

// ─── تب تنظیمات ────────────────────────────────────────────────────────────────

function SettingsTab({ settings }: { settings: LoyaltySettings | undefined }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [values, setValues] = useState<Record<NumericField, string>>(
    () => Object.fromEntries(NUMERIC_FIELDS.map((f) => [f, ""])) as Record<NumericField, string>,
  );

  useEffect(() => {
    if (!settings) return;
    setEnabled(settings.enabled);
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
    if (!(parsed.earnAmount >= 1000) || !(parsed.redeemValue >= 1000)) {
      toast({ title: "نرخ کسب و ارزش امتیاز باید حداقل ۱٬۰۰۰ تومان باشد", variant: "destructive" });
      return;
    }
    if (!(parsed.minRedeem >= 1)) {
      toast({ title: "حداقل امتیاز برای استفاده باید حداقل ۱ باشد", variant: "destructive" });
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
    update.mutate({ data: { enabled, ...parsed } });
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
          <CardTitle className="text-base flex items-center gap-2"><Settings2 className="h-4 w-4 text-primary" /> امتیاز</CardTitle>
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
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label className="text-sm mb-1.5 block">نرخ کسب امتیاز (تومان به ازای ۱ امتیاز)</Label>
              <Input inputMode="numeric" dir="ltr" value={values.earnAmount} onChange={set("earnAmount")} />
              <p className="text-xs text-muted-foreground mt-1">هر {formatCurrency(n("earnAmount") || 0)} پرداخت = ۱ امتیاز</p>
            </div>
            <div>
              <Label className="text-sm mb-1.5 block">ارزش هر امتیاز هنگام استفاده (تومان)</Label>
              <Input inputMode="numeric" dir="ltr" value={values.redeemValue} onChange={set("redeemValue")} />
              <p className="text-xs text-muted-foreground mt-1">هر امتیاز = {formatCurrency(n("redeemValue") || 0)} تخفیف</p>
            </div>
            <div>
              <Label className="text-sm mb-1.5 block">حداقل امتیاز برای استفاده</Label>
              <Input inputMode="numeric" dir="ltr" value={values.minRedeem} onChange={set("minRedeem")} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Award className="h-4 w-4 text-amber-600" /> سطح‌ها</CardTitle>
          <CardDescription>
            سطح هر عضو خودکار از روی مجموع پرداخت‌های ۱۲ ماه اخیرش تعیین می‌شود. ارتقای سطح با پیامک اطلاع داده می‌شود؛ اگر خرید ۱۲ ماهه کم شود، سطح بی‌صدا پایین می‌آید. برای غیرفعال کردن یک سطح، مرز آن را ۰ بگذارید.
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
                <Label className="text-xs mb-1 block text-muted-foreground">ضریب امتیاز (٪) — {rateText(n(rate) || 100)}</Label>
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
            <Label className="text-sm mb-1.5 block">انقضای امتیاز (ماه پس از کسب)</Label>
            <Input inputMode="numeric" dir="ltr" value={values.expiryMonths} onChange={set("expiryMonths")} />
            <p className="text-xs text-muted-foreground mt-1">
              {n("expiryMonths") > 0
                ? `امتیاز ${toPersianDigits(n("expiryMonths"))} ماه پس از کسب منقضی می‌شود (اول قدیمی‌ترها خرج می‌شوند)؛ یک هفته قبل پیامک هشدار می‌رود`
                : "۰ = امتیازها هرگز منقضی نمی‌شوند"}
            </p>
          </div>
          <div>
            <Label className="text-sm mb-1.5 block">امتیاز هدیهٔ تولد</Label>
            <Input inputMode="numeric" dir="ltr" value={values.birthdayBonus} onChange={set("birthdayBonus")} />
            <p className="text-xs text-muted-foreground mt-1">در روز تولد شمسی؛ در پیامک تبریک تولد خودکار هم گفته می‌شود (۰ = خاموش)</p>
          </div>
          <div>
            <Label className="text-sm mb-1.5 block">امتیاز معرفی دوست</Label>
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
  const [tab, setTab] = useState("overview");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Award className="h-7 w-7 text-amber-600" />
          باشگاه مشتریان
        </h1>
        <p className="text-muted-foreground mt-1">
          عضویت خودکار با اولین پرداخت، سطح‌بندی بر اساس خرید، امتیاز با هر پرداخت و استفاده از آن در صندوق
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
        <TabsContent value="members"><MembersTab settings={settings} /></TabsContent>
        <TabsContent value="settings"><SettingsTab settings={settings} /></TabsContent>
      </Tabs>
    </div>
  );
}
