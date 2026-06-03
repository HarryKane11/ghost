import { Radio, MonitorPlay, FileAudio, ArrowRight } from "lucide-react";
import { GhostLogo } from "@/components/GhostLogo";

export type LaunchMode = "live" | "watch" | "audio";

/** 진입 런처 — 매 실행 시 3가지 모드 중 선택. macOS는 상단 신호등 영역을 드래그 가능하게 비운다. */
export function Launcher({ onSelect, isMac = false, t }: { onSelect: (m: LaunchMode) => void; isMac?: boolean; t: (k: string) => string }) {
  const DRAG = { WebkitAppRegion: "drag" } as any;
  const NODRAG = { WebkitAppRegion: "no-drag" } as any;

  const cards: { mode: LaunchMode; icon: React.ReactNode; title: string; desc: string }[] = [
    { mode: "live", icon: <Radio className="size-6" />, title: t("launch.liveTitle"), desc: t("launch.liveDesc") },
    { mode: "watch", icon: <MonitorPlay className="size-6" />, title: t("launch.watchTitle"), desc: t("launch.watchDesc") },
    { mode: "audio", icon: <FileAudio className="size-6" />, title: t("launch.audioTitle"), desc: t("launch.audioDesc") },
  ];

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="h-10 shrink-0" style={{ ...DRAG, paddingLeft: isMac ? 84 : undefined }} />
      <div className="flex flex-1 flex-col items-center justify-center px-6" style={NODRAG}>
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <GhostLogo variant="icon" size={48} className="rounded-2xl" />
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Ghost</h1>
          <p className="text-[13px] text-stone">{t("launch.subtitle")}</p>
        </div>
        <div className="grid w-full max-w-3xl gap-3 sm:grid-cols-3">
          {cards.map((c) => (
            <button key={c.mode} onClick={() => onSelect(c.mode)}
              className="group flex flex-col gap-3 rounded-2xl border border-hairline bg-surface-soft/40 p-5 text-left transition-all hover:border-ink/30 hover:bg-surface hover:shadow-sm">
              <span className="grid size-11 place-items-center rounded-xl bg-canvas text-spark-deep shadow-sm">{c.icon}</span>
              <div className="flex-1">
                <div className="text-[14.5px] font-semibold text-foreground">{c.title}</div>
                <p className="mt-1 text-[12px] leading-relaxed text-stone">{c.desc}</p>
              </div>
              <span className="inline-flex items-center gap-1 text-[12px] font-medium text-steel transition-colors group-hover:text-foreground">
                {t("launch.start")} <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
