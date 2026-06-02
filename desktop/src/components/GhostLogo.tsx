import { cn } from "@/lib/cn";

export function GhostLogo({
  variant = "icon",
  size = 28,
  className,
}: {
  variant?: "icon" | "mark";
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size };
  if (variant === "icon") {
    return (
      <svg viewBox="0 0 100 100" style={style} className={cn("block", className)} aria-label="Ghost" role="img">
        <rect width="100" height="100" rx="24" fill="#0a0a0a" />
        <path
          d="M26 85 L26 47 A24 24 0 0 1 74 47 L74 85 Q66 79 58 85 Q50 91 42 85 Q34 79 26 85 Z"
          fill="#fff"
        />
        <rect x="40" y="41" width="5.5" height="15" rx="2.75" fill="#0a0a0a" />
        <rect x="56" y="41" width="5.5" height="15" rx="2.75" fill="#0a0a0a" />
        <circle cx="75" cy="80" r="15" fill="#0a0a0a" />
        <path d="M75 65 Q77 77 89 80 Q77 83 75 95 Q73 83 61 80 Q73 77 75 65 Z" fill="#fff" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 100 100" style={style} className={cn("block", className)} fill="currentColor" aria-label="Ghost" role="img">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M26 85 L26 47 A24 24 0 0 1 74 47 L74 85 Q66 79 58 85 Q50 91 42 85 Q34 79 26 85 Z
           M40 41 h5.5 a2.75 2.75 0 0 1 2.75 2.75 v9.5 a2.75 2.75 0 0 1 -2.75 2.75 h-5.5 a2.75 2.75 0 0 1 -2.75 -2.75 v-9.5 a2.75 2.75 0 0 1 2.75 -2.75 Z
           M56 41 h5.5 a2.75 2.75 0 0 1 2.75 2.75 v9.5 a2.75 2.75 0 0 1 -2.75 2.75 h-5.5 a2.75 2.75 0 0 1 -2.75 -2.75 v-9.5 a2.75 2.75 0 0 1 2.75 -2.75 Z"
      />
    </svg>
  );
}
