import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0 select-none",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground rounded-full hover:opacity-90 active:scale-[0.98] shadow-[0_1px_2px_rgba(0,0,0,0.08)]",
        secondary:
          "bg-transparent text-foreground border border-border rounded-full hover:bg-surface active:scale-[0.98]",
        ghost:
          "bg-transparent text-foreground rounded-md hover:bg-surface",
        accent:
          "bg-spark text-ink rounded-full hover:bg-spark-deep active:scale-[0.98]",
        link: "bg-transparent text-foreground underline-offset-4 hover:underline p-0 h-auto",
      },
      size: {
        sm: "h-9 px-4 text-[13px]",
        md: "h-10 px-5 text-sm",
        lg: "h-12 px-7 text-[15px]",
        icon: "size-10 rounded-full",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
);
Button.displayName = "Button";

export { buttonVariants };
