import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPurchases,
  useCreatePurchase,
  useUpdatePurchase,
  useDeletePurchase,
  getListPurchasesQueryKey,
  useListPurchaseProducts,
  useCreatePurchaseProduct,
  getListPurchaseProductsQueryKey,
  type Purchase,
  type PurchaseProduct,
} from "@workspace/api-client-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { PurchaseProductsDialog } from "@/components/purchase-products-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { ErrorNotice } from "@/components/error-notice";
import { PersianDatePicker } from "@/components/persian-date-picker";
import { PriceInput } from "@/components/price-input";
import { useToast } from "@/hooks/use-toast";
import { onApiError } from "@/lib/api-error";
import { formatCurrency, formatShamsiDate, gregorianDateToUnix, toPersianDigits, unixToGregorianDate } from "@/lib/format";
import { tehranTodayISO } from "@/lib/tehran-date";
import { ShoppingCart, Plus, Pencil, Trash2, Search, CheckCircle2, Clock, Package, ChevronsUpDown } from "lucide-react";

// ─── خریدها ───────────────────────────────────────────────────────────────────
// ثبت خرید مواد و محصولات (نوع محصول، خود محصول، تاریخ و مبلغ خرید) و وضعیت تسویه.

// نوع‌های پیشنهادی؛ هر نوع دیگری هم می‌شود نوشت
const DEFAULT_TYPES = ["فیلر", "بوتاکس", "مزوتراپی", "اسکین بوستر", "نخ", "مواد مصرفی", "تجهیزات"];

type StatusFilter = "all" | "unsettled" | "settled";

interface FormState {
  productType: string;
  productName: string;
  supplier: string;
  quantity: string;
  price: number;
  purchaseDate: string; // میلادی YYYY-MM-DD (تقویم شمسی نمایش داده می‌شود)
  isSettled: boolean;
  notes: string;
}

const emptyForm = (): FormState => ({
  productType: "",
  productName: "",
  supplier: "",
  quantity: "1",
  price: 0,
  purchaseDate: tehranTodayISO(),
  isSettled: false,
  notes: "",
});

export default function Purchases() {
  const { data: purchases, isLoading, isError, refetch } = useListPurchases();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Purchase | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<Purchase | null>(null);
  const [productsOpen, setProductsOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // محصول تازه‌ای که دستی تایپ شده، در فهرست ذخیره شود؟
  const [saveToList, setSaveToList] = useState(true);
  const { data: savedProducts } = useListPurchaseProducts();
  const createProduct = useCreatePurchaseProduct({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListPurchaseProductsQueryKey() }) },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListPurchasesQueryKey() });
  const create = useCreatePurchase({
    mutation: {
      onSuccess: () => { invalidate(); setOpen(false); toast({ title: "خرید ثبت شد" }); },
      onError: onApiError("ثبت خرید ناموفق بود"),
    },
  });
  const update = useUpdatePurchase({
    mutation: {
      onSuccess: () => { invalidate(); setOpen(false); },
      onError: onApiError("ویرایش خرید ناموفق بود"),
    },
  });
  const remove = useDeletePurchase({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "خرید حذف شد" }); },
      onError: onApiError("حذف خرید ناموفق بود"),
    },
  });

  const all = purchases ?? [];
  const types = useMemo(() => {
    const set = new Set<string>();
    for (const p of all) set.add(p.productType);
    return [...set].sort((a, b) => a.localeCompare(b, "fa"));
  }, [all]);
  const productNames = useMemo(() => [...new Set(all.map((p) => p.productName))], [all]);
  const suppliers = useMemo(() => [...new Set(all.map((p) => p.supplier).filter((s): s is string => !!s))], [all]);

  const filtered = useMemo(() => {
    const term = q.trim();
    return all.filter((p) =>
      (typeFilter === "all" || p.productType === typeFilter) &&
      (status === "all" || (status === "settled" ? p.isSettled : !p.isSettled)) &&
      (!term || p.productName.includes(term) || p.productType.includes(term) || (p.supplier ?? "").includes(term)),
    );
  }, [all, q, typeFilter, status]);

  const totals = useMemo(() => {
    let total = 0, settled = 0, unsettled = 0, unsettledCount = 0;
    for (const p of filtered) {
      total += p.price;
      if (p.isSettled) settled += p.price;
      else { unsettled += p.price; unsettledCount++; }
    }
    return { total, settled, unsettled, unsettledCount };
  }, [filtered]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setSaveToList(true);
    setOpen(true);
  }

  // انتخاب از محصولات ذخیره‌شده: نوع و نام، و فروشنده/قیمت پیش‌فرض (اگر خالی‌اند)
  function pickProduct(p: PurchaseProduct) {
    setForm((f) => ({
      ...f,
      productType: p.productType,
      productName: p.name,
      supplier: f.supplier.trim() ? f.supplier : (p.defaultSupplier ?? ""),
      price: f.price > 0 ? f.price : (p.defaultPrice ?? 0),
    }));
    setPickerOpen(false);
  }

  const isSavedProduct = (savedProducts ?? []).some(
    (p) => p.productType === form.productType.trim() && p.name === form.productName.trim(),
  );
  function openEdit(p: Purchase) {
    setEditing(p);
    setForm({
      productType: p.productType,
      productName: p.productName,
      supplier: p.supplier ?? "",
      quantity: String(p.quantity),
      price: p.price,
      purchaseDate: unixToGregorianDate(p.purchaseDate) || tehranTodayISO(),
      isSettled: p.isSettled,
      notes: p.notes ?? "",
    });
    setOpen(true);
  }

  function submit() {
    const quantity = Number.parseInt(form.quantity, 10);
    if (!form.productType.trim() || !form.productName.trim()) {
      toast({ title: "نوع محصول و نام محصول را وارد کنید", variant: "destructive" });
      return;
    }
    if (!(form.price > 0)) {
      toast({ title: "مبلغ خرید را وارد کنید", variant: "destructive" });
      return;
    }
    if (!(quantity >= 1)) {
      toast({ title: "تعداد باید حداقل ۱ باشد", variant: "destructive" });
      return;
    }
    const data = {
      productType: form.productType.trim(),
      productName: form.productName.trim(),
      supplier: form.supplier.trim() || null,
      quantity,
      price: Math.round(form.price),
      purchaseDate: gregorianDateToUnix(form.purchaseDate),
      isSettled: form.isSettled,
      notes: form.notes.trim() || null,
    };
    if (editing) {
      update.mutate({ id: editing.id, data }, { onSuccess: () => toast({ title: "خرید ویرایش شد" }) });
    } else {
      create.mutate({ data });
    }
    // محصول جدیدِ تایپ‌شده برای دفعه‌های بعد در فهرست ذخیره می‌شود
    if (saveToList && !isSavedProduct) {
      createProduct.mutate({ data: { productType: data.productType, name: data.productName, defaultSupplier: data.supplier } });
    }
  }

  function toggleSettled(p: Purchase) {
    update.mutate(
      { id: p.id, data: { isSettled: !p.isSettled } },
      { onSuccess: () => toast({ title: p.isSettled ? "به «تسویه نشده» برگشت" : "تسویه شد" }) },
    );
  }

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <ShoppingCart className="h-7 w-7 text-primary" />
            خریدها
          </h1>
          <p className="text-muted-foreground mt-1">ثبت خرید محصولات و مواد مصرفی، و وضعیت تسویه با فروشنده</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={() => setProductsOpen(true)}>
            <Package className="h-4 w-4" /> محصولات ذخیره‌شده
            {(savedProducts?.length ?? 0) > 0 && <Badge variant="secondary">{toPersianDigits(savedProducts?.length ?? 0)}</Badge>}
          </Button>
          <Button className="gap-2" onClick={openCreate}>
            <Plus className="h-4 w-4" /> خرید جدید
          </Button>
        </div>
      </div>

      {isError && <ErrorNotice onRetry={() => refetch()} />}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground font-medium">جمع خریدها</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totals.total)}</div>
            <p className="text-xs text-muted-foreground mt-1">{toPersianDigits(filtered.length)} خرید</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground font-medium">تسویه‌شده</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-emerald-700">{formatCurrency(totals.settled)}</div></CardContent>
        </Card>
        <Card className={totals.unsettled > 0 ? "border-red-200" : ""}>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground font-medium">تسویه‌نشده (بدهی به فروشنده)</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{formatCurrency(totals.unsettled)}</div>
            <p className="text-xs text-muted-foreground mt-1">{toPersianDigits(totals.unsettledCount)} خرید</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[14rem]">
              <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجوی محصول، نوع یا فروشنده" className="pr-9" />
            </div>
            {([["all", "همه"], ["unsettled", "تسویه نشده"], ["settled", "تسویه شده"]] as const).map(([k, label]) => (
              <Button key={k} size="sm" variant={status === k ? "default" : "outline"} onClick={() => setStatus(k)}>{label}</Button>
            ))}
          </div>
          {types.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={typeFilter === "all" ? "secondary" : "ghost"} onClick={() => setTypeFilter("all")}>همهٔ انواع</Button>
              {types.map((t) => (
                <Button key={t} size="sm" variant={typeFilter === t ? "secondary" : "ghost"} onClick={() => setTypeFilter(t)}>{t}</Button>
              ))}
            </div>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">تاریخ خرید</TableHead>
                <TableHead className="text-right">نوع محصول</TableHead>
                <TableHead className="text-right">محصول</TableHead>
                <TableHead className="text-right">فروشنده</TableHead>
                <TableHead className="text-right">تعداد</TableHead>
                <TableHead className="text-right">مبلغ خرید</TableHead>
                <TableHead className="text-right">وضعیت</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-sm whitespace-nowrap">{formatShamsiDate(p.purchaseDate)}</TableCell>
                  <TableCell><Badge variant="secondary">{p.productType}</Badge></TableCell>
                  <TableCell className="font-medium">
                    {p.productName}
                    {p.notes && <div className="text-xs text-muted-foreground max-w-[220px] truncate">{p.notes}</div>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{p.supplier || "—"}</TableCell>
                  <TableCell className="text-sm">{toPersianDigits(p.quantity)}</TableCell>
                  <TableCell className="font-bold whitespace-nowrap">{formatCurrency(p.price)}</TableCell>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => toggleSettled(p)}
                      disabled={update.isPending}
                      title={p.isSettled ? "برگرداندن به «تسویه نشده»" : "علامت‌گذاری به‌عنوان تسویه‌شده"}
                      className="text-right"
                    >
                      {p.isSettled ? (
                        <Badge className="gap-1 bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-200" variant="outline">
                          <CheckCircle2 className="h-3 w-3" /> تسویه شده
                        </Badge>
                      ) : (
                        <Badge className="gap-1 bg-red-50 text-red-700 border-red-200 hover:bg-red-100" variant="outline">
                          <Clock className="h-3 w-3" /> تسویه نشده
                        </Badge>
                      )}
                      {p.isSettled && p.settledAt && (
                        <div className="text-[11px] text-muted-foreground mt-0.5">{formatShamsiDate(p.settledAt)}</div>
                      )}
                    </button>
                  </TableCell>
                  <TableCell className="text-left whitespace-nowrap">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label="ویرایش" title="ویرایش" onClick={() => openEdit(p)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" aria-label="حذف" title="حذف" onClick={() => setDeleteTarget(p)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    {all.length ? "خریدی با این مشخصات پیدا نشد" : "هنوز خریدی ثبت نشده است"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(o) => !create.isPending && !update.isPending && setOpen(o)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "ویرایش خرید" : "ثبت خرید جدید"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm mb-1.5 block">انتخاب از محصولات ذخیره‌شده</Label>
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" role="combobox" className="w-full justify-between font-normal text-muted-foreground">
                    {(savedProducts?.length ?? 0) > 0 ? "جست‌وجوی محصول… (مثلاً لوناژل)" : "هنوز محصولی ذخیره نشده"}
                    <ChevronsUpDown className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[360px] p-0" align="start">
                  <Command filter={(value, search) => {
                    const p = savedProducts?.find((x) => String(x.id) === value);
                    if (!p) return 0;
                    return `${p.name} ${p.productType} ${p.defaultSupplier ?? ""}`.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
                  }}>
                    <CommandInput placeholder="نام یا نوع محصول…" />
                    <CommandList>
                      <CommandEmpty>محصولی پیدا نشد</CommandEmpty>
                      {[...new Set((savedProducts ?? []).map((p) => p.productType))].map((type) => (
                        <CommandGroup key={type} heading={type}>
                          {(savedProducts ?? []).filter((p) => p.productType === type).map((p) => (
                            <CommandItem key={p.id} value={String(p.id)} onSelect={() => pickProduct(p)}>
                              <div className="flex flex-col">
                                <span className="font-medium">{p.name}</span>
                                {(p.defaultSupplier || p.defaultPrice) && (
                                  <span className="text-xs text-muted-foreground">
                                    {[p.defaultSupplier, p.defaultPrice ? formatCurrency(p.defaultPrice) : null].filter(Boolean).join(" — ")}
                                  </span>
                                )}
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      ))}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="pur-type" className="text-sm mb-1.5 block">نوع محصول *</Label>
                <Input id="pur-type" list="pur-types" value={form.productType} onChange={(e) => set("productType", e.target.value)} placeholder="مثلاً فیلر" />
                <datalist id="pur-types">
                  {[...new Set([...types, ...(savedProducts ?? []).map((p) => p.productType), ...DEFAULT_TYPES])].map((t) => <option key={t} value={t} />)}
                </datalist>
              </div>
              <div>
                <Label htmlFor="pur-name" className="text-sm mb-1.5 block">محصول *</Label>
                <Input id="pur-name" list="pur-names" value={form.productName} onChange={(e) => set("productName", e.target.value)} placeholder="مثلاً فیلر رووفیل" />
                <datalist id="pur-names">
                  {productNames.map((t) => <option key={t} value={t} />)}
                </datalist>
              </div>
            </div>
            {!editing && form.productType.trim() && form.productName.trim() && !isSavedProduct && (
              <div className="flex items-center gap-2">
                <Checkbox id="pur-save-product" checked={saveToList} onCheckedChange={(v) => setSaveToList(Boolean(v))} />
                <Label htmlFor="pur-save-product" className="text-sm font-normal cursor-pointer">
                  «{form.productName.trim()}» را برای خریدهای بعدی در فهرست محصولات ذخیره کن
                </Label>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="text-sm mb-1.5 block">تاریخ خرید *</Label>
                <PersianDatePicker value={form.purchaseDate} onChange={(v) => set("purchaseDate", v || tehranTodayISO())} />
              </div>
              <div>
                <Label className="text-sm mb-1.5 block">مبلغ خرید (تومان) *</Label>
                <PriceInput value={form.price} onChange={(v) => set("price", v)} placeholder="مبلغ کل" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="pur-qty" className="text-sm mb-1.5 block">تعداد</Label>
                <Input id="pur-qty" inputMode="numeric" dir="ltr" value={form.quantity} onChange={(e) => set("quantity", e.target.value.replace(/[^\d]/g, ""))} />
              </div>
              <div>
                <Label htmlFor="pur-supplier" className="text-sm mb-1.5 block">فروشنده / تأمین‌کننده</Label>
                <Input id="pur-supplier" list="pur-suppliers" value={form.supplier} onChange={(e) => set("supplier", e.target.value)} placeholder="اختیاری" />
                <datalist id="pur-suppliers">
                  {suppliers.map((t) => <option key={t} value={t} />)}
                </datalist>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="pur-settled" className="text-sm">تسویه شده</Label>
                <p className="text-xs text-muted-foreground">پول این خرید به فروشنده پرداخت شده است</p>
              </div>
              <Switch id="pur-settled" checked={form.isSettled} onCheckedChange={(v) => set("isSettled", v)} />
            </div>
            <div>
              <Label htmlFor="pur-notes" className="text-sm mb-1.5 block">یادداشت</Label>
              <Textarea id="pur-notes" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="اختیاری — مثلاً شمارهٔ فاکتور یا سری ساخت" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>انصراف</Button>
            <Button onClick={submit} disabled={create.isPending || update.isPending}>
              {create.isPending || update.isPending ? "در حال ثبت..." : editing ? "ذخیره تغییرات" : "ثبت خرید"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PurchaseProductsDialog
        open={productsOpen}
        onOpenChange={setProductsOpen}
        typeSuggestions={[...new Set([...types, ...DEFAULT_TYPES])]}
      />

      <ConfirmDeleteDialog
        open={!!deleteTarget}
        title={`حذف خرید «${deleteTarget?.productName ?? ""}»`}
        description="آیا از حذف این خرید مطمئن هستید؟ این عمل قابل بازگشت نیست."
        onConfirm={() => { if (deleteTarget) remove.mutate({ id: deleteTarget.id }); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
