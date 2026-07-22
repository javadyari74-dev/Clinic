import { useState, useMemo } from "react";
import { useListServices, useCreateService, useUpdateService, useDeleteService, getListServicesQueryKey, type Service } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Separator } from "@/components/ui/separator";
import { formatCurrency, toPersianDigits } from "@/lib/format";
import { Plus, Pencil, Trash2, TrendingUp, TrendingDown, UserCheck, Package, MoreHorizontal, Search, Eye, EyeOff } from "lucide-react";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { useAuth } from "@/hooks/use-auth";
import { PriceInput } from "@/components/price-input";
import { useToast } from "@/hooks/use-toast";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Badge } from "@/components/ui/badge";
import { ErrorNotice } from "@/components/error-notice";

const formSchema = z.object({
  name: z.string().min(2, "نام الزامی است"),
  category: z.string().min(1, "دسته‌بندی الزامی است"),
  price: z.coerce.number().min(0, "قیمت معتبر نیست"),
  durationMinutes: z.coerce.number().min(1, "مدت زمان الزامی است"),
  doctorFee:    z.coerce.number().min(0).default(0),
  materialCost: z.coerce.number().min(0).default(0),
  otherCost:    z.coerce.number().min(0).default(0),
  unitCount:    z.coerce.number().min(1, "تعداد واحد معتبر نیست").default(1),
  unitLabel:    z.string().optional(),
  priceMode:        z.enum(["total", "per_unit"]).default("total"),
  doctorFeeMode:    z.enum(["total", "per_unit"]).default("total"),
  materialCostMode: z.enum(["total", "per_unit"]).default("total"),
  otherCostMode:    z.enum(["total", "per_unit"]).default("total"),
  description: z.string().optional(),
});
type FormValues = z.infer<typeof formSchema>;
type Mode = "total" | "per_unit";

const FORM_DEFAULTS: FormValues = {
  name: "", category: "", price: 0, durationMinutes: 30,
  doctorFee: 0, materialCost: 0, otherCost: 0,
  unitCount: 1, unitLabel: "",
  priceMode: "total", doctorFeeMode: "total", materialCostMode: "total", otherCostMode: "total",
  description: "",
};

function effective(raw: number | null | undefined, mode: string | null | undefined, unitCount: number | null | undefined) {
  const v = raw ?? 0;
  return mode === "per_unit" ? v * (unitCount ?? 1) : v;
}

function profitOf(s: {
  price: number;
  doctorFee?: number | null; materialCost?: number | null; otherCost?: number | null;
  unitCount?: number | null;
  priceMode?: string | null; doctorFeeMode?: string | null; materialCostMode?: string | null; otherCostMode?: string | null;
}) {
  const uc = s.unitCount ?? 1;
  const price = effective(s.price, s.priceMode, uc);
  const cost =
    effective(s.doctorFee, s.doctorFeeMode, uc) +
    effective(s.materialCost, s.materialCostMode, uc) +
    effective(s.otherCost, s.otherCostMode, uc);
  return { price, cost, profit: price - cost, margin: price > 0 ? Math.round(((price - cost) / price) * 100) : 0 };
}

function ModeToggle({ value, onChange }: { value: Mode; onChange: (v: Mode) => void }) {
  return (
    <div className="inline-flex shrink-0 rounded-md border bg-background p-0.5 text-[11px]">
      <button
        type="button"
        onClick={() => onChange("total")}
        className={`rounded px-2 py-0.5 transition-colors ${value !== "per_unit" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
      >
        کل
      </button>
      <button
        type="button"
        onClick={() => onChange("per_unit")}
        className={`rounded px-2 py-0.5 transition-colors ${value === "per_unit" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
      >
        هر واحد
      </button>
    </div>
  );
}

function LiveProfit({
  price, doctorFee, materialCost, otherCost,
  unitCount, unitLabel,
  priceMode, doctorFeeMode, materialCostMode, otherCostMode,
}: {
  price: number; doctorFee: number; materialCost: number; otherCost: number;
  unitCount: number; unitLabel: string;
  priceMode: Mode; doctorFeeMode: Mode; materialCostMode: Mode; otherCostMode: Mode;
}) {
  const uc = unitCount || 1;
  const unitTxt = unitLabel?.trim() || "واحد";
  const eff = (v: number, mode: Mode) => (mode === "per_unit" ? v * uc : v);
  const effPrice = eff(price, priceMode);
  const effDoctor = eff(doctorFee, doctorFeeMode);
  const effMaterial = eff(materialCost, materialCostMode);
  const effOther = eff(otherCost, otherCostMode);
  const cost = effDoctor + effMaterial + effOther;
  const profit = effPrice - cost;
  const margin = effPrice > 0 ? Math.round((profit / effPrice) * 100) : 0;

  const hint = (raw: number, mode: Mode) =>
    mode === "per_unit" && raw > 0 ? (
      <span className="text-[10px] text-muted-foreground"> ({formatCurrency(raw)} × {toPersianDigits(uc)} {unitTxt})</span>
    ) : null;

  return (
    <div className={`rounded-lg p-3 border-2 ${profit >= 0 ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground">محاسبه سود/زیان هر نوبت</span>
        {profit >= 0
          ? <TrendingUp className="h-4 w-4 text-green-600" />
          : <TrendingDown className="h-4 w-4 text-red-600" />}
      </div>
      <div className="space-y-1 text-xs text-muted-foreground">
        <div className="flex justify-between">
          <span>قیمت دریافتی از مراجع{hint(price, priceMode)}</span>
          <span className="font-mono text-green-700">{formatCurrency(effPrice)}</span>
        </div>
        {effDoctor > 0 && (
          <div className="flex justify-between">
            <span>− هزینه پزشک{hint(doctorFee, doctorFeeMode)}</span>
            <span className="font-mono text-orange-600">({formatCurrency(effDoctor)})</span>
          </div>
        )}
        {effMaterial > 0 && (
          <div className="flex justify-between">
            <span>− مواد مصرفی{hint(materialCost, materialCostMode)}</span>
            <span className="font-mono text-orange-600">({formatCurrency(effMaterial)})</span>
          </div>
        )}
        {effOther > 0 && (
          <div className="flex justify-between">
            <span>− سایر هزینه‌ها{hint(otherCost, otherCostMode)}</span>
            <span className="font-mono text-orange-600">({formatCurrency(effOther)})</span>
          </div>
        )}
        <Separator className="my-1" />
        <div className="flex justify-between font-bold text-sm">
          <span className={profit >= 0 ? "text-green-700" : "text-red-600"}>
            {profit >= 0 ? "سود خالص" : "زیان"} هر نوبت
          </span>
          <span className={`font-mono ${profit >= 0 ? "text-green-700" : "text-red-600"}`}>
            {formatCurrency(profit)}
          </span>
        </div>
        {effPrice > 0 && (
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">حاشیه سود</span>
            <Badge variant={margin >= 50 ? "default" : margin >= 20 ? "secondary" : "destructive"} className="text-xs h-5">
              {toPersianDigits(margin)}٪
            </Badge>
          </div>
        )}
      </div>
    </div>
  );
}

function ServiceFormBody({ form }: { form: ReturnType<typeof useForm<FormValues>> }) {
  const [price, doctorFee, materialCost, otherCost, unitCount, unitLabel, priceMode, doctorFeeMode, materialCostMode, otherCostMode] = useWatch({
    control: form.control,
    name: ["price", "doctorFee", "materialCost", "otherCost", "unitCount", "unitLabel", "priceMode", "doctorFeeMode", "materialCostMode", "otherCostMode"],
  });

  const anyPerUnit = [priceMode, doctorFeeMode, materialCostMode, otherCostMode].includes("per_unit");

  return (
    <div className="space-y-4">
      <FormField control={form.control} name="name" render={({ field }) => (
        <FormItem>
          <FormLabel>نام خدمت *</FormLabel>
          <FormControl><Input placeholder="مثلاً: PRP خون" {...field} /></FormControl>
          <FormMessage />
        </FormItem>
      )} />

      <div className="grid grid-cols-2 gap-3">
        <FormField control={form.control} name="category" render={({ field }) => (
          <FormItem>
            <FormLabel>دسته‌بندی *</FormLabel>
            <FormControl><Input placeholder="مثلاً: تزریقی" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="durationMinutes" render={({ field }) => (
          <FormItem>
            <FormLabel>مدت زمان (دقیقه)</FormLabel>
            <FormControl><Input type="number" dir="ltr" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
      </div>

      <FormField control={form.control} name="price" render={({ field }) => (
        <FormItem>
          <div className="flex items-center justify-between gap-2">
            <FormLabel>قیمت دریافتی از مراجع (تومان) *</FormLabel>
            <FormField control={form.control} name="priceMode" render={({ field: mf }) => (
              <ModeToggle value={mf.value} onChange={mf.onChange} />
            )} />
          </div>
          <FormControl>
            <PriceInput value={field.value} onChange={val => field.onChange(val)} placeholder="مثال: ۱,۵۰۰,۰۰۰" />
          </FormControl>
          <FormMessage />
        </FormItem>
      )} />

      {/* تعداد و نوع واحد — فقط وقتی حداقل یک فیلد روی «هر واحد» باشد */}
      {anyPerUnit && (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3">
          <FormField control={form.control} name="unitCount" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm">تعداد واحد</FormLabel>
              <FormControl><Input type="number" dir="ltr" min={1} {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="unitLabel" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm">نوع واحد</FormLabel>
              <FormControl><Input placeholder="مثلاً: سی‌سی" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
      )}

      {/* بخش هزینه‌ها */}
      <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
        <div className="flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-orange-600" />
          <span className="text-sm font-semibold">هزینه‌های انجام خدمت (اختیاری)</span>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <FormField control={form.control} name="doctorFee" render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between gap-2">
                <FormLabel className="flex items-center gap-1.5 text-sm">
                  <UserCheck className="h-3.5 w-3.5 text-blue-600" />
                  هزینه پزشک / ارائه‌دهنده (تومان)
                </FormLabel>
                <FormField control={form.control} name="doctorFeeMode" render={({ field: mf }) => (
                  <ModeToggle value={mf.value} onChange={mf.onChange} />
                )} />
              </div>
              <FormControl>
                <PriceInput value={field.value} onChange={val => field.onChange(val)} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="materialCost" render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between gap-2">
                <FormLabel className="flex items-center gap-1.5 text-sm">
                  <Package className="h-3.5 w-3.5 text-orange-600" />
                  مواد مصرفی (تومان)
                </FormLabel>
                <FormField control={form.control} name="materialCostMode" render={({ field: mf }) => (
                  <ModeToggle value={mf.value} onChange={mf.onChange} />
                )} />
              </div>
              <FormControl>
                <PriceInput value={field.value} onChange={val => field.onChange(val)} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="otherCost" render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between gap-2">
                <FormLabel className="flex items-center gap-1.5 text-sm">
                  <MoreHorizontal className="h-3.5 w-3.5 text-gray-500" />
                  سایر هزینه‌ها (تومان)
                </FormLabel>
                <FormField control={form.control} name="otherCostMode" render={({ field: mf }) => (
                  <ModeToggle value={mf.value} onChange={mf.onChange} />
                )} />
              </div>
              <FormControl>
                <PriceInput value={field.value} onChange={val => field.onChange(val)} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        {/* نمایش زنده سود */}
        <LiveProfit
          price={Number(price) || 0}
          doctorFee={Number(doctorFee) || 0}
          materialCost={Number(materialCost) || 0}
          otherCost={Number(otherCost) || 0}
          unitCount={Number(unitCount) || 1}
          unitLabel={unitLabel ?? ""}
          priceMode={(priceMode as Mode) ?? "total"}
          doctorFeeMode={(doctorFeeMode as Mode) ?? "total"}
          materialCostMode={(materialCostMode as Mode) ?? "total"}
          otherCostMode={(otherCostMode as Mode) ?? "total"}
        />
      </div>

      <FormField control={form.control} name="description" render={({ field }) => (
        <FormItem>
          <FormLabel>توضیحات (اختیاری)</FormLabel>
          <FormControl><Input {...field} /></FormControl>
          <FormMessage />
        </FormItem>
      )} />
    </div>
  );
}

export default function Services() {
  const { data: services, isLoading, isError, refetch } = useListServices();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string } | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("همه");
  const [showFinancials, setShowFinancials] = useState(true);

  // Derived: unique categories with counts
  const categories = useMemo(() => {
    if (!services) return [];
    const map = new Map<string, number>();
    for (const s of services) {
      const cat = s.category ?? "سایر";
      map.set(cat, (map.get(cat) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([name, count]) => ({ name, count }));
  }, [services]);

  // Derived: filtered list
  const filteredServices = useMemo(() => {
    if (!services) return [];
    const term = searchTerm.trim().toLowerCase();
    return services.filter((s) => {
      const matchCat = activeCategory === "همه" || (s.category ?? "سایر") === activeCategory;
      const matchSearch = !term || s.name.toLowerCase().includes(term);
      return matchCat && matchSearch;
    });
  }, [services, searchTerm, activeCategory]);

  const createService = useCreateService({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListServicesQueryKey() });
        setIsOpen(false);
        toast({ title: "خدمت با موفقیت ثبت شد" });
        form.reset();
      },
    },
  });

  const updateService = useUpdateService({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListServicesQueryKey() });
        setEditing(null);
        setIsOpen(false);
        toast({ title: "خدمت با موفقیت ویرایش شد" });
      },
    },
  });

  const deleteService = useDeleteService({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListServicesQueryKey() });
        toast({ title: "خدمت حذف شد" });
      },
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: FORM_DEFAULTS,
  });

  function openCreate() {
    setEditing(null);
    form.reset(FORM_DEFAULTS);
    setIsOpen(true);
  }

  function openEdit(s: Service) {
    setEditing(s);
    form.reset({
      name: s.name,
      category: s.category ?? "",
      price: s.price,
      durationMinutes: s.durationMinutes ?? 30,
      doctorFee: s.doctorFee ?? 0,
      materialCost: s.materialCost ?? 0,
      otherCost: s.otherCost ?? 0,
      unitCount: s.unitCount ?? 1,
      unitLabel: s.unitLabel ?? "",
      priceMode: (s.priceMode as Mode) ?? "total",
      doctorFeeMode: (s.doctorFeeMode as Mode) ?? "total",
      materialCostMode: (s.materialCostMode as Mode) ?? "total",
      otherCostMode: (s.otherCostMode as Mode) ?? "total",
      description: s.description ?? "",
    });
    setIsOpen(true);
  }

  function onSubmit(values: FormValues) {
    if (editing) {
      updateService.mutate({ id: editing.id, data: values });
    } else {
      createService.mutate({ data: values });
    }
  }

  return (
    <div className="space-y-4">
      <ConfirmDeleteDialog
        open={!!deleteTarget}
        title={`حذف ${deleteTarget?.label ?? ''}`}
        description={`آیا از حذف «${deleteTarget?.label ?? ''}» مطمئن هستید؟ این عمل قابل بازگشت نیست.`}
        onConfirm={() => { deleteService.mutate({ id: deleteTarget!.id }); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">خدمات</h1>
          <p className="text-muted-foreground mt-1">مدیریت خدمات، تعرفه‌ها، و هزینه‌های انجام</p>
        </div>
        <Button className="gap-2" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          خدمت جدید
        </Button>
      </div>

      {isError && <ErrorNotice onRetry={() => refetch()} />}

      {/* Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "ویرایش خدمت" : "ثبت خدمت جدید"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <ServiceFormBody form={form} />
              <DialogFooter>
                <Button variant="outline" type="button" onClick={() => setIsOpen(false)}>انصراف</Button>
                <Button type="submit" disabled={createService.isPending || updateService.isPending}>
                  {editing ? "ذخیره تغییرات" : "ثبت خدمت"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Filter bar */}
      <Card>
        <CardContent className="pt-4 pb-3 space-y-3">
          {/* Search + toggle */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="جستجوی نام خدمت..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pr-9"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs shrink-0"
              onClick={() => setShowFinancials((v) => !v)}
            >
              {showFinancials ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {showFinancials ? "پنهان‌کردن ارقام مالی" : "نمایش ارقام مالی"}
            </Button>
            <span className="text-xs text-muted-foreground shrink-0">
              {toPersianDigits(filteredServices.length)} از {toPersianDigits(services?.length ?? 0)} خدمت
            </span>
          </div>

          {/* Category chips */}
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setActiveCategory("همه")}
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium border transition-colors
                  ${activeCategory === "همه"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"}`}
              >
                همه
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${activeCategory === "همه" ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                  {toPersianDigits(services?.length ?? 0)}
                </span>
              </button>
              {categories.map(({ name, count }) => (
                <button
                  key={name}
                  onClick={() => setActiveCategory(name)}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium border transition-colors
                    ${activeCategory === name
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"}`}
                >
                  {name}
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${activeCategory === name ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                    {toPersianDigits(count)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="pt-2 pb-2">
          <Table>
            <TableHeader>
              <TableRow className="h-9">
                <TableHead className="py-2">نام خدمت</TableHead>
                <TableHead className="py-2">دسته‌بندی</TableHead>
                <TableHead className="py-2">مدت</TableHead>
                <TableHead className="py-2">قیمت</TableHead>
                {showFinancials && <TableHead className="py-2">هزینه کل</TableHead>}
                {showFinancials && <TableHead className="py-2">سود هر نوبت</TableHead>}
                {showFinancials && <TableHead className="py-2">حاشیه</TableHead>}
                <TableHead className="py-2">وضعیت</TableHead>
                <TableHead className="py-2 text-left">عملیات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredServices.map((s) => {
                const { price: effPrice, cost, profit, margin } = profitOf(s);
                const hasCost = cost > 0;
                const isPerUnit = [s.priceMode, s.doctorFeeMode, s.materialCostMode, s.otherCostMode].includes("per_unit");
                return (
                  <TableRow key={s.id} className="h-10">
                    <TableCell className="py-1.5 font-medium text-sm">{s.name}</TableCell>
                    <TableCell className="py-1.5"><Badge variant="secondary" className="text-xs">{s.category}</Badge></TableCell>
                    <TableCell className="py-1.5 text-muted-foreground text-xs">{toPersianDigits(s.durationMinutes ?? 0)} دقیقه</TableCell>
                    <TableCell className="py-1.5 font-mono text-sm">
                      {formatCurrency(effPrice)}
                      {isPerUnit && (
                        <span className="block text-[10px] text-muted-foreground">
                          {toPersianDigits(s.unitCount ?? 1)} {s.unitLabel?.trim() || "واحد"}
                        </span>
                      )}
                    </TableCell>
                    {showFinancials && (
                      <TableCell className="py-1.5 font-mono text-xs text-orange-600">
                        {hasCost ? formatCurrency(cost) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    )}
                    {showFinancials && (
                      <TableCell className={`py-1.5 font-mono text-xs font-semibold ${!hasCost ? "text-muted-foreground" : profit >= 0 ? "text-green-700" : "text-red-600"}`}>
                        {hasCost
                          ? <span className="flex items-center gap-1">
                              {profit >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                              {formatCurrency(profit)}
                            </span>
                          : <span className="text-muted-foreground">ثبت نشده</span>}
                      </TableCell>
                    )}
                    {showFinancials && (
                      <TableCell className="py-1.5">
                        {hasCost
                          ? <Badge variant={margin >= 50 ? "default" : margin >= 20 ? "secondary" : "destructive"} className="text-xs">
                              {toPersianDigits(margin)}٪
                            </Badge>
                          : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                    )}
                    <TableCell className="py-1.5">
                      <Badge variant={s.isActive ? "default" : "outline"} className="text-xs">{s.isActive ? "فعال" : "غیرفعال"}</Badge>
                    </TableCell>
                    <TableCell className="py-1.5 text-left">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(s)}><Pencil className="h-3 w-3" /></Button>
                      {user?.role === "admin" && (
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => setDeleteTarget({ id: s.id, label: s.name })}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!isLoading && filteredServices.length === 0 && (
                <TableRow>
                  <TableCell colSpan={showFinancials ? 9 : 6} className="text-center py-8 text-muted-foreground">
                    {services?.length ? "خدمتی با این فیلتر یافت نشد" : "خدمتی ثبت نشده"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
