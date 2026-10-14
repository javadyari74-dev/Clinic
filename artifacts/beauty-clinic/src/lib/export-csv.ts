// ─── خروجی اکسل (CSV با BOM تا اکسل فارسی را درست باز کند) ──────────────────────
// استفاده: exportCsv("صندوق-مهر", [{ header: "مراجع", value: (r) => r.name }, ...], rows)
// اعداد خام (بدون «تومان» و جداکننده) نوشته می‌شوند تا در اکسل قابل جمع باشند.

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
}

function cell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: readonly T[]): string {
  const lines = [columns.map((c) => cell(c.header)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => cell(c.value(r))).join(","));
  return "﻿" + lines.join("\r\n");
}

export function exportCsv<T>(fileName: string, columns: CsvColumn<T>[], rows: readonly T[]): void {
  const blob = new Blob([toCsv(columns, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** تاریخ قابل‌خواندن در اکسل (شمسی، بدون ساعت) */
export function csvDate(unix: number | null | undefined): string {
  if (!unix) return "";
  const ms = unix > 1e11 ? unix : unix * 1000;
  return new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Tehran" }).format(new Date(ms));
}
