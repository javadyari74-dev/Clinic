import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Download, Database, Shield, Trash2, AlertTriangle, ShieldAlert, Upload, RotateCcw, FolderCog, GitMerge, FileClock, Save, CheckCircle2, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");
const CONFIRM_WORD = "حذف";

type ResetStep = "idle" | "warn" | "confirm";

export default function Backup() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { token } = useAuth();
  const [resetStep, setResetStep] = useState<ResetStep>("idle");
  const [confirmInput, setConfirmInput] = useState("");
  const [resetting, setResetting] = useState(false);

  // بازیابی از فایل پشتیبان
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);

  function onPickRestoreFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (file) {
      setRestoreFile(file);
      setRestoreOpen(true);
    }
    // اجازه انتخاب دوباره همان فایل
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function closeRestore() {
    setRestoreOpen(false);
    setRestoreFile(null);
  }

  async function doRestore() {
    if (!restoreFile) return;
    setRestoring(true);
    try {
      const text = await restoreFile.text();
      const parsed = JSON.parse(text);
      if (!parsed?.data || typeof parsed.data !== "object") {
        throw new Error("invalid");
      }
      const res = await fetch(`${BASE_URL}/api/backup/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ data: parsed.data }),
      });
      if (!res.ok) throw new Error("failed");
      queryClient.clear();
      toast({ title: "اطلاعات با موفقیت بازیابی شد", description: "تمام داده‌ها از فایل پشتیبان جایگزین شد." });
      closeRestore();
    } catch (err) {
      const msg = err instanceof SyntaxError || (err as Error)?.message === "invalid"
        ? "فایل انتخاب‌شده یک پشتیبان معتبر نیست"
        : "خطا در بازیابی اطلاعات";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setRestoring(false);
    }
  }

  async function downloadBackup() {
    try {
      const res = await fetch(`${BASE_URL}/api/backup/download`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `clinic-backup-${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast({ title: "فایل پشتیبان‌گیری در حال دانلود است" });
    } catch {
      toast({ title: "خطا در دانلود پشتیبان", variant: "destructive" });
    }
  }

  function downloadPatientsCsv() {
    const link = document.createElement("a");
    link.href = `${BASE_URL}/api/patients/export/excel`;
    link.download = "patients.csv";
    link.click();
    toast({ title: "فایل CSV مراجعین در حال دانلود است" });
  }

  function openReset() {
    setConfirmInput("");
    setResetStep("warn");
  }

  function closeReset() {
    setResetStep("idle");
    setConfirmInput("");
  }

  function goToConfirm() {
    setResetStep("confirm");
    setConfirmInput("");
  }

  async function doReset() {
    if (confirmInput !== CONFIRM_WORD) return;
    setResetting(true);
    try {
      const res = await fetch(`${BASE_URL}/api/reset`, { method: "DELETE", headers: { "Authorization": `Bearer ${token}` } });
      if (!res.ok) throw new Error();
      queryClient.clear();
      toast({ title: "تمام اطلاعات پاک شدند", description: "سیستم به حالت اولیه برگشت." });
      closeReset();
    } catch {
      toast({ title: "خطا در پاک‌سازی اطلاعات", variant: "destructive" });
    } finally {
      setResetting(false);
    }
  }

  const canReset = confirmInput === CONFIRM_WORD && !resetting;

  // مسیر ذخیره بکاپ
  const [defaultDir, setDefaultDir] = useState("");
  const [isDefaultDir, setIsDefaultDir] = useState(true);
  const [pathInput, setPathInput] = useState("");
  const [savingPath, setSavingPath] = useState(false);

  // بازیابی ادغامی
  const mergeInputRef = useRef<HTMLInputElement>(null);
  const [mergeFile, setMergeFile] = useState<File | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeReport, setMergeReport] = useState<Record<string, { added: number; skipped: number }> | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  // گزارش بکاپ خودکار
  type BackupLog = { id: number; kind: string; filename: string | null; status: string; message: string | null; createdAt: number };
  const [logs, setLogs] = useState<BackupLog[]>([]);

  async function loadSettings() {
    try {
      const res = await fetch(`${BASE_URL}/api/backup/settings`, { headers: { "Authorization": `Bearer ${token}` } });
      if (!res.ok) return;
      const j = await res.json();
      setDefaultDir(j.defaultDir ?? "");
      setIsDefaultDir(!!j.isDefault);
      setPathInput(j.isDefault ? "" : (j.backupDir ?? ""));
    } catch { /* ignore */ }
  }

  async function loadLogs() {
    try {
      const res = await fetch(`${BASE_URL}/api/backup/logs`, { headers: { "Authorization": `Bearer ${token}` } });
      if (!res.ok) return;
      const j = await res.json();
      setLogs(Array.isArray(j.logs) ? j.logs : []);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    loadSettings();
    loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveBackupPath() {
    setSavingPath(true);
    try {
      const res = await fetch(`${BASE_URL}/api/backup/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ backupDir: pathInput }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "خطا در ذخیره مسیر");
      setIsDefaultDir(!!j.isDefault);
      setPathInput(j.isDefault ? "" : (j.backupDir ?? ""));
      toast({ title: j.message || "مسیر ذخیره بکاپ ذخیره شد" });
    } catch (e) {
      toast({ title: (e as Error).message || "خطا در ذخیره مسیر", variant: "destructive" });
    } finally {
      setSavingPath(false);
    }
  }

  function onPickMergeFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (file) {
      setMergeFile(file);
      setMergeOpen(true);
    }
    if (mergeInputRef.current) mergeInputRef.current.value = "";
  }

  function closeMerge() {
    setMergeOpen(false);
    setMergeFile(null);
  }

  async function doMerge() {
    if (!mergeFile) return;
    setMerging(true);
    try {
      const text = await mergeFile.text();
      const parsed = JSON.parse(text);
      if (!parsed?.data || typeof parsed.data !== "object") throw new Error("invalid");
      const res = await fetch(`${BASE_URL}/api/backup/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ data: parsed.data }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "failed");
      queryClient.clear();
      setMergeReport(j.report ?? null);
      closeMerge();
      setReportOpen(true);
      loadLogs();
      toast({ title: "بازیابی ادغامی با موفقیت انجام شد" });
    } catch (err) {
      const msg = err instanceof SyntaxError || (err as Error)?.message === "invalid"
        ? "فایل انتخاب‌شده یک پشتیبان معتبر نیست"
        : ((err as Error)?.message || "خطا در بازیابی ادغامی");
      toast({ title: msg, variant: "destructive" });
    } finally {
      setMerging(false);
    }
  }

  const TABLE_LABELS: Record<string, string> = {
    patients: "مراجعین",
    services: "خدمات",
    staff: "کارکنان",
    appointments: "نوبت‌ها",
    payments: "پرداخت‌ها",
    discounts: "تخفیف‌ها",
    inventory: "موجودی انبار",
    commissions: "کمیسیون‌ها",
    recipients: "دریافت‌کنندگان کمیسیون",
    reminders: "یادآوری‌ها",
    notes: "یادداشت‌ها",
    activityLog: "گزارش فعالیت",
    expenses: "هزینه‌ها",
    users: "کاربران",
    accountTransactions: "تراکنش‌های حساب",
  };

  function formatLogTime(sec: number): string {
    try {
      return new Date(sec * 1000).toLocaleString("fa-IR");
    } catch {
      return "";
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">پشتیبان‌گیری</h1>
        <p className="text-muted-foreground mt-1">صادرات و پشتیبان‌گیری از داده‌های مطب</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              پشتیبان‌گیری کامل
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground text-sm">
              یک فایل JSON شامل تمام اطلاعات مطب (مراجعین، نوبت‌ها، پرداخت‌ها، موجودی انبار و...) دانلود کنید.
            </p>
            <div className="text-xs text-muted-foreground bg-muted p-3 rounded-lg space-y-0.5">
              <p>✓ شامل اطلاعات مراجعین</p>
              <p>✓ شامل سابقه نوبت‌ها</p>
              <p>✓ شامل تراکنش‌های مالی و هزینه‌ها</p>
              <p>✓ شامل موجودی انبار</p>
              <p>✓ شامل کمیسیون‌ها و یادآوری‌ها</p>
              <p>✓ شامل خدمات، کارکنان و کاربران</p>
            </div>
            <Button className="w-full gap-2" onClick={downloadBackup}>
              <Download className="h-4 w-4" />
              دانلود پشتیبان JSON
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              صادرات مراجعین
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground text-sm">
              لیست کامل مراجعین را به فرمت CSV (قابل باز شدن در Excel) دانلود کنید.
            </p>
            <div className="text-xs text-muted-foreground bg-muted p-3 rounded-lg space-y-0.5">
              <p>✓ شماره پرونده</p>
              <p>✓ نام و نام خانوادگی</p>
              <p>✓ شماره تماس</p>
              <p>✓ ایمیل</p>
              <p>✓ تاریخ تولد و جنسیت</p>
            </div>
            <Button variant="outline" className="w-full gap-2" onClick={downloadPatientsCsv}>
              <Download className="h-4 w-4" />
              دانلود CSV مراجعین
            </Button>
          </CardContent>
        </Card>

        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-primary" />
              بازیابی اطلاعات
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground text-sm">
              یک فایل پشتیبان JSON بارگذاری کنید تا تمام اطلاعات مطب بازگردانده شود.
            </p>
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 p-3 rounded-lg">
              ⚠️ با بازیابی، تمام اطلاعات فعلی مطب پاک و با اطلاعات فایل جایگزین می‌شود.
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={onPickRestoreFile}
            />
            <Button variant="outline" className="w-full gap-2" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4" />
              انتخاب فایل پشتیبان
            </Button>
          </CardContent>
        </Card>

        {/* بازیابی ادغامی */}
        <Card className="border-emerald-300/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitMerge className="h-5 w-5 text-emerald-600" />
              بازیابی ادغامی
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground text-sm">
              یک فایل پشتیبان را با اطلاعات فعلی مطب «ادغام» کنید؛ رکوردهای جدید اضافه و رکوردهای تکراری نادیده گرفته می‌شوند.
            </p>
            <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 p-3 rounded-lg space-y-0.5">
              <p>✓ هیچ اطلاعاتی پاک نمی‌شود</p>
              <p>✓ تشخیص تکراری بر اساس شناسه یکتا (uuid)</p>
              <p>✓ پیش از ادغام، یک بکاپ ایمنی خودکار گرفته می‌شود</p>
            </div>
            <input
              ref={mergeInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={onPickMergeFile}
            />
            <Button variant="outline" className="w-full gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={() => mergeInputRef.current?.click()}>
              <GitMerge className="h-4 w-4" />
              انتخاب فایل برای ادغام
            </Button>
          </CardContent>
        </Card>

        {/* مسیر ذخیره بکاپ */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderCog className="h-5 w-5 text-primary" />
              مسیر ذخیره بکاپ
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground text-sm">
              پوشه‌ای که بکاپ‌های خودکار و بکاپ ایمنی پیش از ادغام در آن ذخیره می‌شوند. مسیر کامل پوشه را وارد کنید.
            </p>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">مسیر پوشه</label>
              <Input
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                placeholder={defaultDir || "مسیر کامل پوشه"}
                dir="ltr"
                className="text-left"
              />
              <p className="text-xs text-muted-foreground">
                {isDefaultDir
                  ? `در حال حاضر از مسیر پیش‌فرض استفاده می‌شود: ${defaultDir}`
                  : "برای بازگشت به مسیر پیش‌فرض، کادر را خالی کرده و ذخیره کنید."}
              </p>
            </div>
            <Button className="w-full gap-2" onClick={saveBackupPath} disabled={savingPath}>
              <Save className="h-4 w-4" />
              {savingPath ? "در حال ذخیره..." : "ذخیره مسیر"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="border-yellow-200 bg-yellow-50">
        <CardContent className="pt-4">
          <p className="text-sm text-yellow-800">
            <strong>توصیه:</strong> برای حفظ امنیت اطلاعات مراجعین، فایل‌های پشتیبان را در مکانی امن نگهداری کنید
            و از اشتراک‌گذاری آن‌ها با افراد غیرمجاز خودداری کنید.
          </p>
        </CardContent>
      </Card>

      {/* گزارش بکاپ خودکار */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileClock className="h-5 w-5 text-primary" />
            گزارش بکاپ خودکار
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm mb-3">
            برنامه به‌صورت خودکار هنگام باز و بسته شدن، از اطلاعات مطب بکاپ می‌گیرد (حداکثر یک‌بار در هر ۱۵ دقیقه) و ۵۰ بکاپ آخر را نگه می‌دارد.
          </p>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">هنوز بکاپ خودکاری ثبت نشده است.</p>
          ) : (
            <div className="max-h-72 overflow-auto rounded-lg border divide-y">
              {logs.map((log) => (
                <div key={log.id} className="flex items-center gap-3 p-2.5 text-sm">
                  {log.status === "success" ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate" dir="ltr">
                      {log.filename ?? "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatLogTime(log.createdAt)}
                      {log.kind === "pre-merge" ? " • بکاپ ایمنی پیش از ادغام" : ""}
                      {log.status === "error" && log.message ? ` • ${log.message}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-5 w-5" />
            منطقه خطر
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            این عملیات تمام اطلاعات سیستم را به‌طور کامل و غیرقابل بازگشت پاک می‌کند.
            پیش از انجام، حتماً از اطلاعات پشتیبان تهیه کنید.
          </p>
          <Button
            variant="destructive"
            className="gap-2"
            onClick={openReset}
          >
            <Trash2 className="h-4 w-4" />
            پاک‌سازی کامل اطلاعات
          </Button>
        </CardContent>
      </Card>

      {/* مرحله اول — هشدار پشتیبان */}
      <Dialog open={resetStep === "warn"} onOpenChange={(o) => !o && closeReset()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              هشدار مهم — پشتیبان‌گیری ضروری است
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800 space-y-2">
              <p className="font-bold">⚠️ قبل از ادامه حتماً از اطلاعات پشتیبان بگیرید!</p>
              <p>پس از پاک‌سازی، هیچ راهی برای بازیابی اطلاعات وجود ندارد. این عملیات شامل:</p>
              <ul className="list-disc list-inside space-y-0.5 text-xs">
                <li>تمام پرونده‌های مراجعین</li>
                <li>سابقه کامل نوبت‌ها</li>
                <li>تمام تراکنش‌های مالی</li>
                <li>کمیسیون‌ها، یادآوری‌ها و موجودی انبار</li>
              </ul>
            </div>
            <p className="text-sm text-muted-foreground">
              ابتدا از دکمه «دانلود پشتیبان JSON» استفاده کنید، سپس برای ادامه کلیک کنید.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeReset}>انصراف</Button>
            <Button
              className="gap-2"
              onClick={downloadBackup}
              variant="secondary"
            >
              <Download className="h-4 w-4" />
              دانلود پشتیبان
            </Button>
            <Button variant="destructive" onClick={goToConfirm}>
              پشتیبان گرفتم، ادامه
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* مرحله دوم — تأیید نهایی */}
      <Dialog open={resetStep === "confirm"} onOpenChange={(o) => !o && closeReset()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              تأیید نهایی پاک‌سازی
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
              این عملیات کاملاً <strong>غیرقابل بازگشت</strong> است. برای تأیید، کلمه
              {" "}<strong className="font-mono bg-red-100 px-1 rounded">حذف</strong>{" "}
              را در کادر زیر تایپ کنید.
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">برای تأیید بنویسید: <span className="font-mono font-bold">حذف</span></label>
              <Input
                value={confirmInput}
                onChange={e => setConfirmInput(e.target.value)}
                placeholder="حذف"
                className={confirmInput === CONFIRM_WORD ? "border-destructive ring-1 ring-destructive" : ""}
                autoFocus
                onKeyDown={e => e.key === "Enter" && canReset && doReset()}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeReset} disabled={resetting}>انصراف</Button>
            <Button
              variant="destructive"
              disabled={!canReset}
              onClick={doReset}
              className="gap-2"
            >
              <Trash2 className="h-4 w-4" />
              {resetting ? "در حال پاک‌سازی..." : "پاک‌سازی کامل"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تأیید بازیابی از فایل پشتیبان */}
      <Dialog open={restoreOpen} onOpenChange={(o) => !o && !restoring && closeRestore()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <RotateCcw className="h-5 w-5" />
              تأیید بازیابی اطلاعات
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800 space-y-2">
              <p className="font-bold">⚠️ این عملیات تمام اطلاعات فعلی مطب را پاک می‌کند!</p>
              <p>پس از بازیابی، اطلاعات فعلی با محتوای فایل پشتیبان جایگزین می‌شود و قابل بازگشت نیست.</p>
            </div>
            {restoreFile && (
              <p className="text-sm text-muted-foreground">
                فایل انتخاب‌شده: <span className="font-medium">{restoreFile.name}</span>
              </p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeRestore} disabled={restoring}>انصراف</Button>
            <Button variant="destructive" onClick={doRestore} disabled={restoring} className="gap-2">
              <RotateCcw className="h-4 w-4" />
              {restoring ? "در حال بازیابی..." : "بازیابی اطلاعات"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تأیید بازیابی ادغامی */}
      <Dialog open={mergeOpen} onOpenChange={(o) => !o && !merging && closeMerge()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-600">
              <GitMerge className="h-5 w-5" />
              تأیید بازیابی ادغامی
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-sm text-emerald-800 space-y-2">
              <p className="font-bold">✓ اطلاعات فعلی مطب پاک نمی‌شود.</p>
              <p>فقط رکوردهای جدید از فایل پشتیبان اضافه می‌شوند و رکوردهای تکراری نادیده گرفته می‌شوند. پیش از ادغام یک بکاپ ایمنی خودکار گرفته می‌شود.</p>
            </div>
            {mergeFile && (
              <p className="text-sm text-muted-foreground">
                فایل انتخاب‌شده: <span className="font-medium">{mergeFile.name}</span>
              </p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeMerge} disabled={merging}>انصراف</Button>
            <Button onClick={doMerge} disabled={merging} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
              <GitMerge className="h-4 w-4" />
              {merging ? "در حال ادغام..." : "شروع ادغام"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* گزارش نتیجه بازیابی ادغامی */}
      <Dialog open={reportOpen} onOpenChange={(o) => !o && setReportOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" />
              گزارش بازیابی ادغامی
            </DialogTitle>
          </DialogHeader>
          {mergeReport && (
            <div className="space-y-3">
              <div className="max-h-80 overflow-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="text-right p-2 font-medium">بخش</th>
                      <th className="text-center p-2 font-medium">اضافه‌شده</th>
                      <th className="text-center p-2 font-medium">تکراری</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {Object.entries(mergeReport)
                      .filter(([key]) => key !== "totals")
                      .map(([key, val]) => (
                        <tr key={key}>
                          <td className="p-2">{TABLE_LABELS[key] ?? key}</td>
                          <td className="p-2 text-center font-medium text-emerald-600">{val.added}</td>
                          <td className="p-2 text-center text-muted-foreground">{val.skipped}</td>
                        </tr>
                      ))}
                  </tbody>
                  {mergeReport.totals && (
                    <tfoot className="bg-muted/50 font-bold">
                      <tr>
                        <td className="p-2">مجموع</td>
                        <td className="p-2 text-center text-emerald-600">{mergeReport.totals.added}</td>
                        <td className="p-2 text-center">{mergeReport.totals.skipped}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setReportOpen(false)}>بستن</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
