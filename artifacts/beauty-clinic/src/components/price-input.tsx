import { useState, useEffect } from "react";
import { toPersianDigits } from "@/lib/format";
import { cn } from "@/lib/utils";

function persianToEnglish(str: string): string {
  return str.replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 1776));
}

function formatDisplay(num: number): string {
  return toPersianDigits(num.toLocaleString("en-US"));
}

interface PriceInputProps {
  value?: number | null;
  onChange?: (value: number) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function PriceInput({ value, onChange, placeholder = "", className, disabled }: PriceInputProps) {
  const [display, setDisplay] = useState<string>(() => {
    const n = Number(value);
    return n ? formatDisplay(n) : "";
  });

  useEffect(() => {
    const n = Number(value);
    const currentRaw = parseInt(persianToEnglish(display).replace(/[^0-9]/g, ""), 10) || 0;
    if (currentRaw !== n) {
      setDisplay(n ? formatDisplay(n) : "");
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = persianToEnglish(e.target.value).replace(/[^0-9]/g, "");
    if (raw === "") {
      setDisplay("");
      onChange?.(0);
      return;
    }
    const num = parseInt(raw, 10);
    if (isNaN(num)) return;
    setDisplay(formatDisplay(num));
    onChange?.(num);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      value={display}
      onChange={handleChange}
      placeholder={placeholder}
      disabled={disabled}
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      style={{ direction: "ltr", textAlign: "right" }}
    />
  );
}
