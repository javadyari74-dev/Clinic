import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch, getListRemindersQueryKey, useUpdateReminder, useDeleteReminder,
  type Reminder,
} from "@workspace/api-client-react";
import { Bell, Check, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PersianDatePicker } from "@/components/persian-date-picker";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { useToast } from "@/hooks/use-toast";
import { onApiError } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { formatShamsiDate, gregorianDateToUnix, toPersianDigits, unixToGregorianDate } from "@/lib/format";

/** کلید کوئری زیر پیشوند `/api/reminders` تا ابطال‌های صفحهٔ یادآوری‌ها این کارت را هم تازه کند */
export const patientRemindersQueryKey = (patientId: number) =>
  [...getListRemindersQueryKey(), { patientId }] as const;

/**
 * یادآوری‌های یک مراجع در پرونده: علامت انجام‌شده، ویرایش عنوان/سررسید، حذف.
 * ثبت یادآوری جدید از دکمهٔ زنگ ردیف نوبت‌ها (دیالوگ موجود در پرونده) انجام می‌شود.
 */
export function PatientRemindersCard({
  patientId,
  canEdit,
  onAdd,
}: {
  patientId: number;
  /** ویرایش/حذف/انجام‌شده (PUT/DELETE /reminders) فقط با دسترسی «یادآوری‌ها» */
  canEdit: boolean;
  onAdd?: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ id: number; title: string; date: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Reminder | null>(null);

  const { data } = useQuery({
    queryKey: patientRemindersQueryKey(patientId),
    queryFn: () => customFetch<Reminder[]>(`/api/reminders?patientId=${patientId}`),
    enabled: patientId > 0,
  });
  // سرور فیلتر می‌کند؛ فیلتر سمت کاربر فقط احتیاط است
  const reminders = (Array.isArray(data) ? data : []).filter((r) => r.patientId === patientId);
  const pendingCount = reminders.filter((r) => r.status !== "done").length;
  const sorted = [...reminders].sort((a, b) =>
    (a.status === "done" ? 1 : 0) - (b.status === "done" ? 1 : 0) || a.dueAt - b.dueAt);
  const nowSec = Math.floor(Date.now() / 1000);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListRemindersQueryKey() });

  const updateReminder = useUpdateReminder({
    mutation: {
      onSuccess: () => { void invalidate(); },
      onError: onApiError("ویرایش یادآوری ناموفق بود"),
    },
  });
  const deleteReminder = useDeleteReminder({
    mutation: {
      onSuccess: () => { void invalidate(); toast({ title: "یادآوری حذف شد" }); },
      onError: onApiError("حذف یادآوری ناموفق بود"),
    },
  });

  function saveEdit() {
    if (!editing) return;
    if (!editing.title.trim() || !editing.date) {
      toast({ title: "عنوان و تاریخ سررسید الزامی است", variant: "destructive" });
      return;
    }
    updateReminder.mutate(
      { id: editing.id, data: { title: editing.title.trim(), dueAt: gregorianDateToUnix(editing.date) } },
      { onSuccess: () => { setEditing(null); toast({ title: "یادآوری ویرایش شد" }); } },
    );
  }

  return (
    <Card data-testid="patient-reminders-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" />
            یادآوری‌های مراجع
            {pendingCount > 0 && (
              <Badge variant="secondary" className="text-xs">{toPersianDigits(pendingCount)} در انتظار</Badge>
            )}
          </CardTitle>
          {onAdd && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={onAdd}>
              <Bell className="h-3 w-3" /> یادآوری جدید
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-center text-muted-foreground text-sm py-4">یادآوری‌ای برای این مراجع ثبت نشده</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {sorted.map((r) => {
              const done = r.status === "done";
              const overdue = !done && r.dueAt < nowSec;
              const isEditing = editing?.id === r.id;
              return (
                <div key={r.id} className="rounded-lg border bg-muted/40 p-2.5 text-sm" data-testid={`patient-reminder-${r.id}`}>
                  {isEditing ? (
                    <div className="space-y-2">
                      <Input
                        value={editing.title}
                        onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                        aria-label="عنوان یادآوری"
                      />
                      <PersianDatePicker
                        value={editing.date}
                        onChange={(d) => setEditing({ ...editing, date: d })}
                        placeholder="تاریخ سررسید"
                      />
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" className="h-7" onClick={() => setEditing(null)}>
                          <X className="h-3.5 w-3.5 ml-1" /> انصراف
                        </Button>
                        <Button size="sm" className="h-7" onClick={saveEdit} disabled={updateReminder.isPending}>
                          <Check className="h-3.5 w-3.5 ml-1" /> ذخیره
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", done ? "bg-green-500" : overdue ? "bg-red-500" : "bg-orange-400")} />
                      <div className="min-w-0 flex-1">
                        <p className={cn("truncate font-medium", done && "line-through text-muted-foreground")}>{r.title}</p>
                        <p className={cn("text-xs", overdue ? "text-red-600 font-bold" : "text-muted-foreground")}>
                          سررسید: {formatShamsiDate(r.dueAt)}{overdue && " (گذشته)"}
                        </p>
                      </div>
                      {canEdit && (
                        <div className="flex shrink-0 items-center gap-0.5">
                          <Button
                            size="icon" variant="ghost" className="h-7 w-7"
                            title={done ? "بازگردانی به در انتظار" : "انجام شد"}
                            aria-label={done ? "بازگردانی به در انتظار" : "انجام شد"}
                            disabled={updateReminder.isPending}
                            onClick={() => updateReminder.mutate(
                              { id: r.id, data: { status: done ? "pending" : "done" } },
                              { onSuccess: () => toast({ title: done ? "یادآوری دوباره فعال شد" : "یادآوری انجام شد" }) },
                            )}
                          >
                            {done ? <RotateCcw className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5 text-green-600" />}
                          </Button>
                          <Button
                            size="icon" variant="ghost" className="h-7 w-7"
                            title="ویرایش یادآوری" aria-label="ویرایش یادآوری"
                            onClick={() => setEditing({ id: r.id, title: r.title, date: unixToGregorianDate(r.dueAt) })}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                            title="حذف یادآوری" aria-label="حذف یادآوری"
                            onClick={() => setDeleteTarget(r)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
      <ConfirmDeleteDialog
        open={!!deleteTarget}
        title="حذف یادآوری"
        description={`یادآوری «${deleteTarget?.title ?? ""}» حذف شود؟`}
        onConfirm={() => { if (deleteTarget) deleteReminder.mutate({ id: deleteTarget.id }); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />
    </Card>
  );
}
