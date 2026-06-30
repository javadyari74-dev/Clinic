import { useState } from "react";
import { useListInventory, useCreateInventoryItem, useUpdateInventoryItem, useDeleteInventoryItem, getListInventoryQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { formatCurrency, toPersianDigits } from "@/lib/format";
import { Plus, Pencil, Trash2, AlertTriangle } from "lucide-react";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Badge } from "@/components/ui/badge";
import { ErrorNotice } from "@/components/error-notice";

const formSchema = z.object({
  name: z.string().min(2, "نام الزامی است"),
  category: z.string().min(1, "دسته‌بندی الزامی است"),
  unit: z.string().min(1, "واحد الزامی است"),
  quantity: z.coerce.number().min(0),
  minQuantity: z.coerce.number().min(0),
  costPrice: z.coerce.number().min(0).optional(),
  salePrice: z.coerce.number().min(0).optional(),
  description: z.string().optional(),
});
type FormValues = z.infer<typeof formSchema>;

export default function Inventory() {
  const { data: items, isLoading, isError, refetch } = useListInventory();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string } | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<NonNullable<typeof items>[0] | null>(null);

  const createItem = useCreateInventoryItem({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListInventoryQueryKey() });
        setIsOpen(false);
        toast({ title: "آیتم به انبار اضافه شد" });
        form.reset();
      },
    },
  });

  const updateItem = useUpdateInventoryItem({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListInventoryQueryKey() });
        setEditing(null);
        setIsOpen(false);
        toast({ title: "آیتم انبار ویرایش شد" });
      },
    },
  });

  const deleteItem = useDeleteInventoryItem({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListInventoryQueryKey() });
        toast({ title: "آیتم حذف شد" });
      },
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", category: "", unit: "عدد", quantity: 0, minQuantity: 5 },
  });

  function openCreate() {
    setEditing(null);
    form.reset({ name: "", category: "", unit: "عدد", quantity: 0, minQuantity: 5 });
    setIsOpen(true);
  }

  function openEdit(item: NonNullable<typeof items>[0]) {
    setEditing(item);
    form.reset({ name: item.name, category: item.category ?? "", unit: item.unit ?? "", quantity: item.quantity, minQuantity: item.minQuantity ?? 0, costPrice: item.costPrice ?? undefined, salePrice: item.salePrice ?? undefined, description: item.description ?? "" });
    setIsOpen(true);
  }

  function onSubmit(values: FormValues) {
    if (editing) {
      updateItem.mutate({ id: editing.id, data: values });
    } else {
      createItem.mutate({ data: values });
    }
  }

  const lowStock = items?.filter(i => i.quantity <= (i.minQuantity ?? 0)) ?? [];

  return (
    <div className="space-y-6">
      <ConfirmDeleteDialog
        open={!!deleteTarget}
        title={`حذف ${deleteTarget?.label ?? ''}`}
        description={`آیا از حذف «${deleteTarget?.label ?? ''}» مطمئن هستید؟ این عمل قابل بازگشت نیست.`}
        onConfirm={() => { deleteItem.mutate({ id: deleteTarget!.id }); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">انبار</h1>
          <p className="text-muted-foreground mt-1">مدیریت موجودی و ملزومات</p>
        </div>
        <Button className="gap-2" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          آیتم جدید
        </Button>
      </div>

      {isError && <ErrorNotice onRetry={() => refetch()} />}

      {lowStock.length > 0 && (
        <Card className="border-orange-200 bg-orange-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-orange-700 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {toPersianDigits(lowStock.length)} آیتم نیاز به تأمین دارد
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {lowStock.map(i => (
                <Badge key={i.id} variant="outline" className="border-orange-300 text-orange-700">
                  {i.name} ({toPersianDigits(i.quantity)} {i.unit})
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "ویرایش آیتم" : "افزودن آیتم جدید"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>نام محصول</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="category" render={({ field }) => (
                  <FormItem>
                    <FormLabel>دسته‌بندی</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="unit" render={({ field }) => (
                  <FormItem>
                    <FormLabel>واحد</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="quantity" render={({ field }) => (
                  <FormItem>
                    <FormLabel>موجودی</FormLabel>
                    <FormControl><Input type="number" dir="ltr" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="minQuantity" render={({ field }) => (
                  <FormItem>
                    <FormLabel>حداقل موجودی</FormLabel>
                    <FormControl><Input type="number" dir="ltr" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="costPrice" render={({ field }) => (
                  <FormItem>
                    <FormLabel>قیمت خرید</FormLabel>
                    <FormControl><Input type="number" dir="ltr" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="salePrice" render={({ field }) => (
                  <FormItem>
                    <FormLabel>قیمت فروش</FormLabel>
                    <FormControl><Input type="number" dir="ltr" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createItem.isPending || updateItem.isPending}>
                  {editing ? "ذخیره" : "افزودن به انبار"}
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
                <TableHead>دسته</TableHead>
                <TableHead>موجودی</TableHead>
                <TableHead>واحد</TableHead>
                <TableHead>قیمت فروش</TableHead>
                <TableHead>وضعیت</TableHead>
                <TableHead className="text-left">عملیات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items?.map((item) => {
                const isLow = item.quantity <= (item.minQuantity ?? 0);
                return (
                  <TableRow key={item.id} className={isLow ? "bg-orange-50" : undefined}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell><Badge variant="secondary">{item.category}</Badge></TableCell>
                    <TableCell className={`font-mono font-bold ${isLow ? "text-orange-600" : ""}`}>
                      {toPersianDigits(item.quantity)}
                    </TableCell>
                    <TableCell>{item.unit}</TableCell>
                    <TableCell className="font-mono text-sm">{item.salePrice ? formatCurrency(item.salePrice) : "—"}</TableCell>
                    <TableCell>
                      {isLow
                        ? <Badge variant="destructive" className="text-xs"><AlertTriangle className="h-3 w-3 mr-1" />کمبود</Badge>
                        : <Badge variant="default" className="text-xs">موجود</Badge>
                      }
                    </TableCell>
                    <TableCell className="text-left">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(item)}><Pencil className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteTarget({ id: item.id, label: item.name })}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!isLoading && !items?.length && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">آیتمی ثبت نشده</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
