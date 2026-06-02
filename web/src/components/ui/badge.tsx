import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full font-medium transition-colors",
  {
    variants: {
      variant: {
        outline: "border border-border bg-canvas text-steel",
        solid: "bg-ink text-canvas",
        soft: "bg-surface text-slate border border-hairline",
        spark:
          "border border-spark-soft bg-[color-mix(in_srgb,var(--spark)_10%,transparent)] text-spark-deep",
      },
      size: {
        sm: "h-6 px-2.5 text-[11px] tracking-[0.02em]",
        md: "h-7 px-3 text-xs",
      },
    },
    defaultVariants: { variant: "outline", size: "sm" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size }), className)} {...props} />
  );
}
