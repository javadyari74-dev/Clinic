import { useState } from "react";
import { PersianDatePicker } from "@/components/persian-date-picker";
import { useParams, useLocation } from "wouter";
import {
  useGetPatient, useListPatientAppointments, useListPatientNotes,
  useCreatePatientNote, useDeletePatientNote, getListPatientNotesQueryKey,
  useListServices, useListStaff, useCreateAppointment, getListAppointmentsQueryKey,
  useUpdatePatient, getGetPatientQueryKey, getListPatientsQueryKey,
  useCreateReminder, getListRemindersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, formatShamsiDate, toPersianDigits, formatBirthdate } from "@/lib/format";
import {
  ArrowRight, Plus, Trash2, Phone, FileText, StickyNote,
  CalendarDays, CalendarPlus, Mail, User, AlertCircle, Clock, Pencil, History, Bell
} from "lucide-react";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { useToast } from "@/hooks/use-toast";

const statuses: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  scheduled: { label: "رزرو شده", variant: "secondary" },
  confirmed: { label: "تایید شده", variant: "outline" },
  arrived: { label: "حاضر شده", variant: "outline" },
  in_progress: { label: "در حال انجام", variant: "outline" },
  completed: { label: "تکمیل شده", variant: "default" },
  cancelled: { label: "لغو شده", variant: "destructive" },
  no_show: { label: "غیبت", variant: "destructive" },
};

export default function PatientDetail() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const id = Number(params.id);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string } | null>(null);
  const [noteText, setNoteText] = useState("");
  const [apptOpen, setApptOpen] = useState(false);
  const [apptServiceId, setApptServiceId] = useState("");
  const [apptStaffId, setApptStaffId] = useState("");
  const [apptDate, setApptDate] = useState("");
  const [apptTime, setApptTime] = useState("10:00");
  const [apptNotes, setApptNotes] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "", phone: "", fileNumber: "", email: "", birthdate: "", gender: "", notes: "",
  });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [histServiceId, setHistServiceId] = useState("");
  const [histStaffId, setHistStaffId] = useState("");
  const [histDate, setHistDate] = useState("");
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderAppt, setReminderAppt] = useState<any | null>(null);
  const [remTitle, setRemTitle] = useState("");
  const [remDesc, setRemDesc] = useState("");
  const [remDate, setRemDate] = useState("");

  const { data: patient, isLoading } = useGetPatient(id);
  const { data: appointments } = useListPatientAppointments(id);
  const { data: notes } = useListPatientNotes(id);
  const { data: services } = useListServices();
  const { data: staff } = useListStaff();

  const createNote = useCreatePatientNote({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPatientNotesQueryKey(id) });
        setNoteText("");
        toast({ title: "یادداشت ثبت شد" });
      },
    },
  });

  const deleteNote = useDeletePatientNote({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPatientNotesQueryKey(id) });
        toast({ title: "یادداشت حذف شد" });
      },
    },
  });

  const createAppt = useCreateAppointment({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
        queryClient.invalidateQueries({ queryKey: [`/api/patients/${id}/appointments`] });
        toast({ title: "نوبت با موفقیت ثبت شد" });
        setApptOpen(false);
        setApptServiceId(""); setApptStaffId(""); setApptDate(""); setApptTime("10:00"); setApptNotes("");
      },
    },
  });

  const updatePatient = useUpdatePatient({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetPatientQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListPatientsQueryKey() });
        toast({ title: "پرونده با موفقیت ویرایش شد" });
        setEditOpen(false);
      },
      onError: () => toast({ title: "خطا در ویرایش پرونده", variant: "destructive" }),
    },
  });

  const createHistory = useCreateAppointment({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
        queryClient.invalidateQueries({ queryKey: [`/api/patients/${id}/appointments`] });
        toast({ title: "سابقه با موفقیت ثبت شد" });
        setHistoryOpen(false);
        setHistServiceId(""); setHistStaffId(""); setHistDate("");
      },
      onError: () => toast({ title: "خطا در ثبت سابقه", variant: "destructive" }),
    },
  });

  const createReminder = useCreateReminder({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRemindersQueryKey() });
        toast({ title: "یادآوری ثبت شد" });
        setReminderOpen(false);
        setReminderAppt(null);
        setRemTitle(""); setRemDesc(""); setRemDate("");
      },
      onError: () => toast({ title: "خطا در ثبت یادآوری", variant: "destructive" }),
    },
  });

  function openEditPatient() {
    if (!patient) return;
    setEditForm({
      name: patient.name ?? "",
      phone: patient.phone ?? "",
      fileNumber: patient.fileNumber ?? "",
      email: patient.email ?? "",
      birthdate: patient.birthdate ?? "",
      gender: patient.gender ?? "",
      notes: patient.notes ?? "",
    });
    setEditOpen(true);
  }

  function submitEditPatient() {
    if (!editForm.name.trim() || !editForm.phone.trim() || !editForm.fileNumber.trim()) {
      toast({ title: "نام، تماس و شماره پرونده الزامی است", variant: "destructive" });
      return;
    }
    updatePatient.mutate({
      id,
      data: {
        name: editForm.name.trim(),
        phone: editForm.phone.trim(),
        fileNumber: editForm.fileNumber.trim(),
        email: editForm.email.trim() || null,
        birthdate: editForm.birthdate || null,
        gender: editForm.gender || null,
        notes: editForm.notes.trim() || null,
      },
    });
  }

  function submitAppt() {
    if (!apptServiceId || !apptDate) {
      toast({ title: "خدمت و تاریخ الزامی است", variant: "destructive" });
      return;
    }
    const [y, m, d] = apptDate.split("-").map(Number);
    const [h, min] = apptTime.split(":").map(Number);
    const dt = new Date(y, m - 1, d, h, min);
    createAppt.mutate({
      data: {
        patientId: id,
        serviceId: Number(apptServiceId),
        staffId: apptStaffId ? Number(apptStaffId) : undefined,
        scheduledAt: Math.floor(dt.getTime() / 1000),
        status: "scheduled",
        notes: apptNotes || undefined,
      },
    });
  }

  function submitHistory() {
    if (!histServiceId || !histDate) {
      toast({ title: "خدمت و تاریخ الزامی است", variant: "destructive" });
      return;
    }
    const svc = services?.find(s => String(s.id) === histServiceId);
    const price = svc
      ? (svc.priceMode === "per_unit" ? svc.price * (svc.unitCount ?? 1) : svc.price)
      : undefined;
    const [y, m, d] = histDate.split("-").map(Number);
    const dt = new Date(y, m - 1, d, 12, 0, 0);
    if (dt.getTime() > Date.now()) {
      toast({ title: "تاریخ سابقه نباید در آینده باشد", variant: "destructive" });
      return;
    }
    createHistory.mutate({
      data: {
        patientId: id,
        serviceId: Number(histServiceId),
        staffId: histStaffId ? Number(histStaffId) : undefined,
        scheduledAt: Math.floor(dt.getTime() / 1000),
        status: "completed",
        price,
      },
    });
  }

  function openReminder(a: any) {
    setReminderAppt(a);
    setRemTitle(`پیگیری ${a.serviceName ?? "خدمت"} — ${patient?.name ?? ""}`);
    setRemDesc("");
    setRemDate("");
    setReminderOpen(true);
  }

  function submitReminder() {
    if (!remTitle.trim() || !remDate) {
      toast({ title: "عنوان و تاریخ یادآوری الزامی است", variant: "destructive" });
      return;
    }
    const [y, m, d] = remDate.split("-").map(Number);
    const dt = new Date(y, m - 1, d, 12, 0, 0);
    createReminder.mutate({
      data: {
        title: remTitle.trim(),
        description: remDesc.trim() || undefined,
        type: "followup",
        patientId: id,
        dueAt: Math.floor(dt.getTime() / 1000),
        status: "pending",
      },
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Clock className="h-5 w-5 ml-2 animate-spin" />
        در حال بارگذاری...
      </div>
    );
  }
  if (!patient) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        مراجع یافت نشد
      </div>
    );
  }

  const apptList = appointments?.data ?? [];
  const upcoming = apptList.filter(a => a.scheduledAt > Math.floor(Date.now() / 1000));
  const past = apptList.filter(a => a.scheduledAt <= Math.floor(Date.now() / 1000));
  const totalSpent = past.filter(a => a.status === "completed" && a.price).reduce((s, a) => s + (a.price ?? 0), 0);
  const histService = services?.find(s => String(s.id) === histServiceId);
  const histPrice = histService
    ? (histService.priceMode === "per_unit" ? histService.price * (histService.unitCount ?? 1) : histService.price)
    : 0;

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <ConfirmDeleteDialog
        open={!!deleteTarget}
        title="حذف یادداشت"
        description="آیا از حذف این یادداشت مطمئن هستید؟ این عمل قابل بازگشت نیست."
        onConfirm={() => { deleteNote.mutate({ id: deleteTarget!.id }); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/patients")} className="gap-1 text-muted-foreground">
          <ArrowRight className="h-4 w-4" />
          بازگشت
        </Button>
        <Separator orientation="vertical" className="h-5" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{patient.name}</h1>
          <p className="text-sm text-muted-foreground">پرونده مراجع</p>
        </div>
        <div className="mr-auto flex items-center gap-2">
          <Button size="sm" variant="outline" className="gap-2" onClick={openEditPatient}>
            <Pencil className="h-4 w-4" />
            ویرایش پرونده
          </Button>
          <Button size="sm" className="gap-2" onClick={() => setApptOpen(true)}>
            <CalendarPlus className="h-4 w-4" />
            دریافت نوبت
          </Button>
        </div>
      </div>

      {/* Patient Info Card */}
      <Card>
        <CardContent className="pt-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <FileText className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">شماره پرونده</p>
                <p className="font-mono font-bold">{patient.fileNumber}</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Phone className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">تماس</p>
                <p className="font-mono">{patient.phone}</p>
              </div>
            </div>
            {patient.email && (
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">ایمیل</p>
                  <p className="text-sm">{patient.email}</p>
                </div>
              </div>
            )}
            {patient.birthdate && (
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                  <User className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">تاریخ تولد</p>
                  <p className="text-sm">{formatBirthdate(patient.birthdate)}</p>
                </div>
              </div>
            )}
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">تاریخ ثبت</p>
                <p className="text-sm">{formatShamsiDate(patient.createdAt)}</p>
              </div>
            </div>
            {patient.gender && (
              <div className="flex items-center gap-2.5">
                <Badge variant="outline" className="h-8 px-3">{patient.gender === "female" ? "خانم" : patient.gender === "male" ? "آقا" : patient.gender}</Badge>
              </div>
            )}
          </div>
          {patient.notes && (
            <div className="mt-4 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-amber-800"><strong>هشدار: </strong>{patient.notes}</p>
            </div>
          )}
          {totalSpent > 0 && (
            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground border-t pt-3">
              <span>مجموع پرداخت‌ها:</span>
              <span className="font-bold text-green-700">{formatCurrency(totalSpent)}</span>
              <span className="mr-2">تعداد نوبت:</span>
              <span className="font-bold">{toPersianDigits(apptList.length)} نوبت</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Notes Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <StickyNote className="h-4 w-4 text-primary" />
            یادداشت‌های پرونده
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 mb-4">
            <Button
              size="sm"
              className="h-10 w-10 flex-shrink-0 p-0"
              onClick={() => noteText.trim() && createNote.mutate({ id, data: { content: noteText } })}
              disabled={createNote.isPending || !noteText.trim()}
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Input
              placeholder="یادداشت جدید..."
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && noteText.trim()) {
                  createNote.mutate({ id, data: { content: noteText } });
                }
              }}
            />
          </div>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {(notes as any[])?.map((n) => (
              <div key={n.id} className="flex items-start justify-between gap-2 p-3 bg-muted/50 rounded-lg text-sm border">
                <div className="flex-1">
                  <p>{n.content}</p>
                  <p className="text-xs text-muted-foreground mt-1">{formatShamsiDate(n.createdAt, true)}</p>
                </div>
                <Button variant="ghost" size="sm" className="text-destructive shrink-0 h-6 w-6 p-0" onClick={() => setDeleteTarget({ id: n.id, label: 'این یادداشت' })}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
            {!notes?.length && (
              <p className="text-center text-muted-foreground text-sm py-6">یادداشتی ثبت نشده</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Appointments Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-primary" />
              سابقه نوبت‌ها
              {apptList.length > 0 && (
                <Badge variant="secondary" className="text-xs">{toPersianDigits(apptList.length)}</Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={() => setHistoryOpen(true)}>
                <History className="h-3 w-3" />
                افزودن سابقه
              </Button>
              <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={() => setApptOpen(true)}>
                <Plus className="h-3 w-3" />
                نوبت جدید
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>تاریخ</TableHead>
                <TableHead>خدمت</TableHead>
                <TableHead>پزشک</TableHead>
                <TableHead>قیمت</TableHead>
                <TableHead>وضعیت</TableHead>
                <TableHead className="text-center">یادآوری</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apptList.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">نوبتی ثبت نشده</TableCell>
                </TableRow>
              )}
              {upcoming.map((a) => (
                <TableRow key={a.id} className="bg-blue-50/50">
                  <TableCell className="font-medium text-sm">{formatShamsiDate(a.scheduledAt, true)}</TableCell>
                  <TableCell>{a.serviceName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{a.staffName || "—"}</TableCell>
                  <TableCell className="font-mono text-sm">{a.price ? formatCurrency(a.price) : "—"}</TableCell>
                  <TableCell>
                    <Badge variant={statuses[a.status]?.variant ?? "secondary"} className="text-xs">
                      {statuses[a.status]?.label ?? a.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-orange-600 hover:text-orange-700 hover:bg-orange-50" onClick={() => openReminder(a)} title="ثبت یادآوری">
                      <Bell className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {past.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="text-sm text-muted-foreground">{formatShamsiDate(a.scheduledAt, true)}</TableCell>
                  <TableCell>{a.serviceName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{a.staffName || "—"}</TableCell>
                  <TableCell className="font-mono text-sm">{a.price ? formatCurrency(a.price) : "—"}</TableCell>
                  <TableCell>
                    <Badge variant={statuses[a.status]?.variant ?? "secondary"} className="text-xs">
                      {statuses[a.status]?.label ?? a.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-orange-600 hover:text-orange-700 hover:bg-orange-50" onClick={() => openReminder(a)} title="ثبت یادآوری">
                      <Bell className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* New Appointment Dialog */}
      <Dialog open={apptOpen} onOpenChange={setApptOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarPlus className="h-5 w-5 text-primary" />
              دریافت نوبت — {patient.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm mb-1.5 block">خدمت *</Label>
              <Select value={apptServiceId} onValueChange={setApptServiceId}>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب خدمت..." />
                </SelectTrigger>
                <SelectContent>
                  {services?.map(s => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm mb-1.5 block">پزشک / متخصص</Label>
              <Select value={apptStaffId} onValueChange={setApptStaffId}>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب..." />
                </SelectTrigger>
                <SelectContent>
                  {staff?.map(s => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm mb-1.5 block">تاریخ *</Label>
                <PersianDatePicker value={apptDate} onChange={setApptDate} placeholder="انتخاب تاریخ" />
              </div>
              <div>
                <Label className="text-sm mb-1.5 block">ساعت</Label>
                <Input type="time" dir="ltr" value={apptTime} onChange={e => setApptTime(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-sm mb-1.5 block">یادداشت</Label>
              <Input placeholder="توضیحات اضافی..." value={apptNotes} onChange={e => setApptNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setApptOpen(false)}>انصراف</Button>
            <Button onClick={submitAppt} disabled={createAppt.isPending}>
              {createAppt.isPending ? "در حال ثبت..." : "ثبت نوبت"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Patient Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-primary" />
              ویرایش پرونده مراجع
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm mb-1.5 block">نام و نام خانوادگی *</Label>
                <Input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <Label className="text-sm mb-1.5 block">شماره پرونده *</Label>
                <Input value={editForm.fileNumber} onChange={e => setEditForm(f => ({ ...f, fileNumber: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm mb-1.5 block">تماس *</Label>
                <Input dir="ltr" value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div>
                <Label className="text-sm mb-1.5 block">ایمیل</Label>
                <Input dir="ltr" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm mb-1.5 block">تاریخ تولد</Label>
                <PersianDatePicker
                  value={editForm.birthdate}
                  onChange={v => setEditForm(f => ({ ...f, birthdate: v }))}
                  placeholder="انتخاب تاریخ تولد"
                />
              </div>
              <div>
                <Label className="text-sm mb-1.5 block">جنسیت</Label>
                <Select value={editForm.gender || undefined} onValueChange={v => setEditForm(f => ({ ...f, gender: v }))}>
                  <SelectTrigger><SelectValue placeholder="انتخاب..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="female">خانم</SelectItem>
                    <SelectItem value="male">آقا</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-sm mb-1.5 block">یادداشت / هشدار</Label>
              <Textarea rows={2} value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} placeholder="توضیحات اضافی..." />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditOpen(false)}>انصراف</Button>
            <Button onClick={submitEditPatient} disabled={updatePatient.isPending}>
              {updatePatient.isPending ? "در حال ذخیره..." : "ذخیره تغییرات"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add History Dialog */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5 text-primary" />
              افزودن سابقه — {patient.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm mb-1.5 block">مراجع</Label>
              <Input value={patient.name} readOnly disabled />
            </div>
            <div>
              <Label className="text-sm mb-1.5 block">خدمت *</Label>
              <Select value={histServiceId} onValueChange={setHistServiceId}>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب خدمت..." />
                </SelectTrigger>
                <SelectContent>
                  {services?.map(s => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm mb-1.5 block">پزشک / متخصص</Label>
              <Select value={histStaffId} onValueChange={setHistStaffId}>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب..." />
                </SelectTrigger>
                <SelectContent>
                  {staff?.map(s => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm mb-1.5 block">تاریخ خدمت *</Label>
              <PersianDatePicker value={histDate} onChange={setHistDate} placeholder="انتخاب تاریخ" />
            </div>
            {histServiceId && (
              <div className="flex items-center justify-between text-sm bg-muted/50 rounded-lg px-3 py-2">
                <span className="text-muted-foreground">قیمت خدمت</span>
                <span className="font-bold text-green-700 font-mono">{formatCurrency(histPrice)}</span>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              این سابقه با وضعیت «تکمیل شده» ثبت می‌شود و در صندوق ثبت نمی‌گردد.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setHistoryOpen(false)}>انصراف</Button>
            <Button onClick={submitHistory} disabled={createHistory.isPending}>
              {createHistory.isPending ? "در حال ثبت..." : "ثبت سابقه"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reminder Dialog */}
      <Dialog open={reminderOpen} onOpenChange={setReminderOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-primary" />
              ثبت یادآوری
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm mb-1.5 block">عنوان *</Label>
              <Input value={remTitle} onChange={e => setRemTitle(e.target.value)} placeholder="عنوان یادآوری..." />
            </div>
            <div>
              <Label className="text-sm mb-1.5 block">توضیحات</Label>
              <Input value={remDesc} onChange={e => setRemDesc(e.target.value)} placeholder="توضیحات (اختیاری)..." />
            </div>
            <div>
              <Label className="text-sm mb-1.5 block">تاریخ سررسید *</Label>
              <PersianDatePicker value={remDate} onChange={setRemDate} placeholder="انتخاب تاریخ سررسید" />
            </div>
            {reminderAppt && (
              <p className="text-xs text-muted-foreground">
                مربوط به: {reminderAppt.serviceName ?? "خدمت"} — {patient.name}
              </p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReminderOpen(false)}>انصراف</Button>
            <Button onClick={submitReminder} disabled={createReminder.isPending}>
              {createReminder.isPending ? "در حال ثبت..." : "ثبت یادآوری"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
