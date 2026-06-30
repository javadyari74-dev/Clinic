import { Component, type ReactNode } from "react";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";
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
}

// Contains a render crash to the page it happened on instead of letting it
// propagate to the root and unmount the whole app (blank white screen).
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

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
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
}
