import { useRef, useState } from "react";
import { X, FileAudio, Upload, Loader2, FileText, Play, Globe, ChevronDown, Save, Check } from "lucide-react";
import * as api from "@/lib/api";
import { GenUI, type Spec } from "@/components/GenUI";
import { GhostLogo } from "@/components/GhostLogo";
import { ModelPicker } from "@/components/ModelPicker";
import { cn } from "@/lib/cn";

const fmt = (s: number) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`;
};

type Phase = "empty" | "transcribing" | "ready" | "error";

// 화자 칩 팔레트(화자 번호 → 색, 순환)
const SPK_COLORS = ["#0a7ea4", "#b06a00", "#6b8af0", "#7c3aed", "#d05757", "#00b48a"];

/**
 * 음성 파일 업로드 모드 — 설정된 ASR로 타임스탬프 전사 + 오디오 재생 + AI 회의록(구간 재생 주석).
 * 전사는 백엔드(/api/audio/transcribe), 회의록은 AI 백엔드(/api/audio/minutes/stream). 오디오 재생은 로컬 blob.
 */
export function AudioView({
  open, onClose, isMac = false, t,
  provider, models, onPickModel, transLangs, lang, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  isMac?: boolean;
  t: (k: string) => string;
  provider?: string;
  models: api.SttModels | null;
  onPickModel: (kind: "local" | "cloud", id: string) => void;
  transLangs: api.TransLang[];
  lang: string;
  onSaved?: () => void;   // 회의 저장 후 회의 내역 갱신용
}) {
  // 회의록 출력 언어(입력 음성과 무관) — 모드를 나갔다 와도 선택이 유지되게 영속.
  const [outLang, setOutLangState] = useState(() => {
    try { return localStorage.getItem("ghost.audioOutLang") || lang || "ko"; } catch { return lang || "ko"; }
  });
  const setOutLang = (v: string) => {
    setOutLangState(v);
    try { localStorage.setItem("ghost.audioOutLang", v); } catch { /* ignore */ }
  };
  const [phase, setPhase] = useState<Phase>("empty");
  const [fileName, setFileName] = useState("");
  const [audioUrl, setAudioUrl] = useState<string>("");
  const [segments, setSegments] = useState<api.AudioSegment[]>([]);
  const [upPct, setUpPct] = useState(0);
  const [minutes, setMinutes] = useState<Spec | null>(null);
  const [minBusy, setMinBusy] = useState(false);
  const [minProgress, setMinProgress] = useState<string>("");
  const [err, setErr] = useState("");
  // 회의로 저장(#영속) — idle | saving | done
  const [saveState, setSaveState] = useState<"idle" | "saving" | "done">("idle");

  const fileRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<(() => void) | null>(null);   // 진행 중 업로드 취소 핸들
  const savedIdRef = useRef<string>("");                 // 저장된 회의 id — 이후 회의록 생성 시 거기에 붙인다

  const DRAG = { WebkitAppRegion: "drag" } as any;
  const NODRAG = { WebkitAppRegion: "no-drag" } as any;

  if (!open) return null;

  const seek = (sec: number) => {
    const a = audioRef.current;
    if (a) { a.currentTime = sec; a.play().catch(() => {}); }
  };

  const pick = async (file?: File | null) => {
    if (!file) return;
    setFileName(file.name);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(URL.createObjectURL(file));
    setSegments([]); setMinutes(null); setErr(""); setUpPct(0); setSaveState("idle"); savedIdRef.current = "";
    setPhase("transcribing");
    try {
      const r = await api.uploadAudio(file, setUpPct, (abort) => { abortRef.current = abort; });
      // 백엔드가 원인을 주면 그대로 보여준다(예: 로컬 STT 미설치 안내) — 이전엔 전부 "텍스트 없음"이었다.
      if (!r.ok || !r.segments?.length) { setPhase("error"); setErr(r.error || t("audio.noText")); return; }
      setSegments(r.segments);
      setPhase("ready");
    } catch (e) {
      // 사용자가 직접 취소했으면 에러가 아니라 빈 상태로 복귀.
      if (String(e).includes("aborted")) { setPhase("empty"); setFileName(""); return; }
      setPhase("error"); setErr(String(e));
    } finally {
      abortRef.current = null;
    }
  };

  const cancelUpload = () => { abortRef.current?.(); };

  const genMinutes = () => {
    if (!segments.length || minBusy) return;
    setMinBusy(true); setMinutes(null); setMinProgress(t("audio.minutesWorking"));
    api.streamAudioMinutes(segments, "", {
      onProgress: (p) => setMinProgress(p.text || ""),
      onResult: (spec) => {
        setMinutes(spec); setMinBusy(false);
        // 이미 회의로 저장했다면, 새로 만든 회의록을 그 회의에 붙인다(중복 회의 생성 없이).
        if (savedIdRef.current) void api.saveAudioAsMeeting({ meeting_id: savedIdRef.current, minutes: spec });
      },
      onError: () => { setMinBusy(false); setMinProgress(t("audio.minutesFail")); },
    }, outLang);   // 출력 언어 강제
  };
  const langs = transLangs.length ? transLangs : [{ code: "ko", name: "Korean", label: "한국어" }, { code: "en", name: "English", label: "English" }] as api.TransLang[];

  // 전사(+회의록)를 회의로 저장 — 회의 내역·검색·MCP에서 접근 가능해진다.
  const saveAsMeeting = async () => {
    if (!segments.length || saveState !== "idle") return;
    setSaveState("saving");
    const title = fileName.replace(/\.[^.]+$/, "").trim() || t("audio.title");
    const r = await api.saveAudioAsMeeting({ title, segments, minutes, duration: audioRef.current?.duration || 0 });
    if (r.ok) { savedIdRef.current = r.meeting?.id || ""; setSaveState("done"); onSaved?.(); }
    else { setSaveState("idle"); setErr(r.error || t("audio.saveFail")); }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-canvas">
      {/* 상단 바 — 라이브와 동일 톤: 로고(→홈) · 모델 · 출력 언어 · 액션 */}
      <div className="flex items-center gap-2 border-b border-hairline px-4 py-2.5" style={{ ...DRAG, paddingLeft: isMac ? 84 : undefined }}>
        <button style={NODRAG} onClick={onClose} title={t("header.home")} className="flex shrink-0 items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-surface"><GhostLogo variant="icon" size={20} className="rounded-md" /><span className="text-[13px] font-semibold tracking-tight">Ghost</span></button>
        <span style={NODRAG}><FileAudio className="size-4 shrink-0 text-spark-deep" /></span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-charcoal">{fileName || t("audio.title")}</span>
        <span style={NODRAG}><ModelPicker provider={provider} models={models} onPick={onPickModel} t={t} /></span>
        {/* 회의록 출력 언어 */}
        <span style={NODRAG} className="inline-flex items-center gap-1 rounded-full border border-hairline bg-surface px-1.5 py-0.5 text-[11px] text-steel">
          <Globe className="size-3 text-stone" />
          <select value={outLang} onChange={(e) => setOutLang(e.target.value)} title={t("audio.outLang")} className="bg-transparent text-[11px] text-steel outline-none">
            {langs.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </span>
        {phase !== "empty" && (
          <button style={NODRAG} onClick={() => fileRef.current?.click()} className="h-8 shrink-0 rounded-lg border border-hairline px-3 text-[12px] font-medium text-steel hover:text-foreground">{t("audio.another")}</button>
        )}
        {phase === "ready" && (
          <>
            {/* 회의로 저장 — 전사·회의록을 회의 내역에 영속(검색·MCP 접근 가능) */}
            {saveState === "done" ? (
              <span style={NODRAG} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-spark-soft px-3 text-[12px] font-medium text-spark-deep">
                <Check className="size-3.5" /> {t("audio.saved")}
              </span>
            ) : (
              <button style={NODRAG} onClick={saveAsMeeting} disabled={saveState === "saving"}
                title={t("audio.saveHint")}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-hairline px-3 text-[12px] font-medium text-steel hover:text-foreground disabled:opacity-50">
                {saveState === "saving" ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} {t("audio.save")}
              </button>
            )}
            <button style={NODRAG} onClick={genMinutes} disabled={minBusy}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-ink px-3 text-[12px] font-medium text-canvas disabled:opacity-50">
              {minBusy ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />} {t("audio.makeMinutes")}
            </button>
          </>
        )}
      </div>

      <input ref={fileRef} type="file" accept="audio/*,video/*,.mp3,.mp4,.m4a,.wav,.webm,.aac,.ogg" className="hidden"
        onChange={(e) => pick(e.target.files?.[0])} />

      {/* 오디오 플레이어 */}
      {audioUrl && (
        <div className="border-b border-hairline bg-surface-soft/50 px-4 py-2">
          <audio ref={audioRef} src={audioUrl} controls className="h-9 w-full" />
        </div>
      )}

      {/* 본문 */}
      {phase === "empty" ? (
        <button onClick={() => fileRef.current?.click()}
          className="m-6 flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-hairline text-stone hover:border-ink/30 hover:text-foreground">
          <Upload className="size-10 opacity-40" />
          <span className="text-[14px] font-medium">{t("audio.drop")}</span>
          <span className="text-[12px] text-stone">mp3 · mp4 · m4a · wav · webm</span>
        </button>
      ) : phase === "transcribing" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-stone">
          <Loader2 className="size-7 animate-spin text-spark-deep" />
          <p className="text-[13px]">{upPct < 100 ? `${t("audio.uploading")} ${upPct}%` : t("audio.transcribing")}</p>
          {upPct < 100 && (
            <button onClick={cancelUpload} className="rounded-lg border border-hairline px-3 py-1.5 text-[12px] text-steel hover:text-foreground">
              {t("audio.cancel")}
            </button>
          )}
        </div>
      ) : phase === "error" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-stone">
          <p className="text-[13px] text-[#b04141]">{err || t("audio.error")}</p>
          <button onClick={() => fileRef.current?.click()} className="rounded-lg border border-hairline px-3 py-1.5 text-[12.5px] text-steel hover:text-foreground">{t("audio.another")}</button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
        {/* ready 상태에서의 일시적 오류(저장 실패 등) */}
        {err && <div className="border-b border-hairline bg-surface-soft/60 px-4 py-1.5 text-[11.5px] text-[#b04141]">{err}</div>}
        <div className="flex min-h-0 flex-1">
          {/* 좌: 스크립트(타임스탬프 클릭 재생) */}
          <div className="flex w-1/2 min-h-0 flex-col border-r border-hairline">
            <div className="border-b border-hairline px-4 py-2 text-[12.5px] font-semibold text-foreground">{t("audio.script")} <span className="text-[11px] font-normal text-stone">({segments.length})</span></div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2">
              {segments.map((s, i) => (
                <button key={i} onClick={() => seek(s.start)}
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-soft">
                  <span className="mt-0.5 inline-flex shrink-0 items-center gap-0.5 rounded-md border border-spark-soft bg-[color-mix(in_srgb,var(--spark)_8%,transparent)] px-1.5 py-px text-[10.5px] font-medium tabular-nums text-spark-deep">
                    <Play className="size-2.5" />{fmt(s.start)}
                  </span>
                  {/* 화자 분리(ElevenLabs diarize) — 화자별 색 칩 */}
                  {s.speaker != null && (
                    <span className="mt-0.5 shrink-0 rounded-md px-1.5 py-px text-[10.5px] font-semibold"
                      style={{ background: `color-mix(in srgb, ${SPK_COLORS[(s.speaker - 1) % SPK_COLORS.length]} 16%, transparent)`,
                               color: SPK_COLORS[(s.speaker - 1) % SPK_COLORS.length] }}>
                      {t("audio.speaker")}{s.speaker}
                    </span>
                  )}
                  <span className="text-[12.5px] leading-relaxed text-charcoal">{s.text}</span>
                </button>
              ))}
            </div>
          </div>
          {/* 우: 회의록(구간 재생 주석) */}
          <div className="flex w-1/2 min-h-0 flex-col">
            <div className="border-b border-hairline px-4 py-2 text-[12.5px] font-semibold text-foreground">{t("audio.minutes")}</div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {minutes ? (
                <GenUI spec={minutes} onSeek={seek} />
              ) : minBusy ? (
                <div className="flex flex-col items-center gap-2 pt-10 text-stone">
                  <Loader2 className="size-6 animate-spin text-spark-deep" />
                  <p className="text-[12.5px]">{minProgress || t("audio.minutesWorking")}</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 pt-10 text-center text-stone">
                  <FileText className="size-8 opacity-30" />
                  <p className="text-[12.5px]">{t("audio.minutesHint")}</p>
                  <button onClick={genMinutes} className="rounded-lg bg-ink px-3 py-1.5 text-[12.5px] font-medium text-canvas">{t("audio.makeMinutes")}</button>
                </div>
              )}
            </div>
          </div>
        </div>
        </div>
      )}
    </div>
  );
}
