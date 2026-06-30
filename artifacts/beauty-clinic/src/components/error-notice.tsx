import { AlertCircle, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const ERROR_NOTICE_TITLE = "خطا در بارگذاری اطلاعات";

export function ErrorNotice({
  onRetry,
  className,
  description = "دریافت اطلاعات از سرور با مشکل مواجه شد. لطفاً اتصال خود را بررسی کرده و دوباره تلاش کنید.",
}: {
  onRetry?: () => void;
  className?: string;
  description?: string;
}) {
  return (
    <Alert variant="destructive" className={cn("flex flex-col gap-3", className)}>
      <AlertCircle className="h-4 w-4" />
      <div>
        <AlertTitle>{ERROR_NOTICE_TITLE}</AlertTitle>
        <AlertDescription>{description}</AlertDescription>
      </div>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="w-fit gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          تلاش مجدد
        </Button>
      )}
    </Alert>
  );
}
