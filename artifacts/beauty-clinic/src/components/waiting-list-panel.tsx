import { useState } from "react";
import {
  useListWaitingList, useCreateWaitingEntry, useUpdateWaitingEntry, useDeleteWaitingEntry,
  useNotifyWaitingEntry, getListWaitingListQueryKey, useListServices,
  type WaitingEntry,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ErrorNotice } from "@/components/error-notice";
import { TierBadge } from "@/components/tier-badge";
import { SortableHead } from "@/components/sortable-head";
import { useTableSort } from "@/hooks/use-table-sort";
import { PersianDatePicker } from "@/components/persian-date-picker";
import { formatShamsiDate, toPersianDigits } from "@/lib/format";
import { PatientSearchSelect } from "@/components/patient-search-select";
import { useToast } from "@/hooks/use-toast";
import { toastApiError } from "@/lib/api-error";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Trash2, MessageSquare, CalendarPlus } from "lucide-react";

// وضعیت‌های لیست انتظار
export const waitingStatuses: Record<string, { label: string; color: string }> = {
  waiting:   { label: "در انتظار",     color: "bg-amber-100 text-amber-700 border-amber-200" },
  fulfilled: { label: "تبدیل به نوبت", color: "bg-green-100 text-green-700 border-green-200" },
  cancelled: { label: "لغو شده",       color: "bg-red-100 text-red-700 border-red-200" },
};

// تبدیل «YYYY-MM-DD» میلادی (قرارداد PersianDatePicker) به ثانیه یونیکس ظهر همان روز
export function dateStrToSec(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.floor(new Date(y, m - 1, d, 12, 0, 0).getTime() / 1000);
}

// ثانیه/میلی‌ثانیه یونیکس → «YYYY-MM-DD» برای PersianDatePicker
export function secToDateStr(ts: number): string {
  const d = new Date(ts > 1e11 ? ts : ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// بازه تاریخ دلخواه به‌صورت شمسی برای نمایش در جدول
export function formatPreferredRange(entry: Pick<WaitingEntry, "preferredFrom" | "preferredTo">): string {
  if (!entry.preferredFrom && !entry.preferredTo) return "—";
  const from = entry.preferredFrom ? formatShamsiDate(entry.preferredFrom) : null;
  const to = entry.preferredTo ? formatShamsiDate(entry.preferredTo) : null;
  if (from && to && from !== to) return `${from} تا ${to}`;
  return from ?? to ?? "—";
}

const entrySchema = z.object({
  patientId: z.coerce.number().min(1, "مراجع را انتخاب کنید"),
  serviceId: z.coerce.number().min(1, "خدمت را انتخاب کنید"),
  preferredFrom: z.string().default(""),
  preferredTo: z.string().default(""),
  note: z.string().default(""),
});
type EntryFormValues = z.infer<typeof entrySchema>;

type Props = {
  onConvert: (entry: WaitingEntry) => void;
};

export function WaitingListPanel({ onConvert }: Props) {
  const [statusFilter, setStatusFilter] = useState<string>("waiting");
  const [isOpen, setIsOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<WaitingEntry | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [notifyingId, setNotifyingId] = useState<number | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListWaitingListQueryKey() });

  const { data: list, isError, refetch } = useListWaitingList(
    statusFilter === "all" ? undefined : { status: statusFilter },
  );
  const { data: services } = useListServices();

  const createEntry = useCreateWaitingEntry({
    mutation: {
      onSuccess: () => {
        invalidate();
        setIsOpen(false);
        toast({ title: "به لیست انتظار اضافه شد" });
      },
      onError: (e) => toastApiError(e, "افزودن به لیست انتظار ناموفق بود"),
    },
  });

  const updateEntry = useUpdateWaitingEntry({
    mutation: {
      onSuccess: () => {
        invalidate();
        setEditEntry(null);
        setIsOpen(false);
        toast({ title: "لیست انتظار به‌روزرسانی شد" });
      },
      onError: (e) => toastApiError(e, "به‌روزرسانی ناموفق بود"),
    },
  });

  const deleteEntry = useDeleteWaitingEntry({
    mutation: {
      onSuccess: () => {
        invalidate();
        setConfirmDeleteId(null);
        toast({ title: "از لیست انتظار حذف شد" });
      },
      onError: (e) => toastApiError(e, "حذف ناموفق بود"),
    },
  });

  const notifyEntry = useNotifyWaitingEntry({
    mutation: {
      onSuccess: (result) => {
        if (result.ok) {
          toast({ title: "پیامک اطلاع‌رسانی جای خالی ارسال شد" });
        } else {
          toast({ title: "ارسال پیامک ناموفق بود", description: result.error ?? undefined, variant: "destructive" });
        }
      },
      onError: (e) => toastApiError(e, "ارسال پیامک ناموفق بود"),
      onSettled: () => setNotifyingId(null),
    },
  });

  const form = useForm<EntryFormValues>({
    resolver: zodResolver(entrySchema),
    defaultValues: { patientId: 0, serviceId: 0, preferredFrom: "", preferredTo: "", note: "" },
  });

  function openAdd() {
    setEditEntry(null);
    form.reset({ patientId: 0, serviceId: 0, preferredFrom: "", preferredTo: "", note: "" });
    setIsOpen(true);
  }

  function openEdit(entry: WaitingEntry) {
    setEditEntry(entry);
    form.reset({
      patientId: entry.patientId,
      serviceId: entry.serviceId,
      preferredFrom: entry.preferredFrom ? secToDateStr(entry.preferredFrom) : "",
      preferredTo: entry.preferredTo ? secToDateStr(entry.preferredTo) : "",
      note: entry.note ?? "",
    });
    setIsOpen(true);
  }

  function onSubmit(values: EntryFormValues) {
    const payload = {
      patientId: values.patientId,
      serviceId: values.serviceId,
      preferredFrom: values.preferredFrom ? dateStrToSec(values.preferredFrom) : undefined,
      preferredTo: values.preferredTo ? dateStrToSec(values.preferredTo) : undefined,
      note: values.note.trim() || undefined,
    };
    if (editEntry) {
      updateEntry.mutate({
        id: editEntry.id,
        data: {
          ...payload,
          preferredFrom: payload.preferredFrom ?? null,
          preferredTo: payload.preferredTo ?? null,
          note: payload.note ?? null,
        },
      });
    } else {
      createEntry.mutate({ data: payload });
    }
  }

  function handleNotify(entry: WaitingEntry) {
    setNotifyingId(entry.id);
    notifyEntry.mutate({ id: entry.id });
  }

  const rows = list?.data ?? [];
  const sort = useTableSort(rows, {
    patient: (e: WaitingEntry) => e.patientName,
    service: (e: WaitingEntry) => e.serviceName,
    range: (e: WaitingEntry) => e.preferredFrom || e.preferredTo || null,
    note: (e: WaitingEntry) => e.note,
    createdAt: (e: WaitingEntry) => e.createdAt,
    status: (e: WaitingEntry) => waitingStatuses[e.status]?.label ?? e.status,
  });

  return (
    <Card>
      <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="در انتظار" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="waiting">⏳ در انتظار (پیش‌فرض)</SelectItem>
            <SelectItem value="all">همه موارد</SelectItem>
            <SelectItem value="fulfilled">تبدیل به نوبت</SelectItem>
            <SelectItem value="cancelled">لغو شده</SelectItem>
          </SelectContent>
        </Select>
        <Button className="gap-2" onClick={openAdd} data-testid="add-waiting-entry">
          <Plus className="h-4 w-4" />
          افزودن به لیست انتظار
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {isError && <div className="p-4"><ErrorNotice onRetry={() => refetch()} /></div>}
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead {...sort.head("patient")}>مراجع</SortableHead>
              <SortableHead {...sort.head("service")}>خدمت</SortableHead>
              <SortableHead {...sort.head("range")}>بازه تاریخ دلخواه</SortableHead>
              <SortableHead {...sort.head("note")}>یادداشت</SortableHead>
              <SortableHead {...sort.head("createdAt")}>تاریخ ثبت</SortableHead>
              <SortableHead {...sort.head("status")}>وضعیت</SortableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sort.sorted.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-1.5">
                    {entry.patientName}
                    <TierBadge tier={entry.patientTier} />
                  </span>
                  <span className="block text-xs text-muted-foreground">{entry.patientPhone ? toPersianDigits(entry.patientPhone) : ""}</span>
                </TableCell>
                <TableCell>{entry.serviceName}</TableCell>
                <TableCell className="text-sm">{formatPreferredRange(entry)}</TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{entry.note || "—"}</TableCell>
                <TableCell className="text-sm">{formatShamsiDate(entry.createdAt)}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={`text-xs font-normal ${waitingStatuses[entry.status]?.color ?? "bg-gray-100 text-gray-600"}`}>
                    {waitingStatuses[entry.status]?.label ?? entry.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1 justify-end">
                    {entry.status === "waiting" && (
                      <>
                        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" title="ثبت نوبت برای این مراجع"
                          onClick={() => onConvert(entry)} data-testid={`convert-${entry.id}`}>
                          <CalendarPlus className="h-3.5 w-3.5" />
                          ثبت نوبت
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" title="اطلاع‌رسانی جای خالی با پیامک"
                          disabled={notifyingId === entry.id}
                          onClick={() => handleNotify(entry)} data-testid={`notify-${entry.id}`}>
                          <MessageSquare className="h-3.5 w-3.5" />
                          {notifyingId === entry.id ? "در حال ارسال..." : "اطلاع‌رسانی جای خالی"}
                        </Button>
                      </>
                    )}
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => openEdit(entry)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => setConfirmDeleteId(entry.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  {statusFilter === "waiting" ? "کسی در لیست انتظار نیست" : "موردی یافت نشد"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      {/* Add / edit dialog */}
      <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) setEditEntry(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editEntry ? "ویرایش مورد لیست انتظار" : "افزودن به لیست انتظار"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="patientId" render={({ field }) => (
                <FormItem>
                  <FormLabel>مراجع</FormLabel>
                  <FormControl>
                    <PatientSearchSelect value={field.value} onChange={(id) => field.onChange(id ?? 0)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="serviceId" render={({ field }) => (
                <FormItem>
                  <FormLabel>خدمت</FormLabel>
                  <Select onValueChange={(val) => field.onChange(Number(val))} value={field.value ? String(field.value) : ""}>
                    <FormControl><SelectTrigger><SelectValue placeholder="انتخاب خدمت" /></SelectTrigger></FormControl>
                    <SelectContent>{services?.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="preferredFrom" render={({ field }) => (
                  <FormItem>
                    <FormLabel>از تاریخ (اختیاری)</FormLabel>
                    <FormControl><PersianDatePicker value={field.value} onChange={field.onChange} placeholder="از تاریخ" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="preferredTo" render={({ field }) => (
                  <FormItem>
                    <FormLabel>تا تاریخ (اختیاری)</FormLabel>
                    <FormControl><PersianDatePicker value={field.value} onChange={field.onChange} placeholder="تا تاریخ" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="note" render={({ field }) => (
                <FormItem>
                  <FormLabel>یادداشت (اختیاری)</FormLabel>
                  <FormControl><Input placeholder="مثال: فقط بعدازظهرها" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <DialogFooter>
                <Button type="submit" disabled={createEntry.isPending || updateEntry.isPending} className="w-full">
                  {createEntry.isPending || updateEntry.isPending
                    ? "در حال ذخیره..."
                    : editEntry ? "ذخیره تغییرات" : "افزودن به لیست انتظار"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={confirmDeleteId !== null} onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تأیید حذف</AlertDialogTitle>
            <AlertDialogDescription>
              آیا مطمئن هستید که می‌خواهید این مورد را از لیست انتظار حذف کنید؟ این عملیات قابل بازگشت نیست.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteEntry.isPending}
              onClick={() => { if (confirmDeleteId !== null) deleteEntry.mutate({ id: confirmDeleteId }); }}
            >
              {deleteEntry.isPending ? "در حال حذف..." : "حذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
