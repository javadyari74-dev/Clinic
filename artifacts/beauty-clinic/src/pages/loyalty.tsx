import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useGetLoyaltySettings,
  useUpdateLoyaltySettings,
  useGetLoyaltyOverview,
  getGetLoyaltySettingsQueryKey,
  getGetLoyaltyOverviewQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorNotice } from "@/components/error-notice";
import { formatCurrency, formatShamsiDate, toPersianDigits } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import {
  Award,
  Users,
  TrendingUp,
  TrendingDown,
  Coins,
  Settings2,
} from "lucide-react";

export default function Loyalty() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const {
    data: settings,
    isError: settingsError,
    refetch: refetchSettings,
  } = useGetLoyaltySettings();
  const {
    data: overview,
    isError: overviewError,
    refetch: refetchOverview,
  } = useGetLoyaltyOverview();

  const [enabled, setEnabled] = useState(false);
  const [earnAmount, setEarnAmount] = useState("");
  const [redeemValue, setRedeemValue] = useState("");
  const [minRedeem, setMinRedeem] = useState("");

  useEffect(() => {
    if (settings) {
      setEnabled(settings.enabled);
      setEarnAmount(String(settings.earnAmount));
      setRedeemValue(String(settings.redeemValue));
      setMinRedeem(String(settings.minRedeem));
    }
  }, [settings]);

  const updateSettings = useUpdateLoyaltySettings({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetLoyaltySettingsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetLoyaltyOverviewQueryKey() });
        toast({ title: "تنظیمات باشگاه ذخیره شد" });
      },
      onError: () => {
        toast({ title: "ذخیره تنظیمات ناموفق بود", variant: "destructive" });
      },
    },
  });

  function handleSave() {
    const earn = Number.parseInt(earnAmount, 10);
    const redeem = Number.parseInt(redeemValue, 10);
    const min = Number.parseInt(minRedeem, 10);

    if (!Number.isFinite(earn) || earn < 1000) {
      toast({ title: "نرخ کسب امتیاز باید حداقل ۱٬۰۰۰ تومان باشد", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(redeem) || redeem < 1000) {
      toast({ title: "ارزش هر امتیاز باید حداقل ۱٬۰۰۰ تومان باشد", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(min) || min < 1) {
      toast({ title: "حداقل امتیاز برای استفاده باید حداقل ۱ باشد", variant: "destructive" });
      return;
    }
    updateSettings.mutate({
      data: { enabled, earnAmount: earn, redeemValue: redeem, minRedeem: min },
    });
  }

  const typeLabel = (t: string) =>
    t === "earn" ? "کسب" : t === "redeem" ? "استفاده" : "برگردان";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Award className="h-7 w-7 text-amber-600" />
          باشگاه مشتریان
        </h1>
        <p className="text-muted-foreground mt-1">
          امتیازدهی خودکار با هر پرداخت و استفاده از امتیاز هنگام ثبت پرداخت در صندوق
        </p>
      </div>

      {(settingsError || overviewError) && (
        <ErrorNotice
          onRetry={() => {
            refetchSettings();
            refetchOverview();
          }}
        />
      )}

      {/* Totals */}
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
              <TrendingUp className="h-4 w-4 text-emerald-600" /> امتیاز کسب‌شده
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-emerald-600">
              {toPersianDigits(overview?.totalEarned ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-rose-600" /> امتیاز استفاده‌شده
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-rose-600">
              {toPersianDigits(overview?.totalRedeemed ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Coins className="h-4 w-4 text-amber-600" /> امتیاز باقی‌مانده
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-amber-600">
              {toPersianDigits(overview?.totalOutstanding ?? 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Settings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-primary" />
            تنظیمات باشگاه
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="loyalty-enabled" className="font-medium cursor-pointer">
                فعال‌سازی باشگاه مشتریان
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                با فعال‌شدن، هر پرداخت به‌صورت خودکار امتیاز می‌سازد و امتیازها هنگام پرداخت قابل استفاده می‌شوند
              </p>
            </div>
            <Switch id="loyalty-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label className="text-sm mb-1.5 block">
                نرخ کسب امتیاز (تومان به ازای ۱ امتیاز)
              </Label>
              <Input
                inputMode="numeric"
                value={earnAmount}
                onChange={(e) => setEarnAmount(e.target.value)}
                placeholder="مثلاً 100000"
              />
              <p className="text-xs text-muted-foreground mt-1">
                هر {formatCurrency(Number.parseInt(earnAmount, 10) || 0)} پرداخت = ۱ امتیاز
              </p>
            </div>
            <div>
              <Label className="text-sm mb-1.5 block">
                ارزش هر امتیاز هنگام استفاده (تومان)
              </Label>
              <Input
                inputMode="numeric"
                value={redeemValue}
                onChange={(e) => setRedeemValue(e.target.value)}
                placeholder="مثلاً 10000"
              />
              <p className="text-xs text-muted-foreground mt-1">
                هر امتیاز = {formatCurrency(Number.parseInt(redeemValue, 10) || 0)} تخفیف
              </p>
            </div>
            <div>
              <Label className="text-sm mb-1.5 block">حداقل امتیاز برای استفاده</Label>
              <Input
                inputMode="numeric"
                value={minRedeem}
                onChange={(e) => setMinRedeem(e.target.value)}
                placeholder="مثلاً 10"
              />
              <p className="text-xs text-muted-foreground mt-1">
                کمتر از این تعداد امتیاز قابل استفاده نیست
              </p>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={updateSettings.isPending}>
              {updateSettings.isPending ? "در حال ذخیره..." : "ذخیره تنظیمات"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Top patients */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            مراجعین برتر باشگاه
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">مراجع</TableHead>
                <TableHead className="text-right">شماره پرونده</TableHead>
                <TableHead className="text-right">امتیاز فعلی</TableHead>
                <TableHead className="text-right">مجموع کسب‌شده</TableHead>
                <TableHead className="text-right">ارزش امتیازها</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(overview?.topPatients ?? []).map((p) => (
                <TableRow key={p.patientId}>
                  <TableCell>
                    <Link
                      href={`/patients/${p.patientId}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {p.patientName}
                    </Link>
                  </TableCell>
                  <TableCell>{p.fileNumber ? toPersianDigits(p.fileNumber) : "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono">
                      {toPersianDigits(p.balance)}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono">{toPersianDigits(p.earnedTotal)}</TableCell>
                  <TableCell className="font-mono">
                    {formatCurrency(p.balance * (settings?.redeemValue ?? 0))}
                  </TableCell>
                </TableRow>
              ))}
              {!overview?.topPatients?.length && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    هنوز عضوی در باشگاه نیست — با ثبت اولین پرداخت (پس از فعال‌سازی) امتیازها ساخته می‌شوند
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Recent transactions */}
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
                  <TableCell className="font-medium">{tx.patientName ?? "—"}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        tx.type === "earn"
                          ? "default"
                          : tx.type === "redeem"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {typeLabel(tx.type)}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className={`font-mono font-bold ${tx.delta > 0 ? "text-emerald-600" : "text-rose-600"}`}
                  >
                    {tx.delta > 0 ? "+" : "−"}
                    {toPersianDigits(Math.abs(tx.delta))}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-72 truncate">
                    {tx.description ?? "—"}
                  </TableCell>
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
