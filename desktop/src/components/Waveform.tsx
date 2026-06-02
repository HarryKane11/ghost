import { cn } from "@/lib/cn";

/** WhisperFlow식 flat 음성 표시 — 얇은 막대들이 레벨에 반응. 오브 같은 글로우 없음. */
export function Waveform({ active, level, bars = 18, className }: { active: boolean; level: number; bars?: number; className?: string }) {
  return (
    <div className={cn("flex items-center gap-[3px]", className)} aria-hidden>
      {Array.from({ length: bars }).map((_, i) => {
        // 중앙이 높고 가장자리가 낮은 자연스러운 분포 + 레벨 반응
        const center = 1 - Math.abs(i - (bars - 1) / 2) / ((bars - 1) / 2);
        const base = 0.18 + center * 0.5;
        const h = active ? Math.max(0.12, Math.min(1, base * (0.4 + level * 1.6) * (0.7 + ((i * 7) % 5) / 10))) : 0.12;
        return (
          <span
            key={i}
            className={cn("w-[3px] rounded-full transition-[height,background-color] duration-100", active ? "bg-spark-deep" : "bg-hairline")}
            style={{ height: `${h * 22 + 2}px` }}
          />
        );
      })}
    </div>
  );
}
