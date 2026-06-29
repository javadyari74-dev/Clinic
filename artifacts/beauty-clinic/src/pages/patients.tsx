import { useState, useMemo } from "react";
import { useListPatients, useCreatePatient, getListPatientsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { formatShamsiDate, formatCurrency } from "@/lib/format";
import { TierBadge } from "@/components/tier-badge";
import { PersianDatePicker } from "@/components/persian-date-picker";
import { Link, useLocation } from "wouter";
import { Search, Plus, FolderOpen, Users, FileText, Phone, ArrowUpDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toPersianDigits } from "@/lib/format";

const formSchema = z.object({
  name: z.string().min(2, "نام الزامی است"),
  phone: z.string().min(10, "شماره تماس معتبر نیست"),
  fileNumber: z.string().min(1, "شماره پرونده الزامی است"),
  email: z.string().email("ایمیل معتبر نیست").optional().or(z.literal("")),
  birthdate: z.string().optional(),
  gender: z.string().optional(),
  notes: z.string().optional(),
});

type PatientWithReferrer = {
  referrerType?: string | null;
  referrerId?: number | null;
  referrerName?: string | null;
};

const REFERRER_TYPE_LABELS: Record<string, string> = {
  patient: "مراجع",
  recipient: "کمیسیون‌گیرنده",
  staff: "کارمند",
  laser: "لیزر",
};

function ReferrerCell({ patient }: { patient: PatientWithReferrer }) {
  if (!patient.referrerType || !patient.referrerId) {
    return <span className="text-muted-foreground text-sm">—</span>;
  }
  const typeLabel = REFERRER_TYPE_LABELS[patient.referrerType] ?? patient.referrerType;
  const name = patient.referrerName ?? "—";
  let href: string | null = null;
  if (patient.referrerType === "patient") href = `/patients/${patient.referrerId}`;
  else if (patient.referrerType === "recipient" || patient.referrerType === "laser") href = `/commission-recipients?profile=${patient.referrerId}`;

  const content = (
    <span className="inline-flex flex-col items-start leading-tight">
      <span className={href ? "text-primary hover:underline font-medium text-sm" : "font-medium text-sm"}>{name}</span>
      <span className="text-[11px] text-muted-foreground">{typeLabel}</span>
    </span>
  );

  if (href) {
    return (
      <Link href={href} onClick={(e) => e.stopPropagation()}>
        {content}
      </Link>
    );
  }
  return content;
}

export default function Patients() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [sortBy, setSortBy] = useState<"fileNumber" | "name" | "createdAt">("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const { data: patientsList } = useListPatients({ q: search, limit: 200 });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const createPatient = useCreatePatient({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPatientsQueryKey() });
        setIsOpen(false);
        toast({ title: "مراجع جدید با موفقیت ثبت شد" });
        form.reset();
      },
    },
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", phone: "", fileNumber: "", email: "", birthdate: "", gender: "", notes: "" },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    createPatient.mutate({ data: { ...values, email: values.email || undefined, birthdate: values.birthdate || undefined, gender: values.gender || undefined, notes: values.notes || undefined } });
  }

  function toggleSort(col: typeof sortBy) {
    if (sortBy === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("asc"); }
  }

  const sorted = useMemo(() => {
    const list = [...(patientsList?.data ?? [])];
    list.sort((a, b) => {
      let av: string | number = sortBy === "fileNumber" ? a.fileNumber : sortBy === "name" ? a.name : a.createdAt;
      let bv: string | number = sortBy === "fileNumber" ? b.fileNumber : sortBy === "name" ? b.name : b.createdAt;
      if (sortBy === "fileNumber") {
        const an = parseInt(String(av).replace(/\D/g, ""), 10) || 0;
        const bn = parseInt(String(bv).replace(/\D/g, ""), 10) || 0;
        return sortDir === "asc" ? an - bn : bn - an;
      }
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string, "fa") : (bv as string).localeCompare(av, "fa");
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return list;
  }, [patientsList, sortBy, sortDir]);

  const SortIcon = ({ col }: { col: typeof sortBy }) => (
    <ArrowUpDown className={`h-3 w-3 mr-1 inline ${sortBy === col ? "text-primary" : "text-muted-foreground/50"}`} />
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">مراجعین</h1>
          <p className="text-muted-foreground mt-1">
            مدیریت پرونده‌ها — {toPersianDigits(patientsList?.total ?? 0)} مراجع
          </p>
        </div>
        <Button className="gap-2" onClick={() => setIsOpen(true)}>
          <Plus className="h-4 w-4" />
          مراجع جدید
        </Button>
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>ثبت مراجع جدید</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>نام و نام خانوادگی *</FormLabel>
                    <FormControl><Input placeholder="مثلا: زهرا محمدی" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="phone" render={({ field }) => (
                  <FormItem>
                    <FormLabel>شماره تماس *</FormLabel>
                    <FormControl><Input placeholder="0912..." dir="ltr" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="fileNumber" render={({ field }) => (
                  <FormItem>
                    <FormLabel>شماره پرونده *</FormLabel>
                    <FormControl><Input placeholder="P-001" dir="ltr" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>ایمیل</FormLabel>
                    <FormControl><Input placeholder="email@example.com" dir="ltr" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="birthdate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>تاریخ تولد</FormLabel>
                    <FormControl>
                      <PersianDatePicker
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="انتخاب تاریخ تولد..."
                        minYear={1330}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="gender" render={({ field }) => (
                  <FormItem>
                    <FormLabel>جنسیت</FormLabel>
                    <FormControl>
                      <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background" {...field}>
                        <option value="">انتخاب نکنید</option>
                        <option value="female">خانم</option>
                        <option value="male">آقا</option>
                      </select>
                    </FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="notes" render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>توضیحات / هشدار پزشکی</FormLabel>
                    <FormControl><Input placeholder="مثلا: حساسیت به پنی‌سیلین" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createPatient.isPending}>
                  {createPatient.isPending ? "در حال ثبت..." : "ثبت اطلاعات"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Tabs defaultValue="files">
        <TabsList className="mb-4">
          <TabsTrigger value="list" className="gap-2">
            <Users className="h-4 w-4" />
            لیست مراجعین
          </TabsTrigger>
          <TabsTrigger value="files" className="gap-2">
            <FolderOpen className="h-4 w-4" />
            پرونده‌ها
          </TabsTrigger>
        </TabsList>

        {/* ── List Tab ── */}
        <TabsContent value="list">
          <Card>
            <CardHeader className="pb-3">
              <div className="relative max-w-sm">
                <Search className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="جستجو — نام، شماره تماس..."
                  className="pl-3 pr-10"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("fileNumber")}>
                      <SortIcon col="fileNumber" />شماره پرونده
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("name")}>
                      <SortIcon col="name" />نام مراجع
                    </TableHead>
                    <TableHead>شماره تماس</TableHead>
                    <TableHead>معرف</TableHead>
                    <TableHead>موجودی اکانت</TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("createdAt")}>
                      <SortIcon col="createdAt" />تاریخ ثبت
                    </TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((patient) => (
                    <TableRow key={patient.id} className="cursor-pointer hover:bg-muted/50">
                      <TableCell className="font-mono text-sm font-medium">{patient.fileNumber}</TableCell>
                      <TableCell className="font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          {patient.name}
                          <TierBadge tier={patient.tier} />
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{patient.phone}</TableCell>
                      <TableCell><ReferrerCell patient={patient} /></TableCell>
                      <TableCell className="text-sm">
                        {patient.accountBalance && patient.accountBalance > 0
                          ? <span className="text-emerald-600 font-medium">{formatCurrency(patient.accountBalance)}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatShamsiDate(patient.createdAt)}</TableCell>
                      <TableCell>
                        <Link href={`/patients/${patient.id}`}>
                          <Button variant="ghost" size="sm" className="text-primary hover:text-primary">
                            مشاهده پرونده
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!sorted.length && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                        <Users className="h-10 w-10 mx-auto mb-2 opacity-20" />
                        مراجعی یافت نشد
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Files Tab (sorted by fileNumber) ── */}
        <TabsContent value="files">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="جستجو — نام، شماره پرونده، تماس..."
                    className="pl-3 pr-10"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <p className="text-sm text-muted-foreground whitespace-nowrap">
                  {toPersianDigits(sorted.length)} پرونده — مرتب بر اساس شماره پرونده
                </p>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="font-bold text-foreground">شماره پرونده</TableHead>
                    <TableHead className="font-bold text-foreground">نام مراجع</TableHead>
                    <TableHead className="font-bold text-foreground">تماس</TableHead>
                    <TableHead className="font-bold text-foreground">معرف</TableHead>
                    <TableHead className="font-bold text-foreground">جنسیت</TableHead>
                    <TableHead className="font-bold text-foreground">تاریخ ثبت</TableHead>
                    <TableHead className="font-bold text-foreground">هشدار</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...(patientsList?.data ?? [])]
                    .sort((a, b) => {
                      const an = parseInt(a.fileNumber.replace(/\D/g, ""), 10) || 0;
                      const bn = parseInt(b.fileNumber.replace(/\D/g, ""), 10) || 0;
                      return an - bn;
                    })
                    .map((patient) => (
                      <TableRow
                        key={patient.id}
                        className="cursor-pointer hover:bg-primary/5 transition-colors group"
                        onClick={() => navigate(`/patients/${patient.id}`)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <FileText className="h-3.5 w-3.5 text-primary opacity-60" />
                            <span className="font-mono font-bold text-primary">{patient.fileNumber}</span>
                          </div>
                        </TableCell>
                        <TableCell className="font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            {patient.name}
                            <TierBadge tier={patient.tier} />
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-sm font-mono">
                            <Phone className="h-3 w-3 text-muted-foreground" />
                            {patient.phone}
                          </div>
                        </TableCell>
                        <TableCell><ReferrerCell patient={patient} /></TableCell>
                        <TableCell>
                          {patient.gender
                            ? <Badge variant="outline" className="text-xs">{patient.gender === "female" ? "خانم" : patient.gender === "male" ? "آقا" : patient.gender}</Badge>
                            : <span className="text-muted-foreground text-sm">—</span>
                          }
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatShamsiDate(patient.createdAt)}</TableCell>
                        <TableCell>
                          {patient.notes
                            ? <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5 max-w-[150px] truncate block">{patient.notes}</span>
                            : <span className="text-muted-foreground text-sm">—</span>
                          }
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity">مشاهده پرونده ←</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  {!patientsList?.data.length && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                        <FolderOpen className="h-10 w-10 mx-auto mb-2 opacity-20" />
                        پرونده‌ای یافت نشد
                      </TableCell>
                    </TableRow>
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
