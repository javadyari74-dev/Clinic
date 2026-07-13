import { useState } from "react";
import { PersianDatePicker } from "@/components/persian-date-picker";
import { useParams, useLocation } from "wouter";
import {
  useGetPatient, useListPatientAppointments, useListPatientNotes,
  useCreatePatientNote, useDeletePatientNote, getListPatientNotesQueryKey,
  useListServices, useListStaff, useCreateAppointment, getListAppointmentsQueryKey,
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
import { formatCurrency, formatShamsiDate, toPersianDigits } from "@/lib/format";
import {
  ArrowRight, Plus, Trash2, Phone, FileText, StickyNote,
  CalendarDays, CalendarPlus, Mail, User, AlertCircle, Clock
} from "lucide-react";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { ErrorNotice } from "@/components/error-notice";
import { TierBadge } from "@/components/tier-badge";
import { PATIENT_TIERS } from "@/lib/tiers";
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

  const { data: patient, isLoading, isError, refetch } = useGetPatient(id);
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Clock className="h-5 w-5 ml-2 animate-spin" />
        در حال بارگذاری...
      </div>
    );
  }
  if (isError) {
    return (
      <div className="max-w-3xl mx-auto py-8">
        <ErrorNotice onRetry={() => refetch()} />
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
        <div className="mr-auto">
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
                  <p className="text-sm">{patient.birthdate}</p>
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
            <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={() => setApptOpen(true)}>
              <Plus className="h-3 w-3" />
              نوبت جدید
            </Button>
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {apptList.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">نوبتی ثبت نشده</TableCell>
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
    </div>
  );
}
