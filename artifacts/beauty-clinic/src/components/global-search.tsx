import { useState, useRef, useEffect } from "react";
import { PersianDatePicker } from "@/components/persian-date-picker";
import {
  useListPatients, useListPatientAppointments, useListPatientNotes,
  useCreateAppointment, getListAppointmentsQueryKey,
  useListServices, useListStaff, useListPayments,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatCurrency, formatShamsiDate, toPersianDigits } from "@/lib/format";
import {
  Search, X, User, Phone, FileText, CalendarDays, CreditCard,
  Clock, CheckCircle, XCircle, CalendarPlus, ChevronDown, StickyNote,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

const statusLabels: Record<string, { label: string; color: string }> = {
  scheduled: { label: "رزرو شده", color: "bg-blue-100 text-blue-700" },
  confirmed: { label: "تایید شده", color: "bg-green-100 text-green-700" },
  completed: { label: "تکمیل شده", color: "bg-gray-100 text-gray-700" },
  cancelled: { label: "لغو شده", color: "bg-red-100 text-red-700" },
  no_show: { label: "حاضر نشده", color: "bg-orange-100 text-orange-700" },
};

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function PatientProfile({ patientId, onClose }: { patientId: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [showNewAppt, setShowNewAppt] = useState(false);

  // Patient data
  const { data: appts } = useListPatientAppointments(patientId);
  const { data: notes } = useListPatientNotes(patientId);
  const { data: services } = useListServices();
  const { data: staff } = useListStaff();

  // New appointment form state
  const [apptServiceId, setApptServiceId] = useState<string>("");
  const [apptStaffId, setApptStaffId] = useState<string>("");
  const [apptDate, setApptDate] = useState("");
  const [apptTime, setApptTime] = useState("10:00");
  const [apptNotes, setApptNotes] = useState("");

  const createAppt = useCreateAppointment({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
        toast({ title: "نوبت با موفقیت ثبت شد" });
        setShowNewAppt(false);
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
        patientId,
        serviceId: Number(apptServiceId),
        staffId: apptStaffId ? Number(apptStaffId) : undefined,
        scheduledAt: Math.floor(dt.getTime() / 1000),
        status: "scheduled",
        notes: apptNotes || undefined,
      },
    });
  }

  const apptList = appts?.data ?? [];
  const upcoming = apptList.filter(a => a.scheduledAt > Math.floor(Date.now() / 1000));
  const past = apptList.filter(a => a.scheduledAt <= Math.floor(Date.now() / 1000));

  return (
    <div className="space-y-4">
      {/* Appointments */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2 text-sm">
            <CalendarDays className="h-4 w-4 text-pink-600" />
            نوبت‌ها ({toPersianDigits(apptList.length)})
          </h3>
          <Button
            size="sm"
            className="gap-1 h-7 text-xs"
            onClick={() => setShowNewAppt(v => !v)}
          >
            <CalendarPlus className="h-3 w-3" />
            دریافت نوبت
          </Button>
        </div>

        {/* New Appointment Form */}
        {showNewAppt && (
          <div className="rounded-lg border border-pink-200 bg-pink-50/50 p-3 mb-3 space-y-3">
            <p className="text-xs font-medium text-pink-700">ثبت نوبت جدید</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs mb-1 block">خدمت *</Label>
                <Select value={apptServiceId} onValueChange={setApptServiceId}>
                  <SelectTrigger className="h-8 text-xs">
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
                <Label className="text-xs mb-1 block">پزشک / متخصص</Label>
                <Select value={apptStaffId} onValueChange={setApptStaffId}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="انتخاب..." />
                  </SelectTrigger>
                  <SelectContent>
                    {staff?.map(s => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs mb-1 block">تاریخ *</Label>
                <PersianDatePicker value={apptDate} onChange={setApptDate} placeholder="انتخاب تاریخ" />
              </div>
              <div>
                <Label className="text-xs mb-1 block">ساعت</Label>
                <Input type="time" className="h-8 text-xs" value={apptTime} onChange={e => setApptTime(e.target.value)} dir="ltr" />
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1 block">یادداشت</Label>
              <Input className="h-8 text-xs" value={apptNotes} onChange={e => setApptNotes(e.target.value)} placeholder="توضیحات اضافی..." />
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs flex-1" onClick={submitAppt} disabled={createAppt.isPending}>
                {createAppt.isPending ? "در حال ثبت..." : "ثبت نوبت"}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowNewAppt(false)}>انصراف</Button>
            </div>
          </div>
        )}

        {/* Upcoming */}
        {upcoming.length > 0 && (
          <div className="mb-2">
            <p className="text-xs text-muted-foreground mb-1 font-medium">نوبت‌های آینده</p>
            <div className="space-y-1">
              {upcoming.map(a => (
                <div key={a.id} className="flex items-center justify-between rounded-md bg-blue-50 px-3 py-2 text-xs">
                  <div>
                    <span className="font-medium">{a.serviceName}</span>
                    {a.staffName && <span className="text-muted-foreground"> — {a.staffName}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{formatShamsiDate(a.scheduledAt, true)}</span>
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${statusLabels[a.status]?.color ?? "bg-gray-100"}`}>
                      {statusLabels[a.status]?.label ?? a.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Past */}
        {past.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-1 font-medium">سابقه نوبت‌ها</p>
            <div className="space-y-1">
              {past.slice(0, 5).map(a => (
                <div key={a.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-xs">
                  <div>
                    <span className="font-medium">{a.serviceName}</span>
                    {a.staffName && <span className="text-muted-foreground"> — {a.staffName}</span>}
                    {a.price && <span className="text-green-600 mr-2">{formatCurrency(a.price)}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{formatShamsiDate(a.scheduledAt)}</span>
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${statusLabels[a.status]?.color ?? "bg-gray-100"}`}>
                      {statusLabels[a.status]?.label ?? a.status}
                    </span>
                  </div>
                </div>
              ))}
              {past.length > 5 && (
                <p className="text-xs text-center text-muted-foreground">{toPersianDigits(past.length - 5)} نوبت دیگر...</p>
              )}
            </div>
          </div>
        )}

        {apptList.length === 0 && (
          <p className="text-xs text-center text-muted-foreground py-3">نوبتی ثبت نشده</p>
        )}
      </div>

      {/* Notes */}
      {notes && notes.length > 0 && (
        <>
          <Separator />
          <div>
            <h3 className="font-semibold flex items-center gap-2 text-sm mb-2">
              <StickyNote className="h-4 w-4 text-pink-600" />
              یادداشت‌های پرونده
            </h3>
            <div className="space-y-1">
              {notes.map((n: any) => (
                <div key={n.id} className="rounded-md bg-amber-50 border border-amber-100 px-3 py-2 text-xs">
                  <p>{n.text}</p>
                  <p className="text-muted-foreground mt-1">{formatShamsiDate(n.createdAt)}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Quick actions */}
      <Separator />
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          className="text-xs flex-1"
          onClick={() => { navigate(`/patients/${patientId}`); onClose(); }}
        >
          <User className="h-3 w-3 ml-1" />
          مشاهده پرونده کامل
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-xs flex-1"
          onClick={() => { navigate(`/appointments`); onClose(); }}
        >
          <CalendarDays className="h-3 w-3 ml-1" />
          لیست نوبت‌ها
        </Button>
      </div>
    </div>
  );
}

export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<{
    id: number; name: string; fileNumber: string; phone: string;
    email?: string | null; birthdate?: string | null; notes?: string | null; gender?: string | null;
  } | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const debouncedQuery = useDebounce(query, 300);

  const { data: patients } = useListPatients(
    debouncedQuery.length >= 2 ? { q: debouncedQuery, limit: 8 } : undefined,
    { query: { enabled: debouncedQuery.length >= 2 } }
  );

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function selectPatient(p: NonNullable<typeof patients>["data"][0]) {
    setSelectedPatient(p);
    setProfileOpen(true);
    setOpen(false);
    setQuery("");
  }

  function closeProfile() {
    setProfileOpen(false);
    setSelectedPatient(null);
  }

  return (
    <>
      <div className="relative w-full max-w-md" dir="rtl">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(e.target.value.length >= 2); }}
            onFocus={() => { if (query.length >= 2) setOpen(true); }}
            placeholder="جستجوی مراجع — نام، شماره پرونده یا تماس..."
            className="pr-9 pl-4 h-10 bg-white/90 border-border/60 text-sm"
          />
          {query && (
            <button
              onClick={() => { setQuery(""); setOpen(false); }}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Dropdown Results */}
        {open && debouncedQuery.length >= 2 && (
          <div
            ref={dropdownRef}
            className="absolute top-full mt-1 right-0 left-0 z-50 bg-white rounded-lg border shadow-lg overflow-hidden"
          >
            {!patients?.data.length ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                <User className="h-8 w-8 mx-auto mb-2 opacity-30" />
                نتیجه‌ای یافت نشد
              </div>
            ) : (
              <ul>
                {patients.data.map((p, i) => (
                  <li key={p.id}>
                    {i > 0 && <Separator />}
                    <button
                      className="w-full text-right px-4 py-3 hover:bg-muted/50 transition-colors flex items-center gap-3"
                      onClick={() => selectPatient(p)}
                    >
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <User className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{p.name}</p>
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <FileText className="h-3 w-3" />{p.fileNumber}
                          </span>
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Phone className="h-3 w-3" />{p.phone}
                          </span>
                        </div>
                      </div>
                      <ChevronDown className="h-4 w-4 text-muted-foreground rotate-[-90deg] flex-shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Patient Profile Dialog */}
      <Dialog open={profileOpen} onOpenChange={(o) => { if (!o) closeProfile(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="text-lg font-bold">{selectedPatient?.name}</div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs text-muted-foreground flex items-center gap-1 font-normal">
                    <FileText className="h-3 w-3" />پرونده: {selectedPatient?.fileNumber}
                  </span>
                  <span className="text-xs text-muted-foreground flex items-center gap-1 font-normal">
                    <Phone className="h-3 w-3" />{selectedPatient?.phone}
                  </span>
                  {selectedPatient?.gender && (
                    <Badge variant="outline" className="text-xs font-normal h-5">
                      {selectedPatient.gender === "male" ? "آقا" : selectedPatient.gender === "female" ? "خانم" : selectedPatient.gender}
                    </Badge>
                  )}
                </div>
              </div>
            </DialogTitle>
          </DialogHeader>

          {/* Patient quick info */}
          <div className="flex gap-4 flex-wrap text-sm py-2 border-y">
            {selectedPatient?.email && (
              <span className="text-muted-foreground">{selectedPatient.email}</span>
            )}
            {selectedPatient?.birthdate && (
              <span className="text-muted-foreground">تولد: {selectedPatient.birthdate}</span>
            )}
            {selectedPatient?.notes && (
              <span className="text-amber-700 bg-amber-50 rounded px-2 py-0.5 text-xs">
                توجه: {selectedPatient.notes}
              </span>
            )}
          </div>

          <ScrollArea className="flex-1 overflow-y-auto pr-1">
            {selectedPatient && (
              <PatientProfile patientId={selectedPatient.id} onClose={closeProfile} />
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
