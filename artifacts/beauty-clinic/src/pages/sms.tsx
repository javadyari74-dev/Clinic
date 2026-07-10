import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSmsSettings,
  getGetSmsSettingsQueryKey,
  useUpdateSmsSettings,
  useGetSmsTemplates,
  useUpdateSmsTemplates,
  useGetSmsCredit,
  getGetSmsCreditQueryKey,
  useSendManualSms,
  useListSmsLogs,
  getListSmsLogsQueryKey,
  useListPatients,
} from "@workspace/api-client-react";
import type { SmsTemplates, SmsLogEntry } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { toPersianDigits, formatShamsiDate } from "@/lib/format";
import {
  MessageSquare, Settings, FileText, Send, History, Wallet, RotateCcw, Cake, CheckCircle2, XCircle,
} from "lucide-react";

// ── تب تنظیمات ────────────────────────────────────────────────────────────────

function SettingsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useGetSmsSettings();
  const [username, setUsername] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [checkCredit, setCheckCredit] = useState(false);

  const { data: credit, isFetching: creditLoading } = useGetSmsCredit({
    query: { enabled: checkCredit, queryKey: getGetSmsCreditQueryKey() },
  });

  const update = useUpdateSmsSettings({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetSmsSettingsQueryKey(), data);
        setPassword("");
        toast({ title: "تنظیمات پنل پیامکی ذخیره شد" });
      },
      onError: () => toast({ title: "خطا در ذخیره تنظیمات", variant: "destructive" }),
    },
  });

  if (isLoading || !settings) {
    return <div className="flex justify-center py-12"><Spinner className="size-6" /></div>;
  }

  const usernameValue = username ?? settings.username;
  const fromValue = from ?? settings.from;

  function save() {
    update.mutate({
      data: {
        username: usernameValue,
        from: fromValue,
        ...(password ? { password } : {}),
      },
    });
  }

  function toggle(key: "enabledAppointment" | "enabledPayment" | "enabledCommission", value: boolean) {
    update.mutate({ data: { [key]: value } });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Settings className="size-5" />اتصال به پنل ملی‌پیامک</CardTitle>
          <CardDescription>
            نام کاربری، رمز عبور و شماره خط اختصاصی پنل ملی‌پیامک خود را وارد کنید. این اطلاعات فقط روی همین دستگاه ذخیره می‌شود.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sms-username">نام کاربری پنل</Label>
            <Input id="sms-username" dir="ltr" value={usernameValue} onChange={(e) => setUsername(e.target.value)} placeholder="09xxxxxxxxx" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sms-password">رمز عبور پنل</Label>
            <Input
              id="sms-password"
              dir="ltr"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={settings.hasPassword ? "•••••••• (برای تغییر، رمز جدید وارد کنید)" : "رمز عبور"}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sms-from">شماره فرستنده (خط اختصاصی)</Label>
            <Input id="sms-from" dir="ltr" value={fromValue} onChange={(e) => setFrom(e.target.value)} placeholder="مثلاً 50004001..." />
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button onClick={save} disabled={update.isPending} data-testid="button-save-sms-settings">
              {update.isPending ? <Spinner className="size-4" /> : null}
              ذخیره تنظیمات
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setCheckCredit(true);
                queryClient.invalidateQueries({ queryKey: getGetSmsCreditQueryKey() });
              }}
              disabled={creditLoading}
              data-testid="button-check-credit"
            >
              <Wallet className="size-4" />
              {creditLoading ? "در حال بررسی..." : "تست اتصال و اعتبار"}
            </Button>
          </div>
          {checkCredit && credit && !creditLoading && (
            credit.ok ? (
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-500">
                <CheckCircle2 className="size-4" />
                اتصال برقرار است — اعتبار پنل: {toPersianDigits(Math.round(credit.credit ?? 0).toLocaleString("en-US"))} پیامک
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <XCircle className="size-4" />
                {credit.error ?? "اتصال برقرار نشد"}
              </div>
            )
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>پیامک‌های خودکار</CardTitle>
          <CardDescription>
            در صورت فعال بودن، پس از هر رویداد به‌صورت خودکار پیامک ارسال می‌شود. اگر اینترنت در دسترس نباشد، کار برنامه مختل نمی‌شود و فقط در تاریخچه «ناموفق» ثبت می‌شود.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-medium">ثبت نوبت</div>
              <div className="text-sm text-muted-foreground">پیامک تأیید نوبت برای بیمار</div>
            </div>
            <Switch checked={settings.enabledAppointment} onCheckedChange={(v) => toggle("enabledAppointment", v)} data-testid="switch-sms-appointment" />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-medium">ثبت پرداخت</div>
              <div className="text-sm text-muted-foreground">پیامک رسید پرداخت برای بیمار</div>
            </div>
            <Switch checked={settings.enabledPayment} onCheckedChange={(v) => toggle("enabledPayment", v)} data-testid="switch-sms-payment" />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-medium">پورسانت معرف</div>
              <div className="text-sm text-muted-foreground">پیامک اطلاع پورسانت برای معرف (کارمند، کمیسیون‌گیرنده یا بیمار معرف)</div>
            </div>
            <Switch checked={settings.enabledCommission} onCheckedChange={(v) => toggle("enabledCommission", v)} data-testid="switch-sms-commission" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── تب قالب‌ها ────────────────────────────────────────────────────────────────

const TEMPLATE_META: { key: keyof Omit<SmsTemplates, "defaults">; title: string; vars: string[] }[] = [
  { key: "appointment", title: "تأیید نوبت", vars: ["{نام}", "{تاریخ}", "{ساعت}", "{خدمت}"] },
  { key: "payment", title: "رسید پرداخت", vars: ["{نام}", "{مبلغ}", "{خدمت}"] },
  { key: "commission", title: "پورسانت معرف", vars: ["{نام}", "{پورسانت}", "{درصد}", "{مبلغ}"] },
  { key: "birthday", title: "تبریک تولد", vars: ["{نام}"] },
];

function TemplatesTab() {
  const { toast } = useToast();
  const { data: templates, isLoading, refetch } = useGetSmsTemplates();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const update = useUpdateSmsTemplates({
    mutation: {
      onSuccess: () => {
        setDrafts({});
        refetch();
        toast({ title: "قالب‌های پیامک ذخیره شد" });
      },
      onError: () => toast({ title: "خطا در ذخیره قالب‌ها", variant: "destructive" }),
    },
  });

  if (isLoading || !templates) {
    return <div className="flex justify-center py-12"><Spinner className="size-6" /></div>;
  }

  const hasChanges = Object.keys(drafts).length > 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {TEMPLATE_META.map(({ key, title, vars }) => {
          const value = drafts[key] ?? templates[key];
          return (
            <Card key={key}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{title}</CardTitle>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {vars.map((v) => (
                    <Badge key={v} variant="secondary" className="font-mono text-xs" dir="ltr">{v}</Badge>
                  ))}
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <Textarea
                  value={value}
                  onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                  rows={4}
                  data-testid={`textarea-template-${key}`}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => setDrafts((d) => ({ ...d, [key]: templates.defaults[key] }))}
                >
                  <RotateCcw className="size-3.5" />
                  بازگشت به قالب پیش‌فرض
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <Button
        onClick={() => update.mutate({ data: drafts })}
        disabled={!hasChanges || update.isPending}
        data-testid="button-save-templates"
      >
        {update.isPending ? <Spinner className="size-4" /> : null}
        ذخیره قالب‌ها
      </Button>
    </div>
  );
}

// ── تب ارسال ──────────────────────────────────────────────────────────────────

function SendTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"manual" | "birthday">("manual");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Map<number, string>>(new Map());
  const [birthdayDays, setBirthdayDays] = useState("7");

  const { data: patientsData } = useListPatients(
    { q: search || undefined, limit: 20 },
  );
  const patients = patientsData?.data ?? [];

  const { data: templates } = useGetSmsTemplates();

  const send = useSendManualSms({
    mutation: {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getListSmsLogsQueryKey() });
        toast({
          title: `ارسال انجام شد: ${toPersianDigits(result.sent)} موفق، ${toPersianDigits(result.failed)} ناموفق`,
          description: result.errors && result.errors.length > 0 ? result.errors.join("؛ ") : undefined,
          variant: result.failed > 0 && result.sent === 0 ? "destructive" : undefined,
        });
        if (result.sent > 0) {
          setSelected(new Map());
        }
      },
      onError: () => toast({ title: "خطا در ارسال پیامک", variant: "destructive" }),
    },
  });

  function togglePatient(id: number, name: string) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, name);
      return next;
    });
  }

  function submit() {
    if (!message.trim()) {
      toast({ title: "متن پیام را وارد کنید", variant: "destructive" });
      return;
    }
    if (mode === "manual") {
      if (selected.size === 0) {
        toast({ title: "حداقل یک گیرنده انتخاب کنید", variant: "destructive" });
        return;
      }
      send.mutate({ data: { message, patientIds: Array.from(selected.keys()) } });
    } else {
      const days = Math.max(0, parseInt(birthdayDays, 10) || 0);
      send.mutate({ data: { message, birthdayDays: days, eventType: "birthday" } });
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Send className="size-5" />ارسال پیامک</CardTitle>
          <CardDescription>می‌توانید از متغیر {"{نام}"} در متن استفاده کنید تا نام هر گیرنده جایگزین شود.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button variant={mode === "manual" ? "default" : "outline"} size="sm" onClick={() => setMode("manual")} data-testid="button-mode-manual">
              <MessageSquare className="size-4" />
              انتخاب مراجعین
            </Button>
            <Button variant={mode === "birthday" ? "default" : "outline"} size="sm" onClick={() => setMode("birthday")} data-testid="button-mode-birthday">
              <Cake className="size-4" />
              تبریک تولد
            </Button>
          </div>

          {mode === "birthday" && (
            <div className="space-y-2">
              <Label htmlFor="birthday-days">ارسال برای بیماران دارای تولد در چند روز آینده؟</Label>
              <Input
                id="birthday-days"
                type="number"
                min={0}
                max={90}
                value={birthdayDays}
                onChange={(e) => setBirthdayDays(e.target.value)}
                className="w-32"
                data-testid="input-birthday-days"
              />
              {templates && (
                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setMessage(templates.birthday)}>
                  <RotateCcw className="size-3.5" />
                  استفاده از قالب تبریک تولد
                </Button>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="sms-message">متن پیام</Label>
            <Textarea
              id="sms-message"
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="مثلاً: {نام} عزیز، ..."
              data-testid="textarea-sms-message"
            />
            <div className="text-xs text-muted-foreground">
              {toPersianDigits(message.length)} حرف
            </div>
          </div>

          <Button onClick={submit} disabled={send.isPending} data-testid="button-send-sms">
            {send.isPending ? <Spinner className="size-4" /> : <Send className="size-4" />}
            {mode === "birthday" ? "ارسال تبریک تولد" : `ارسال به ${toPersianDigits(selected.size)} نفر`}
          </Button>
        </CardContent>
      </Card>

      {mode === "manual" && (
        <Card>
          <CardHeader>
            <CardTitle>انتخاب گیرندگان</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="جستجوی نام یا شماره..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-patient-search"
            />
            {selected.size > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {Array.from(selected.entries()).map(([id, name]) => (
                  <Badge key={id} variant="secondary" className="cursor-pointer" onClick={() => togglePatient(id, name)}>
                    {name} ✕
                  </Badge>
                ))}
              </div>
            )}
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {patients.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => togglePatient(p.id, p.name)}
                  className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-right text-sm transition-colors ${
                    selected.has(p.id) ? "border-primary bg-primary/10" : "hover:bg-muted"
                  }`}
                  data-testid={`button-select-patient-${p.id}`}
                >
                  <span>{p.name}</span>
                  <span className="text-muted-foreground" dir="ltr">{toPersianDigits(p.phone)}</span>
                </button>
              ))}
              {patients.length === 0 && (
                <div className="py-6 text-center text-sm text-muted-foreground">موردی یافت نشد</div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── تب تاریخچه ────────────────────────────────────────────────────────────────

const EVENT_LABELS: Record<string, string> = {
  appointment: "نوبت",
  payment: "پرداخت",
  commission: "پورسانت",
  birthday: "تولد",
  manual: "دستی",
};

function LogsTab() {
  const [page, setPage] = useState(1);
  const limit = 30;
  const { data, isLoading } = useListSmsLogs({ page, limit });

  if (isLoading) {
    return <div className="flex justify-center py-12"><Spinner className="size-6" /></div>;
  }

  const logs: SmsLogEntry[] = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><History className="size-5" />تاریخچه ارسال</CardTitle>
        <CardDescription>{toPersianDigits(total)} پیامک ثبت شده</CardDescription>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground">هنوز پیامکی ارسال نشده است</div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">گیرنده</TableHead>
                  <TableHead className="text-right">شماره</TableHead>
                  <TableHead className="text-right">نوع</TableHead>
                  <TableHead className="text-right">متن</TableHead>
                  <TableHead className="text-right">وضعیت</TableHead>
                  <TableHead className="text-right">زمان</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id} data-testid={`row-sms-log-${log.id}`}>
                    <TableCell>{log.recipientName ?? "—"}</TableCell>
                    <TableCell dir="ltr" className="text-right">{toPersianDigits(log.recipientPhone)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{EVENT_LABELS[log.eventType] ?? log.eventType}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[280px]">
                      <span className="line-clamp-2 text-sm">{log.message}</span>
                    </TableCell>
                    <TableCell>
                      {log.status === "sent" ? (
                        <Badge className="bg-green-600 hover:bg-green-600">ارسال شد</Badge>
                      ) : (
                        <Badge variant="destructive" title={log.error ?? undefined}>
                          ناموفق
                        </Badge>
                      )}
                      {log.status !== "sent" && log.error && (
                        <div className="mt-1 text-xs text-muted-foreground">{log.error}</div>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatShamsiDate(log.createdAt, true)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-center gap-3">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  قبلی
                </Button>
                <span className="text-sm text-muted-foreground">
                  صفحه {toPersianDigits(page)} از {toPersianDigits(totalPages)}
                </span>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  بعدی
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── صفحه اصلی ─────────────────────────────────────────────────────────────────

export default function SmsPanel() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <MessageSquare className="size-6" />
          پنل پیامکی
        </h1>
        <p className="mt-1 text-muted-foreground">
          ارسال خودکار و دستی پیامک از طریق پنل ملی‌پیامک
        </p>
      </div>

      <Tabs defaultValue="settings" dir="rtl">
        <TabsList>
          <TabsTrigger value="settings" data-testid="tab-settings">
            <Settings className="size-4" />
            تنظیمات
          </TabsTrigger>
          <TabsTrigger value="templates" data-testid="tab-templates">
            <FileText className="size-4" />
            قالب‌ها
          </TabsTrigger>
          <TabsTrigger value="send" data-testid="tab-send">
            <Send className="size-4" />
            ارسال
          </TabsTrigger>
          <TabsTrigger value="logs" data-testid="tab-logs">
            <History className="size-4" />
            تاریخچه
          </TabsTrigger>
        </TabsList>
        <TabsContent value="settings" className="mt-6">
          <SettingsTab />
        </TabsContent>
        <TabsContent value="templates" className="mt-6">
          <TemplatesTab />
        </TabsContent>
        <TabsContent value="send" className="mt-6">
          <SendTab />
        </TabsContent>
        <TabsContent value="logs" className="mt-6">
          <LogsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
