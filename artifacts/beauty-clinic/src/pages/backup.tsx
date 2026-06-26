import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Download, Database, Shield, Trash2, AlertTriangle, ShieldAlert, Upload, RotateCcw } from "lucide-react";
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
      </div>

      <Card className="border-yellow-200 bg-yellow-50">
        <CardContent className="pt-4">
          <p className="text-sm text-yellow-800">
            <strong>توصیه:</strong> برای حفظ امنیت اطلاعات مراجعین، فایل‌های پشتیبان را در مکانی امن نگهداری کنید
            و از اشتراک‌گذاری آن‌ها با افراد غیرمجاز خودداری کنید.
          </p>
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
    </div>
  );
}
