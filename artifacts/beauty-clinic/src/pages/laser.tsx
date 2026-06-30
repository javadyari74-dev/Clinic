import React, { useState, useEffect, useCallback, useRef } from "react";
import { PriceInput } from "@/components/price-input";
import { useAuth } from "@/hooks/use-auth";
import { PersianDatePicker } from "@/components/persian-date-picker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatShamsiDate, toPersianDigits } from "@/lib/format";
import { ErrorNotice } from "@/components/error-notice";
import {
  Plus, Edit2, Trash2, Zap, User, CalendarDays, CreditCard, Scissors,
  CheckCircle2, Clock, XCircle, ChevronLeft, ChevronRight, BellRing, Phone,
  Search, ChevronDown, X,
} from "lucide-react";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");
function authHeader(): Record<string, string> {
  const token = localStorage.getItem("clinic_auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}
async function api(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "خطای سرور" }));
    throw new Error(err.message || "خطا");
  }
  if (res.status === 204) return null;
  return res.json();
}

type Gender = "male" | "female";
type ApptStatus = "scheduled" | "completed" | "cancelled";
type Client = {
  id: number; fileNumber: string; name: string; phone: string; gender: Gender;
  email?: string; birthdate?: string; skinType?: string; hairColor?: string;
  medicalHistory?: string; notes?: string; createdAt: number;
};
type Service = {
  id: number; code?: string; name: string; genderCategory: Gender; price: number;
  commissionRate: number; description?: string; isActive: boolean;
};
type Appointment = {
  id: number; appointmentCode?: string; clientId: number; serviceId: number; operatorName?: string;
  scheduledAt: number; status: ApptStatus; sessionNumber?: number;
  price?: number; notes?: string; createdAt: number;
  client?: { name: string; fileNumber: string; gender: Gender; phone: string };
  service?: { name: string; price: number; commissionRate: number };
};
type Payment = {
  id: number; appointmentId: number; amount: number; method: string;
  operatorName?: string; commissionAmount: number; notes?: string;
  nextSessionDate?: string; nextSessionNote?: string; paidAt: number;
  client?: { name: string; fileNumber: string; phone?: string };
  service?: { name: string };
  appointment?: { scheduledAt: number };
};

const GENDER_LABEL: Record<Gender, string> = { male: "آقا", female: "خانم" };
const GENDER_COLOR: Record<Gender, string> = { male: "bg-blue-100 text-blue-800", female: "bg-pink-100 text-pink-800" };
const STATUS_LABEL: Record<ApptStatus, string> = { scheduled: "فعال", completed: "تکمیل‌شده", cancelled: "لغو‌شده" };
const STATUS_ICON: Record<ApptStatus, React.ReactNode> = {
  scheduled: <Clock className="h-3.5 w-3.5" />,
  completed: <CheckCircle2 className="h-3.5 w-3.5" />,
  cancelled: <XCircle className="h-3.5 w-3.5" />,
};
const STATUS_COLOR: Record<ApptStatus, string> = {
  scheduled: "bg-yellow-100 text-yellow-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
};
const METHOD_LABEL: Record<string, string> = { cash: "نقد", card: "کارت‌خوان", transfer: "کارت به کارت" };

// ─── Searchable Client Picker ─────────────────────────────────────────────────
function ClientSearchPicker({
  clients,
  value,
  onChange,
  placeholder = "انتخاب مراجع",
}: {
  clients: Client[];
  value: number | undefined;
  onChange: (id: number) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = clients.find(c => c.id === value);

  const filtered = query.trim()
    ? clients.filter(c => {
        const q = query.toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          c.fileNumber.toLowerCase().includes(q) ||
          (c.phone || "").includes(q)
        );
      })
    : clients;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 border rounded-md px-3 h-10 text-sm bg-background hover:bg-muted/50 transition-colors"
      >
        <span className={selected ? "text-foreground" : "text-muted-foreground"}>
          {selected
            ? `${selected.name} — ${GENDER_LABEL[selected.gender]} (${selected.fileNumber})`
            : placeholder}
        </span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {selected && (
            <span
              role="button"
              onClick={e => { e.stopPropagation(); onChange(0); setQuery(""); }}
              className="text-muted-foreground hover:text-foreground p-0.5 rounded"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </div>
      </button>

      {open && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg overflow-hidden">
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute right-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="جستجو — نام، شماره پرونده یا تماس..."
                className="w-full pr-8 pl-3 py-1.5 text-sm border rounded bg-background outline-none focus:ring-1 focus:ring-ring"
                dir="rtl"
              />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-sm text-center text-muted-foreground">مراجعی یافت نشد</div>
            ) : (
              filtered.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { onChange(c.id); setOpen(false); setQuery(""); }}
                  className={`w-full text-right px-3 py-2.5 text-sm flex items-center gap-3 hover:bg-muted transition-colors ${c.id === value ? "bg-muted/70 font-medium" : ""}`}
                >
                  <span className={`flex-shrink-0 text-xs px-1.5 py-0.5 rounded-full font-medium ${GENDER_COLOR[c.gender]}`}>
                    {GENDER_LABEL[c.gender]}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium truncate">{c.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {c.fileNumber}{c.phone ? ` · ${c.phone}` : ""}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Searchable Appointment Picker ───────────────────────────────────────────
function AppointmentSearchPicker({
  appointments,
  value,
  onChange,
  placeholder = "انتخاب نوبت",
}: {
  appointments: Appointment[];
  value: number | undefined;
  onChange: (appt: Appointment | undefined) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = appointments.find(a => a.id === value);

  const filtered = query.trim()
    ? appointments.filter(a => {
        const q = query.toLowerCase();
        return (
          (a.client?.name || "").toLowerCase().includes(q) ||
          (a.client?.fileNumber || "").toLowerCase().includes(q) ||
          (a.client?.phone || "").includes(q) ||
          (a.service?.name || "").toLowerCase().includes(q)
        );
      })
    : appointments;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 border rounded-md px-3 h-10 text-sm bg-background hover:bg-muted/50 transition-colors"
      >
        <span className={selected ? "text-foreground truncate" : "text-muted-foreground"}>
          {selected
            ? `${selected.client?.name} — ${selected.service?.name}`
            : placeholder}
        </span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {selected && (
            <span role="button" onClick={e => { e.stopPropagation(); onChange(undefined); setQuery(""); }}
              className="text-muted-foreground hover:text-foreground p-0.5 rounded">
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </div>
      </button>

      {open && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg overflow-hidden">
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute right-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="جستجو — نام، پرونده، تماس یا خدمت..."
                className="w-full pr-8 pl-3 py-1.5 text-sm border rounded bg-background outline-none focus:ring-1 focus:ring-ring"
                dir="rtl"
              />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-sm text-center text-muted-foreground">نوبتی یافت نشد</div>
            ) : (
              filtered.map(a => (
                <button key={a.id} type="button"
                  onClick={() => { onChange(a); setOpen(false); setQuery(""); }}
                  className={`w-full text-right px-3 py-2.5 text-sm flex items-start gap-3 hover:bg-muted transition-colors ${a.id === value ? "bg-muted/70 font-medium" : ""}`}>
                  <CalendarDays className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium truncate">{a.client?.name} — {a.service?.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {a.client?.fileNumber}{a.client?.phone ? ` · ${a.client.phone}` : ""} · {new Date(a.scheduledAt).toLocaleDateString("fa-IR")}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatDateTime(ts: number | string | null | undefined) {
  if (!ts) return "—";
  const n = Number(ts);
  const ms = n < 1e12 ? n * 1000 : n;
  return formatShamsiDate(Math.floor(ms / 1000), true);
}

// Print a receipt by writing its HTML into a hidden iframe (works in browser + Electron)
function printReceiptHtml(bodyHtml: string) {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) { document.body.removeChild(iframe); return; }
  doc.open();
  doc.write(
    `<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><title>رسید پرداخت</title>` +
    `<style>body{font-family:Tahoma,Arial,sans-serif;padding:24px;color:#111}` +
    `h2{text-align:center;margin:0 0 2px}.sub{text-align:center;color:#666;font-size:12px;margin:0 0 16px}` +
    `table{width:100%;border-collapse:collapse}td{padding:8px 6px;border-bottom:1px solid #eee;font-size:14px}` +
    `td.l{color:#666;width:42%}td.v{font-weight:bold;text-align:left}.total td.v{color:#15803d;font-size:16px}</style>` +
    `</head><body>${bodyHtml}</body></html>`,
  );
  doc.close();
  iframe.contentWindow?.focus();
  setTimeout(() => {
    iframe.contentWindow?.print();
    setTimeout(() => document.body.removeChild(iframe), 500);
  }, 250);
}

// ─── Clients Tab ──────────────────────────────────────────────────────────────
function ClientsTab() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<Partial<Client>>({});
  const { toast } = useToast();
  const { user } = useAuth();

  const load = useCallback(async () => {
    setLoading(true);
    try { setClients(await api("/laser/clients")); setError(false); } catch { setError(true); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openNew = () => { setEditing(null); setForm({}); setOpen(true); };
  const openEdit = (c: Client) => { setEditing(c); setForm(c); setOpen(true); };

  const save = async () => {
    if (!form.fileNumber || !form.name || !form.phone || !form.gender) {
      toast({ title: "خطا", description: "شماره پرونده، نام، تلفن و جنسیت الزامی است", variant: "destructive" }); return;
    }
    try {
      if (editing) await api(`/laser/clients/${editing.id}`, "PUT", form);
      else await api("/laser/clients", "POST", form);
      toast({ title: "ذخیره شد" });
      setOpen(false); load();
    } catch (e: any) { toast({ title: "خطا", description: e.message, variant: "destructive" }); }
  };

  const del = async (id: number) => {
    if (!confirm("مراجع حذف شود؟")) return;
    try { await api(`/laser/clients/${id}`, "DELETE"); load(); } catch (e: any) {
      toast({ title: "خطا", description: e.message, variant: "destructive" });
    }
  };

  const filtered = clients.filter(c =>
    c.name.includes(search) || c.phone.includes(search) || c.fileNumber.includes(search)
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center">
        <Input placeholder="جستجو نام، تلفن، پرونده..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
        <Button onClick={openNew} className="mr-auto bg-rose-700 hover:bg-rose-800 text-white">
          <Plus className="h-4 w-4 ml-1" /> مراجع جدید
        </Button>
      </div>

      {error ? <ErrorNotice onRetry={() => load()} /> : loading ? <p className="text-center text-muted-foreground py-8">در حال بارگذاری...</p> : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <User className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>هیچ مراجعی یافت نشد</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {["پرونده", "نام", "جنسیت", "تلفن", "نوع پوست", "رنگ مو", ""].map(h => (
                  <th key={h} className="px-3 py-2.5 text-right font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(c => (
                <tr key={c.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{toPersianDigits(c.fileNumber)}</td>
                  <td className="px-3 py-2.5 font-medium">{c.name}</td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${GENDER_COLOR[c.gender]}`}>
                      {GENDER_LABEL[c.gender]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono">{c.phone}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{c.skinType || "—"}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{c.hairColor || "—"}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1 justify-end">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(c)}><Edit2 className="h-3.5 w-3.5" /></Button>
                      {user?.role === "admin" && (
                        <Button size="icon" variant="ghost" className="text-red-500 hover:text-red-700" onClick={() => del(c.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "ویرایش مراجع" : "مراجع جدید"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>شماره پرونده *</Label><Input value={form.fileNumber || ""} onChange={e => setForm(f => ({ ...f, fileNumber: e.target.value }))} /></div>
            <div><Label>نام و نام خانوادگی *</Label><Input value={form.name || ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><Label>شماره تماس *</Label><Input value={form.phone || ""} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
            <div>
              <Label>جنسیت *</Label>
              <Select value={form.gender || ""} onValueChange={v => setForm(f => ({ ...f, gender: v as Gender }))}>
                <SelectTrigger><SelectValue placeholder="انتخاب کنید" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">آقا</SelectItem>
                  <SelectItem value="female">خانم</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>ایمیل</Label><Input value={form.email || ""} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
            <div><Label>تاریخ تولد</Label><PersianDatePicker value={form.birthdate || ""} onChange={v => setForm(f => ({ ...f, birthdate: v }))} placeholder="انتخاب تاریخ تولد" /></div>
            <div><Label>نوع پوست</Label><Input value={form.skinType || ""} placeholder="مثال: روشن، مختلط" onChange={e => setForm(f => ({ ...f, skinType: e.target.value }))} /></div>
            <div><Label>رنگ مو</Label><Input value={form.hairColor || ""} placeholder="مثال: مشکی، بور" onChange={e => setForm(f => ({ ...f, hairColor: e.target.value }))} /></div>
            <div className="col-span-2"><Label>سابقه پزشکی</Label><Textarea rows={2} value={form.medicalHistory || ""} onChange={e => setForm(f => ({ ...f, medicalHistory: e.target.value }))} /></div>
            <div className="col-span-2"><Label>یادداشت</Label><Textarea rows={2} value={form.notes || ""} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>انصراف</Button>
            <Button onClick={save} className="bg-rose-700 hover:bg-rose-800 text-white">ذخیره</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Services Tab ─────────────────────────────────────────────────────────────
function ServicesTab() {
  const [services, setServices] = useState<Service[]>([]);
  const [globalRate, setGlobalRate] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [form, setForm] = useState<Partial<Service>>({});
  const [genderTab, setGenderTab] = useState<Gender>("female");
  const { toast } = useToast();
  const { user } = useAuth();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [svcs, settings] = await Promise.all([api("/laser/services"), api("/laser/settings")]);
      setServices(svcs);
      setGlobalRate(settings?.commissionRate ?? 0);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = services.filter(s => s.genderCategory === genderTab);

  const openNew = () => { setEditing(null); setForm({ genderCategory: genderTab, commissionRate: globalRate, isActive: true }); setOpen(true); };
  const openEdit = (s: Service) => { setEditing(s); setForm({ ...s, commissionRate: globalRate }); setOpen(true); };

  const save = async () => {
    if (!form.name || !form.genderCategory || form.price == null) {
      toast({ title: "خطا", description: "نام، جنسیت و قیمت الزامی است", variant: "destructive" }); return;
    }
    try {
      const payload = { ...form, commissionRate: globalRate };
      if (editing) await api(`/laser/services/${editing.id}`, "PUT", payload);
      else await api("/laser/services", "POST", payload);
      toast({ title: "ذخیره شد" });
      setOpen(false); load();
    } catch (e: any) { toast({ title: "خطا", description: e.message, variant: "destructive" }); }
  };

  const del = async (id: number) => {
    if (!confirm("این خدمت حذف شود؟")) return;
    try { await api(`/laser/services/${id}`, "DELETE"); load(); } catch (e: any) {
      toast({ title: "خطا", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex rounded-lg overflow-hidden border">
          <button onClick={() => setGenderTab("female")} className={`px-4 py-2 text-sm font-medium transition-colors ${genderTab === "female" ? "bg-rose-700 text-white" : "hover:bg-muted"}`}>
            خانم‌ها
          </button>
          <button onClick={() => setGenderTab("male")} className={`px-4 py-2 text-sm font-medium transition-colors border-r ${genderTab === "male" ? "bg-blue-700 text-white" : "hover:bg-muted"}`}>
            آقایان
          </button>
        </div>
        <Button onClick={openNew} className="mr-auto bg-rose-700 hover:bg-rose-800 text-white">
          <Plus className="h-4 w-4 ml-1" /> خدمت جدید
        </Button>
      </div>

      {loading ? <p className="text-center text-muted-foreground py-8">در حال بارگذاری...</p> : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Scissors className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>هیچ خدمتی برای {genderTab === "female" ? "خانم‌ها" : "آقایان"} ثبت نشده</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {["کد خدمت", "نام خدمت", "قیمت", "نرخ کمیسیون", "وضعیت", "توضیح", ""].map(h => (
                  <th key={h} className="px-3 py-2.5 text-right font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(s => (
                <tr key={s.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2.5">
                    <span className="font-mono text-xs bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded">
                      {s.code || "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-medium">{s.name}</td>
                  <td className="px-3 py-2.5">{formatCurrency(s.price)}</td>
                  <td className="px-3 py-2.5">
                    <span className="font-medium text-emerald-700">{toPersianDigits(s.commissionRate)}٪</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${s.isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>
                      {s.isActive ? "فعال" : "غیرفعال"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground text-xs max-w-[200px] truncate">{s.description || "—"}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1 justify-end">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(s)}><Edit2 className="h-3.5 w-3.5" /></Button>
                      {user?.role === "admin" && (
                        <Button size="icon" variant="ghost" className="text-red-500 hover:text-red-700" onClick={() => del(s.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? "ویرایش خدمت" : "خدمت جدید"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>نام خدمت *</Label><Input value={form.name || ""} placeholder="مثال: لیزر موهای زائد ناحیه پشت" onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div>
              <Label>دسته‌بندی جنسیت *</Label>
              <Select value={form.genderCategory || ""} onValueChange={v => setForm(f => ({ ...f, genderCategory: v as Gender }))}>
                <SelectTrigger><SelectValue placeholder="انتخاب کنید" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="female">خانم‌ها</SelectItem>
                  <SelectItem value="male">آقایان</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>قیمت (تومان) *</Label><PriceInput value={form.price} onChange={v => setForm(f => ({ ...f, price: v }))} placeholder="مثال: ۲,۵۰۰,۰۰۰" /></div>
            <div>
              <Label>نرخ کمیسیون (٪)</Label>
              <div className="flex items-center gap-2 mt-1 border rounded-md px-3 py-2 bg-muted/40">
                <span className="text-lg font-bold text-rose-700">{toPersianDigits(globalRate)}٪</span>
                <span className="text-xs text-muted-foreground">— تنظیم‌شده توسط ادمین</span>
              </div>
            </div>
            <div>
              <Label>وضعیت</Label>
              <Select value={form.isActive ? "active" : "inactive"} onValueChange={v => setForm(f => ({ ...f, isActive: v === "active" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">فعال</SelectItem>
                  <SelectItem value="inactive">غیرفعال</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>توضیح</Label><Textarea rows={2} value={form.description || ""} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>انصراف</Button>
            <Button onClick={save} className="bg-rose-700 hover:bg-rose-800 text-white">ذخیره</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Appointments Tab ─────────────────────────────────────────────────────────
function AppointmentsTab({ refreshKey }: { refreshKey?: number }) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusTab, setStatusTab] = useState<"scheduled" | "history">("scheduled");
  const [open, setOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState<number | null>(null);
  const [form, setForm] = useState<Partial<Appointment & { scheduledDate?: string; scheduledTime?: string }>>({});
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [appts, clts, svcs] = await Promise.all([
        api("/laser/appointments"), api("/laser/clients"), api("/laser/services"),
      ]);
      setAppointments(appts); setClients(clts); setServices(svcs);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const selectedClient = clients.find(c => c.id === Number(form.clientId));
  const filteredServices = services.filter(s => s.isActive && (selectedClient ? s.genderCategory === selectedClient.gender : true));

  const active = appointments.filter(a => a.status === "scheduled");
  const history = appointments.filter(a => a.status !== "scheduled");
  const shown = statusTab === "scheduled" ? active : history;

  const openNew = () => {
    const now = new Date();
    const gregDate = now.toISOString().split("T")[0];
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    setForm({ scheduledDate: gregDate, scheduledTime: time });
    setOpen(true);
  };

  const save = async () => {
    if (!form.clientId || !form.serviceId || !form.scheduledDate) {
      toast({ title: "خطا", description: "مراجع، خدمت و تاریخ نوبت الزامی است", variant: "destructive" }); return;
    }
    const svc = services.find(s => s.id === Number(form.serviceId));
    try {
      await api("/laser/appointments", "POST", {
        clientId: Number(form.clientId),
        serviceId: Number(form.serviceId),
        operatorName: form.operatorName || null,
        scheduledAt: new Date(`${form.scheduledDate}T${form.scheduledTime || "09:00"}`).toISOString(),
        sessionNumber: form.sessionNumber || null,
        price: form.price ?? (svc?.price ?? null),
        notes: form.notes || null,
      });
      toast({ title: "نوبت ثبت شد" });
      setOpen(false); load();
    } catch (e: any) { toast({ title: "خطا", description: e.message, variant: "destructive" }); }
  };

  const cancel = async (id: number) => {
    try {
      await api(`/laser/appointments/${id}`, "PUT", { status: "cancelled" });
      toast({ title: "نوبت لغو شد" });
      setCancelOpen(null); load();
    } catch (e: any) { toast({ title: "خطا", description: e.message, variant: "destructive" }); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex rounded-lg overflow-hidden border">
          <button onClick={() => setStatusTab("scheduled")} className={`px-4 py-2 text-sm font-medium flex items-center gap-1.5 transition-colors ${statusTab === "scheduled" ? "bg-yellow-500 text-white" : "hover:bg-muted"}`}>
            <Clock className="h-3.5 w-3.5" /> نوبت‌های فعال
            {active.length > 0 && <span className="bg-white/30 px-1.5 py-0.5 rounded-full text-xs">{toPersianDigits(active.length)}</span>}
          </button>
          <button onClick={() => setStatusTab("history")} className={`px-4 py-2 text-sm font-medium flex items-center gap-1.5 border-r transition-colors ${statusTab === "history" ? "bg-slate-700 text-white" : "hover:bg-muted"}`}>
            <CheckCircle2 className="h-3.5 w-3.5" /> تاریخچه
          </button>
        </div>
        {statusTab === "scheduled" && (
          <Button onClick={openNew} className="mr-auto bg-rose-700 hover:bg-rose-800 text-white">
            <Plus className="h-4 w-4 ml-1" /> نوبت جدید
          </Button>
        )}
      </div>

      {loading ? <p className="text-center text-muted-foreground py-8">در حال بارگذاری...</p> : shown.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <CalendarDays className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>{statusTab === "scheduled" ? "نوبت فعالی وجود ندارد" : "تاریخچه‌ای یافت نشد"}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {["کد نوبت", "مراجع", "پرونده", "جنسیت", "خدمت", "اپراتور", "تاریخ نوبت", "جلسه", "قیمت", "وضعیت", ""].map(h => (
                  <th key={h} className="px-3 py-2.5 text-right font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map(a => (
                <tr key={a.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2.5">
                    <span className="font-mono text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded whitespace-nowrap">
                      {a.appointmentCode || "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-medium">{a.client?.name || "—"}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{a.client?.fileNumber || "—"}</td>
                  <td className="px-3 py-2.5">
                    {a.client?.gender && (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${GENDER_COLOR[a.client.gender]}`}>
                        {GENDER_LABEL[a.client.gender]}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 max-w-[150px] truncate">{a.service?.name || "—"}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{a.operatorName || "—"}</td>
                  <td className="px-3 py-2.5 text-xs">{formatDateTime(a.scheduledAt)}</td>
                  <td className="px-3 py-2.5 text-center">{a.sessionNumber ? toPersianDigits(a.sessionNumber) : "—"}</td>
                  <td className="px-3 py-2.5">{a.price ? formatCurrency(a.price) : a.service?.price ? formatCurrency(a.service.price) : "—"}</td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[a.status]}`}>
                      {STATUS_ICON[a.status]}{STATUS_LABEL[a.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {a.status === "scheduled" && (
                      <Button size="icon" variant="ghost" className="text-red-500 hover:text-red-700" onClick={() => setCancelOpen(a.id)}>
                        <XCircle className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* New Appointment Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>نوبت جدید لیزر</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>مراجع *</Label>
              <ClientSearchPicker
                clients={clients}
                value={form.clientId}
                onChange={id => setForm(f => ({ ...f, clientId: id || undefined, serviceId: undefined }))}
              />
            </div>
            {selectedClient && (
              <p className="text-xs text-muted-foreground bg-muted rounded px-3 py-1.5">
                جنسیت: <strong>{GENDER_LABEL[selectedClient.gender]}</strong> — خدمات {selectedClient.gender === "female" ? "خانم‌ها" : "آقایان"} نمایش داده می‌شود
              </p>
            )}
            <div>
              <Label>خدمت *</Label>
              <Select value={String(form.serviceId || "")} onValueChange={v => {
                const svc = services.find(s => s.id === Number(v));
                setForm(f => ({ ...f, serviceId: Number(v), price: svc?.price }));
              }}>
                <SelectTrigger><SelectValue placeholder={selectedClient ? "انتخاب خدمت" : "ابتدا مراجع را انتخاب کنید"} /></SelectTrigger>
                <SelectContent>
                  {filteredServices.map(s => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name} — {formatCurrency(s.price)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>تاریخ نوبت *</Label>
                <PersianDatePicker value={form.scheduledDate || ""} onChange={v => setForm(f => ({ ...f, scheduledDate: v }))} placeholder="انتخاب تاریخ" />
              </div>
              <div>
                <Label>ساعت</Label>
                <Input type="time" dir="ltr" value={form.scheduledTime || ""} onChange={e => setForm(f => ({ ...f, scheduledTime: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>شماره جلسه</Label><Input type="number" min={1} value={form.sessionNumber || ""} onChange={e => setForm(f => ({ ...f, sessionNumber: Number(e.target.value) }))} /></div>
              <div><Label>قیمت (تومان)</Label><Input type="number" value={form.price ?? ""} onChange={e => setForm(f => ({ ...f, price: Number(e.target.value) }))} /></div>
            </div>
            <div><Label>نام اپراتور</Label><Input value={form.operatorName || ""} onChange={e => setForm(f => ({ ...f, operatorName: e.target.value }))} /></div>
            <div><Label>یادداشت</Label><Textarea rows={2} value={form.notes || ""} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>انصراف</Button>
            <Button onClick={save} className="bg-rose-700 hover:bg-rose-800 text-white">ثبت نوبت</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Confirm */}
      <Dialog open={cancelOpen !== null} onOpenChange={() => setCancelOpen(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>لغو نوبت</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">آیا این نوبت لغو شود؟</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(null)}>خیر</Button>
            <Button variant="destructive" onClick={() => cancelOpen && cancel(cancelOpen)}>بله، لغو شود</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Payments Tab ─────────────────────────────────────────────────────────────
function PaymentsTab({ onPaymentSaved }: { onPaymentSaved?: () => void }) {
  const { user } = useAuth();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [activeAppts, setActiveAppts] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{
    appointmentId?: number; amount?: number; method: string;
    operatorName?: string; commissionAmount?: number; notes?: string;
    nextSessionDate?: string; nextSessionNote?: string;
  }>({ method: "cash" });
  const [receipt, setReceipt] = useState<Payment | null>(null);
  const [editing, setEditing] = useState<Payment | null>(null);
  const [editForm, setEditForm] = useState<{
    amount?: number; method: string; operatorName?: string;
    commissionAmount?: number; notes?: string;
    nextSessionDate?: string; nextSessionNote?: string;
  }>({ method: "cash" });
  const [confirmDelete, setConfirmDelete] = useState<Payment | null>(null);
  const isAdmin = user?.role === "admin";
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pays, appts] = await Promise.all([
        api("/laser/payments"), api("/laser/appointments?status=scheduled"),
      ]);
      setPayments(pays); setActiveAppts(appts);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openEdit = (p: Payment) => {
    setEditForm({
      amount: p.amount, method: p.method, operatorName: p.operatorName,
      commissionAmount: p.commissionAmount, notes: p.notes,
      nextSessionDate: p.nextSessionDate, nextSessionNote: p.nextSessionNote,
    });
    setEditing(p);
    setReceipt(null);
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      await api(`/laser/payments/${editing.id}`, "PUT", editForm);
      toast({ title: "پرداخت ویرایش شد" });
      setEditing(null); load(); onPaymentSaved?.();
    } catch (e: any) { toast({ title: "خطا", description: e.message, variant: "destructive" }); }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    try {
      await api(`/laser/payments/${confirmDelete.id}`, "DELETE");
      toast({ title: "پرداخت حذف شد", description: "نوبت مرتبط به حالت فعال بازگشت" });
      setConfirmDelete(null); setReceipt(null); load(); onPaymentSaved?.();
    } catch (e: any) { toast({ title: "خطا", description: e.message, variant: "destructive" }); }
  };

  const printReceipt = (p: Payment) => {
    const esc = (s: string) => s.replace(/[&<>"']/g, c => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
    ));
    const row = (l: string, v: string, cls = "") => `<tr class="${cls}"><td class="l">${esc(l)}</td><td class="v">${esc(v)}</td></tr>`;
    const body =
      `<h2>مطب زیبایی دکتر یاری</h2><p class="sub">رسید پرداخت صندوق لیزر</p><table>` +
      row("مراجع", p.client?.name || "—") +
      row("شماره پرونده", p.client?.fileNumber ? toPersianDigits(p.client.fileNumber) : "—") +
      row("خدمت", p.service?.name || "—") +
      row("روش پرداخت", METHOD_LABEL[p.method] || p.method) +
      row("اپراتور", p.operatorName || "—") +
      row("کمیسیون", p.commissionAmount > 0 ? formatCurrency(p.commissionAmount) : "—") +
      row("تاریخ پرداخت", formatDateTime(p.paidAt)) +
      (p.nextSessionDate ? row("جلسه بعدی", formatDateTime(p.nextSessionDate)) : "") +
      (p.notes ? row("یادداشت", p.notes) : "") +
      row("مبلغ کل", formatCurrency(p.amount), "total") +
      `</table>`;
    printReceiptHtml(body);
  };

  const selectedAppt = activeAppts.find(a => a.id === Number(form.appointmentId));

  const openNew = () => {
    const autoOperator = user?.role === "laser_operator" ? user.username : undefined;
    setForm({ method: "cash", operatorName: autoOperator });
    setOpen(true);
  };

  const save = async () => {
    if (!form.appointmentId || form.amount == null) {
      toast({ title: "خطا", description: "نوبت و مبلغ الزامی است", variant: "destructive" }); return;
    }
    try {
      await api("/laser/payments", "POST", form);
      toast({ title: "پرداخت ثبت شد", description: "نوبت به تاریخچه منتقل شد" });
      setOpen(false); load(); onPaymentSaved?.();
    } catch (e: any) { toast({ title: "خطا", description: e.message, variant: "destructive" }); }
  };

  const totalAmount = payments.reduce((s, p) => s + p.amount, 0);
  const totalCommission = payments.reduce((s, p) => s + p.commissionAmount, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="grid grid-cols-2 gap-3 flex-1">
          <div className="rounded-lg border bg-green-50 px-4 py-3">
            <p className="text-xs text-muted-foreground">جمع دریافتی</p>
            <p className="text-lg font-bold text-green-700">{formatCurrency(totalAmount)}</p>
          </div>
          <div className="rounded-lg border bg-amber-50 px-4 py-3">
            <p className="text-xs text-muted-foreground">جمع کمیسیون‌ها</p>
            <p className="text-lg font-bold text-amber-700">{formatCurrency(totalCommission)}</p>
          </div>
        </div>
        <Button onClick={openNew} className="bg-rose-700 hover:bg-rose-800 text-white self-center">
          <Plus className="h-4 w-4 ml-1" /> ثبت پرداخت
        </Button>
      </div>

      {loading ? <p className="text-center text-muted-foreground py-8">در حال بارگذاری...</p> : payments.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <CreditCard className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>هیچ پرداختی ثبت نشده</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {["مراجع", "خدمت", "مبلغ", "روش", "اپراتور", "کمیسیون", "تاریخ پرداخت", "یادداشت", "رسید"].map(h => (
                  <th key={h} className="px-3 py-2.5 text-right font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {payments.map(p => (
                <tr
                  key={p.id}
                  className="hover:bg-rose-50/60 cursor-pointer transition-colors"
                  onClick={() => setReceipt(p)}
                  title="مشاهده رسید کامل"
                >
                  <td className="px-3 py-2.5 font-medium">{p.client?.name || "—"}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{p.service?.name || "—"}</td>
                  <td className="px-3 py-2.5 font-medium text-green-700">{formatCurrency(p.amount)}</td>
                  <td className="px-3 py-2.5"><span className="text-xs bg-muted px-2 py-0.5 rounded">{METHOD_LABEL[p.method] || p.method}</span></td>
                  <td className="px-3 py-2.5 text-muted-foreground">{p.operatorName || "—"}</td>
                  <td className="px-3 py-2.5 text-amber-700 font-medium">{p.commissionAmount > 0 ? formatCurrency(p.commissionAmount) : "—"}</td>
                  <td className="px-3 py-2.5 text-xs">{formatDateTime(p.paidAt)}</td>
                  <td className="px-3 py-2.5 text-muted-foreground text-xs max-w-[120px] truncate">{p.notes || "—"}</td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1 text-xs text-rose-700 font-medium">
                      <CreditCard className="h-3.5 w-3.5" /> مشاهده
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>ثبت پرداخت صندوق لیزر</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>نوبت فعال *</Label>
              {activeAppts.length === 0 ? (
                <p className="text-sm text-muted-foreground bg-muted rounded px-3 py-2 mt-1">هیچ نوبت فعالی وجود ندارد</p>
              ) : (
                <AppointmentSearchPicker
                  appointments={activeAppts}
                  value={form.appointmentId}
                  onChange={appt => {
                    if (!appt) { setForm(f => ({ ...f, appointmentId: undefined })); return; }
                    setForm(f => ({
                      ...f,
                      appointmentId: appt.id,
                      operatorName: user?.role === "laser_operator"
                        ? user.username
                        : (appt.operatorName || f.operatorName),
                      amount: appt.price ?? appt.service?.price,
                      commissionAmount: Math.round((appt.price ?? appt.service?.price ?? 0) * (appt.service?.commissionRate ?? 0) / 100),
                    }));
                  }}
                />
              )}
            </div>
            {selectedAppt && (
              <div className="bg-muted/50 rounded-lg p-3 text-xs space-y-1">
                <div className="flex justify-between"><span>مراجع:</span><strong>{selectedAppt.client?.name}</strong></div>
                <div className="flex justify-between"><span>خدمت:</span><strong>{selectedAppt.service?.name}</strong></div>
                <div className="flex justify-between"><span>نرخ کمیسیون:</span><strong className="text-amber-700">{toPersianDigits(selectedAppt.service?.commissionRate ?? 0)}٪</strong></div>
              </div>
            )}
            <div><Label>مبلغ (تومان) *</Label>
              <PriceInput
                value={form.amount}
                onChange={amount => {
                  const rate = selectedAppt?.service?.commissionRate ?? 0;
                  setForm(f => ({ ...f, amount, commissionAmount: Math.round(amount * rate / 100) }));
                }}
                placeholder="مبلغ دریافتی"
              />
            </div>
            <div>
              <Label>روش پرداخت</Label>
              <Select value={form.method} onValueChange={v => setForm(f => ({ ...f, method: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">نقد</SelectItem>
                  <SelectItem value="card">کارت‌خوان</SelectItem>
                  <SelectItem value="transfer">کارت به کارت</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>نام اپراتور</Label>
              <Input
                value={form.operatorName || ""}
                onChange={e => setForm(f => ({ ...f, operatorName: e.target.value }))}
                readOnly={user?.role === "laser_operator"}
                className={user?.role === "laser_operator" ? "bg-muted" : ""}
              />
            </div>
            <div>
              <Label>مبلغ کمیسیون (تومان) — محاسبه خودکار</Label>
              <PriceInput value={form.commissionAmount} onChange={v => setForm(f => ({ ...f, commissionAmount: v }))} />
            </div>
            <div className="border rounded-lg p-3 space-y-2 bg-amber-50/50 border-amber-200">
              <Label className="flex items-center gap-1.5 text-amber-800 font-medium">
                <BellRing className="h-4 w-4" /> یادآوری جلسه بعدی
              </Label>
              <PersianDatePicker
                value={form.nextSessionDate || ""}
                onChange={v => setForm(f => ({ ...f, nextSessionDate: v }))}
                placeholder="تاریخ جلسه بعدی (اختیاری)"
              />
              <Input
                value={form.nextSessionNote || ""}
                onChange={e => setForm(f => ({ ...f, nextSessionNote: e.target.value }))}
                placeholder="یادداشت یادآوری (اختیاری)"
              />
            </div>
            <div><Label>یادداشت</Label><Textarea rows={2} value={form.notes || ""} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>انصراف</Button>
            <Button onClick={save} disabled={!form.appointmentId || form.amount == null} className="bg-rose-700 hover:bg-rose-800 text-white">
              ثبت پرداخت
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receipt view dialog */}
      <Dialog open={!!receipt} onOpenChange={o => !o && setReceipt(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-rose-700" /> رسید پرداخت
            </DialogTitle>
          </DialogHeader>
          {receipt && (
            <div className="space-y-3">
              <div className="text-center border-b pb-2">
                <p className="font-bold">مطب زیبایی دکتر یاری</p>
                <p className="text-xs text-muted-foreground">رسید پرداخت صندوق لیزر</p>
              </div>
              <div className="text-sm divide-y">
                {[
                  ["مراجع", receipt.client?.name || "—"],
                  ["شماره پرونده", receipt.client?.fileNumber ? toPersianDigits(receipt.client.fileNumber) : "—"],
                  ["خدمت", receipt.service?.name || "—"],
                  ["روش پرداخت", METHOD_LABEL[receipt.method] || receipt.method],
                  ["اپراتور", receipt.operatorName || "—"],
                  ["کمیسیون", receipt.commissionAmount > 0 ? formatCurrency(receipt.commissionAmount) : "—"],
                  ["تاریخ پرداخت", formatDateTime(receipt.paidAt)],
                  ...(receipt.nextSessionDate ? [["جلسه بعدی", formatDateTime(receipt.nextSessionDate)] as [string, string]] : []),
                  ...(receipt.nextSessionNote ? [["یادداشت جلسه بعدی", receipt.nextSessionNote] as [string, string]] : []),
                  ...(receipt.notes ? [["یادداشت", receipt.notes] as [string, string]] : []),
                ].map(([l, v]) => (
                  <div key={l} className="flex justify-between gap-3 py-2">
                    <span className="text-muted-foreground">{l}</span>
                    <span className="font-medium text-left">{v}</span>
                  </div>
                ))}
                <div className="flex justify-between gap-3 py-2 bg-green-50 rounded px-2 mt-1">
                  <span className="font-medium">مبلغ کل</span>
                  <span className="font-bold text-green-700">{formatCurrency(receipt.amount)}</span>
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2">
            {receipt && isAdmin && (
              <>
                <Button variant="destructive" onClick={() => setConfirmDelete(receipt)}>
                  <Trash2 className="h-4 w-4 ml-1" /> حذف
                </Button>
                <Button variant="outline" onClick={() => openEdit(receipt)}>
                  <Edit2 className="h-4 w-4 ml-1" /> ویرایش
                </Button>
              </>
            )}
            {receipt && (
              <Button onClick={() => printReceipt(receipt)} className="bg-rose-700 hover:bg-rose-800 text-white">
                چاپ رسید
              </Button>
            )}
            <Button variant="ghost" onClick={() => setReceipt(null)}>بستن</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit payment dialog — admin only */}
      <Dialog open={!!editing} onOpenChange={o => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>ویرایش پرداخت</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>مبلغ (تومان) *</Label>
              <PriceInput value={editForm.amount} onChange={v => setEditForm(f => ({ ...f, amount: v }))} placeholder="مبلغ دریافتی" />
            </div>
            <div>
              <Label>روش پرداخت</Label>
              <Select value={editForm.method} onValueChange={v => setEditForm(f => ({ ...f, method: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">نقد</SelectItem>
                  <SelectItem value="card">کارت‌خوان</SelectItem>
                  <SelectItem value="transfer">کارت به کارت</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>نام اپراتور</Label>
              <Input value={editForm.operatorName || ""} onChange={e => setEditForm(f => ({ ...f, operatorName: e.target.value }))} />
            </div>
            <div><Label>مبلغ کمیسیون (تومان)</Label>
              <PriceInput value={editForm.commissionAmount} onChange={v => setEditForm(f => ({ ...f, commissionAmount: v }))} />
            </div>
            <div className="border rounded-lg p-3 space-y-2 bg-amber-50/50 border-amber-200">
              <Label className="flex items-center gap-1.5 text-amber-800 font-medium">
                <BellRing className="h-4 w-4" /> یادآوری جلسه بعدی
              </Label>
              <PersianDatePicker
                value={editForm.nextSessionDate || ""}
                onChange={v => setEditForm(f => ({ ...f, nextSessionDate: v }))}
                placeholder="تاریخ جلسه بعدی (اختیاری)"
              />
              <Input
                value={editForm.nextSessionNote || ""}
                onChange={e => setEditForm(f => ({ ...f, nextSessionNote: e.target.value }))}
                placeholder="یادداشت یادآوری (اختیاری)"
              />
            </div>
            <div><Label>یادداشت</Label><Textarea rows={2} value={editForm.notes || ""} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>انصراف</Button>
            <Button onClick={saveEdit} disabled={editForm.amount == null} className="bg-rose-700 hover:bg-rose-800 text-white">
              ذخیره تغییرات
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation — admin only */}
      <Dialog open={!!confirmDelete} onOpenChange={o => !o && setConfirmDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>حذف پرداخت</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            آیا از حذف این رسید پرداخت مطمئن هستید؟ نوبت مرتبط به حالت «فعال» بازمی‌گردد و این عملیات قابل بازگشت نیست.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>انصراف</Button>
            <Button variant="destructive" onClick={doDelete}>بله، حذف شود</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Reminders Tab ────────────────────────────────────────────────────────────
function RemindersTab() {
  const [reminders, setReminders] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api("/laser/reminders");
      setReminders(data);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const today = new Date().toISOString().split("T")[0];

  function diffDays(dateStr: string) {
    const d = new Date(dateStr).getTime() - new Date(today).getTime();
    return Math.round(d / 86400000);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <BellRing className="h-4 w-4" />
        یادآوری‌ها بر اساس نزدیک‌ترین تاریخ به امروز مرتب شده‌اند
      </div>

      {loading ? <p className="text-center text-muted-foreground py-8">در حال بارگذاری...</p>
        : reminders.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <BellRing className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>هیچ یادآوری‌ای ثبت نشده</p>
            <p className="text-xs mt-1">هنگام ثبت پرداخت می‌توانید تاریخ جلسه بعدی را وارد کنید</p>
          </div>
        ) : (
          <div className="space-y-2">
            {reminders.map(r => {
              const diff = diffDays(r.nextSessionDate!);
              const isPast = diff < 0;
              const isToday = diff === 0;
              const isSoon = diff > 0 && diff <= 3;
              return (
                <div key={r.id} className={`rounded-lg border p-4 flex items-start gap-4 ${isPast ? "bg-red-50 border-red-200" : isToday ? "bg-green-50 border-green-300" : isSoon ? "bg-amber-50 border-amber-200" : "bg-card border-border"}`}>
                  <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${isPast ? "bg-red-100 text-red-700" : isToday ? "bg-green-100 text-green-700" : isSoon ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground"}`}>
                    {isToday ? "امروز" : isPast ? toPersianDigits(Math.abs(diff)) + "↑" : toPersianDigits(diff)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{r.client?.name || "—"}</span>
                      <span className="text-xs text-muted-foreground font-mono">{r.client?.fileNumber}</span>
                      {r.client?.phone && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Phone className="h-3 w-3" />{r.client.phone}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{r.service?.name || "—"}</div>
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${isPast ? "bg-red-100 text-red-700" : isToday ? "bg-green-100 text-green-700" : isSoon ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground"}`}>
                        {isPast ? `${toPersianDigits(Math.abs(diff))} روز پیش` : isToday ? "امروز" : `${toPersianDigits(diff)} روز دیگر`}
                      </span>
                      <span className="text-xs text-muted-foreground">{formatShamsiDate(new Date(r.nextSessionDate!).getTime())}</span>
                      {r.nextSessionNote && <span className="text-xs text-foreground/70">📝 {r.nextSessionNote}</span>}
                      {r.operatorName && <span className="text-xs text-muted-foreground">اپراتور: {r.operatorName}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}

// ─── Main Laser Page ──────────────────────────────────────────────────────────
export default function LaserPage() {
  const [appointmentsRefreshKey, setAppointmentsRefreshKey] = useState(0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-rose-100 rounded-lg"><Zap className="h-6 w-6 text-rose-700" /></div>
        <div>
          <h1 className="text-2xl font-bold">بخش لیزر</h1>
          <p className="text-sm text-muted-foreground">مدیریت مراجعین، نوبت‌ها، خدمات و صندوق لیزر</p>
        </div>
      </div>

      <Tabs defaultValue="clients" className="space-y-4">
        <TabsList className="grid grid-cols-5 w-full max-w-2xl">
          <TabsTrigger value="clients" className="flex items-center gap-1.5">
            <User className="h-3.5 w-3.5" /> مراجعین
          </TabsTrigger>
          <TabsTrigger value="appointments" className="flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" /> نوبت‌ها
          </TabsTrigger>
          <TabsTrigger value="services" className="flex items-center gap-1.5">
            <Scissors className="h-3.5 w-3.5" /> خدمات لیزر
          </TabsTrigger>
          <TabsTrigger value="payments" className="flex items-center gap-1.5">
            <CreditCard className="h-3.5 w-3.5" /> صندوق لیزر
          </TabsTrigger>
          <TabsTrigger value="reminders" className="flex items-center gap-1.5">
            <BellRing className="h-3.5 w-3.5" /> یادآوری‌ها
          </TabsTrigger>
        </TabsList>

        <TabsContent value="clients"><ClientsTab /></TabsContent>
        <TabsContent value="appointments">
          <AppointmentsTab refreshKey={appointmentsRefreshKey} />
        </TabsContent>
        <TabsContent value="services"><ServicesTab /></TabsContent>
        <TabsContent value="payments">
          <PaymentsTab onPaymentSaved={() => setAppointmentsRefreshKey(k => k + 1)} />
        </TabsContent>
        <TabsContent value="reminders"><RemindersTab /></TabsContent>
      </Tabs>
    </div>
  );
}
