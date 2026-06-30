import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { getTier } from "@/lib/tiers";
import { cn } from "@/lib/utils";

interface TierBadgeProps {
  tier: string | null | undefined;
  showLabel?: boolean;
  className?: string;
}

export function TierBadge({ tier, showLabel = false, className }: TierBadgeProps) {
  const meta = getTier(tier);
  if (!meta) return null;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center gap-1 align-middle cursor-default select-none",
              className,
            )}
          >
            <span className="text-base leading-none">{meta.emoji}</span>
            {showLabel && <span className="text-xs text-muted-foreground">{meta.label}</span>}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <span className="font-medium">{meta.label}</span>
          {" — "}
          {meta.description}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
