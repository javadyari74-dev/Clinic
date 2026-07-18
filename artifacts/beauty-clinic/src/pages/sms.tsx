import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSmsSettings,
  useUpdateSmsSettings,
  useGetSmsTemplates,
  useUpdateSmsTemplates,
  useGetSmsCredit,
  useSendManualSms,
  useSendPatternSms,
  useListSavedPatterns,
  useCreateSavedPattern,
  useDeleteSavedPattern,
  getListSavedPatternsQueryKey,
  useListSmsLogs,
  useListPatients,
  getGetSmsSettingsQueryKey,
  getGetSmsCreditQueryKey,
  getListSmsLogsQueryKey,
} from "@workspace/api-client-react";
import type { SmsTemplates } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toPersianDigits, formatShamsiDate } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import {
  MessageSquare, PlugZap, FileText, Send, History, Zap,
  CheckCircle2, XCircle, RotateCcw, Cake, Plus, Trash2,
} from "lucide-react";

// ─── Settings tab ──────────────────────────────────────────────────────────────

function SettingsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useGetSmsSettings();

  const [username, setUsername] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [creditEnabled, setCreditEnabled] = useState(false);
  const [patternDraft, setPatternDraft] = useState<Record<string, string>>({});
  const [throttleDraft, setThrottleDraft] = useState<string | null>(null);

  const { data: credit, isFetching: creditFetching } = useGetSmsCredit({
    query: { enabled: creditEnabled, queryKey: getGetSmsCreditQueryKey() },
  });

  const update = useUpdateSmsSettings({
    mutation: {
      onSuccess: (res) => {
        queryClient.setQueryData(getGetSmsSettingsQueryKey(), res);
        setPassword("");
        toast({ title: "تنظیمات پنل پیامکی ذخیره شد" });
      },
      onError: () => toast({ title: "خطا در ذخیره تنظیمات", variant: "destructive" }),
    },
  });

  if (isLoading || !settings) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-6" />
      </div>
    );
  }

  const usernameVal = username ?? settings.username;
  const fromVal = from ?? settings.from;

  function saveConnection() {
    update.mutate({
      data: { username: usernameVal, from: fromVal, ...(password ? { password } : {}) },
    });
  }

  async function checkCredit() {
    const dirty = username !== null || from !== null || password !== "";
    try {
      if (dirty) {
        await update.mutateAsync({
          data: { username: usernameVal, from: fromVal, ...(password ? { password } : {}) },
        });
      }
      setCreditEnabled(true);
      await queryClient.invalidateQueries({ queryKey: getGetSmsCreditQueryKey() });
    } catch {
      /* handled by onError */
    }
  }

  function toggleFlag(key: string, value: boolean) {
    update.mutate({ data: { [key]: value } });
  }

  function saveThrottle() {
    if (throttleDraft === null) return;
    const n = parseInt(throttleDraft, 10);
    setThrottleDraft(null);
    if (Number.isFinite(n) && n !== settings?.surveyThrottleDays) {
      update.mutate({ data: { surveyThrottleDays: n } });
    }
  }

  function savePattern() {
    update.mutate({
      data: {
        bodyIdAppointment: patternDraft.bodyIdAppointment ?? settings?.bodyIdAppointment ?? "",
        bodyIdPayment: patternDraft.bodyIdPayment ?? settings?.bodyIdPayment ?? "",
        bodyIdCommission: patternDraft.bodyIdCommission ?? settings?.bodyIdCommission ?? "",
        bodyIdBirthday: patternDraft.bodyIdBirthday ?? settings?.bodyIdBirthday ?? "",
        bodyIdSurvey: patternDraft.bodyIdSurvey ?? settings?.bodyIdSurvey ?? "",
        bodyIdRecipientWelcome: patternDraft.bodyIdRecipientWelcome ?? settings?.bodyIdRecipientWelcome ?? "",
      },
    });
  }

  const patternFields = [
    { key: "bodyIdAppointment", label: "کد متن نوبت" },
    { key: "bodyIdPayment", label: "کد متن پرداخت" },
    { key: "bodyIdCommission", label: "کد متن پورسانت" },
    { key: "bodyIdBirthday", label: "کد متن تولد" },
    { key: "bodyIdSurvey", label: "کد متن نظرسنجی" },
    { key: "bodyIdRecipientWelcome", label: "کد متن خوش‌آمد معرف" },
  ] as const;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Connection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PlugZap className="size-5" />
            اتصال به پنل ملی‌پیامک
          </CardTitle>
          <CardDescription>
            نام کاربری، رمز عبور و شماره خط اختصاصی پنل ملی‌پیامک خود را وارد کنید. این اطلاعات فقط روی همین دستگاه ذخیره می‌شود.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sms-username">نام کاربری پنل</Label>
            <Input
              id="sms-username"
              dir="ltr"
              value={usernameVal}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="09xxxxxxxxx"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sms-password">کلید وب‌سرویس (API Key)</Label>
            <Input
              id="sms-password"
              dir="ltr"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={
                settings.hasPassword
                  ? "•••••••• (برای تغییر، کلید جدید وارد کنید)"
                  : "کلید وب‌سرویس"
              }
            />
            <p className="text-xs text-muted-foreground">
              رمز عبور معمولی پنل کار نمی‌کند — کلید وب‌سرویس را از پنل ملی‌پیامک، بخش «تنظیمات ← وب‌سرویس» کپی کنید.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sms-from">شماره فرستنده (خط اختصاصی)</Label>
            <Input
              id="sms-from"
              dir="ltr"
              value={fromVal}
              onChange={(e) => setFrom(e.target.value)}
              placeholder="مثلاً 50004001..."
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button onClick={saveConnection} disabled={update.isPending} data-testid="button-save-sms-settings">
              {update.isPending ? <Spinner className="size-4" /> : null}
              ذخیره تنظیمات
            </Button>
            <Button
              variant="outline"
              onClick={checkCredit}
              disabled={creditFetching || update.isPending}
              data-testid="button-check-credit"
            >
              <Zap className="size-4" />
              {creditFetching || update.isPending ? "در حال بررسی..." : "تست اتصال و اعتبار"}
            </Button>
          </div>
          {creditEnabled && credit && !creditFetching && (
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

      {/* Automatic SMS */}
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
            <Switch
              checked={settings.enabledAppointment}
              onCheckedChange={(v) => toggleFlag("enabledAppointment", v)}
              data-testid="switch-sms-appointment"
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-medium">ثبت پرداخت</div>
              <div className="text-sm text-muted-foreground">پیامک رسید پرداخت برای بیمار</div>
            </div>
            <Switch
              checked={settings.enabledPayment}
              onCheckedChange={(v) => toggleFlag("enabledPayment", v)}
              data-testid="switch-sms-payment"
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-medium">پورسانت معرف</div>
              <div className="text-sm text-muted-foreground">
                پیامک اطلاع پورسانت برای معرف (کارمند، کمیسیون‌گیرنده یا بیمار معرف)
              </div>
            </div>
            <Switch
              checked={settings.enabledCommission}
              onCheckedChange={(v) => toggleFlag("enabledCommission", v)}
              data-testid="switch-sms-commission"
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-medium">خوش‌آمد معرف جدید</div>
              <div className="text-sm text-muted-foreground">
                پیامک اطلاع‌رسانی به فردی که به عنوان معرف (کمیسیون‌گیرنده) ثبت می‌شود
              </div>
            </div>
            <Switch
              checked={settings.enabledRecipientWelcome}
              onCheckedChange={(v) => toggleFlag("enabledRecipientWelcome", v)}
              data-testid="switch-sms-recipient-welcome"
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-medium">نظرسنجی پس از مراجعه</div>
              <div className="text-sm text-muted-foreground">
                پیامک نظرسنجی رضایت پس از ثبت پرداخت؛ امتیاز (۱ تا ۵) را منشی در تماس بعدی ثبت می‌کند
              </div>
            </div>
            <Switch
              checked={settings.enabledSurvey}
              onCheckedChange={(v) => toggleFlag("enabledSurvey", v)}
              data-testid="switch-sms-survey"
            />
          </div>
          {settings.enabledSurvey && (
            <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/40 p-3">
              <Label htmlFor="sms-survey-throttle" className="text-sm font-normal leading-6">
                حداقل فاصله بین دو پیامک نظرسنجی برای هر مراجع (روز)
              </Label>
              <Input
                id="sms-survey-throttle"
                dir="ltr"
                inputMode="numeric"
                className="w-24 shrink-0"
                value={throttleDraft ?? String(settings.surveyThrottleDays)}
                onChange={(e) => setThrottleDraft(e.target.value.replace(/[^0-9]/g, ""))}
                onBlur={saveThrottle}
                data-testid="input-survey-throttle-days"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pattern (service) send */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5">
              <CardTitle>ارسال خدماتی (پترن)</CardTitle>
              <CardDescription>
                برای ارسال به شماره‌هایی که پیامک تبلیغاتی‌شان مسدود است، از خط خدماتی اشتراکی ملی‌پیامک با «متن پیش‌فرض (پترن)» استفاده کنید. ابتدا متن هر رویداد را در پنل ملی‌پیامک (بخش ارسال ← متن پیش‌فرض) ثبت کنید و پس از تأیید، «کد متن» هر کدام را اینجا وارد کنید.
              </CardDescription>
            </div>
            <Switch
              checked={settings.sendMode === "pattern"}
              onCheckedChange={(v) => update.mutate({ data: { sendMode: v ? "pattern" : "normal" } })}
              data-testid="switch-sms-pattern-mode"
            />
          </div>
        </CardHeader>
        {settings.sendMode === "pattern" && (
          <CardContent className="space-y-5">
            <div className="rounded-md border bg-muted/40 p-3 text-xs leading-6 text-muted-foreground space-y-1">
              <div>در متن پترن، متغیرها را دقیقاً با همین ترتیب و به شکل {"{0}"}، {"{1}"}، ... ثبت کنید:</div>
              <div>• نوبت: {"{0}"} نام — {"{1}"} تاریخ — {"{2}"} ساعت</div>
              <div>• پرداخت: {"{0}"} نام — {"{1}"} مبلغ — {"{2}"} خدمت</div>
              <div>• پورسانت: {"{0}"} نام — {"{1}"} پورسانت — {"{2}"} درصد — {"{3}"} مبلغ</div>
              <div>• تولد: {"{0}"} نام</div>
              <div>• نظرسنجی: {"{0}"} نام — {"{1}"} خدمت</div>
              <div>• خوش‌آمد معرف: {"{0}"} نام</div>
              <div className="pt-1">
                نمونه متن پترن نوبت: «{"{0}"} عزیز، نوبت شما در مطب زیبایی دکتر یاری برای {"{1}"} ساعت {"{2}"} ثبت شد. منتظر حضور شما هستیم. www.drjavadyari.ir»
              </div>
              <div>
                توجه: در این حالت، پیامک‌های خودکار و تبریک تولد با پترن ارسال می‌شوند؛ ولی «ارسال متن آزاد به مراجعین» همچنان با خط عادی (تبلیغاتی) می‌رود و به شماره‌های مسدود نمی‌رسد.
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {patternFields.map((f) => (
                <div className="space-y-2" key={f.key}>
                  <Label htmlFor={`sms-${f.key}`}>{f.label}</Label>
                  <Input
                    id={`sms-${f.key}`}
                    dir="ltr"
                    inputMode="numeric"
                    value={patternDraft[f.key] ?? settings[f.key]}
                    onChange={(e) =>
                      setPatternDraft((prev) => ({ ...prev, [f.key]: e.target.value.replace(/[^0-9]/g, "") }))
                    }
                    placeholder="مثلاً 123456"
                    data-testid={`input-${f.key}`}
                  />
                </div>
              ))}
            </div>
            <Button onClick={savePattern} disabled={update.isPending} data-testid="button-save-pattern-settings">
              {update.isPending ? <Spinner className="size-4" /> : null}
              ذخیره کدهای پترن
            </Button>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

// ─── Templates tab ───────────────────────────────────────────────────────────

const TEMPLATE_DEFS = [
  { key: "appointment", title: "تأیید نوبت", vars: ["{نام}", "{تاریخ}", "{ساعت}", "{خدمت}"] },
  { key: "payment", title: "رسید پرداخت", vars: ["{نام}", "{مبلغ}", "{خدمت}"] },
  { key: "commission", title: "پورسانت معرف", vars: ["{نام}", "{پورسانت}", "{درصد}", "{مبلغ}"] },
  { key: "birthday", title: "تبریک تولد", vars: ["{نام}"] },
  { key: "survey", title: "نظرسنجی پس از مراجعه", vars: ["{نام}", "{خدمت}"] },
  { key: "recipientWelcome", title: "خوش‌آمد معرف جدید", vars: ["{نام}"] },
] as const;

type TemplateKey = (typeof TEMPLATE_DEFS)[number]["key"];

function TemplatesTab() {
  const { toast } = useToast();
  const { data: templates, isLoading, refetch } = useGetSmsTemplates();
  const [drafts, setDrafts] = useState<Partial<Record<TemplateKey, string>>>({});

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
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-6" />
      </div>
    );
  }

  const dirty = Object.keys(drafts).length > 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {TEMPLATE_DEFS.map(({ key, title, vars }) => {
          const value = drafts[key] ?? (templates as SmsTemplates)[key];
          return (
            <Card key={key}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{title}</CardTitle>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {vars.map((v) => (
                    <Badge variant="secondary" className="font-mono text-xs" dir="ltr" key={v}>
                      {v}
                    </Badge>
                  ))}
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <Textarea
                  value={value}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                  rows={4}
                  data-testid={`textarea-template-${key}`}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => setDrafts((prev) => ({ ...prev, [key]: templates.defaults[key] }))}
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
        disabled={!dirty || update.isPending}
        data-testid="button-save-templates"
      >
        {update.isPending ? <Spinner className="size-4" /> : null}
        ذخیره قالب‌ها
      </Button>
    </div>
  );
}

// ─── Send tab ────────────────────────────────────────────────────────────────

function SendTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"manual" | "birthday" | "pattern">("manual");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Map<number, string>>(new Map());
  const [birthdayDays, setBirthdayDays] = useState("7");
  // ── حالت خدماتی (پترن) ──
  const [patternBodyId, setPatternBodyId] = useState("");
  const [patternArgs, setPatternArgs] = useState<string[]>([""]);
  const [patternRecipientMode, setPatternRecipientMode] = useState<"patient" | "phone">("patient");
  const [patternPatient, setPatternPatient] = useState<{ id: number; name: string } | null>(null);
  const [patternPhone, setPatternPhone] = useState("");
  const [savePatternName, setSavePatternName] = useState("");

  const { data: patientsRes } = useListPatients({ q: search || undefined, limit: 20 });
  const patients = patientsRes?.data ?? [];
  const { data: templates } = useGetSmsTemplates();
  const { data: settings } = useGetSmsSettings();

  const send = useSendManualSms({
    mutation: {
      onSuccess: (res) => {
        queryClient.invalidateQueries({ queryKey: getListSmsLogsQueryKey() });
        toast({
          title: `ارسال انجام شد: ${toPersianDigits(res.sent)} موفق، ${toPersianDigits(res.failed)} ناموفق`,
          description: res.errors && res.errors.length > 0 ? res.errors.join("؛ ") : undefined,
          variant: res.failed > 0 && res.sent === 0 ? "destructive" : undefined,
        });
        if (res.sent > 0) setSelected(new Map());
      },
      onError: () => toast({ title: "خطا در ارسال پیامک", variant: "destructive" }),
    },
  });

  const sendPattern = useSendPatternSms({
    mutation: {
      onSuccess: (res) => {
        queryClient.invalidateQueries({ queryKey: getListSmsLogsQueryKey() });
        if (res.ok) {
          toast({ title: "پیامک خدماتی با موفقیت ارسال شد" });
        } else {
          toast({ title: "ارسال ناموفق", description: res.error ?? undefined, variant: "destructive" });
        }
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { error?: string } } | null)?.data?.error;
        toast({ title: "خطا در ارسال پیامک خدماتی", description: msg, variant: "destructive" });
      },
    },
  });

  const { data: savedPatterns } = useListSavedPatterns();

  const createSavedPattern = useCreateSavedPattern({
    mutation: {
      onSuccess: (created) => {
        queryClient.invalidateQueries({ queryKey: getListSavedPatternsQueryKey() });
        setSavePatternName("");
        toast({ title: `کد «${created.name}» ذخیره شد` });
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { error?: string } } | null)?.data?.error;
        toast({ title: msg ?? "خطا در ذخیره کد پترن", variant: "destructive" });
      },
    },
  });

  const deleteSavedPattern = useDeleteSavedPattern({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSavedPatternsQueryKey() });
        toast({ title: "کد پترن حذف شد" });
      },
    },
  });

  function handleSavePattern() {
    if (!/^\d+$/.test(patternBodyId.trim())) {
      toast({ title: "ابتدا کد پترن معتبر (فقط عدد) وارد کنید", variant: "destructive" });
      return;
    }
    if (!savePatternName.trim()) {
      toast({ title: "نامی برای این کد وارد کنید (مثلاً «یادآوری مراجعه»)", variant: "destructive" });
      return;
    }
    createSavedPattern.mutate({ data: { name: savePatternName.trim(), bodyId: patternBodyId.trim() } });
  }

  function handleSendPattern() {
    if (!/^\d+$/.test(patternBodyId.trim())) {
      toast({ title: "کد پترن باید فقط عدد باشد (مثلاً 465123)", variant: "destructive" });
      return;
    }
    const args = patternArgs.map((a) => a.trim()).filter((a) => a.length > 0);
    if (patternRecipientMode === "patient") {
      if (!patternPatient) {
        toast({ title: "یک مراجع انتخاب کنید", variant: "destructive" });
        return;
      }
      sendPattern.mutate({ data: { bodyId: patternBodyId.trim(), args, patientId: patternPatient.id } });
    } else {
      if (!patternPhone.trim()) {
        toast({ title: "شماره موبایل را وارد کنید", variant: "destructive" });
        return;
      }
      sendPattern.mutate({ data: { bodyId: patternBodyId.trim(), args, phone: patternPhone.trim() } });
    }
  }

  function toggleRecipient(id: number, name: string) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, name);
      return next;
    });
  }

  function handleSend() {
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
          <CardTitle className="flex items-center gap-2">
            <Send className="size-5" />
            ارسال پیامک
          </CardTitle>
          <CardDescription>
            می‌توانید از متغیر {"{نام}"} در متن استفاده کنید تا نام هر گیرنده جایگزین شود.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button
              variant={mode === "manual" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("manual")}
              data-testid="button-mode-manual"
            >
              <MessageSquare className="size-4" />
              انتخاب مراجعین
            </Button>
            <Button
              variant={mode === "birthday" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("birthday")}
              data-testid="button-mode-birthday"
            >
              <Cake className="size-4" />
              تبریک تولد
            </Button>
            <Button
              variant={mode === "pattern" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("pattern")}
              data-testid="button-mode-pattern"
            >
              <Zap className="size-4" />
              پیامک خدماتی
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
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => setMessage(templates.birthday)}
                >
                  <RotateCcw className="size-3.5" />
                  استفاده از قالب تبریک تولد
                </Button>
              )}
            </div>
          )}

          {mode !== "pattern" && (
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
              <div className="text-xs text-muted-foreground">{toPersianDigits(message.length)} حرف</div>
            </div>
          )}

          {mode === "pattern" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pattern-body-id">کد پترن (bodyId)</Label>
                <Input
                  id="pattern-body-id"
                  dir="ltr"
                  placeholder="مثلاً 465123"
                  value={patternBodyId}
                  onChange={(e) => setPatternBodyId(e.target.value)}
                  data-testid="input-pattern-body-id"
                />
                <p className="text-xs text-muted-foreground">
                  کد پیامک آماده‌شده در پنل ملی‌پیامک (بخش ارسال خدماتی). متن پیام همان متن ثبت‌شده در پنل است.
                </p>
              </div>

              {savedPatterns && savedPatterns.length > 0 && (
                <div className="space-y-2">
                  <Label>کدهای ذخیره‌شده</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {savedPatterns.map((p) => (
                      <span className="inline-flex items-center" key={p.id}>
                        <Badge
                          variant={patternBodyId.trim() === p.bodyId ? "default" : "secondary"}
                          className="cursor-pointer rounded-l-none"
                          onClick={() => setPatternBodyId(p.bodyId)}
                          data-testid={`badge-saved-pattern-${p.id}`}
                        >
                          {p.name} ({toPersianDigits(p.bodyId)})
                        </Badge>
                        <button
                          type="button"
                          className="rounded-r-md border border-r-0 border-transparent bg-muted px-1.5 py-0.5 text-xs text-muted-foreground hover:text-destructive"
                          onClick={() => deleteSavedPattern.mutate({ id: p.id })}
                          title={`حذف «${p.name}»`}
                          data-testid={`button-delete-saved-pattern-${p.id}`}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="save-pattern-name">ذخیره این کد با نام دلخواه</Label>
                <div className="flex gap-2">
                  <Input
                    id="save-pattern-name"
                    placeholder="مثلاً یادآوری مراجعه"
                    value={savePatternName}
                    onChange={(e) => setSavePatternName(e.target.value)}
                    data-testid="input-save-pattern-name"
                  />
                  <Button
                    variant="outline"
                    onClick={handleSavePattern}
                    disabled={createSavedPattern.isPending}
                    data-testid="button-save-pattern"
                  >
                    <Plus className="size-4" />
                    ذخیره
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label>متغیرهای پترن (به ترتیب {"{0}"}، {"{1}"}، ...)</Label>
                {patternArgs.map((arg, i) => (
                  <div className="flex gap-2" key={i}>
                    <Input
                      placeholder={`متغیر ${toPersianDigits(i)} — مثلاً نام مراجع`}
                      value={arg}
                      onChange={(e) =>
                        setPatternArgs((prev) => prev.map((a, j) => (j === i ? e.target.value : a)))
                      }
                      data-testid={`input-pattern-arg-${i}`}
                    />
                    {patternArgs.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setPatternArgs((prev) => prev.filter((_, j) => j !== i))}
                        data-testid={`button-remove-pattern-arg-${i}`}
                      >
                        <Trash2 className="size-4 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPatternArgs((prev) => [...prev, ""])}
                  data-testid="button-add-pattern-arg"
                >
                  <Plus className="size-4" />
                  افزودن متغیر
                </Button>
                <p className="text-xs text-muted-foreground">
                  اگر پترن شما متغیر ندارد، فیلدها را خالی بگذارید.
                </p>
              </div>

              <div className="space-y-2">
                <Label>گیرنده</Label>
                <div className="flex gap-2">
                  <Button
                    variant={patternRecipientMode === "patient" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPatternRecipientMode("patient")}
                    data-testid="button-pattern-recipient-patient"
                  >
                    انتخاب مراجع
                  </Button>
                  <Button
                    variant={patternRecipientMode === "phone" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPatternRecipientMode("phone")}
                    data-testid="button-pattern-recipient-phone"
                  >
                    شماره دلخواه
                  </Button>
                </div>
                {patternRecipientMode === "phone" && (
                  <Input
                    dir="ltr"
                    placeholder="مثلاً 09121234567"
                    value={patternPhone}
                    onChange={(e) => setPatternPhone(e.target.value)}
                    data-testid="input-pattern-phone"
                  />
                )}
                {patternRecipientMode === "patient" && patternPatient && (
                  <Badge
                    variant="secondary"
                    className="cursor-pointer"
                    onClick={() => setPatternPatient(null)}
                    data-testid="badge-pattern-patient"
                  >
                    {patternPatient.name} ✕
                  </Badge>
                )}
              </div>

              <Button
                onClick={handleSendPattern}
                disabled={sendPattern.isPending}
                data-testid="button-send-pattern-sms"
              >
                {sendPattern.isPending ? <Spinner className="size-4" /> : <Zap className="size-4" />}
                ارسال پیامک خدماتی
              </Button>
            </div>
          )}

          {settings?.sendMode === "pattern" && mode !== "pattern" && (
            <div className="rounded-md border bg-muted/40 p-3 text-xs leading-6 text-muted-foreground">
              {mode === "birthday"
                ? "حالت خدماتی (پترن) فعال است: تبریک تولد با پترن تولد ارسال می‌شود و متن بالا فقط برای ثبت در تاریخچه استفاده خواهد شد — متن واقعی همان پترن ثبت‌شده در پنل ملی‌پیامک است."
                : "حالت خدماتی (پترن) فعال است، اما ارسال متن آزاد همیشه با خط عادی (تبلیغاتی) انجام می‌شود و به شماره‌های مسدودشده نمی‌رسد."}
            </div>
          )}

          {mode !== "pattern" && (
            <Button onClick={handleSend} disabled={send.isPending} data-testid="button-send-sms">
              {send.isPending ? <Spinner className="size-4" /> : <Send className="size-4" />}
              {mode === "birthday" ? "ارسال تبریک تولد" : `ارسال به ${toPersianDigits(selected.size)} نفر`}
            </Button>
          )}
        </CardContent>
      </Card>

      {mode === "pattern" && patternRecipientMode === "patient" && (
        <Card>
          <CardHeader>
            <CardTitle>انتخاب مراجع</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="جستجوی نام یا شماره..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-pattern-patient-search"
            />
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {patients.map((p) => (
                <button
                  type="button"
                  onClick={() => {
                    setPatternPatient({ id: p.id, name: p.name });
                    // نام مراجع به‌عنوان متغیر اول پیشنهاد می‌شود (اگر خالی باشد)
                    setPatternArgs((prev) =>
                      prev.length > 0 && prev[0].trim() === "" ? [p.name, ...prev.slice(1)] : prev,
                    );
                  }}
                  className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-right text-sm transition-colors ${
                    patternPatient?.id === p.id ? "border-primary bg-primary/10" : "hover:bg-muted"
                  }`}
                  data-testid={`button-pattern-select-patient-${p.id}`}
                  key={p.id}
                >
                  <span>{p.name}</span>
                  <span className="text-muted-foreground" dir="ltr">
                    {toPersianDigits(p.phone)}
                  </span>
                </button>
              ))}
              {patients.length === 0 && (
                <div className="py-6 text-center text-sm text-muted-foreground">موردی یافت نشد</div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

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
                  <Badge
                    variant="secondary"
                    className="cursor-pointer"
                    onClick={() => toggleRecipient(id, name)}
                    key={id}
                  >
                    {name} ✕
                  </Badge>
                ))}
              </div>
            )}
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {patients.map((p) => (
                <button
                  type="button"
                  onClick={() => toggleRecipient(p.id, p.name)}
                  className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-right text-sm transition-colors ${
                    selected.has(p.id) ? "border-primary bg-primary/10" : "hover:bg-muted"
                  }`}
                  data-testid={`button-select-patient-${p.id}`}
                  key={p.id}
                >
                  <span>{p.name}</span>
                  <span className="text-muted-foreground" dir="ltr">
                    {toPersianDigits(p.phone)}
                  </span>
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

// ─── Logs tab ────────────────────────────────────────────────────────────────

const EVENT_TYPE_LABELS: Record<string, string> = {
  appointment: "نوبت",
  payment: "پرداخت",
  commission: "پورسانت",
  birthday: "تولد",
  survey: "نظرسنجی",
  manual: "دستی",
  waiting_list: "لیست انتظار",
  recipient_welcome: "ثبت معرف",
};

function LogsTab() {
  const [page, setPage] = useState(1);
  const limit = 30;
  const { data, isLoading } = useListSmsLogs({ page, limit });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-6" />
      </div>
    );
  }

  const logs = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="size-5" />
          تاریخچه ارسال
        </CardTitle>
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
                  <TableRow data-testid={`row-sms-log-${log.id}`} key={log.id}>
                    <TableCell>{log.recipientName ?? "—"}</TableCell>
                    <TableCell dir="ltr" className="text-right">
                      {toPersianDigits(log.recipientPhone)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{EVENT_TYPE_LABELS[log.eventType] ?? log.eventType}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[280px]">
                      <span className="line-clamp-2 text-sm">{log.message}</span>
                    </TableCell>
                    <TableCell>
                      {log.status === "sent" ? (
                        <Badge className="bg-green-600 hover:bg-green-600">ارسال شد</Badge>
                      ) : (
                        <Badge variant="destructive" title={log.error ?? undefined}>ناموفق</Badge>
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

// ─── Main page ───────────────────────────────────────────────────────────────

export default function Sms() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <MessageSquare className="size-6" />
          پنل پیامکی
        </h1>
        <p className="mt-1 text-muted-foreground">ارسال خودکار و دستی پیامک از طریق پنل ملی‌پیامک</p>
      </div>

      <Tabs defaultValue="settings" dir="rtl">
        <TabsList>
          <TabsTrigger value="settings" data-testid="tab-settings">
            <PlugZap className="size-4" />
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
