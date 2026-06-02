import { cn } from "@/lib/utils";

type GhostLogoProps = {
  /** "icon" = filled rounded-square app icon · "mark" = bare glyph in currentColor */
  variant?: "icon" | "mark";
  className?: string;
  /** pixel size for square render */
  size?: number;
};

/**
 * Ghost brand logo — a ghost silhouette with a "spark" at the lower-right,
 * recreated from the provided mark. Monochrome by design.
 */
export function GhostLogo({ variant = "mark", className, size }: GhostLogoProps) {
  const style = size ? { width: size, height: size } : undefined;

  if (variant === "icon") {
    return (
      <svg
        viewBox="0 0 100 100"
        className={cn("block", className)}
        style={style}
        role="img"
        aria-label="Ghost"
      >
        <rect width="100" height="100" rx="24" fill="#0a0a0a" />
        <g fill="#fff">
          {/* body */}
          <path d="M26 85 L26 47 A24 24 0 0 1 74 47 L74 85 Q66 79 58 85 Q50 91 42 85 Q34 79 26 85 Z" />
        </g>
        {/* eyes */}
        <rect x="40" y="41" width="5.5" height="15" rx="2.75" fill="#0a0a0a" />
        <rect x="56" y="41" width="5.5" height="15" rx="2.75" fill="#0a0a0a" />
        {/* spark notch + star */}
        <circle cx="75" cy="80" r="15" fill="#0a0a0a" />
        <path
          d="M75 65 Q77 77 89 80 Q77 83 75 95 Q73 83 61 80 Q73 77 75 65 Z"
          fill="#fff"
        />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 100 100"
      className={cn("block", className)}
      style={style}
      role="img"
      aria-label="Ghost"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M26 85 L26 47 A24 24 0 0 1 74 47 L74 85 Q66 79 58 85 Q50 91 42 85 Q34 79 26 85 Z
           M40 41 h5.5 a2.75 2.75 0 0 1 2.75 2.75 v9.5 a2.75 2.75 0 0 1 -2.75 2.75 h-5.5 a2.75 2.75 0 0 1 -2.75 -2.75 v-9.5 a2.75 2.75 0 0 1 2.75 -2.75 Z
           M56 41 h5.5 a2.75 2.75 0 0 1 2.75 2.75 v9.5 a2.75 2.75 0 0 1 -2.75 2.75 h-5.5 a2.75 2.75 0 0 1 -2.75 -2.75 v-9.5 a2.75 2.75 0 0 1 2.75 -2.75 Z"
      />
      <path
        className="text-spark"
        d="M86 70 Q88 80 98 82 Q88 84 86 94 Q84 84 74 82 Q84 80 86 70 Z"
        fill="currentColor"
      />
    </svg>
  );
}
