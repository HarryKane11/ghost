import { useEffect, useState } from "react";
import { GhostLogo } from "@/components/GhostLogo";

type Bubble = { id: number; text: string };

/**
 * 플로팅 고스트 오브 — `#orb` 해시로 뜨는 미니 투명 창.
 *
 * 메인 창이 숨겨진 동안에도 전사는 메인 렌더러가 백그라운드에서 계속하고,
 * 여기는 (1) 클릭하면 메인 창 복귀, (2) 카드가 도착하면 회의 중 자기 생각을
 * 밝히듯 아이콘 위에 말풍선을 띄우는 역할만 한다.
 */
export default function OrbApp() {
  const g = (typeof window !== "undefined" ? (window as any).ghost : null) || {};
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const [active, setActive] = useState(false);

  // 투명 창 — 루트 배경을 비워 둔다(스타일시트의 흰 배경 무효화).
  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, []);

  useEffect(() => g.onOrbBubble?.((text: string) => {
    const tx = (text || "").trim();
    if (!tx) return;
    const id = Date.now();
    setBubble({ id, text: tx.length > 140 ? tx.slice(0, 139) + "…" : tx });
    // 잠깐 생각을 밝히고 스르륵 사라진다.
    setTimeout(() => setBubble((b) => (b?.id === id ? null : b)), 12000);
  }), []);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => g.onOrbState?.((s: { active?: boolean }) => setActive(!!s?.active)), []);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-screen w-screen flex-col items-end justify-end gap-2.5 bg-transparent p-4"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}>
      {bubble && (
        <button onClick={() => g.showMain?.()} style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          className="orb-bubble max-w-[260px] rounded-2xl rounded-br-md border border-hairline bg-canvas px-3.5 py-2.5 text-left text-[12.5px] leading-relaxed text-foreground shadow-2xl">
          {bubble.text}
        </button>
      )}
      <button onClick={() => g.showMain?.()} title="Ghost 열기"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        className="relative grid size-14 shrink-0 place-items-center rounded-full bg-ink shadow-2xl transition-transform hover:scale-105">
        <GhostLogo variant="icon" size={42} className="rounded-full" />
        {active && <span className="soul-pulse absolute -right-0.5 -top-0.5 size-3 rounded-full bg-spark ring-2 ring-canvas" />}
      </button>
    </div>
  );
}
