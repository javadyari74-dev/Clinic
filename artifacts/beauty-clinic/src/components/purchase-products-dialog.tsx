import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPurchaseProducts,
  useCreatePurchaseProduct,
  useUpdatePurchaseProduct,
  useDeletePurchaseProduct,
  getListPurchaseProductsQueryKey,
  type PurchaseProduct,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PriceInput } from "@/components/price-input";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { useToast } from "@/hooks/use-toast";
import { onApiError } from "@/lib/api-error";
import { formatCurrency, toPersianDigits } from "@/lib/format";
import { Package, Pencil, Trash2, Plus, Search, X } from "lucide-react";

// ─── محصولات ذخیره‌شدهٔ خرید ───────────────────────────────────────────────────
// محصول یک‌بار اینجا ذخیره می‌شود (مثلاً نوع «فیلر»، محصول «لوناژل») و در فرم خرید از
// فهرست انتخاب می‌شود. فروشنده و قیمت پیش‌فرض اختیاری‌اند و فرم خرید را پر می‌کنند.

interface Draft {
  productType: string;
  name: string;
  defaultSupplier: string;
  defaultPrice: number;
}
const emptyDraft = (): Draft => ({ productType: "", name: "", defaultSupplier: "", defaultPrice: 0 });

export function PurchaseProductsDialog({
  open,
  onOpenChange,
  typeSuggestions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  typeSuggestions: string[];
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: products } = useListPurchaseProducts();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<PurchaseProduct | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListPurchaseProductsQueryKey() });
  const done = (title: string) => () => { invalidate(); setDraft(emptyDraft()); setEditingId(null); toast({ title }); };
  const create = useCreatePurchaseProduct({ mutation: { onSuccess: done("محصول ذخیره شد"), onError: onApiError("ذخیرهٔ محصول ناموفق بود") } });
  const update = useUpdatePurchaseProduct({ mutation: { onSuccess: done("محصول ویرایش شد"), onError: onApiError("ویرایش محصول ناموفق بود") } });
  const remove = useDeletePurchaseProduct({ mutation: { onSuccess: () => { invalidate(); toast({ title: "محصول از فهرست حذف شد" }); }, onError: onApiError("حذف محصول ناموفق بود") } });

  const groups = useMemo(() => {
    const term = q.trim();
    const map = new Map<string, PurchaseProduct[]>();
    for (const p of products ?? []) {
      if (term && !p.name.includes(term) && !p.productType.includes(term)) continue;
      const list = map.get(p.productType) ?? [];
      list.push(p);
      map.set(p.productType, list);
    }
    return [...map.entries()];
  }, [products, q]);

  const allTypes = useMemo(
    () => [...new Set([...(products ?? []).map((p) => p.productType), ...typeSuggestions])],
    [products, typeSuggestions],
  );

  function save() {
    if (!draft.productType.trim() || !draft.name.trim()) {
      toast({ title: "نوع محصول و نام محصول را وارد کنید", variant: "destructive" });
      return;
    }
    const data = {
      productType: draft.productType.trim(),
      name: draft.name.trim(),
      defaultSupplier: draft.defaultSupplier.trim() || null,
      defaultPrice: draft.defaultPrice > 0 ? draft.defaultPrice : null,
    };
    if (editingId) update.mutate({ id: editingId, data });
    else create.mutate({ data });
  }

  function startEdit(p: PurchaseProduct) {
    setEditingId(p.id);
    setDraft({ productType: p.productType, name: p.name, defaultSupplier: p.defaultSupplier ?? "", defaultPrice: p.defaultPrice ?? 0 });
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              محصولات ذخیره‌شده
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            محصولی را که زیاد می‌خرید یک‌بار اینجا ذخیره کنید؛ بعد در «خرید جدید» از فهرست پیدایش کنید.
          </p>

          <div className="rounded-lg border p-3 space-y-3">
            <div className="text-sm font-medium">{editingId ? "ویرایش محصول" : "افزودن محصول"}</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="pp-type" className="text-xs mb-1 block">نوع محصول *</Label>
                <Input id="pp-type" list="pp-types" value={draft.productType} onChange={(e) => set("productType", e.target.value)} placeholder="مثلاً فیلر" />
                <datalist id="pp-types">{allTypes.map((t) => <option key={t} value={t} />)}</datalist>
              </div>
              <div>
                <Label htmlFor="pp-name" className="text-xs mb-1 block">نام محصول *</Label>
                <Input id="pp-name" value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="مثلاً لوناژل" />
              </div>
              <div>
                <Label htmlFor="pp-supplier" className="text-xs mb-1 block">فروشندهٔ همیشگی (اختیاری)</Label>
                <Input id="pp-supplier" value={draft.defaultSupplier} onChange={(e) => set("defaultSupplier", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs mb-1 block">قیمت معمول خرید (اختیاری)</Label>
                <PriceInput value={draft.defaultPrice} onChange={(v) => set("defaultPrice", v)} placeholder="تومان" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="gap-1" onClick={save} disabled={create.isPending || update.isPending}>
                {editingId ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                {editingId ? "ذخیرهٔ تغییرات" : "ذخیره در فهرست"}
              </Button>
              {editingId && (
                <Button size="sm" variant="ghost" className="gap-1" onClick={() => { setEditingId(null); setDraft(emptyDraft()); }}>
                  <X className="h-3.5 w-3.5" /> انصراف
                </Button>
              )}
            </div>
          </div>

          <div className="relative">
            <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجو در محصولات" className="pr-9" />
          </div>

          <div className="space-y-3">
            {groups.map(([type, list]) => (
              <div key={type}>
                <div className="flex items-center gap-2 mb-1.5">
                  <Badge variant="secondary">{type}</Badge>
                  <span className="text-xs text-muted-foreground">{toPersianDigits(list.length)} محصول</span>
                </div>
                <div className="rounded-md border divide-y">
                  {list.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <div>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {[p.defaultSupplier, p.defaultPrice ? formatCurrency(p.defaultPrice) : null].filter(Boolean).join(" — ") || "—"}
                        </div>
                      </div>
                      <div className="flex shrink-0">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label="ویرایش" title="ویرایش" onClick={() => startEdit(p)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" aria-label="حذف" title="حذف" onClick={() => setDeleteTarget(p)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {groups.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">
                {(products ?? []).length ? "محصولی با این نام پیدا نشد" : "هنوز محصولی ذخیره نشده است"}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={!!deleteTarget}
        title={`حذف «${deleteTarget?.name ?? ""}» از فهرست`}
        description="فقط از فهرست محصولات حذف می‌شود؛ خریدهای ثبت‌شده تغییری نمی‌کنند."
        onConfirm={() => { if (deleteTarget) remove.mutate({ id: deleteTarget.id }); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
