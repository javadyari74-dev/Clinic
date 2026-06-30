import { useState } from "react";
import {
  useListClientErrors,
  getListClientErrorsQueryKey,
  type ClientErrorReport,
} from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ChevronDown, ChevronUp, Bug } from "lucide-react";
import { formatShamsiDate } from "@/lib/format";

function ErrorRow({ report }: { report: ClientErrorReport }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = Boolean(report.stack || report.componentStack);

  return (
    <Card className="border-border">
      <CardContent className="py-3 px-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium break-words" dir="ltr">
              {report.message}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{formatShamsiDate(report.createdAt, true)}</span>
              {report.url && (
                <>
                  <span>•</span>
                  <span className="break-all" dir="ltr">
                    {report.url}
                  </span>
                </>
              )}
            </div>
            {report.userAgent && (
              <p className="mt-1 text-xs text-muted-foreground/70 break-words" dir="ltr">
                {report.userAgent}
              </p>
            )}
            {expanded && hasDetails && (
              <div className="mt-3 space-y-3">
                {report.stack && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Stack</p>
                    <pre
                      className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground"
                      dir="ltr"
                    >
                      {report.stack}
                    </pre>
                  </div>
                )}
                {report.componentStack && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Component stack</p>
                    <pre
                      className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground"
                      dir="ltr"
                    >
                      {report.componentStack}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
          {hasDetails && (
            <Button
              size="sm"
              variant="ghost"
              className="flex-shrink-0 gap-1 text-muted-foreground"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-4 w-4" /> بستن
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4" /> جزئیات
                </>
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ClientErrors() {
  const { user } = useAuth();

  const { data: reports = [], isLoading, isError } = useListClientErrors({
    query: {
      enabled: user?.role === "admin",
      queryKey: getListClientErrorsQueryKey(),
    },
  });

  if (user?.role !== "admin") {
    return <div className="text-center py-20 text-muted-foreground">شما دسترسی به این بخش ندارید</div>;
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold">گزارش‌های خطا</h1>
        <p className="text-muted-foreground text-sm mt-1">
          خطاهای رخ‌داده در نمایش صفحات سمت کاربر، جدیدترین در بالا
        </p>
      </div>

      {isLoading ? (
        <div className="text-center py-10 text-muted-foreground">در حال بارگذاری...</div>
      ) : isError ? (
        <div className="text-center py-10 text-destructive">خطا در دریافت گزارش‌ها</div>
      ) : reports.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Bug className="h-6 w-6" />
            </div>
            <p>هیچ خطایی ثبت نشده است</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Badge variant="secondary" className="text-xs">
            {reports.length} گزارش
          </Badge>
          <div className="grid gap-3">
            {reports.map((r) => (
              <ErrorRow key={r.id} report={r} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
