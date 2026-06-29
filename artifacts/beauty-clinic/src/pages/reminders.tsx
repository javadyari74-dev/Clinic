import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useListReminders, useCreateReminder, useUpdateReminder, useDeleteReminder,
  getListRemindersQueryKey, useListPatients, customFetch,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { formatShamsiDate, toPersianDigits } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Plus, CheckCircle, Trash2, Bell, Gift, Scissors, LayoutList, Phone } from "lucide-react";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { PersianDatePicker } from "@/components/persian-date-picker";

// ─── Statics ─────────────────────────────────────────────────────────────────

const SHAMSI_MONTHS = [
  "فروردین","اردیبهشت","خرداد","تیر","مرداد","شهریور",
  "مهر","آبان","آذر","دی","بهمن","اسفند",
];

const TYPE_MAP: Record<string, string> = {
  followup: "پیگیری",
  birthday: "تولد",
  payment:  "پرداخت",
  custom:   "سایر",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "text-orange-600 border-orange-300",
  done:    "text-green-700 bg-green-50",
};

// ─── Birthday helpers ─────────────────────────────────────────────────────────

interface BirthdayAlert {
  patientId: number;
  name: string;
  phone: string;
  birthdate: string;
  birthdayShamsiYear: number;
  birthdayShamsiMonth: number;
  birthdayShamsiDay: number;
  daysUntil: number;
}

function useUpcomingBirthdays(days = 30) {
  return useQuery<BirthdayAlert[]>({
    queryKey: ["upcoming-birthdays", days],
    queryFn: () => customFetch<BirthdayAlert[]>(`/api/patients/upcoming-birthdays?days=${days}`),
    staleTime: 5 * 60 * 1000,
  });
}

// ─── Form schema ──────────────────────────────────────────────────────────────

const formSchema = z.object({
  title: z.string().min(2, "عنوان الزامی است"),
  description: z.string().optional(),
  type: z.enum(["followup", "birthday", "payment", "custom"]),
  patientId: z.coerce.number().optional(),
  dueAt: z.coerce.number().min(1, "تاریخ سررسید الزامی است"),
});

// ─── Reminder row ─────────────────────────────────────────────────────────────

function ReminderRow({
  r, onDone, onDelete,
}: {
  r: any;
  onDone: (id: number) => void;
  onDelete: (id: number, label: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border bg-card hover:bg-accent/30 transition-colors">
      <div className={cn(
        "w-2 h-2 rounded-full flex-shrink-0 mt-1",
        r.status === "done" ? "bg-green-500" : "bg-orange-400",
      )} />
      <div className="flex-1 min-w-0">
        <p className={cn("font-medium text-sm truncate", r.status === "done" && "line-through text-muted-foreground")}>
          {r.title}
        </p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {r.patientName && (
            <span className="text-xs text-muted-foreground">مراجع: {r.patientName}</span>
          )}
          <span className="text-xs text-muted-foreground font-mono">{formatShamsiDate(r.dueAt)}</span>
        </div>
        {r.description && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{r.description}</p>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {r.status === "done" ? (
          <Badge className="text-xs bg-green-100 text-green-700 border-green-200">انجام شده</Badge>
        ) : (
          <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">در انتظار</Badge>
        )}
        {r.status !== "done" && (
          <Button
            variant="ghost" size="icon"
            className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50"
            onClick={() => onDone(r.id)}
          >
            <CheckCircle className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="ghost" size="icon"
          className="h-7 w-7 text-destructive hover:bg-destructive/10"
          onClick={() => onDelete(r.id, r.title || "یادآوری")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
      <Icon className="h-12 w-12 opacity-20" />
      <p className="text-sm">{text}</p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Reminders() {
  const { data: reminders, isLoading } = useListReminders({});
  const { data: patients } = useListPatients();
  const { data: birthdays = [], isLoading: loadingBirthdays } = useUpcomingBirthdays(30);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string } | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [defaultType, setDefaultType] = useState<"followup" | "payment" | "custom">("followup");

  const createReminder = useCreateReminder({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRemindersQueryKey() });
        setIsOpen(false);
        toast({ title: "یادآوری ثبت شد" });
        form.reset();
      },
    },
  });

  const updateReminder = useUpdateReminder({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRemindersQueryKey() });
        toast({ title: "یادآوری انجام شد" });
      },
    },
  });

  const deleteReminder = useDeleteReminder({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRemindersQueryKey() });
        toast({ title: "یادآوری حذف شد" });
      },
    },
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "", type: defaultType,
      dueAt: Math.floor(Date.now() / 1000) + 86400,
    },
  });

  function openAddDialog(type: "followup" | "payment" | "custom") {
    setDefaultType(type);
    form.reset({
      title: "", type,
      dueAt: Math.floor(Date.now() / 1000) + 86400,
    });
    setIsOpen(true);
  }

  function onSubmit(values: z.infer<typeof formSchema>) {
    createReminder.mutate({ data: { ...values, status: "pending" } });
  }

  // Partition reminders by type
  const allItems = (reminders as any[]) ?? [];
  const serviceReminders = allItems.filter(r => r.type === "followup" || r.type === "payment");
  const otherReminders   = allItems.filter(r => r.type === "custom" || r.type === "birthday");

  const handleDone   = (id: number) => updateReminder.mutate({ id, data: { status: "done" } });
  const handleDelete = (id: number, label: string) => setDeleteTarget({ id, label });

  return (
    <div className="space-y-6">
      <ConfirmDeleteDialog
        open={!!deleteTarget}
        title={`حذف ${deleteTarget?.label ?? ""}`}
        description={`آیا از حذف «${deleteTarget?.label ?? ""}» مطمئن هستید؟ این عمل قابل بازگشت نیست.`}
        onConfirm={() => { deleteReminder.mutate({ id: deleteTarget!.id }); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Add dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ثبت یادآوری جدید</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="title" render={({ field }) => (
                <FormItem>
                  <FormLabel>عنوان</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="type" render={({ field }) => (
                  <FormItem>
                    <FormLabel>نوع</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {Object.entries(TYPE_MAP).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="patientId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>مراجع (اختیاری)</FormLabel>
                    <Select onValueChange={(v) => field.onChange(v ? Number(v) : undefined)}>
                      <FormControl><SelectTrigger><SelectValue placeholder="انتخاب..." /></SelectTrigger></FormControl>
                      <SelectContent>
                        {patients?.data.map(p => (
                          <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>توضیحات</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="dueAt" render={({ field }) => (
                <FormItem>
                  <FormLabel>تاریخ سررسید</FormLabel>
                  <FormControl>
                    <PersianDatePicker
                      value={
                        field.value
                          ? (() => {
                              const d = new Date(field.value * 1000);
                              const parts = new Intl.DateTimeFormat("en-US-u-ca-persian", {
                                year: "numeric", month: "2-digit", day: "2-digit",
                              }).formatToParts(d);
                              const g = (t: string) => parts.find(p => p.type === t)?.value ?? "";
                              return `${g("year")}-${g("month")}-${g("day")}`;
                            })()
                          : ""
                      }
                      onChange={(shamsiStr) => {
                        if (!shamsiStr) { field.onChange(0); return; }
                        const [y, m, day] = shamsiStr.split("-").map(Number);
                        // Convert Shamsi to Gregorian unix
                        const ref = new Date();
                        ref.setHours(12, 0, 0, 0);
                        const rp = new Intl.DateTimeFormat("en-US-u-ca-persian", {
                          year: "numeric", month: "numeric", day: "numeric",
                        }).formatToParts(ref);
                        const rg = (t: string) => parseInt(rp.find(p => p.type === t)?.value ?? "0");
                        const ry = rg("year"), rm = rg("month"), rd = rg("day");
                        const approx = Math.round(
                          (y - ry) * 365.25 + ((m - 1) * 30.5 + day) - ((rm - 1) * 30.5 + rd),
                        );
                        const base = new Date(ref);
                        base.setDate(base.getDate() + approx);
                        let found = base;
                        for (let offset = -8; offset <= 8; offset++) {
                          const test = new Date(base);
                          test.setDate(test.getDate() + offset);
                          const tp = new Intl.DateTimeFormat("en-US-u-ca-persian", {
                            year: "numeric", month: "numeric", day: "numeric",
                          }).formatToParts(test);
                          const tg = (t: string) => parseInt(tp.find(p => p.type === t)?.value ?? "0");
                          if (tg("year") === y && tg("month") === m && tg("day") === day) {
                            found = test; break;
                          }
                        }
                        field.onChange(Math.floor(found.getTime() / 1000));
                      }}
                      placeholder="انتخاب تاریخ سررسید..."
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="submit" disabled={createReminder.isPending}>ثبت یادآوری</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">یادآوری‌ها</h1>
        <p className="text-muted-foreground mt-1">مدیریت یادآوری‌ها و پیگیری‌ها</p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="birthday" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="birthday" className="gap-2">
            <Gift className="h-4 w-4" />
            یادآوری تولد
            {birthdays.length > 0 && (
              <Badge className="mr-1 h-5 min-w-5 px-1.5 text-xs bg-pink-500 text-white">
                {toPersianDigits(birthdays.length)}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="service" className="gap-2">
            <Scissors className="h-4 w-4" />
            یادآوری خدمات
            {serviceReminders.filter(r => r.status === "pending").length > 0 && (
              <Badge variant="secondary" className="mr-1 h-5 min-w-5 px-1.5 text-xs">
                {toPersianDigits(serviceReminders.filter(r => r.status === "pending").length)}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="other" className="gap-2">
            <LayoutList className="h-4 w-4" />
            سایر یادآوری‌ها
            {otherReminders.filter(r => r.status === "pending").length > 0 && (
              <Badge variant="secondary" className="mr-1 h-5 min-w-5 px-1.5 text-xs">
                {toPersianDigits(otherReminders.filter(r => r.status === "pending").length)}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Birthday ── */}
        <TabsContent value="birthday" className="space-y-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-muted-foreground">
                  تولدهای مراجعین در ۳۰ روز آینده — به‌صورت خودکار از اطلاعات مراجعین محاسبه می‌شود
                </p>
              </div>

              {loadingBirthdays ? (
                <div className="py-12 text-center text-muted-foreground text-sm">در حال بارگذاری...</div>
              ) : birthdays.length === 0 ? (
                <EmptyState icon={Gift} text="هیچ تولدی در ۳۰ روز آینده ثبت نشده — تاریخ تولد مراجعین را از صفحه مراجعین تکمیل کنید" />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {birthdays.map((b) => {
                    const isToday    = b.daysUntil === 0;
                    const isTomorrow = b.daysUntil === 1;
                    const isThisWeek = b.daysUntil <= 7;
                    return (
                      <div
                        key={b.patientId}
                        className={cn(
                          "flex items-center gap-3 p-4 rounded-xl border bg-card shadow-sm transition-colors",
                          isToday    && "border-pink-400 ring-2 ring-pink-300 bg-pink-50/40 dark:bg-pink-950/20",
                          isTomorrow && !isToday && "border-orange-300 bg-orange-50/30 dark:bg-orange-950/10",
                        )}
                      >
                        <div className={cn(
                          "w-12 h-12 rounded-full flex items-center justify-center text-2xl flex-shrink-0",
                          isToday    ? "bg-pink-500 shadow-md"
                          : isThisWeek ? "bg-pink-100 dark:bg-pink-900/40"
                          : "bg-muted",
                        )}>
                          🎂
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold truncate">{b.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {toPersianDigits(b.birthdayShamsiDay)}{" "}
                            {SHAMSI_MONTHS[b.birthdayShamsiMonth - 1]}
                          </p>
                          <p className={cn(
                            "text-xs font-semibold mt-1",
                            isToday    ? "text-pink-600 dark:text-pink-400"
                            : isTomorrow ? "text-orange-500"
                            : isThisWeek ? "text-amber-600"
                            : "text-muted-foreground",
                          )}>
                            {isToday
                              ? "🎉 امروز تولدشه!"
                              : isTomorrow
                              ? "⏰ فردا تولدشه"
                              : `${toPersianDigits(b.daysUntil)} روز دیگه`}
                          </p>
                        </div>
                        <div className="flex flex-col gap-1 flex-shrink-0">
                          <a
                            href={`tel:${b.phone}`}
                            title={`تماس با ${b.name}`}
                            className={cn(
                              "w-8 h-8 rounded-full flex items-center justify-center transition-colors",
                              "bg-muted hover:bg-primary hover:text-primary-foreground text-muted-foreground",
                            )}
                          >
                            <Phone className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {birthdays.length > 0 && (
                <p className="text-xs text-muted-foreground mt-4 flex items-center gap-1.5 border-t pt-3">
                  <Bell className="h-3 w-3" />
                  پیشنهاد: برای مراجعینی که تولدشون نزدیکه تبریک بگید یا یک تخفیف ویژه در نظر بگیرید
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 2: Service ── */}
        <TabsContent value="service" className="space-y-4">
          <div className="flex justify-end">
            <Button className="gap-2" onClick={() => openAddDialog("followup")}>
              <Plus className="h-4 w-4" />
              یادآوری خدمات جدید
            </Button>
          </div>

          {/* هشدار یک هفته مانده */}
          {(() => {
            const nowTs = Math.floor(Date.now() / 1000);
            const weekLater = nowTs + 7 * 86400;
            const urgent = serviceReminders.filter(
              r => r.status === "pending" && r.dueAt > nowTs && r.dueAt <= weekLater,
            );
            if (urgent.length === 0) return null;
            return (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-2">
                <div className="flex items-center gap-2 font-semibold text-amber-800 text-sm">
                  <Bell className="h-4 w-4" />
                  هشدار — {toPersianDigits(urgent.length)} یادآوری در کمتر از یک هفته آینده سررسید می‌شود
                </div>
                <div className="space-y-1.5">
                  {urgent.map(r => (
                    <div key={r.id} className="flex items-center justify-between text-sm bg-white rounded-lg px-3 py-2 border border-amber-200">
                      <span className="font-medium truncate flex-1">{r.title}</span>
                      <span className="text-amber-700 text-xs mr-3 flex-shrink-0">{formatShamsiDate(r.dueAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          <Card>
            <CardContent className="pt-4 space-y-2">
              {isLoading ? (
                <div className="py-12 text-center text-muted-foreground text-sm">در حال بارگذاری...</div>
              ) : serviceReminders.length === 0 ? (
                <EmptyState icon={Scissors} text="یادآوری خدماتی ثبت نشده — پیگیری بعد از خدمات و یادآوری نوبت‌های آینده را اینجا ثبت کنید" />
              ) : (
                serviceReminders.map(r => (
                  <ReminderRow
                    key={r.id} r={r}
                    onDone={handleDone}
                    onDelete={handleDelete}
                  />
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 3: Other ── */}
        <TabsContent value="other" className="space-y-4">
          <div className="flex justify-end">
            <Button className="gap-2" onClick={() => openAddDialog("custom")}>
              <Plus className="h-4 w-4" />
              یادآوری جدید
            </Button>
          </div>
          <Card>
            <CardContent className="pt-4 space-y-2">
              {isLoading ? (
                <div className="py-12 text-center text-muted-foreground text-sm">در حال بارگذاری...</div>
              ) : otherReminders.length === 0 ? (
                <EmptyState icon={LayoutList} text="یادآوری‌ای ثبت نشده" />
              ) : (
                otherReminders.map(r => (
                  <ReminderRow
                    key={r.id} r={r}
                    onDone={handleDone}
                    onDelete={handleDelete}
                  />
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
