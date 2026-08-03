import { useState, useMemo } from "react";
import { useListStaff, useCreateStaff, useUpdateStaff, useDeleteStaff, getListStaffQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Plus, Pencil, Trash2, Calculator } from "lucide-react";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Badge } from "@/components/ui/badge";
import { ErrorNotice } from "@/components/error-notice";
import { PersianDatePicker } from "@/components/persian-date-picker";
import { useRevenueRange } from "@/hooks/use-accounting";
import { formatCurrency, toPersianDigits } from "@/lib/format";

const formSchema = z.object({
  name: z.string().min(2, "نام الزامی است"),
  role: z.string().min(1, "سمت الزامی است"),
  phone: z.string().optional(),
  email: z.string().email("ایمیل معتبر نیست").optional().or(z.literal("")),
});
type FormValues = z.infer<typeof formSchema>;

export default function Staff() {
  const { data: staff, isLoading, isError, refetch } = useListStaff();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string } | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<NonNullable<typeof staff>[0] | null>(null);

  // ── ماشین حساب کمیسیون ──
  const [calcFrom, setCalcFrom] = useState("");
  const [calcTo, setCalcTo] = useState("");
  const [calcRate, setCalcRate] = useState("");
  const [queryEnabled, setQueryEnabled] = useState(false);

  const fromUnix = useMemo(() => calcFrom ? Math.floor(new Date(calcFrom).getTime() / 1000) : null, [calcFrom]);
  const toUnix = useMemo(() => calcTo ? Math.floor(new Date(calcTo).getTime() / 1000) + 86399 : null, [calcTo]);

  const { data: revenueData, isFetching, refetch: refetchRevenue } = useRevenueRange(
    queryEnabled ? fromUnix : null,
    queryEnabled ? toUnix : null,
  );

  const commission = useMemo(() => {
    if (!revenueData || !calcRate) return null;
    const rate = parseFloat(calcRate);
    if (isNaN(rate) || rate <= 0) return null;
    return Math.round(revenueData.revenue * rate / 100);
  }, [revenueData, calcRate]);

  const createStaff = useCreateStaff({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListStaffQueryKey() });
        setIsOpen(false);
        toast({ title: "کارمند با موفقیت ثبت شد" });
        form.reset();
      },
    },
  });

  const updateStaff = useUpdateStaff({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListStaffQueryKey() });
        setEditing(null);
        setIsOpen(false);
        toast({ title: "اطلاعات کارمند ویرایش شد" });
      },
    },
  });

  const deleteStaff = useDeleteStaff({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListStaffQueryKey() });
        toast({ title: "کارمند حذف شد" });
      },
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", role: "", phone: "", email: "" },
  });

  function openCreate() {
    setEditing(null);
    form.reset({ name: "", role: "", phone: "", email: "" });
    setIsOpen(true);
  }

  function openEdit(s: NonNullable<typeof staff>[0]) {
    setEditing(s);
    form.reset({ name: s.name, role: s.role ?? "", phone: s.phone ?? "", email: s.email ?? "" });
    setIsOpen(true);
  }

  function onSubmit(values: FormValues) {
    if (editing) {
      updateStaff.mutate({ id: editing.id, data: values });
    } else {
      createStaff.mutate({ data: values });
    }
  }

  return (
    <div className="space-y-6">
      <ConfirmDeleteDialog
        open={!!deleteTarget}
        title={`حذف ${deleteTarget?.label ?? ''}`}
        description={`آیا از حذف «${deleteTarget?.label ?? ''}» مطمئن هستید؟ این عمل قابل بازگشت نیست.`}
        onConfirm={() => { deleteStaff.mutate({ id: deleteTarget!.id }); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">کارمندان</h1>
          <p className="text-muted-foreground mt-1">مدیریت پرسنل مطب</p>
        </div>
        <Button className="gap-2" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          کارمند جدید
        </Button>
      </div>

      {isError && <ErrorNotice onRetry={() => refetch()} />}

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "ویرایش کارمند" : "ثبت کارمند جدید"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>نام کامل</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="role" render={({ field }) => (
                <FormItem>
                  <FormLabel>سمت</FormLabel>
                  <FormControl><Input placeholder="مثلا: متخصص پوست" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="phone" render={({ field }) => (
                  <FormItem>
                    <FormLabel>شماره تماس</FormLabel>
                    <FormControl><Input dir="ltr" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem>
                    <FormLabel>ایمیل</FormLabel>
                    <FormControl><Input dir="ltr" type="email" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createStaff.isPending || updateStaff.isPending}>
                  {editing ? "ذخیره تغییرات" : "ثبت کارمند"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── ماشین حساب کمیسیون ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Calculator className="h-4 w-4" />
            ماشین حساب کمیسیون
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">از تاریخ</label>
              <PersianDatePicker value={calcFrom} onChange={v => { setCalcFrom(v); setQueryEnabled(false); }} placeholder="از تاریخ" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">تا تاریخ</label>
              <PersianDatePicker value={calcTo} onChange={v => { setCalcTo(v); setQueryEnabled(false); }} placeholder="تا تاریخ" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">درصد کمیسیون</label>
              <div className="relative">
                <Input
                  type="number"
                  dir="ltr"
                  min={0}
                  max={100}
                  step={0.1}
                  placeholder="مثلاً ۲.۵"
                  value={calcRate}
                  onChange={e => setCalcRate(e.target.value)}
                  className="pl-8"
                />
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-bold">٪</span>
              </div>
            </div>
          </div>

          <Button
            onClick={() => { setQueryEnabled(true); setTimeout(() => refetchRevenue(), 0); }}
            disabled={!calcFrom || !calcTo || !calcRate || isFetching}
            className="gap-2"
          >
            <Calculator className="h-4 w-4" />
            {isFetching ? "در حال محاسبه..." : "محاسبه"}
          </Button>

          {revenueData && queryEnabled && (
            <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">درآمد کل بازه:</span>
                <span className="font-mono font-semibold text-base">{formatCurrency(revenueData.revenue)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">درصد انتخابی:</span>
                <span className="font-mono">{toPersianDigits(calcRate)}٪</span>
              </div>
              <div className="border-t pt-3 flex items-center justify-between">
                <span className="font-medium">کمیسیون قابل پرداخت:</span>
                <span className="font-mono font-bold text-lg text-primary">
                  {commission !== null ? formatCurrency(commission) : "—"}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>نام</TableHead>
                <TableHead>سمت</TableHead>
                <TableHead>شماره تماس</TableHead>
                <TableHead>ایمیل</TableHead>
                <TableHead>وضعیت</TableHead>
                <TableHead className="text-left">عملیات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {staff?.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>{s.role}</TableCell>
                  <TableCell className="font-mono text-sm">{s.phone || "-"}</TableCell>
                  <TableCell className="text-sm">{s.email || "-"}</TableCell>
                  <TableCell>
                    <Badge variant={s.isActive ? "default" : "outline"}>{s.isActive ? "فعال" : "غیرفعال"}</Badge>
                  </TableCell>
                  <TableCell className="text-left">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(s)}><Pencil className="h-3 w-3" /></Button>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteTarget({ id: s.id, label: s.name })}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && !staff?.length && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">کارمندی ثبت نشده</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
