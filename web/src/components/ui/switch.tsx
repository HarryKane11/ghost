"use client";

import * as React from "react";
import { Switch as BaseSwitch } from "@base-ui-components/react/switch";
import { cn } from "@/lib/utils";

export function Switch({
  className,
  ...props
}: React.ComponentProps<typeof BaseSwitch.Root>) {
  return (
    <BaseSwitch.Root
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-hairline bg-surface transition-colors duration-200 outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "data-[checked]:border-ink data-[checked]:bg-ink",
        className
      )}
      {...props}
    >
      <BaseSwitch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-canvas shadow-sm transition-transform duration-200 data-[checked]:translate-x-[22px] data-[checked]:bg-canvas" />
    </BaseSwitch.Root>
  );
}
