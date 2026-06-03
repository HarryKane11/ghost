import { useMemo, useState } from "react";
import { X, MonitorPlay, Ear, Square, Send, Languages } from "lucide-react";
import type { TransLang } from "@/lib/api";
import { GhostLogo } from "@/components/GhostLogo";
import { GenUI, type Spec } from "@/components/GenUI";
import { cn } from "@/lib/cn";

export type WatchCard = { id: string; query: string; ack?: string; status: "chat" | "working" | "done"; spec?: Spec };

/** YouTube URL/ID에서 11자리 video id를 뽑는다. (watch?v= · youtu.be · embed · shorts) */
function parseVideoId(input: string): string {
  const s = (input || "").trim();
  if (!s) return "";
  if (/^[\w-]{11}$/.test(s)) return s;
  const m =
    s.match(/[?&]v=([\w-]{11})/) ||
    s.match(/youtu\.be\/([\w-]{11})/) ||
    s.match(/\/embed\/([\w-]{11})/) ||
    s.match(/\/shorts\/([\w-]{11})/);
  return m ? m[1] : "";
}

type Line = { id: string; text: string };

// 백엔드 langs fetch가 늦거나 실패해도 셀렉트가 비지 않도록 내장 폴백(백엔드 목록과 동일).
const FALLBACK_LANGS: TransLang[] = [
  { code: "en", name: "English", label: "English" },
  { code: "ko", name: "Korean", label: "한국어" },
  { code: "zh", name: "Simplified Chinese", label: "中文" },
  { code: "ja", name: "Japanese", label: "日本語" },
  { code: "es", name: "Spanish", label: "Español" },
  { code: "fr", name: "French", label: "Français" },
  { code: "de", name: "German", label: "Deutsch" },
  { code: "vi", name: "Vietnamese", label: "Tiếng Việt" },
];

/**
 * YouTube 워치 모드 — 임베드 영상 + 우측 실시간 스크립트·번역 + 우하단 플로팅 고스트 챗.
 * 스크립트는 '시스템 오디오'를 STT로 받아 만든다(영상 소리를 공유해야 함). 번역은 기존 파이프라인 재사용.
 */
export function WatchView({
  open, onClose, active, onToggleListen,
  transcript, translations, transLang, setTransLang, transLangs,
  draft, cards, onAsk, t, isMac = false,
}: {
  open: boolean;
  onClose: () => void;
  active: boolean;
  onToggleListen: () => void;
  transcript: Line[];
  translations: Record<string, string>;
  transLang: string;
  setTransLang: (s: string) => void;
  transLangs: TransLang[];
  draft: string;
  cards: WatchCard[];
  onAsk: (q: string) => void;
  t: (k: string) => string;
  isMac?: boolean;
}) {
  const DRAG = { WebkitAppRegion: "drag" } as any;
  const NODRAG = { WebkitAppRegion: "no-drag" } as any;
  const [url, setUrl] = useState("");
  const [videoId, setVideoId] = useState("");
  const langs = transLangs.length ? transLangs : FALLBACK_LANGS;
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");

  const embedSrc = useMemo(
    () => (videoId ? `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0` : ""),
    [videoId],
  );

  if (!open) return null;

  const loadUrl = () => { const id = parseVideoId(url); if (id) setVideoId(id); };
  const send = () => { const q = chatInput.trim(); if (!q) return; onAsk(q); setChatInput(""); };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-canvas">
      {/* 상단 바: 닫기 · URL · 듣기 토글. macOS는 신호등(닫기 버튼)과 안 겹치게 왼쪽 여백 + 드래그 영역. */}
      <div className="flex items-center gap-2 border-b border-hairline px-4 py-2.5" style={{ ...DRAG, paddingLeft: isMac ? 84 : undefined }}>
        <button style={NODRAG} onClick={onClose} title={t("admin.back")} className="grid size-8 shrink-0 place-items-center rounded-lg text-stone hover:bg-surface hover:text-foreground"><X className="size-4.5" /></button>
        <MonitorPlay className="size-4 shrink-0 text-[#ff0033]" />
        <input
          style={NODRAG}
          value={url} onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") loadUrl(); }}
          placeholder={t("watch.urlPlaceholder")}
          className="h-8 min-w-0 flex-1 rounded-lg border border-hairline bg-surface-soft px-3 text-[12.5px] text-charcoal outline-none placeholder:text-stone focus:border-ink/40"
        />
        <button style={NODRAG} onClick={loadUrl} className="h-8 shrink-0 rounded-lg border border-hairline px-3 text-[12px] font-medium text-steel hover:text-foreground">{t("watch.load")}</button>
        <button style={NODRAG} onClick={onToggleListen}
          className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12px] font-medium transition-colors",
            active ? "bg-[#d05757] text-white" : "bg-ink text-canvas")}>
          {active ? <><Square className="size-3.5" /> {t("watch.stop")}</> : <><Ear className="size-3.5" /> {t("watch.listen")}</>}
        </button>
      </div>

      {/* 본문: 위 영상(상단 영역 꽉 채움) · 아래 스크립트+번역 */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1 bg-black">
          {embedSrc ? (
            <iframe src={embedSrc} title="YouTube" className="absolute inset-0 size-full border-0"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-3 text-center text-stone">
              <MonitorPlay className="size-10 text-white/20" />
              <p className="text-[13px] text-white/50">{t("watch.empty")}</p>
            </div>
          )}
        </div>

        {/* 하단 스크립트 패널 */}
        <aside className="flex h-[34%] min-h-[150px] shrink-0 flex-col border-t border-hairline">
          <div className="flex items-center gap-2 border-b border-hairline px-3.5 py-2.5">
            <span className="text-[12.5px] font-semibold text-foreground">{t("watch.script")}</span>
            <span className="inline-flex items-center gap-1 text-[11px] text-stone">
              <span className={cn("size-1.5 rounded-full", active ? "bg-spark" : "bg-stone/40")} />
              {active ? t("watch.live") : t("watch.idle")}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <Languages className="size-3.5 text-stone" />
              <select value={transLang} onChange={(e) => setTransLang(e.target.value)}
                className="h-7 rounded-lg border border-hairline bg-surface-soft px-1.5 text-[11.5px] text-charcoal outline-none focus:border-ink/40">
                {langs.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3.5 py-3">
            {transcript.length === 0 && !draft && (
              <p className="rounded-lg border border-dashed border-hairline px-3 py-6 text-center text-[12px] text-stone">
                {active ? t("watch.waiting") : t("watch.startHint")}
              </p>
            )}
            {transcript.map((ln) => (
              <div key={ln.id} className="ghost-line">
                <p className="text-[13px] leading-relaxed text-slate">{ln.text}</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-spark-deep">
                  {translations[`${transLang}:${ln.id}`] ?? <span className="italic text-stone">…</span>}
                </p>
              </div>
            ))}
            {draft && active && (
              <p className="text-[13px] italic leading-relaxed text-stone">{draft}<span className="text-spark-deep">…</span></p>
            )}
          </div>
        </aside>
      </div>

      {/* 우하단 플로팅 고스트 — 클릭 시 챗 */}
      <div className="absolute bottom-5 right-5 z-10 flex flex-col items-end gap-3">
        {chatOpen && (
          <div className="w-80 overflow-hidden rounded-2xl border border-hairline bg-canvas shadow-2xl">
            <div className="flex items-center gap-2 border-b border-hairline px-3.5 py-2.5">
              <GhostLogo size={16} />
              <span className="text-[12.5px] font-semibold text-foreground">{t("watch.askGhost")}</span>
              <button onClick={() => setChatOpen(false)} className="ml-auto text-stone hover:text-foreground"><X className="size-4" /></button>
            </div>
            {cards.length === 0 ? (
              <p className="px-3.5 pt-2.5 text-[11.5px] leading-relaxed text-stone">{t("watch.askHint")}</p>
            ) : (
              <div className="max-h-[46vh] space-y-3 overflow-y-auto px-3.5 pt-3">
                {cards.map((c) => (
                  <div key={c.id} className="space-y-1.5">
                    {c.status !== "chat" && <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-ink px-3 py-1.5 text-[12px] text-canvas">{c.query}</div>}
                    {c.spec ? (
                      <div className="rounded-xl border border-hairline bg-surface-soft p-2.5">
                        {c.ack && c.status === "done" && <p className="mb-1.5 text-[11.5px] text-steel">{c.ack}</p>}
                        <GenUI spec={c.spec} onAction={onAsk} />
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-[11.5px] text-stone"><span className="size-1.5 animate-pulse rounded-full bg-spark" /> {c.ack || "…"}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-center gap-2 p-3">
              <input autoFocus value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                placeholder={t("watch.askPlaceholder")}
                className="h-9 min-w-0 flex-1 rounded-lg border border-hairline bg-surface-soft px-3 text-[12.5px] text-charcoal outline-none placeholder:text-stone focus:border-ink/40" />
              <button type="submit" className="grid size-9 shrink-0 place-items-center rounded-lg bg-ink text-canvas disabled:opacity-40" disabled={!chatInput.trim()}>
                <Send className="size-4" />
              </button>
            </form>
          </div>
        )}
        <button onClick={() => setChatOpen((v) => !v)}
          className="grid size-14 place-items-center rounded-full bg-ink text-canvas shadow-xl ring-1 ring-black/10 transition-transform hover:scale-105"
          title={t("watch.askGhost")}>
          {chatOpen ? <X className="size-6" /> : <GhostLogo variant="mark" size={30} className="text-canvas" />}
        </button>
      </div>
    </div>
  );
}
