import { useState } from "react";
import { useAuth, Permission } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, ShieldCheck, User, Zap } from "lucide-react";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { toPersianDigits } from "@/lib/format";

const ALL_PERMISSIONS: { key: Permission; label: string }[] = [
  { key: "dashboard", label: "داشبورد" },
  { key: "patients", label: "مراجعین" },
  { key: "appointments", label: "نوبت‌ها" },
  { key: "payments", label: "صندوق" },
  { key: "services", label: "خدمات" },
  { key: "laser", label: "لیزر" },
  { key: "staff", label: "کارمندان" },
  { key: "commissions", label: "کمیسیون" },
  { key: "discounts", label: "تخفیفات" },
  { key: "inventory", label: "انبار" },
  { key: "accounting", label: "حسابداری" },
  { key: "reports", label: "گزارشات" },
  { key: "reminders", label: "یادآوری‌ها" },
  { key: "backup", label: "پشتیبان‌گیری" },
];

interface UserRecord {
  id: number;
  username: string;
  role: "admin" | "staff" | "laser_operator";
  permissions: Permission[];
  isActive: boolean;
  createdAt: string;
}

interface UserFormData {
  username: string;
  password: string;
  role: "admin" | "staff" | "laser_operator";
  permissions: Permission[];
  isActive: boolean;
}

function getToken() {
  return localStorage.getItem("clinic_auth_token");
}

function authFetch(url: string, options?: RequestInit) {
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
      ...(options?.headers ?? {}),
    },
  });
}

function UserFormDialog({
  open,
  onClose,
  initial,
  onSave,
  isLoading,
}: {
  open: boolean;
  onClose: () => void;
  initial?: UserRecord;
  onSave: (data: UserFormData) => void;
  isLoading: boolean;
}) {
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "staff" | "laser_operator">(initial?.role ?? "staff");
  const [permissions, setPermissions] = useState<Permission[]>(initial?.permissions ?? []);
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);

  function togglePerm(p: Permission) {
    setPermissions(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
  }

  function selectAll() { setPermissions(ALL_PERMISSIONS.map(p => p.key)); }
  function clearAll() { setPermissions([]); }

  function handleSubmit() {
    onSave({ username, password, role, permissions, isActive });
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle>{initial ? "ویرایش کاربر" : "کاربر جدید"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>نام کاربری</Label>
              <Input value={username} onChange={e => setUsername(e.target.value)} placeholder="username" />
            </div>
            <div className="space-y-1">
              <Label>{initial ? "رمز جدید (اختیاری)" : "رمز عبور"}</Label>
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
          </div>

          <div className="space-y-1">
            <Label>نقش</Label>
            <Select value={role} onValueChange={v => {
              const r = v as "admin" | "staff" | "laser_operator";
              setRole(r);
              if (r === "laser_operator") setPermissions(["laser"]);
              else if (r === "admin") setPermissions([]);
            }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">مدیر کل (admin)</SelectItem>
                <SelectItem value="staff">کارمند (staff)</SelectItem>
                <SelectItem value="laser_operator">اپراتور لیزر</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {role === "laser_operator" && (
            <div className="rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700 flex items-center gap-2">
              <Zap className="h-4 w-4 flex-shrink-0" />
              اپراتور لیزر فقط به بخش لیزر دسترسی دارد و نام‌شان در فیلد اپراتور صندوق لیزر خودکار پر می‌شود.
            </div>
          )}

          {role === "staff" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>دسترسی‌ها</Label>
                <div className="flex gap-2">
                  <button type="button" onClick={selectAll} className="text-xs text-primary hover:underline">همه</button>
                  <span className="text-muted-foreground">|</span>
                  <button type="button" onClick={clearAll} className="text-xs text-muted-foreground hover:underline">هیچکدام</button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 border rounded-md p-3 bg-muted/30">
                {ALL_PERMISSIONS.map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2">
                    <Checkbox
                      id={`perm-${key}`}
                      checked={permissions.includes(key)}
                      onCheckedChange={() => togglePerm(key)}
                    />
                    <label htmlFor={`perm-${key}`} className="text-sm cursor-pointer">{label}</label>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Switch checked={isActive} onCheckedChange={setIsActive} />
            <Label>فعال</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>انصراف</Button>
          <Button onClick={handleSubmit} disabled={isLoading || !username || (!initial && !password)}>
            {isLoading ? "در حال ذخیره..." : "ذخیره"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LaserCommissionCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [inputRate, setInputRate] = useState("");

  const { data: settings, isLoading } = useQuery<{ id: number; commissionRate: number }>({
    queryKey: ["laser-settings"],
    queryFn: async () => {
      const res = await authFetch("/api/laser/settings");
      if (!res.ok) throw new Error("خطا");
      return res.json();
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (rate: number) => {
      const res = await authFetch("/api/laser/settings", {
        method: "PUT",
        body: JSON.stringify({ commissionRate: rate }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["laser-settings"] });
      setEditing(false);
      toast({ title: "نرخ کمیسیون لیزر ذخیره شد" });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  function startEdit() {
    setInputRate(String(settings?.commissionRate ?? 0));
    setEditing(true);
  }

  function save() {
    const v = Number(inputRate);
    if (isNaN(v) || v < 0 || v > 100) {
      toast({ title: "مقدار باید بین ۰ تا ۱۰۰ باشد", variant: "destructive" }); return;
    }
    saveMutation.mutate(v);
  }

  return (
    <Card className="border-rose-200 bg-rose-50/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <div className="p-1.5 bg-rose-100 rounded-md"><Zap className="h-4 w-4 text-rose-700" /></div>
          تنظیمات کمیسیون لیزر
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">
          این نرخ به صورت سراسری روی تمام خدمات لیزر اعمال می‌شود و فقط توسط ادمین قابل تغییر است.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">در حال بارگذاری...</p>
        ) : editing ? (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={100}
                value={inputRate}
                onChange={e => setInputRate(e.target.value)}
                className="w-28 text-left"
                placeholder="0"
              />
              <span className="text-sm text-muted-foreground font-medium">٪</span>
            </div>
            <Button size="sm" onClick={save} disabled={saveMutation.isPending} className="bg-rose-700 hover:bg-rose-800 text-white">
              {saveMutation.isPending ? "ذخیره..." : "ذخیره"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>انصراف</Button>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold text-rose-700">{toPersianDigits(settings?.commissionRate ?? 0)}</span>
              <span className="text-lg text-rose-600 font-medium">٪</span>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">نرخ کمیسیون فعلی برای تمام خدمات لیزر</p>
              <p className="text-xs text-muted-foreground">همیشه فعال — برای هر پرداخت محاسبه می‌شود</p>
            </div>
            <Button size="sm" variant="outline" onClick={startEdit} className="mr-auto">
              <Pencil className="h-3.5 w-3.5 ml-1" /> تغییر نرخ
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Users() {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserRecord | undefined>();
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data: users = [], isLoading } = useQuery<UserRecord[]>({
    queryKey: ["users"],
    queryFn: async () => {
      const res = await authFetch("/api/users");
      if (!res.ok) throw new Error("خطا در دریافت کاربران");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: UserFormData) => {
      const res = await authFetch("/api/users", { method: "POST", body: JSON.stringify(data) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["users"] }); setFormOpen(false); toast({ title: "کاربر ایجاد شد" }); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: UserFormData }) => {
      const res = await authFetch(`/api/users/${id}`, { method: "PUT", body: JSON.stringify(data) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["users"] }); setFormOpen(false); setEditUser(undefined); toast({ title: "کاربر ویرایش شد" }); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await authFetch(`/api/users/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) { const e = await res.json(); throw new Error(e.message); }
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["users"] }); setDeleteId(null); toast({ title: "کاربر حذف شد" }); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  function handleSave(data: UserFormData) {
    if (editUser) {
      updateMutation.mutate({ id: editUser.id, data });
    } else {
      createMutation.mutate(data);
    }
  }

  if (currentUser?.role !== "admin") {
    return <div className="text-center py-20 text-muted-foreground">شما دسترسی به این بخش ندارید</div>;
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">مدیریت کاربران</h1>
          <p className="text-muted-foreground text-sm mt-1">ساخت و مدیریت حساب‌های کاربری سیستم</p>
        </div>
        <Button onClick={() => { setEditUser(undefined); setFormOpen(true); }}>
          <Plus className="h-4 w-4 ml-2" />
          کاربر جدید
        </Button>
      </div>

      <LaserCommissionCard />

      {isLoading ? (
        <div className="text-center py-10 text-muted-foreground">در حال بارگذاری...</div>
      ) : (
        <div className="grid gap-3">
          {users.map(u => (
            <Card key={u.id} className="border-border">
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-sidebar-primary/10 flex items-center justify-center">
                      {u.role === "admin" ? <ShieldCheck className="h-5 w-5 text-sidebar-primary" /> : u.role === "laser_operator" ? <Zap className="h-5 w-5 text-rose-600" /> : <User className="h-5 w-5 text-muted-foreground" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{u.username}</span>
                        {u.id === currentUser?.id && <Badge variant="outline" className="text-xs">شما</Badge>}
                        {!u.isActive && <Badge variant="destructive" className="text-xs">غیرفعال</Badge>}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant={u.role === "admin" ? "default" : u.role === "laser_operator" ? "outline" : "secondary"}
                          className={`text-xs ${u.role === "laser_operator" ? "border-rose-300 text-rose-700 bg-rose-50" : ""}`}>
                          {u.role === "admin" ? "مدیر کل" : u.role === "laser_operator" ? "اپراتور لیزر" : "کارمند"}
                        </Badge>
                        {u.role === "staff" && (
                          <span className="text-xs text-muted-foreground">
                            {u.permissions.length} دسترسی
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => { setEditUser(u); setFormOpen(true); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {u.id !== currentUser?.id && (
                      <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleteId(u.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {formOpen && (
        <UserFormDialog
          open={formOpen}
          onClose={() => { setFormOpen(false); setEditUser(undefined); }}
          initial={editUser}
          onSave={handleSave}
          isLoading={createMutation.isPending || updateMutation.isPending}
        />
      )}

      <ConfirmDeleteDialog
        open={deleteId !== null}
        title="حذف کاربر"
        description="آیا از حذف این کاربر مطمئن هستید؟ این عمل قابل بازگشت نیست."
        onConfirm={() => deleteId !== null && deleteMutation.mutate(deleteId)}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
