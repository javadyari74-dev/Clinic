import { useState, useCallback } from "react";
import {
  useListAppointments, useCreateAppointment, useUpdateAppointment, useDeleteAppointment,
  getListAppointmentsQueryKey, useListPatients, useListServices, useListStaff,
  getGetAppointmentQueryOptions,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ErrorNotice } from "@/components/error-notice";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatShamsiDate, formatCurrency, toPersianDigits } from "@/lib/format";
import { Check, ChevronsUpDown, Plus, Pencil, Trash2 } from "lucide-react";
import { TierBadge } from "@/components/tier-badge";
import { PersianDatePicker } from "@/components/persian-date-picker";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/hooks/use-auth";

const ACTIVE_STATUSES = ["scheduled", "confirmed"];

const statuses: Record<string, { label: string; color: string }> = {
  scheduled:   { label: "رزرو شده",   color: "bg-blue-100 text-blue-700 border-blue-200" },
  confirmed:   { label: "تایید شده",  color: "bg-cyan-100 text-cyan-700 border-cyan-200" },
  completed:   { label: "تکمیل شده", color: "bg-green-100 text-green-700 border-green-200" },
  cancelled:   { label: "لغو شده",   color: "bg-red-100 text-red-700 border-red-200" },
};

const formSchema = z.object({
  patientId: z.coerce.number().min(1, "مراجع را انتخاب کنید"),
  serviceId: z.coerce.number().min(1, "خدمت را انتخاب کنید"),
  date: z.string().min(1, "تاریخ را وارد کنید"),
  time: z.string().default("09:00"),
  hasDeposit: z.boolean().default(false),
  depositAmount: z.coerce.number().min(0).default(0),
});
type FormValues = z.infer<typeof formSchema>;

const editSchema = z.object({
  date: z.string().min(1, "تاریخ را وارد کنید"),
  time: z.string().default("09:00"),
  serviceId: z.coerce.number().min(1, "خدمت را انتخاب کنید"),
  staffId: z.coerce.number().optional(),
  status: z.string().min(1, "وضعیت را انتخاب کنید"),
});
type EditFormValues = z.infer<typeof editSchema>;

function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateTimeToMs(date: string, time: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute).getTime();
}

function toMs(ts: number): number {
  return ts > 1e11 ? ts : ts * 1000;
}

function tsToDateStr(ts: number): string {
  const d = new Date(toMs(ts));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function tsToTimeStr(ts: number): string {
  const d = new Date(toMs(ts));
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

async function bulkDeleteAppointments(ids: number[]): Promise<void> {
  const token = localStorage.getItem("clinic_auth_token");
  const res = await fetch("/api/appointments/bulk", {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error("خطا در حذف دسته‌جمعی");
}

type AppRow = {
  id: number;
  scheduledAt: number;
  patientName?: string | null;
  patientTier?: string | null;
  serviceName?: string | null;
  sessionNumber?: number | null;
  deposit?: number | null;
  status: string;
  staffName?: string | null;
  serviceId: number;
  staffId?: number | null;
};

type RowProps = {
  app: AppRow;
  isAdmin: boolean;
  selected: Set<number>;
  onToggle: (id: number) => void;
  onEdit: (app: AppRow) => void;
  onDelete: (id: number) => void;
  onStatusChange: (id: number, status: string) => void;
  onPrefetch: (id: number) => void;
};

function AppointmentRow({ app, isAdmin, selected, onToggle, onEdit, onDelete, onStatusChange, onPrefetch }: RowProps) {
  return (
    <TableRow
      className={selected.has(app.id) ? "bg-muted/50" : undefined}
      onMouseEnter={() => onPrefetch(app.id)}
      onFocus={() => onPrefetch(app.id)}
    >
      {isAdmin && (
        <TableCell className="w-10 pr-4">
          <Checkbox checked={selected.has(app.id)} onCheckedChange={() => onToggle(app.id)} aria-label="انتخاب" />
        </TableCell>
      )}
      <TableCell className="text-sm">{formatShamsiDate(app.scheduledAt, true)}</TableCell>
      <TableCell className="font-medium">
        <span className="flex items-center gap-1.5">
          {app.patientName}
          <TierBadge tier={app.patientTier} />
        </span>
      </TableCell>
      <TableCell>{app.serviceName}</TableCell>
      <TableCell>
        {app.sessionNumber
          ? <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 font-bold text-xs">#{toPersianDigits(app.sessionNumber)}</Badge>
          : <span className="text-muted-foreground text-xs">—</span>}
      </TableCell>
      <TableCell className="text-sm">
        {app.deposit && app.deposit > 0
          ? <span className="text-green-700 font-medium">{formatCurrency(app.deposit)}</span>
          : <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell>
        <Select value={app.status} onValueChange={(val) => onStatusChange(app.id, val)}>
          <SelectTrigger className="h-7 w-36 text-xs border-0 shadow-none p-0 focus:ring-0 gap-1">
            <Badge variant="outline" className={`text-xs font-normal cursor-pointer ${statuses[app.status]?.color ?? "bg-gray-100 text-gray-600"}`}>
              {statuses[app.status]?.label ?? app.status}
            </Badge>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(statuses).map(([key, { label, color }]) => (
              <SelectItem key={key} value={key}>
                <span className={`inline-block px-2 py-0.5 rounded text-xs ${color}`}>{label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{app.staffName || "—"}</TableCell>
      {isAdmin && (
        <TableCell>
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => onEdit(app)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => onDelete(app.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </TableCell>
      )}
    </TableRow>
  );
}

type HeaderProps = { ids: number[]; isAdmin: boolean; selected: Set<number>; onToggleAll: (ids: number[]) => void };

function AppTableHeader({ ids, isAdmin, selected, onToggleAll }: HeaderProps) {
  return (
    <TableHeader>
      <TableRow>
        {isAdmin && (
          <TableHead className="w-10 pr-4">
            <Checkbox
              checked={ids.length > 0 && ids.every(id => selected.has(id))}
              onCheckedChange={() => onToggleAll(ids)}
              aria-label="انتخاب همه"
            />
          </TableHead>
        )}
        <TableHead>زمان</TableHead>
        <TableHead>مراجع</TableHead>
        <TableHead>خدمت</TableHead>
        <TableHead>جلسه</TableHead>
        <TableHead>بیعانه</TableHead>
        <TableHead>وضعیت</TableHead>
        <TableHead>پرسنل</TableHead>
        {isAdmin && <TableHead />}
      </TableRow>
    </TableHeader>
  );
}

export default function Appointments() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [isOpen, setIsOpen] = useState(false);
  const [patientComboOpen, setPatientComboOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<number[] | null>(null);
  const [editAppt, setEditAppt] = useState<AppRow | null>(null);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const { data: rawList, isError, refetch } = useListAppointments({ status: (statusFilter === "all" || statusFilter === "active") ? undefined : statusFilter as any });
  const { data: allAppointments } = useListAppointments({ limit: 500 } as any);

  const appointmentsList = statusFilter === "active"
    ? { ...rawList, data: (rawList?.data ?? []).filter(a => ACTIVE_STATUSES.includes(a.status)) }
    : rawList;

  const historyList = [...(allAppointments?.data ?? [])].sort((a, b) =>
    (b.scheduledAt ?? 0) - (a.scheduledAt ?? 0)
  );

  const { data: patients } = useListPatients();
  const { data: services } = useListServices();
  const { data: staff } = useListStaff();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
  }, [queryClient]);

  const prefetchAppointment = useCallback((id: number) => {
    queryClient.prefetchQuery({ ...getGetAppointmentQueryOptions(id), staleTime: 30_000 });
  }, [queryClient]);

  const createAppointment = useCreateAppointment({
    mutation: {
      onSuccess: () => {
        invalidate();
        setIsOpen(false);
        toast({ title: "نوبت با موفقیت ثبت شد" });
        form.reset({ date: todayString(), time: "09:00", hasDeposit: false, depositAmount: 0, patientId: 0, serviceId: 0 });
      },
      onError: (error) => {
        const serverMessage =
          (error as any)?.data?.error ?? (error as any)?.data?.message;
        toast({
          title: "ثبت نوبت ناموفق بود",
          description:
            typeof serverMessage === "string" && serverMessage.trim()
              ? serverMessage
              : "ثبت نوبت با خطا مواجه شد. لطفاً دوباره تلاش کنید.",
          variant: "destructive",
        });
      },
    },
  });

  const updateAppointment = useUpdateAppointment({
    mutation: {
      onSuccess: (_, vars) => {
        invalidate();
        const isEdit = !!(vars.data as any).scheduledAt || (vars.data as any).serviceId;
        if (isEdit) {
          toast({ title: "نوبت با موفقیت ویرایش شد" });
          setEditAppt(null);
        } else {
          const newStatus = (vars.data as any).status;
          toast({ title: `وضعیت نوبت به «${statuses[newStatus]?.label ?? newStatus}» تغییر کرد` });
        }
      },
    },
  });

  const deleteAppointment = useDeleteAppointment({
    mutation: {
      onSuccess: () => {
        invalidate();
        setSelected(prev => { const s = new Set(prev); if (confirmDeleteIds) confirmDeleteIds.forEach(id => s.delete(id)); return s; });
        toast({ title: "نوبت حذف شد" });
        setConfirmDeleteIds(null);
      },
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { patientId: 0, serviceId: 0, date: todayString(), time: "09:00", hasDeposit: false, depositAmount: 0 },
  });

  const editForm = useForm<EditFormValues>({ resolver: zodResolver(editSchema) });

  const hasDeposit = form.watch("hasDeposit");

  function onSubmit(values: FormValues) {
    createAppointment.mutate({
      data: {
        patientId: values.patientId,
        serviceId: values.serviceId,
        scheduledAt: dateTimeToMs(values.date, values.time),
        deposit: values.hasDeposit && values.depositAmount > 0 ? values.depositAmount : undefined,
      },
    });
  }

  function openEdit(app: AppRow) {
    setEditAppt(app);
    editForm.reset({
      date: tsToDateStr(app.scheduledAt),
      time: tsToTimeStr(app.scheduledAt),
      serviceId: app.serviceId,
      staffId: app.staffId ?? undefined,
      status: app.status,
    });
  }

  function onEditSubmit(values: EditFormValues) {
    if (!editAppt) return;
    updateAppointment.mutate({
      id: editAppt.id,
      data: {
        scheduledAt: dateTimeToMs(values.date, values.time),
        serviceId: values.serviceId,
        staffId: values.staffId ?? null,
        status: values.status,
      },
    });
  }

  function handleStatusChange(id: number, status: string) {
    updateAppointment.mutate({ id, data: { status } });
  }

  const toggleSelect = useCallback((id: number) => {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }, []);

  const toggleSelectAll = useCallback((ids: number[]) => {
    setSelected(prev => {
      const allSel = ids.every(id => prev.has(id));
      const s = new Set(prev);
      ids.forEach(id => allSel ? s.delete(id) : s.add(id));
      return s;
    });
  }, []);

  async function handleBulkDelete(ids: number[]) {
    setIsBulkDeleting(true);
    try {
      await bulkDeleteAppointments(ids);
      setSelected(prev => { const s = new Set(prev); ids.forEach(id => s.delete(id)); return s; });
      invalidate();
      toast({ title: `${toPersianDigits(ids.length)} نوبت حذف شدند` });
    } catch {
      toast({ title: "خطا در حذف دسته‌جمعی", variant: "destructive" });
    } finally {
      setIsBulkDeleting(false);
      setConfirmDeleteIds(null);
    }
  }

  const rowProps = { isAdmin, selected, onToggle: toggleSelect, onEdit: openEdit, onDelete: (id: number) => setConfirmDeleteIds([id]), onStatusChange: handleStatusChange, onPrefetch: prefetchAppointment };
  const activeIds = (appointmentsList?.data ?? []).map(a => a.id);
  const historyIds = historyList.map(a => a.id);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">نوبت‌ها</h1>
          <p className="text-muted-foreground mt-1">مدیریت نوبت‌های مطب</p>
        </div>
        <Button className="gap-2" onClick={() => setIsOpen(true)}>
          <Plus className="h-4 w-4" />
          نوبت جدید
        </Button>
      </div>

      {isError && <ErrorNotice onRetry={() => refetch()} />}

      {/* Admin bulk action bar */}
      {isAdmin && selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/60 px-4 py-2.5">
          <span className="text-sm font-medium">{toPersianDigits(selected.size)} نوبت انتخاب‌شده</span>
          <Button size="sm" variant="destructive" className="gap-1.5 h-8" disabled={isBulkDeleting}
            onClick={() => setConfirmDeleteIds([...selected])}>
            <Trash2 className="h-3.5 w-3.5" />
            حذف انتخاب‌شده‌ها
          </Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => setSelected(new Set())}>لغو انتخاب</Button>
        </div>
      )}

      {/* New appointment dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>ثبت نوبت جدید</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="patientId" render={({ field }) => {
                const sel = patients?.data.find(p => p.id === field.value);
                return (
                  <FormItem>
                    <FormLabel>مراجع</FormLabel>
                    <Popover open={patientComboOpen} onOpenChange={setPatientComboOpen} modal>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button variant="outline" role="combobox" className={cn("w-full justify-between font-normal", !sel && "text-muted-foreground")}>
                            {sel ? <span>{sel.name} <span className="text-muted-foreground text-xs mr-1">({sel.fileNumber})</span></span> : "جستجو با نام، شماره پرونده یا تماس..."}
                            <ChevronsUpDown className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-[380px] p-0" align="start">
                        <Command filter={(value, search) => {
                          const p = patients?.data.find(p => String(p.id) === value);
                          if (!p) return 0;
                          return `${p.name} ${p.fileNumber} ${p.phone}`.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
                        }}>
                          <CommandInput placeholder="نام، شماره پرونده یا تماس..." />
                          <CommandList>
                            <CommandEmpty>مراجعی یافت نشد</CommandEmpty>
                            <CommandGroup>
                              {patients?.data.map(p => (
                                <CommandItem key={p.id} value={String(p.id)} onSelect={(val) => { field.onChange(Number(val)); setPatientComboOpen(false); }}>
                                  <Check className={cn("ml-2 h-4 w-4", field.value === p.id ? "opacity-100" : "opacity-0")} />
                                  <div className="flex flex-col">
                                    <span className="font-medium">{p.name}</span>
                                    <span className="text-xs text-muted-foreground">پرونده: {p.fileNumber} | {p.phone}</span>
                                  </div>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                );
              }} />

              <FormField control={form.control} name="serviceId" render={({ field }) => (
                <FormItem>
                  <FormLabel>خدمت</FormLabel>
                  <Select onValueChange={(val) => field.onChange(Number(val))} value={field.value ? String(field.value) : undefined}>
                    <FormControl><SelectTrigger><SelectValue placeholder="انتخاب خدمت" /></SelectTrigger></FormControl>
                    <SelectContent>{services?.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="date" render={({ field }) => (
                  <FormItem>
                    <FormLabel>تاریخ نوبت</FormLabel>
                    <FormControl><PersianDatePicker value={field.value} onChange={field.onChange} placeholder="انتخاب تاریخ نوبت" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="time" render={({ field }) => (
                  <FormItem>
                    <FormLabel>ساعت</FormLabel>
                    <FormControl><Input type="time" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="deposit-switch" className="font-medium cursor-pointer">پرداخت بیعانه</Label>
                  <FormField control={form.control} name="hasDeposit" render={({ field }) => (
                    <Switch id="deposit-switch" checked={field.value} onCheckedChange={field.onChange} />
                  )} />
                </div>
                {hasDeposit && (
                  <FormField control={form.control} name="depositAmount" render={({ field }) => (
                    <FormItem>
                      <FormLabel>مبلغ بیعانه (تومان)</FormLabel>
                      <FormControl><Input type="number" min={0} placeholder="مثال: ۵۰۰۰۰۰" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}
              </div>

              <DialogFooter>
                <Button type="submit" disabled={createAppointment.isPending} className="w-full">
                  {createAppointment.isPending ? "در حال ثبت..." : "ثبت نوبت"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Edit dialog (admin only) */}
      <Dialog open={!!editAppt} onOpenChange={(open) => { if (!open) setEditAppt(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>ویرایش نوبت</DialogTitle></DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField control={editForm.control} name="date" render={({ field }) => (
                  <FormItem>
                    <FormLabel>تاریخ نوبت</FormLabel>
                    <FormControl><PersianDatePicker value={field.value} onChange={field.onChange} placeholder="انتخاب تاریخ" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="time" render={({ field }) => (
                  <FormItem>
                    <FormLabel>ساعت</FormLabel>
                    <FormControl><Input type="time" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={editForm.control} name="serviceId" render={({ field }) => (
                <FormItem>
                  <FormLabel>خدمت</FormLabel>
                  <Select onValueChange={(val) => field.onChange(Number(val))} value={field.value ? String(field.value) : undefined}>
                    <FormControl><SelectTrigger><SelectValue placeholder="انتخاب خدمت" /></SelectTrigger></FormControl>
                    <SelectContent>{services?.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={editForm.control} name="staffId" render={({ field }) => (
                <FormItem>
                  <FormLabel>پرسنل</FormLabel>
                  <Select onValueChange={(val) => field.onChange(val === "none" ? undefined : Number(val))} value={field.value ? String(field.value) : "none"}>
                    <FormControl><SelectTrigger><SelectValue placeholder="انتخاب پرسنل" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="none">— بدون پرسنل</SelectItem>
                      {(Array.isArray(staff) ? staff : (staff as any)?.data ?? []).map((s: any) => (
                        <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={editForm.control} name="status" render={({ field }) => (
                <FormItem>
                  <FormLabel>وضعیت</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="انتخاب وضعیت" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {Object.entries(statuses).map(([key, { label }]) => (
                        <SelectItem key={key} value={key}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={() => setEditAppt(null)}>انصراف</Button>
                <Button type="submit" disabled={updateAppointment.isPending}>
                  {updateAppointment.isPending ? "در حال ذخیره..." : "ذخیره تغییرات"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!confirmDeleteIds} onOpenChange={(open) => { if (!open) setConfirmDeleteIds(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تأیید حذف</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDeleteIds?.length === 1
                ? "آیا مطمئن هستید که می‌خواهید این نوبت را حذف کنید؟ این عملیات قابل بازگشت نیست."
                : `آیا مطمئن هستید که می‌خواهید ${toPersianDigits(confirmDeleteIds?.length ?? 0)} نوبت انتخاب‌شده را حذف کنید؟ این عملیات قابل بازگشت نیست.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteAppointment.isPending || isBulkDeleting}
              onClick={() => {
                if (!confirmDeleteIds) return;
                if (confirmDeleteIds.length === 1) deleteAppointment.mutate({ id: confirmDeleteIds[0] });
                else handleBulkDelete(confirmDeleteIds);
              }}
            >
              {(deleteAppointment.isPending || isBulkDeleting) ? "در حال حذف..." : "حذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Tabs */}
      <Tabs defaultValue="active">
        <TabsList className="mb-4">
          <TabsTrigger value="active">نوبت‌های فعال</TabsTrigger>
          <TabsTrigger value="history">تاریخچه نوبت‌ها</TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          <Card>
            <CardHeader className="pb-3">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="نوبت‌های فعال" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">⏳ نوبت‌های فعال (پیش‌فرض)</SelectItem>
                  <SelectItem value="all">همه نوبت‌ها</SelectItem>
                  {Object.entries(statuses).map(([key, { label }]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <AppTableHeader ids={activeIds} isAdmin={isAdmin} selected={selected} onToggleAll={toggleSelectAll} />
                <TableBody>
                  {(appointmentsList?.data ?? []).map(app => <AppointmentRow key={app.id} app={app as AppRow} {...rowProps} />)}
                  {!appointmentsList?.data?.length && (
                    <TableRow><TableCell colSpan={isAdmin ? 9 : 7} className="text-center py-8 text-muted-foreground">نوبتی یافت نشد</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardContent className="p-0">
              <Table>
                <AppTableHeader ids={historyIds} isAdmin={isAdmin} selected={selected} onToggleAll={toggleSelectAll} />
                <TableBody>
                  {historyList.map(app => <AppointmentRow key={app.id} app={app as AppRow} {...rowProps} />)}
                  {!historyList.length && (
                    <TableRow><TableCell colSpan={isAdmin ? 9 : 7} className="text-center py-8 text-muted-foreground">تاریخچه‌ای یافت نشد</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
