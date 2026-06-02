import { GhostLogo } from "@/components/GhostLogo";

/** 음성 반응 리스닝 오브 — 유령 기운이 도는 자비스풍 코어. */
export function Orb({
  active,
  speaking,
  level,
  thinking,
}: {
  active: boolean;
  speaking: boolean;
  level: number; // 0..1
  thinking: boolean;
}) {
  const scale = 1 + (active ? level * 0.22 : 0);
  const glow = active ? 0.25 + level * 0.6 : 0.08;

  return (
    <div className="relative grid place-items-center" style={{ width: 200, height: 200 }}>
      {/* 외곽 글로우 */}
      <div
        className="absolute rounded-full transition-all duration-200"
        style={{
          width: 200,
          height: 200,
          background: `radial-gradient(circle, color-mix(in srgb, var(--spark) ${Math.round(
            glow * 100
          )}%, transparent) 0%, transparent 62%)`,
          transform: `scale(${1 + level * 0.3})`,
          filter: "blur(6px)",
        }}
      />
      {/* 호흡 링 */}
      <div
        className={`absolute rounded-full border border-hairline ${active ? "orb-breathe" : ""}`}
        style={{ width: 168, height: 168, opacity: active ? 0.9 : 0.5 }}
      />
      <div
        className="absolute rounded-full border transition-all duration-150"
        style={{
          width: 134,
          height: 134,
          borderColor: speaking ? "var(--spark)" : "var(--hairline)",
          transform: `scale(${scale})`,
          boxShadow: speaking ? `0 0 24px color-mix(in srgb, var(--spark) 40%, transparent)` : "none",
        }}
      />

      {/* 떠다니는 입자 */}
      {active &&
        Array.from({ length: 6 }).map((_, i) => {
          const ang = (i / 6) * Math.PI * 2;
          const dx = Math.cos(ang) * 70;
          const dy = Math.sin(ang) * 70;
          return (
            <span
              key={i}
              className="particle absolute rounded-full bg-spark"
              style={
                {
                  width: 4,
                  height: 4,
                  ["--dx" as any]: `${dx}px`,
                  ["--dy" as any]: `${dy}px`,
                  ["--dur" as any]: `${2.6 + (i % 3) * 0.6}s`,
                  ["--delay" as any]: `${i * 0.4}s`,
                } as React.CSSProperties
              }
            />
          );
        })}

      {/* 코어 — Ghost 마크 */}
      <div
        className="relative grid size-[92px] place-items-center rounded-full bg-ink transition-transform duration-150"
        style={{ transform: `scale(${scale})` }}
      >
        <GhostLogo variant="icon" size={92} className="rounded-full" />
        {thinking && (
          <span className="absolute -bottom-1 flex gap-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="think-dot size-1 rounded-full bg-canvas"
                style={{ animationDelay: `${i * 0.16}s` }}
              />
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
