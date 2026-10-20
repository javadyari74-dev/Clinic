import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { SortDir } from "@/hooks/use-table-sort";

/**
 * سر ستونِ قابل کلیک برای مرتب‌سازی. با useTableSort:
 *   <SortableHead {...sort.head("name")}>نام</SortableHead>
 * فلش رو به پایین = از بیشترین/آخر الفبا به کمترین؛ رو به بالا = برعکس.
 */
export function SortableHead({
  active,
  onSort,
  children,
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { active: SortDir | null; onSort: () => void }) {
  const Icon = active === "asc" ? ArrowUp : active === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <TableHead
      aria-sort={active === "asc" ? "ascending" : active === "desc" ? "descending" : "none"}
      className={cn("p-0", className)}
      {...props}
    >
      <button
        type="button"
        onClick={onSort}
        title="مرتب‌سازی"
        className={cn(
          "inline-flex h-10 w-full items-center gap-1 px-2 text-right font-medium select-none hover:text-foreground",
          "justify-start [th.text-center_&]:justify-center [th.text-left_&]:justify-end",
          active && "text-foreground",
        )}
      >
        <span>{children}</span>
        <Icon className={cn("h-3.5 w-3.5 shrink-0", active ? "text-primary" : "text-muted-foreground/40")} />
      </button>
    </TableHead>
  );
}
