import { cn } from "@/lib/cn";

/** 음성 레벨 표시 — 막대들이 레벨에 반응한다.
 *
 * 중요: 막대의 layout 높이는 '고정'하고 시각적 변화는 transform: scaleY()로만 준다.
 * height를 직접 바꾸면 이 줄(섹션) 세로 높이가 음량 따라 출렁여 UI가 흔들린다(리플로우).
 * scaleY는 layout 박스를 바꾸지 않으므로 컨테이너 높이가 항상 일정하다. */
export function Waveform({ active, level, bars = 18, className }: { active: boolean; level: number; bars?: number; className?: string }) {
  return (
    <div className={cn("flex h-5 items-center gap-[3px]", className)} aria-hidden>
      {Array.from({ length: bars }).map((_, i) => {
        // 중앙이 높고 가장자리가 낮은 자연스러운 분포 + 레벨 반응
        const center = 1 - Math.abs(i - (bars - 1) / 2) / ((bars - 1) / 2);
        const base = 0.2 + center * 0.5;
        const s = active
          ? Math.max(0.08, Math.min(1, base * (0.4 + level * 1.6) * (0.7 + ((i * 7) % 5) / 10)))
          : 0.08;
        return (
          <span
            key={i}
            className={cn(
              "h-5 w-[3px] origin-center rounded-full transition-transform duration-100 ease-out",
              active ? "bg-spark-deep" : "bg-hairline",
            )}
            style={{ transform: `scaleY(${s})` }}
          />
        );
      })}
    </div>
  );
}
