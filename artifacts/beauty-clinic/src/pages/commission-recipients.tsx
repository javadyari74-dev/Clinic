import { useState, useMemo, useEffect } from "react";
import {
  useListCommissionRecipients, useCreateCommissionRecipient, useUpdateCommissionRecipient,
  useDeleteCommissionRecipient, getListCommissionRecipientsQueryKey,
  useListCommissions, useListStaff, useGetCommissionRecipientReferrals,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatShamsiDate, toPersianDigits } from "@/lib/format";
import { Plus, Pencil, Trash2, TrendingUp, CheckCircle, Clock, Users, UserCheck, FolderOpen, MessageSquare, Copy } from "lucide-react";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

function RecipientProfileDialog({ recipientId, open, onClose }: { recipientId: number | null; open: boolean; onClose: () => void }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data, isLoading } = useGetCommissionRecipientReferrals(recipientId ?? 0, {
    query: { enabled: open && !!recipientId },
  });

  function generateMessage() {
    if (!data) return;
    const lines = [
      `سلام ${data.recipient.name} عزیز،`,
      `گزارش معرفی‌های شما:`,
      `تعداد افراد معرفی‌شده: ${toPersianDigits(data.count)} نفر`,
      `مجموع خرید معرفی‌شدگان: ${formatCurrency(data.totalSpent)}`,
      `مجموع پورسانت شما: ${formatCurrency(data.totalCommission)}`,
      ``,
      `با تشکر — مطب زیبایی دکتر یاری`,
    ];
    const msg = lines.join("\n");
    navigator.clipboard?.writeText(msg).then(
      () => toast({ title: "پیام در کلیپ‌بورد کپی شد" }),
      () => toast({ title: "امکان کپی نبود", variant: "destructive" }),
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-primary" />
            پرونده کمیسیون‌گیرنده {data?.recipient?.name ? `— ${data.recipient.name}` : ""}
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="py-10 text-center text-muted-foreground">در حال بارگذاری...</div>
        ) : !data ? (
          <div className="py-10 text-center text-muted-foreground">اطلاعاتی یافت نشد</div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg bg-muted/50 p-3 text-center">
                <div className="text-xs text-muted-foreground mb-1">افراد معرفی‌شده</div>
                <div className="font-bold text-lg">{toPersianDigits(data.count)} نفر</div>
              </div>
              <div className="rounded-lg bg-blue-50 p-3 text-center">
                <div className="text-xs text-blue-600 mb-1">مجموع خرید معرفی‌شدگان</div>
                <div className="font-bold text-lg text-blue-700">{formatCurrency(data.totalSpent)}</div>
              </div>
              <div className="rounded-lg bg-green-50 p-3 text-center">
                <div className="text-xs text-green-600 mb-1">مجموع پورسانت</div>
                <div className="font-bold text-lg text-green-700">{formatCurrency(data.totalCommission)}</div>
              </div>
            </div>
            <div className="flex justify-end">
              <Button variant="outline" size="sm" className="gap-2" onClick={generateMessage} disabled={!data.count}>
                <MessageSquare className="h-4 w-4" />
                تولید پیام
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>نام مراجع</TableHead>
                  <TableHead>شماره پرونده</TableHead>
                  <TableHead>مجموع خرید</TableHead>
                  <TableHead>درصد</TableHead>
                  <TableHead>پورسانت</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.referrals.map((r) => (
                  <TableRow key={r.patientId}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="font-mono text-sm">{r.fileNumber ?? "—"}</TableCell>
                    <TableCell className="font-bold">{formatCurrency(r.totalSpent)}</TableCell>
                    <TableCell>{r.referrerRate != null ? `${toPersianDigits(r.referrerRate)}٪` : "—"}</TableCell>
                    <TableCell className="text-green-700 font-medium">{formatCurrency(r.commission)}</TableCell>
                    <TableCell className="text-left">
                      <Button variant="ghost" size="sm" className="text-primary"
                        onClick={() => { onClose(); navigate(`/patients/${r.patientId}`); }}>
                        مشاهده پرونده
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!data.referrals.length && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      هنوز کسی توسط این فرد معرفی نشده است
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>بستن</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const formSchema = z.object({
  name: z.string().min(2, "نام الزامی است"),
  phone: z.string().optional(),
  description: z.string().optional(),
});
type FormValues = z.infer<typeof formSchema>;

function getShamsiMonthLabel(ts: number) {
  try {
    const d = new Date(ts * 1000);
    return new Intl.DateTimeFormat("fa-IR", { calendar: "persian", year: "numeric", month: "long" }).format(d);
  } catch {
    return "—";
  }
}

function getShamsiMonthKey(ts: number) {
  try {
    const d = new Date(ts * 1000);
    const parts = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { year: "numeric", month: "2-digit" }).formatToParts(d);
    const year = parts.find(p => p.type === "year")?.value ?? "";
    const month = parts.find(p => p.type === "month")?.value ?? "";
    return `${year}-${month}`;
  } catch {
    return "0000-00";
  }
}

type RecipientRow = {
  id: number;
  name: string;
  phone?: string | null;
  role?: string | null;
  description?: string | null;
  type: "staff" | "external";
};

export default function CommissionRecipients() {
  const { data: recipients, isLoading: loadingExternal } = useListCommissionRecipients();
  const { data: staff, isLoading: loadingStaff } = useListStaff();
  const { data: allCommissions } = useListCommissions({});
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string } | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<NonNullable<typeof recipients>[0] | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<number | null>(null);
  const search = useSearch();
  const [, navigate] = useLocation();

  useEffect(() => {
    const p = new URLSearchParams(search).get("profile");
    if (p) {
      const id = Number(p);
      setProfileId(Number.isNaN(id) ? null : id);
    } else {
      setProfileId(null);
    }
  }, [search]);

  function openProfile(id: number) {
    navigate(`/commission-recipients?profile=${id}`);
  }

  function closeProfile() {
    if (new URLSearchParams(search).get("profile")) navigate("/commission-recipients");
    else setProfileId(null);
  }

  const create = useCreateCommissionRecipient({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCommissionRecipientsQueryKey() });
        setIsOpen(false);
        toast({ title: "گیرنده خارجی ثبت شد" });
        form.reset();
      },
    },
  });

  const update = useUpdateCommissionRecipient({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCommissionRecipientsQueryKey() });
        setEditing(null);
        setIsOpen(false);
        toast({ title: "اطلاعات ویرایش شد" });
      },
    },
  });

  const del = useDeleteCommissionRecipient({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCommissionRecipientsQueryKey() });
        toast({ title: "گیرنده حذف شد" });
      },
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", phone: "", description: "" },
  });

  function openCreate() {
    setEditing(null);
    form.reset({ name: "", phone: "", description: "" });
    setIsOpen(true);
  }

  function openEdit(r: NonNullable<typeof recipients>[0]) {
    setEditing(r);
    form.reset({ name: r.name, phone: r.phone ?? "", description: r.description ?? "" });
    setIsOpen(true);
  }

  function onSubmit(values: FormValues) {
    if (editing) {
      update.mutate({ id: editing.id, data: values });
    } else {
      create.mutate({ data: values });
    }
  }

  // Build unified list: staff + external
  const allRows = useMemo((): RecipientRow[] => {
    const staffRows: RecipientRow[] = (staff ?? []).map(s => ({
      id: s.id,
      name: s.name,
      phone: s.phone,
      role: s.role,
      type: "staff",
    }));
    const externalRows: RecipientRow[] = (recipients ?? []).map(r => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      description: r.description,
      type: "external",
    }));
    return [...staffRows, ...externalRows];
  }, [staff, recipients]);

  // Build stats per recipient (both staff and external)
  const recipientStats = useMemo(() => {
    const commissions = (allCommissions as any[]) ?? [];
    const map: Record<string, { total: number; paid: number; unpaid: number; byMonth: Record<string, { label: string; total: number; paid: number; unpaid: number }> }> = {};

    for (const c of commissions) {
      const key = `${c.recipientType}:${c.recipientId}`;
      if (!map[key]) map[key] = { total: 0, paid: 0, unpaid: 0, byMonth: {} };
      map[key].total += c.amount;
      if (c.isPaid) map[key].paid += c.amount; else map[key].unpaid += c.amount;

      const mk = getShamsiMonthKey(c.createdAt);
      if (!map[key].byMonth[mk]) {
        map[key].byMonth[mk] = { label: getShamsiMonthLabel(c.createdAt), total: 0, paid: 0, unpaid: 0 };
      }
      map[key].byMonth[mk].total += c.amount;
      if (c.isPaid) map[key].byMonth[mk].paid += c.amount;
      else map[key].byMonth[mk].unpaid += c.amount;
    }
    return map;
  }, [allCommissions]);

  const getKey = (row: RecipientRow) => `${row.type}:${row.id}`;
  const selectedRow = allRows.find(r => getKey(r) === selectedKey);
  const selectedStats = selectedKey ? recipientStats[selectedKey] : null;

  const totalUnpaid = useMemo(() => Object.values(recipientStats).reduce((s, v) => s + v.unpaid, 0), [recipientStats]);

  return (
    <div className="space-y-6">
      <ConfirmDeleteDialog
        open={!!deleteTarget}
        title={`حذف ${deleteTarget?.label ?? ''}`}
        description={`آیا از حذف «${deleteTarget?.label ?? ''}» مطمئن هستید؟ این عمل قابل بازگشت نیست.`}
        onConfirm={() => { del.mutate({ id: deleteTarget!.id }); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />
      <RecipientProfileDialog recipientId={profileId} open={!!profileId} onClose={closeProfile} />
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">گیرندگان کمیسیون</h1>
          <p className="text-muted-foreground mt-1">مدیریت کارمندان و گیرندگان خارجی کمیسیون</p>
        </div>
        <Button className="gap-2" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          گیرنده خارجی جدید
        </Button>
      </div>

      {totalUnpaid > 0 && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 flex items-center gap-3 text-orange-800">
          <Clock className="h-4 w-4 shrink-0" />
          <span className="text-sm">
            مجموع کمیسیون‌های پرداخت‌نشده: <span className="font-bold">{formatCurrency(totalUnpaid)}</span>
          </span>
        </div>
      )}

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "ویرایش گیرنده خارجی" : "ثبت گیرنده خارجی جدید"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground -mt-2">
            برای افزودن کارمند به عنوان گیرنده، از صفحه «کارمندان» اقدام کنید.
          </p>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>نام</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>شماره تماس</FormLabel>
                  <FormControl><Input dir="ltr" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>توضیحات</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="submit" disabled={create.isPending || update.isPending}>
                  {editing ? "ذخیره" : "ثبت گیرنده"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list" className="gap-1.5">
            <Users className="h-3.5 w-3.5" />
            لیست گیرندگان
          </TabsTrigger>
          <TabsTrigger value="stats" className="gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" />
            خلاصه کمیسیون‌ها
          </TabsTrigger>
        </TabsList>

        <TabsContent value="list">
          <Card>
            <CardContent className="pt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>نوع</TableHead>
                    <TableHead>نام</TableHead>
                    <TableHead>سمت / توضیحات</TableHead>
                    <TableHead>شماره تماس</TableHead>
                    <TableHead>مجموع کمیسیون</TableHead>
                    <TableHead>پرداخت‌نشده</TableHead>
                    <TableHead>تسویه‌شده</TableHead>
                    <TableHead className="text-left">عملیات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allRows.map((row) => {
                    const key = getKey(row);
                    const stats = recipientStats[key];
                    const isSelected = selectedKey === key;
                    return (
                      <TableRow
                        key={key}
                        className={`cursor-pointer transition-colors ${isSelected ? "bg-primary/5" : "hover:bg-muted/50"}`}
                        onClick={() => setSelectedKey(isSelected ? null : key)}
                      >
                        <TableCell>
                          {row.type === "staff" ? (
                            <Badge className="bg-blue-100 text-blue-700 border-blue-200 gap-1">
                              <UserCheck className="h-3 w-3" />
                              کارمند
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-pink-700 border-pink-200 gap-1">
                              <Users className="h-3 w-3" />
                              خارجی
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.type === "staff" ? (row.role ?? "—") : (row.description ?? "—")}
                        </TableCell>
                        <TableCell className="font-mono text-sm">{row.phone || "—"}</TableCell>
                        <TableCell className="font-bold">{stats ? formatCurrency(stats.total) : "—"}</TableCell>
                        <TableCell>
                          {stats?.unpaid ? (
                            <span className="text-orange-600 font-medium">{formatCurrency(stats.unpaid)}</span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          {stats?.paid ? (
                            <span className="text-green-600 font-medium">{formatCurrency(stats.paid)}</span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-left" onClick={e => e.stopPropagation()}>
                          {row.type === "external" ? (
                            <>
                              <Button variant="ghost" size="sm" className="gap-1 text-primary" onClick={() => openProfile(row.id)}>
                                <FolderOpen className="h-3 w-3" />
                                <span className="text-xs">مشاهده پرونده</span>
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => {
                                const r = recipients?.find(x => x.id === row.id);
                                if (r) openEdit(r);
                              }}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteTarget({ id: row.id, label: row.name })}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">از صفحه کارمندان</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!loadingExternal && !loadingStaff && !allRows.length && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        گیرنده‌ای ثبت نشده
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>

              {/* Monthly breakdown for selected recipient */}
              {selectedRow && selectedStats && (
                <div className="mt-6 border-t pt-4">
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingUp className="h-4 w-4 text-pink-600" />
                    <h3 className="font-semibold">کمیسیون ماهانه — {selectedRow.name}</h3>
                    {selectedRow.type === "staff" ? (
                      <Badge className="bg-blue-100 text-blue-700 text-xs">کارمند</Badge>
                    ) : (
                      <Badge variant="outline" className="text-pink-700 text-xs">خارجی</Badge>
                    )}
                  </div>
                  <div className="grid gap-3 md:grid-cols-3 mb-4">
                    <div className="rounded-lg bg-muted/50 p-3 text-center">
                      <div className="text-xs text-muted-foreground mb-1">مجموع کل</div>
                      <div className="font-bold text-lg">{formatCurrency(selectedStats.total)}</div>
                    </div>
                    <div className="rounded-lg bg-orange-50 p-3 text-center">
                      <div className="text-xs text-orange-600 mb-1 flex items-center justify-center gap-1">
                        <Clock className="h-3 w-3" />پرداخت‌نشده
                      </div>
                      <div className="font-bold text-lg text-orange-700">{formatCurrency(selectedStats.unpaid)}</div>
                    </div>
                    <div className="rounded-lg bg-green-50 p-3 text-center">
                      <div className="text-xs text-green-600 mb-1 flex items-center justify-center gap-1">
                        <CheckCircle className="h-3 w-3" />تسویه‌شده
                      </div>
                      <div className="font-bold text-lg text-green-700">{formatCurrency(selectedStats.paid)}</div>
                    </div>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ماه</TableHead>
                        <TableHead>مجموع</TableHead>
                        <TableHead>پرداخت‌نشده</TableHead>
                        <TableHead>تسویه‌شده</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(selectedStats.byMonth)
                        .sort(([a], [b]) => b.localeCompare(a))
                        .map(([key, m]) => (
                          <TableRow key={key}>
                            <TableCell className="font-medium">{m.label}</TableCell>
                            <TableCell className="font-bold">{formatCurrency(m.total)}</TableCell>
                            <TableCell>
                              {m.unpaid > 0
                                ? <Badge variant="outline" className="text-orange-600">{formatCurrency(m.unpaid)}</Badge>
                                : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell>
                              {m.paid > 0
                                ? <Badge className="bg-green-100 text-green-700">{formatCurrency(m.paid)}</Badge>
                                : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stats">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {allRows.map((row) => {
              const key = getKey(row);
              const stats = recipientStats[key];
              if (!stats) return (
                <Card key={key}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      {row.name}
                      {row.type === "staff"
                        ? <Badge className="bg-blue-100 text-blue-700 text-xs">کارمند</Badge>
                        : <Badge variant="outline" className="text-pink-700 text-xs">خارجی</Badge>
                      }
                    </CardTitle>
                    {(row.role || row.description) && (
                      <p className="text-xs text-muted-foreground">{row.role ?? row.description}</p>
                    )}
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">کمیسیونی ثبت نشده</p>
                  </CardContent>
                </Card>
              );
              return (
                <Card key={key} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex justify-between items-start">
                      <span className="flex items-center gap-2">
                        {row.name}
                        {row.type === "staff"
                          ? <Badge className="bg-blue-100 text-blue-700 text-xs">کارمند</Badge>
                          : <Badge variant="outline" className="text-pink-700 text-xs">خارجی</Badge>
                        }
                      </span>
                      {stats.unpaid > 0 && (
                        <Badge variant="outline" className="text-orange-600 text-xs">
                          {formatCurrency(stats.unpaid)} بدهی
                        </Badge>
                      )}
                    </CardTitle>
                    {row.phone && <p className="text-xs text-muted-foreground font-mono">{row.phone}</p>}
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">مجموع کل:</span>
                      <span className="font-bold">{formatCurrency(stats.total)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-orange-600 flex items-center gap-1">
                        <Clock className="h-3 w-3" />پرداخت‌نشده:
                      </span>
                      <span className="text-orange-700 font-medium">{formatCurrency(stats.unpaid)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-green-600 flex items-center gap-1">
                        <CheckCircle className="h-3 w-3" />تسویه‌شده:
                      </span>
                      <span className="text-green-700 font-medium">{formatCurrency(stats.paid)}</span>
                    </div>
                    {stats.total > 0 && (
                      <div className="mt-2">
                        <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-green-500 rounded-full"
                            style={{ width: `${Math.round(stats.paid / stats.total * 100)}%` }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 text-center">
                          {toPersianDigits(Math.round(stats.paid / stats.total * 100))}٪ تسویه شده
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
            {!loadingExternal && !loadingStaff && !allRows.length && (
              <div className="col-span-3 text-center py-12 text-muted-foreground">گیرنده‌ای ثبت نشده</div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
