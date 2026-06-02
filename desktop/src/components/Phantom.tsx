import { GhostLogo } from "@/components/GhostLogo";
import { cn } from "@/lib/cn";

/**
 * 유령처럼 좌우로 떠다니며(drift) 흐릿하게 사라졌다 나타나는(phase) 마크.
 * drift / glow / phase 세 레이어를 서로 다른 주기로 겹쳐 유기적인 출몰을 만든다.
 */
export function PhantomGhost({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <div className={cn("phantom", className)}>
      <div className="phantom-glow">
        <div className="phantom-inner">
          <GhostLogo variant="mark" size={size} />
        </div>
      </div>
    </div>
  );
}

/**
 * 컨테이너 뒤에서 크고 옅은 유령들이 천천히 배회하는 ambient 레이어.
 * pointer-events 없음. 한가할 때 화면에 유령 기운을 깐다.
 */
export function PhantomField() {
  const ghosts = [
    { size: 180, top: "12%", left: "8%", dur: "16s", delay: "0s" },
    { size: 120, top: "58%", left: "62%", dur: "21s", delay: "-6s" },
    { size: 90, top: "34%", left: "78%", dur: "18s", delay: "-11s" },
  ];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {ghosts.map((g, i) => (
        <div
          key={i}
          className="phantom-roam absolute text-stone"
          style={{ top: g.top, left: g.left, animationDuration: `${g.dur}, 8s`, animationDelay: `${g.delay}, ${g.delay}` }}
        >
          <GhostLogo variant="mark" size={g.size} />
        </div>
      ))}
    </div>
  );
}
