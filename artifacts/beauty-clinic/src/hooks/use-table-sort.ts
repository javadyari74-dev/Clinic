import { useCallback, useMemo, useState } from "react";

// ─── مرتب‌سازی جدول‌ها با کلیک روی سر ستون ─────────────────────────────────────
// هر جدول برای ستون‌های قابل مرتب‌سازی یک «مقدار» تعریف می‌کند (عدد، متن، تاریخ به ثانیه، …).
// کلیک اول: ستون عددی از بیشترین به کمترین، ستون متنی به ترتیب الفبا (الف تا ی)؛
// کلیک دوم: برعکس؛ کلیک سوم: برگشت به ترتیب پیش‌فرض جدول.
// مقدار خالی (null/undefined/"") در هر دو جهت آخر می‌آید.

export type SortDir = "asc" | "desc";
export type SortValue = string | number | boolean | null | undefined;
export type SortAccessors<T> = Record<string, (row: T) => SortValue>;
export interface SortState<K extends string = string> { key: K; dir: SortDir }

const collator = new Intl.Collator("fa", { numeric: true, sensitivity: "base" });

const isEmpty = (v: SortValue) => v === null || v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v));

export function compareSortValues(a: SortValue, b: SortValue): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" || typeof b === "boolean") return Number(a) - Number(b);
  return collator.compare(String(a), String(b));
}

/** مرتب‌سازی پایدار؛ خالی‌ها همیشه آخر */
export function sortRows<T>(rows: readonly T[], get: (row: T) => SortValue, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, v: get(row) }))
    .sort((x, y) => {
      const ex = isEmpty(x.v), ey = isEmpty(y.v);
      if (ex || ey) return ex === ey ? x.i - y.i : ex ? 1 : -1;
      return compareSortValues(x.v, y.v) * sign || x.i - y.i;
    })
    .map((x) => x.row);
}

/** جهت کلیک اول: عدد/بولی → نزولی (بیشترین اول)، متن → صعودی (الف تا ی) */
export function firstDirection<T>(rows: readonly T[], get: (row: T) => SortValue): SortDir {
  for (const r of rows) {
    const v = get(r);
    if (isEmpty(v)) continue;
    return typeof v === "string" ? "asc" : "desc";
  }
  return "asc";
}

export interface TableSort<T, K extends string> {
  /** ردیف‌های مرتب‌شده (یا همان ترتیب اصلی وقتی مرتب‌سازی فعال نیست) */
  sorted: T[];
  sort: SortState<K> | null;
  toggle: (key: K) => void;
  /** props برای <SortableHead> */
  head: (key: K) => { active: SortDir | null; onSort: () => void };
}

export function useTableSort<T, A extends SortAccessors<T>>(
  rows: readonly T[] | null | undefined,
  accessors: A,
  initial: SortState<Extract<keyof A, string>> | null = null,
): TableSort<T, Extract<keyof A, string>> {
  type K = Extract<keyof A, string>;
  const [sort, setSort] = useState<SortState<K> | null>(initial);
  const list = rows ?? [];

  const sorted = useMemo(() => {
    if (!sort || !accessors[sort.key]) return [...list];
    return sortRows(list, accessors[sort.key], sort.dir);
    // accessors معمولاً هر رندر دوباره ساخته می‌شوند؛ فقط کلید مهم است
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, sort]);

  const toggle = useCallback((key: K) => {
    setSort((cur) => {
      const first = firstDirection(list, accessors[key]);
      if (!cur || cur.key !== key) return { key, dir: first };
      if (cur.dir === first) return { key, dir: first === "asc" ? "desc" : "asc" };
      return null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  const head = (key: K) => ({ active: sort?.key === key ? sort.dir : null, onSort: () => toggle(key) });

  return { sorted, sort, toggle, head };
}
