import { useState } from "react";
import { useListCommissions, useCreateCommission, useUpdateCommission, useDeleteCommission, getListCommissionsQueryKey, useListStaff, useListCommissionRecipients } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatShamsiDate, toPersianDigits } from "@/lib/format";
import { Plus, CheckCircle, Trash2, Clock } from "lucide-react";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { ErrorNotice } from "@/components/error-notice";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Badge } from "@/components/ui/badge";

const formSchema = z.object({
  recipientType: z.enum(["staff", "external"]),
  recipientId: z.coerce.number().min(1, "دریافت‌کننده الزامی است"),
  amount: z.coerce.number().min(1, "مبلغ الزامی است"),
  rate: z.coerce.number().optional(),
  description: z.string().optional(),
});

export default function Commissions() {
  const { data: commissions, isLoading, isError, refetch } = useListCommissions({});
  const { data: staff } = useListStaff();
  const { data: recipients } = useListCommissionRecipients();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string } | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [recipientType, setRecipientType] = useState<"staff" | "external">("staff");

  const createCommission = useCreateCommission({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCommissionsQueryKey() });
        setIsOpen(false);
        toast({ title: "کمیسیون ثبت شد" });
        form.reset();
      },
    },
  });

  const updateCommission = useUpdateCommission({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCommissionsQueryKey() });
        toast({ title: "کمیسیون تسویه شد" });
      },
    },
  });

  const deleteCommission = useDeleteCommission({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCommissionsQueryKey() });
        toast({ title: "کمیسیون حذف شد" });
      },
    },
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { recipientType: "staff", recipientId: 0, amount: 0 },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    createCommission.mutate({ data: { ...values, status: "pending" } });
  }

  const totalUnpaid = commissions?.filter(c => !c.isPaid).reduce((s, c) => s + c.amount, 0) ?? 0;
  const totalPaid = commissions?.filter(c => c.isPaid).reduce((s, c) => s + c.amount, 0) ?? 0;

  function buildSummary(c: any) {
    const parts: string[] = [];
    if (c.amount) parts.push(formatCurrency(c.amount));
    if (c.description) parts.push(c.description);
    else {
      if (c.rate) parts.push(`${toPersianDigits(c.rate)}٪`);
      if (c.recipientName) parts.push(`${c.recipientName} (${c.recipientType === "staff" ? "پرسنل" : "خارجی"})`);
    }
    return parts.join(" — ");
  }

  return (
    <div className="space-y-6">
      <ConfirmDeleteDialog
        open={!!deleteTarget}
        title={`حذف ${deleteTarget?.label ?? ''}`}
        description={`آیا از حذف «${deleteTarget?.label ?? ''}» مطمئن هستید؟ این عمل قابل بازگشت نیست.`}
        onConfirm={() => { deleteCommission.mutate({ id: deleteTarget!.id }); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">کمیسیون</h1>
          <p className="text-muted-foreground mt-1">مدیریت پرداخت‌های کمیسیونی</p>
        </div>
        <Button className="gap-2" onClick={() => setIsOpen(true)}>
          <Plus className="h-4 w-4" />
          ثبت کمیسیون
        </Button>
      </div>

      {isError && <ErrorNotice onRetry={() => refetch()} />}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">پرداخت‌نشده</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{formatCurrency(totalUnpaid)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">تسویه‌شده</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{formatCurrency(totalPaid)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">تعداد کل</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{toPersianDigits(commissions?.length ?? 0)} رکورد</div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ثبت کمیسیون جدید</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="recipientType" render={({ field }) => (
                <FormItem>
                  <FormLabel>نوع دریافت‌کننده</FormLabel>
                  <Select onValueChange={(v) => { field.onChange(v); setRecipientType(v as "staff" | "external"); }} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="staff">پرسنل</SelectItem>
                      <SelectItem value="external">خارجی</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="recipientId" render={({ field }) => (
                <FormItem>
                  <FormLabel>دریافت‌کننده</FormLabel>
                  <Select onValueChange={(v) => field.onChange(Number(v))}>
                    <FormControl><SelectTrigger><SelectValue placeholder="انتخاب کنید" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {recipientType === "staff"
                        ? staff?.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)
                        : recipients?.map(r => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)
                      }
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="amount" render={({ field }) => (
                  <FormItem>
                    <FormLabel>مبلغ (تومان)</FormLabel>
                    <FormControl><Input type="number" dir="ltr" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="rate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>درصد (اختیاری)</FormLabel>
                    <FormControl><Input type="number" dir="ltr" {...field} /></FormControl>
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
              <DialogFooter>
                <Button type="submit" disabled={createCommission.isPending}>ثبت کمیسیون</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="pt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>خلاصه تراکنش</TableHead>
                <TableHead>دریافت‌کننده</TableHead>
                <TableHead>تاریخ</TableHead>
                <TableHead>وضعیت</TableHead>
                <TableHead className="text-left">عملیات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(commissions as any[])?.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="max-w-xs">
                    <div className="text-sm font-medium leading-relaxed">
                      {buildSummary(c)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-sm">{c.recipientName || "—"}</span>
                      <Badge variant="secondary" className="w-fit text-xs">
                        {c.recipientType === "staff" ? "پرسنل" : "خارجی"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{formatShamsiDate(c.createdAt)}</TableCell>
                  <TableCell>
                    {c.isPaid
                      ? <Badge className="bg-green-100 text-green-700 gap-1"><CheckCircle className="h-3 w-3" />تسویه‌شده</Badge>
                      : <Badge variant="outline" className="text-orange-600 gap-1"><Clock className="h-3 w-3" />پرداخت‌نشده</Badge>
                    }
                  </TableCell>
                  <TableCell className="text-left">
                    <div className="flex gap-1 justify-end">
                      {!c.isPaid && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-green-700 border-green-300 hover:bg-green-50 text-xs"
                          onClick={() => updateCommission.mutate({ id: c.id, data: { isPaid: true } })}
                        >
                          <CheckCircle className="h-3 w-3 ml-1" />
                          تسویه
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteTarget({ id: c.id, label: `کمیسیون ${formatCurrency(c.amount)}` })}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && !commissions?.length && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">کمیسیونی ثبت نشده</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
