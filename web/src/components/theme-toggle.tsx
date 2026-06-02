"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = React.useState(false);

  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  return (
    <button
      type="button"
      aria-label="테마 전환"
      onClick={() => setDark((d) => !d)}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-full border border-border text-steel transition-colors hover:bg-surface hover:text-foreground",
        className
      )}
    >
      {dark ? <Moon className="size-4" /> : <Sun className="size-4" />}
    </button>
  );
}
