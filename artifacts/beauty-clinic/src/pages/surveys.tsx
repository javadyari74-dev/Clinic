import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListSurveys, useScoreSurvey, useDeleteSurvey, getListSurveysQueryKey, getGetSurveyStatsQueryKey,
} from "@workspace/api-client-react";
import type { Survey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ErrorNotice } from "@/components/error-notice";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { PersianDatePicker } from "@/components/persian-date-picker";
import { Spinner } from "@/components/ui/spinner";
import { formatShamsiDate, toPersianDigits, dateToUnixSeconds } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Star, Trash2, Phone, ChevronRight, ChevronLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// برچسب وضعیت ارسال پیامک نظرسنجی
const SMS_STATUS_META: Record<string, { label: string; className: string }> = {
  sent: { label: "ارسال شد", className: "text-green-700 border-green-300" },
  failed: { label: "ناموفق", className: "text-destructive border-destructive/40" },
  pending: { label: "در انتظار ارسال", className: "text-orange-600 border-orange-300" },
};

function ScoreStars({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-0.5" dir="ltr" aria-label={`امتیاز ${score} از ۵`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn(
            "size-4",
            i <= score ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30",
          )}
        />
      ))}
    </div>
  );
}

// دیالوگ ثبت امتیاز ۱ تا ۵ + نظر — منشی پس از تماس تلفنی پر می‌کند
function ScoreDialog({
  survey, onClose,
}: {
  survey: Survey;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [score, setScore] = useState<number>(survey.score ?? 0);
  const [hovered, setHovered] = useState<number>(0);
  const [comment, setComment] = useState(survey.comment ?? "");

  const scoreMutation = useScoreSurvey({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSurveysQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetSurveyStatsQueryKey() });
        toast({ title: "امتیاز نظرسنجی ثبت شد" });
        onClose();
      },
      onError: () => toast({ title: "خطا در ثبت امتیاز", variant: "destructive" }),
    },
  });

  function submit() {
    if (score < 1) return;
    scoreMutation.mutate({
      id: survey.id,
      data: { score, comment: comment.trim() ? comment.trim() : null },
    });
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>ثبت امتیاز رضایت</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            مراجع: <span className="font-medium text-foreground">{survey.patientName ?? "—"}</span>
            {survey.serviceName ? <> — خدمت: <span className="font-medium text-foreground">{survey.serviceName}</span></> : null}
          </div>
          <div className="space-y-2">
            <Label>امتیاز (۱ تا ۵)</Label>
            <div className="flex items-center justify-center gap-2 py-2" dir="ltr">
              {[1, 2, 3, 4, 5].map((i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setScore(i)}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(0)}
                  className="p-1"
                  aria-label={`امتیاز ${i}`}
                  data-testid={`button-score-${i}`}
                >
                  <Star
                    className={cn(
                      "size-8 transition-colors",
                      i <= (hovered || score) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30",
                    )}
                  />
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="survey-comment">نظر مراجع (اختیاری)</Label>
            <Textarea
              id="survey-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="خلاصه نظر مراجع در تماس تلفنی..."
              rows={3}
              data-testid="input-survey-comment"
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>انصراف</Button>
          <Button onClick={submit} disabled={score < 1 || scoreMutation.isPending} data-testid="button-submit-score">
            {scoreMutation.isPending ? <Spinner className="size-4" /> : null}
            ثبت امتیاز
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const PAGE_SIZE = 30;

export default function Surveys() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"all" | "pending" | "scored">("all");
  // فیلتر بازه تاریخ ارسال — مقدار میلادی "YYYY-MM-DD" از PersianDatePicker
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [scoring, setScoring] = useState<Survey | null>(null);
  const [deleting, setDeleting] = useState<Survey | null>(null);

  const from = dateToUnixSeconds(fromDate, false);
  const to = dateToUnixSeconds(toDate, true);
  const hasDateFilter = fromDate !== "" || toDate !== "";

  const params = {
    ...(status !== "all" ? { status } : {}),
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    page,
    limit: PAGE_SIZE,
  };
  const { data, isLoading, isError, refetch } = useListSurveys(params);

  const deleteMutation = useDeleteSurvey({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSurveysQueryKey() });
        toast({ title: "نظرسنجی حذف شد" });
        setDeleting(null);
      },
      onError: () => toast({ title: "خطا در حذف نظرسنجی", variant: "destructive" }),
    },
  });

  const surveys = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">نظرسنجی‌ها</h1>
        <p className="text-muted-foreground mt-1">
          رضایت مراجعین پس از مراجعه — پیامک نظرسنجی به‌صورت خودکار پس از ثبت پرداخت ارسال می‌شود و منشی امتیاز را پس از تماس ثبت می‌کند
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={status} onValueChange={(v) => { setStatus(v as typeof status); setPage(1); }}>
          <TabsList>
            <TabsTrigger value="all" data-testid="tab-surveys-all">همه</TabsTrigger>
            <TabsTrigger value="pending" data-testid="tab-surveys-pending">در انتظار امتیاز</TabsTrigger>
            <TabsTrigger value="scored" data-testid="tab-surveys-scored">امتیاز داده‌شده</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">از تاریخ</span>
          <PersianDatePicker value={fromDate} onChange={(v) => { setFromDate(v); setPage(1); }} placeholder="ابتدای بازه" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">تا تاریخ</span>
          <PersianDatePicker value={toDate} onChange={(v) => { setToDate(v); setPage(1); }} placeholder="انتهای بازه" />
        </div>
        {hasDateFilter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setFromDate(""); setToDate(""); setPage(1); }}
            data-testid="button-clear-surveys-range"
          >
            حذف فیلتر
          </Button>
        )}
      </div>

      {isError && <ErrorNotice onRetry={() => refetch()} />}

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner className="size-6" /></div>
      ) : surveys.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {hasDateFilter
              ? "در این بازه تاریخ نظرسنجی‌ای یافت نشد"
              : status === "pending"
                ? "نظرسنجی در انتظار امتیازی وجود ندارد"
                : status === "scored"
                  ? "هنوز امتیازی ثبت نشده است"
                  : "هنوز نظرسنجی‌ای ارسال نشده است — با فعال‌بودن پیامک نظرسنجی، پس از هر ثبت پرداخت یک ردیف اینجا اضافه می‌شود"}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {surveys.map((s) => {
            const smsMeta = SMS_STATUS_META[s.smsStatus] ?? SMS_STATUS_META.pending;
            return (
              <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 hover:bg-accent/30 transition-colors" data-testid={`row-survey-${s.id}`}>
                <div className="flex-1 min-w-48">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{s.patientName ?? "مراجع حذف‌شده"}</span>
                    {s.patientPhone && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1" dir="ltr">
                        <Phone className="size-3" />{toPersianDigits(s.patientPhone)}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                    {s.serviceName && <span>خدمت: {s.serviceName}</span>}
                    {s.staffName && <span>کارمند: {s.staffName}</span>}
                    <span>ارسال: {formatShamsiDate(s.sentAt)}</span>
                  </div>
                  {s.comment && (
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">«{s.comment}»</p>
                  )}
                </div>
                <Badge variant="outline" className={smsMeta.className}>{smsMeta.label}</Badge>
                {s.score != null ? (
                  <ScoreStars score={s.score} />
                ) : (
                  <Badge variant="outline" className="text-orange-600 border-orange-300">در انتظار امتیاز</Badge>
                )}
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant={s.score == null ? "default" : "outline"}
                    onClick={() => setScoring(s)}
                    data-testid={`button-score-survey-${s.id}`}
                  >
                    <Star className="size-4" />
                    {s.score == null ? "ثبت امتیاز" : "ویرایش امتیاز"}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => setDeleting(s)}
                    aria-label="حذف نظرسنجی"
                    data-testid={`button-delete-survey-${s.id}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            );
          })}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} data-testid="button-surveys-prev">
                <ChevronRight className="size-4" />
                قبلی
              </Button>
              <span className="text-sm text-muted-foreground">
                صفحه {toPersianDigits(page)} از {toPersianDigits(totalPages)}
              </span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} data-testid="button-surveys-next">
                بعدی
                <ChevronLeft className="size-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      {scoring && <ScoreDialog survey={scoring} onClose={() => setScoring(null)} />}

      <ConfirmDeleteDialog
        open={deleting !== null}
        title="حذف نظرسنجی"
        description={`نظرسنجی «${deleting?.patientName ?? ""}» حذف شود؟ این عمل قابل بازگشت نیست.`}
        onConfirm={() => { if (deleting) deleteMutation.mutate({ id: deleting.id }); }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
