import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw, Home, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface ErrorBoundaryProps {
  children: ReactNode;
  // Changing this value (e.g. the current route) resets the boundary so the
  // user isn't stuck on the error screen after navigating to another page.
  resetKey?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
  copied: boolean;
  // Raised when the server reports this error+page has crashed repeatedly
  // (past the dedupe threshold) — i.e. reloading keeps landing on the same
  // failure. We escalate the fallback so the operator stops retrying blindly.
  persistentCrash: boolean;
}

const INITIAL_STATE: ErrorBoundaryState = {
  hasError: false,
  error: null,
  componentStack: null,
  copied: false,
  persistentCrash: false,
};

// Client-side throttle so a page stuck in a render loop (or an operator who
// keeps hitting "بارگذاری مجدد") doesn't fire a stream of near-identical
// reports. The same error+page is reported at most once per window; distinct
// crashes are always sent. Keyed across all boundary instances so remounts
// don't reset the throttle. The server applies its own guard as a backstop.
const REPORT_THROTTLE_MS = 30_000;
const lastReportedAt = new Map<string, number>();

// Exported for unit tests; clears the cross-instance throttle state.
export function __resetReportThrottle(): void {
  lastReportedAt.clear();
}

export function shouldReport(signature: string): boolean {
  const now = Date.now();
  const previous = lastReportedAt.get(signature);
  if (previous !== undefined && now - previous < REPORT_THROTTLE_MS) {
    return false;
  }
  lastReportedAt.set(signature, now);
  // Drop stale entries so the map can't grow without bound over a long session.
  if (lastReportedAt.size > 200) {
    for (const [key, at] of lastReportedAt) {
      if (now - at >= REPORT_THROTTLE_MS) lastReportedAt.delete(key);
    }
  }
  return true;
}

// Contains a render crash to the page it happened on instead of letting it
// propagate to the root and unmount the whole app (blank white screen).
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { ...INITIAL_STATE };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const componentStack = info.componentStack ?? null;
    this.setState({ componentStack });

    // Always surface the crash in the console for local debugging.
    console.error("ErrorBoundary caught an error:", error, componentStack);

    // Best-effort report to the backend so an unattended clinic leaves a
    // server-side record of the crash. Failures here are swallowed: the
    // operator still gets the fallback UI and the copy affordance.
    void this.reportError(error, componentStack);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ ...INITIAL_STATE });
    }
  }

  private async reportError(error: Error, componentStack: string | null) {
    // Skip near-identical repeats of the same crash on the same page.
    const signature = `${error.message}\n${window.location.href}`;
    if (!shouldReport(signature)) return;

    try {
      const response = await fetch("/api/client-errors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: error.message,
          stack: error.stack ?? null,
          componentStack,
          url: window.location.href,
          userAgent: navigator.userAgent,
          at: new Date().toISOString(),
        }),
        keepalive: true,
      });

      // The server answers 204 for a logged/suppressed report, but escalates
      // to 200 + { persistentCrash } once the same error+page has crashed
      // repeatedly. Surface that to the operator instead of silently retrying.
      if (response.status === 200) {
        const data = (await response.json().catch(() => null)) as {
          persistentCrash?: boolean;
        } | null;
        if (data?.persistentCrash) {
          this.setState({ persistentCrash: true });
        }
      }
    } catch {
      // Network/offline: nothing more we can do, the copy affordance remains.
    }
  }

  private buildReportText(): string {
    const { error, componentStack } = this.state;
    const lines = [
      `زمان: ${new Date().toLocaleString("fa-IR")}`,
      `آدرس: ${window.location.href}`,
      `خطا: ${error?.message ?? "نامشخص"}`,
    ];
    if (error?.stack) {
      lines.push("", "Stack:", error.stack);
    }
    if (componentStack) {
      lines.push("", "Component stack:", componentStack);
    }
    return lines.join("\n");
  }

  private handleCopy = async () => {
    const text = this.buildReportText();
    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: true });
      window.setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      // Clipboard API unavailable (e.g. insecure context): fall back to a
      // prompt so the operator can still manually copy the details.
      window.prompt("جزئیات خطا را کپی کنید:", text);
    }
  };

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        className="flex h-full w-full items-center justify-center py-24"
        dir="rtl"
      >
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-6 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
                <AlertTriangle className="h-7 w-7 text-destructive" />
              </div>
              <div className="space-y-1.5">
                <h2 className="text-xl font-bold text-foreground">
                  مشکلی در این صفحه پیش آمد
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  متأسفانه نمایش این بخش با خطا مواجه شد. می‌توانید صفحه را دوباره
                  بارگذاری کنید یا به داشبورد بازگردید. سایر بخش‌ها همچنان در
                  دسترس هستند.
                </p>
              </div>
              {this.state.persistentCrash && (
                <div
                  className="w-full rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive leading-relaxed"
                  role="alert"
                >
                  این صفحه به‌طور مکرر دچار خطا می‌شود و بارگذاری مجدد مشکل را حل
                  نکرده است. لطفاً جزئیات خطا را کپی کرده و با پشتیبانی تماس
                  بگیرید.
                </div>
              )}
              {this.state.error?.message && (
                <p
                  className="w-full rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground font-mono break-words text-left"
                  dir="ltr"
                >
                  {this.state.error.message}
                </p>
              )}
              <div className="flex flex-col sm:flex-row gap-2 w-full justify-center pt-2">
                <Button onClick={this.handleReload} className="gap-2">
                  <RotateCcw className="h-4 w-4" />
                  بارگذاری مجدد
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    window.location.href = import.meta.env.BASE_URL;
                  }}
                  className="gap-2"
                >
                  <Home className="h-4 w-4" />
                  بازگشت به داشبورد
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={this.handleCopy}
                className="gap-2 text-muted-foreground"
              >
                {this.state.copied ? (
                  <>
                    <Check className="h-4 w-4" />
                    کپی شد
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    کپی جزئیات خطا برای پشتیبانی
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
}
