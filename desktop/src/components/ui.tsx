import * as React from "react";
import { cn } from "@/lib/cn";

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "icon";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]/40 disabled:opacity-40 disabled:pointer-events-none select-none active:scale-[0.98]";
  const variants = {
    primary: "bg-[var(--primary)] text-[var(--primary-foreground)] rounded-full hover:opacity-90",
    secondary: "border border-[var(--border)] text-[var(--foreground)] rounded-full hover:bg-[var(--surface)]",
    ghost: "text-[var(--steel)] rounded-lg hover:bg-[var(--surface)] hover:text-[var(--foreground)]",
  };
  const sizes = { sm: "h-8 px-3 text-[13px]", md: "h-10 px-5 text-sm", icon: "size-9 rounded-lg" };
  return <button className={cn(base, variants[variant], sizes[size], className)} {...props} />;
}

export function Badge({
  variant = "soft",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: "soft" | "solid" | "spark" | "warn" }) {
  const variants = {
    soft: "bg-[var(--surface)] text-[var(--slate)] border border-[var(--hairline)]",
    solid: "bg-[var(--ink)] text-[var(--canvas)]",
    spark: "border border-[var(--spark-soft)] text-[var(--spark-deep)] bg-[color-mix(in_srgb,var(--spark)_10%,transparent)]",
    warn: "border border-[#e9c46a] text-[#9a6a00] bg-[#fdf6e3]",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 h-6 text-[11px] font-medium",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
