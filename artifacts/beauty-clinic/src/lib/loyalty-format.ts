import { formatCurrency, toPersianDigits } from "@/lib/format";

// ردیف‌های تومانی (اعتبار کیف پول) delta صفر دارند و مبلغشان در amount است؛
// ردیف‌های امتیازی قدیمی delta دارند
export type TxLike = { delta: number; amount: number; type: string };
const NEGATIVE_TYPES = ["expire", "reverse", "redeem"];
// ردیف‌های تومانی: علامت از خود مبلغ (اصلاح/کسر دستی منفی است) و برای انقضا/برگردان معکوس
export function txSign(tx: TxLike): number {
  if (tx.delta !== 0) return Math.sign(tx.delta);
  return (NEGATIVE_TYPES.includes(tx.type) ? -1 : 1) * (tx.amount < 0 ? -1 : 1);
}
export function txAmountText(tx: TxLike): string {
  const sign = txSign(tx) > 0 ? "+" : "−";
  return tx.delta !== 0
    ? `${sign}${toPersianDigits(Math.abs(tx.delta))} امتیاز`
    : `${sign}${formatCurrency(Math.abs(tx.amount))}`;
}
