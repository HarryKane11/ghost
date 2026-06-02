import { X, Mic, MonitorSpeaker, Sparkles, FileText, Keyboard, MessageSquare, Volume2 } from "lucide-react";
import { useT } from "@/lib/i18n";

/** 사용법 + 단축키 도움말 오버레이. */
export function Help({ open, onClose, isMac }: { open: boolean; onClose: () => void; isMac: boolean }) {
  const { t } = useT();
  if (!open) return null;
  const mod = isMac ? "⌘" : "Ctrl";

  const rows = [
    { icon: <Mic className="size-4 text-steel" />, t: t("help.r1t"), d: t("help.r1d") },
    { icon: <Sparkles className="size-4 text-steel" />, t: t("help.r2t"), d: t("help.r2d") },
    { icon: <MessageSquare className="size-4 text-steel" />, t: t("help.r3t"), d: t("help.r3d") },
    { icon: <FileText className="size-4 text-steel" />, t: t("help.r4t"), d: t("help.r4d") },
    { icon: <MonitorSpeaker className="size-4 text-steel" />, t: t("help.r5t"), d: t("help.r5d") },
    { icon: <Volume2 className="size-4 text-steel" />, t: t("help.r6t"), d: t("help.r6d") },
  ];

  const keys = [
    { k: `${mod} L`, d: t("help.k1") },
    { k: "Space", d: t("help.k2") },
    { k: `${mod} K`, d: t("help.k3") },
    { k: `${mod} /`, d: t("help.k4") },
    { k: `${mod} ⇧ G`, d: t("help.k5") },
    { k: "Esc", d: t("help.k6") },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-ink/30 backdrop-blur-md" onClick={onClose}>
      <div className="mt-14 max-h-[82vh] w-[560px] overflow-y-auto rounded-2xl border border-hairline bg-canvas p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold tracking-tight">{t("help.title")}</h2>
          <button onClick={onClose} className="text-stone hover:text-foreground"><X className="size-4.5" /></button>
        </div>

        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.t} className="flex items-start gap-3 rounded-xl border border-hairline bg-surface-soft p-3.5">
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-canvas">{r.icon}</span>
              <div><p className="text-[13.5px] font-semibold tracking-tight">{r.t}</p><p className="text-[12.5px] leading-relaxed text-steel">{r.d}</p></div>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-xl border border-hairline p-4">
          <div className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold tracking-tight"><Keyboard className="size-4 text-steel" /> {t("help.shortcuts")}</div>
          <div className="space-y-1.5">
            {keys.map((k) => (
              <div key={k.k} className="flex items-center gap-3 text-[12.5px]">
                <kbd className="inline-flex min-w-[52px] justify-center rounded-md border border-hairline bg-surface px-2 py-1 font-mono text-[11.5px] text-charcoal">{k.k}</kbd>
                <span className="text-steel">{k.d}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
