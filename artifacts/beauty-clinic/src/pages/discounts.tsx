import { useState } from "react";
import { useListDiscounts, useCreateDiscount, useUpdateDiscount, useDeleteDiscount, getListDiscountsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, toPersianDigits } from "@/lib/format";
import { Plus, Pencil, Trash2, Tag } from "lucide-react";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { ErrorNotice } from "@/components/error-notice";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Badge } from "@/components/ui/badge";

const formSchema = z.object({
  name: z.string().min(2, "نام الزامی است"),
  code: z.string().min(2, "کد الزامی است"),
  type: z.enum(["percentage", "fixed"]),
  value: z.coerce.number().min(1, "مقدار الزامی است"),
  minAmount: z.coerce.number().optional(),
  usageLimit: z.coerce.number().optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
});
type FormValues = z.infer<typeof formSchema>;

export default function Discounts() {
  const { data: discounts, isLoading, isError, refetch } = useListDiscounts();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string } | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<NonNullable<typeof discounts>[0] | null>(null);

  const createDiscount = useCreateDiscount({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListDiscountsQueryKey() });
        setIsOpen(false);
        toast({ title: "تخفیف با موفقیت ثبت شد" });
        form.reset();
      },
    },
  });

  const updateDiscount = useUpdateDiscount({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListDiscountsQueryKey() });
        setEditing(null);
        setIsOpen(false);
        toast({ title: "تخفیف ویرایش شد" });
      },
    },
  });

  const deleteDiscount = useDeleteDiscount({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListDiscountsQueryKey() });
        toast({ title: "تخفیف حذف شد" });
      },
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", code: "", type: "percentage", value: 10, isActive: true },
  });

  function openCreate() {
    setEditing(null);
    form.reset({ name: "", code: "", type: "percentage", value: 10, isActive: true });
    setIsOpen(true);
  }

  function openEdit(d: NonNullable<typeof discounts>[0]) {
    setEditing(d);
    form.reset({ name: d.name, code: d.code, type: d.type as "percentage" | "fixed", value: d.value, minAmount: d.minAmount ?? undefined, usageLimit: d.usageLimit ?? undefined, description: d.description ?? "", isActive: d.isActive });
    setIsOpen(true);
  }

  function onSubmit(values: FormValues) {
    if (editing) {
      updateDiscount.mutate({ id: editing.id, data: values });
    } else {
      createDiscount.mutate({ data: values });
    }
  }

  return (
    <div className="space-y-6">
      <ConfirmDeleteDialog
        open={!!deleteTarget}
        title={`حذف ${deleteTarget?.label ?? ''}`}
        description={`آیا از حذف «${deleteTarget?.label ?? ''}» مطمئن هستید؟ این عمل قابل بازگشت نیست.`}
        onConfirm={() => { deleteDiscount.mutate({ id: deleteTarget!.id }); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">تخفیفات</h1>
          <p className="text-muted-foreground mt-1">مدیریت کدهای تخفیف</p>
        </div>
        <Button className="gap-2" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          تخفیف جدید
        </Button>
      </div>

      {isError && <ErrorNotice onRetry={() => refetch()} />}

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "ویرایش تخفیف" : "ثبت تخفیف جدید"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>نام تخفیف</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="code" render={({ field }) => (
                  <FormItem>
                    <FormLabel>کد تخفیف</FormLabel>
                    <FormControl><Input dir="ltr" className="uppercase" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="type" render={({ field }) => (
                  <FormItem>
                    <FormLabel>نوع</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="percentage">درصدی</SelectItem>
                        <SelectItem value="fixed">مبلغ ثابت</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="value" render={({ field }) => (
                  <FormItem>
                    <FormLabel>مقدار</FormLabel>
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
                <Button type="submit" disabled={createDiscount.isPending || updateDiscount.isPending}>
                  {editing ? "ذخیره" : "ثبت تخفیف"}
                </Button>
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
                <TableHead>نام</TableHead>
                <TableHead>کد</TableHead>
                <TableHead>نوع</TableHead>
                <TableHead>مقدار</TableHead>
                <TableHead>استفاده</TableHead>
                <TableHead>وضعیت</TableHead>
                <TableHead className="text-left">عملیات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {discounts?.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.name}</TableCell>
                  <TableCell><code className="bg-muted px-2 py-0.5 rounded text-sm">{d.code}</code></TableCell>
                  <TableCell>{d.type === "percentage" ? "درصدی" : "ثابت"}</TableCell>
                  <TableCell>{d.type === "percentage" ? `${toPersianDigits(d.value)}٪` : formatCurrency(d.value)}</TableCell>
                  <TableCell>{toPersianDigits(d.usageCount ?? 0)}{d.usageLimit ? ` / ${toPersianDigits(d.usageLimit)}` : ""}</TableCell>
                  <TableCell>
                    <Badge variant={d.isActive ? "default" : "outline"}>{d.isActive ? "فعال" : "غیرفعال"}</Badge>
                  </TableCell>
                  <TableCell className="text-left">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(d)}><Pencil className="h-3 w-3" /></Button>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteTarget({ id: d.id, label: d.name })}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && !discounts?.length && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">تخفیفی ثبت نشده</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
