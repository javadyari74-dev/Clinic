import { toast } from "@/hooks/use-toast";

/**
 * Extract the server's (Persian) error message from an error thrown by a
 * generated API hook (ApiError with `.data.error`) or by a raw fetch wrapper
 * that throws `new Error(serverMessage)`. Returns undefined when there is no
 * usable message.
 */
export function apiErrorMessage(err: unknown): string | undefined {
  const data = (err as { data?: { error?: unknown; message?: unknown } } | null)?.data;
  const fromData = data?.error ?? data?.message;
  if (typeof fromData === "string" && fromData.trim()) return fromData;
  return undefined;
}

export const GENERIC_RETRY = "لطفاً دوباره تلاش کنید.";

/**
 * Show a destructive toast for a failed mutation: `title` is the generic
 * Persian fallback ("… ناموفق بود"), the server's message (if any) is shown
 * as the description.
 */
export function toastApiError(err: unknown, title: string): void {
  const msg = apiErrorMessage(err);
  toast({ title, description: msg ?? GENERIC_RETRY, variant: "destructive" });
}

/** Curried form for `onError: onApiError("حذف ناموفق بود")`. */
export function onApiError(title: string) {
  return (err: unknown) => toastApiError(err, title);
}
