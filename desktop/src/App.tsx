import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Send, Volume2, VolumeX, Sun, Moon, X, RefreshCw, ShieldCheck, ShieldAlert,
  Mic, MonitorSpeaker, Loader2, Check, Settings, AudioLines, Square,
  HelpCircle, Download, Trash2, Play, Pin, Search, Globe, Terminal, Sparkles, ChevronDown, FileText, Copy,
  Languages, Columns2, PanelRight, Home, History, MoreHorizontal, Ghost as GhostIcon,
} from "lucide-react";
// (Languages 아이콘은 헤더 지구본 언어 피커에 사용)
import { GhostLogo } from "@/components/GhostLogo";
import { BrandIcon } from "@/components/BrandIcon";
import { Waveform } from "@/components/Waveform";
import { GenUI, type Spec } from "@/components/GenUI";
import { SettingsMenu } from "@/components/SettingsMenu";
import { WatchView } from "@/components/WatchView";
import { AudioView } from "@/components/AudioView";
import { ModelPicker } from "@/components/ModelPicker";
import { Launcher, type LaunchMode } from "@/components/Launcher";
import { loadAppFont } from "@/components/FontSettings";
import { Onboarding } from "@/components/Onboarding";
import { Help } from "@/components/Help";
import { PhantomGhost, PhantomField } from "@/components/Phantom";
import { cn } from "@/lib/cn";
import * as api from "@/lib/api";
import { useListening, type Source } from "@/lib/useListening";
import { getDemo } from "@/lib/demo";
import { LangProvider, makeT, useT, detectLang, LANGS, type Lang } from "@/lib/i18n";

type CardItem = {
  kind: "card";
  id: string;
  query: string;
  ack?: string;
  status: "chat" | "working" | "done";
  progress: api.ProgressItem[];
  spec?: Spec;
  backend?: string;
  pinned?: boolean;
};
type UserItem = { kind: "user"; id: string; text: string };
type FeedItem = CardItem | UserItem;

const BACKEND_LABELS: Record<string, string> = { codex: "Codex", openai: "OpenAI", ollama: "Ollama", opencode: "OpenCode", hermes: "Hermes" };
const ONBOARDED_KEY = "ghost.onboarded.v1";
// wakeword — 이 말로 부르면 음성으로 답한다.
const WAKE_RE = /^\s*(재키|자비스|고스트|ghost|hey ghost)[,!\s]*/i;
// 순수 인사/잡담(작업 요청이 아님) — 수동 입력에서 judge(네트워크) 없이 즉답 chat으로 처리.
// 입력 '전체'가 인사일 때만 매치(보수적). 그 외엔 전부 act(카드)로 직행.
const CHAT_RE = /^\s*(안녕[하세요가]*|반가워?요?|고마워요?|고맙[습다]+니?다?|감사[합니다해요]*|잘\s*자|좋은\s*(아침|밤)|들[려리]+[니요]*\??|거기\s*있[어니]\??|hi|hello|hey|thanks|thank\s*you|good\s*(morning|night))[\s!?.~]*$/i;
// 실시간 개입 confidence 문턱 (민감도별). off=차단, conservative=인색, eager=느슨.
const LIVE_THRESH: Record<string, number> = { off: 2, conservative: 0.8, eager: 0.5 };
const LIVE_COOLDOWN_MS = 90_000;  // 실시간 카드 최대 1개 / 90초

/** 진행 메시지 앞에 붙는 글리프 — kind 메타(언어 무관) 우선, 텍스트 패턴은 폴백. */
function ProgressGlyph({ text, kind, active }: { text: string; kind?: string; active: boolean }) {
  const t = text || "";
  const brand =
    /^atlassian/i.test(t) ? "atlassian" :
    /^slack/i.test(t) ? "slack" :
    /^notion/i.test(t) ? "notion" :
    /^linear/i.test(t) ? "linear" :
    /^github/i.test(t) ? "github" :
    /hugging\s*face/i.test(t) ? "huggingface" : null;
  if (brand) return <span className="grid size-3.5 shrink-0 place-items-center"><BrandIcon name={brand} size={13} /></span>;
  if (kind === "web" || /^(웹\s*검색|Web search|网页搜索)/i.test(t)) return <Globe className="size-3.5 shrink-0 text-stone" />;
  if (kind === "command" || /^(실행|Run|执行)[::]/.test(t)) return <Terminal className="size-3.5 shrink-0 text-stone" />;
  if (kind === "think" || /^💭/.test(t)) return <Sparkles className="size-3.5 shrink-0 text-stone" />;
  if (kind === "file" || /^(파일\s*검색|Searching files|正在搜索文件)/i.test(t)) return <Search className="size-3.5 shrink-0 text-stone" />;
  return <span className={cn("size-1.5 shrink-0 rounded-full bg-spark", active && "soul-pulse")} />;
}

const RUN_PREFIX_RE = /^(실행|Run|执行)[::]\s*/;

/** 진행 한 줄. bash 실행은 터미널 칩으로 예쁘게, 그 외는 글리프 + 텍스트. */
function ProgressLine({ text, kind, active }: { text: string; kind?: string; active: boolean }) {
  const t = text || "";
  if (RUN_PREFIX_RE.test(t)) {
    const cmd = t.replace(RUN_PREFIX_RE, "");
    return (
      <>
        <Terminal className="size-3.5 shrink-0 text-stone" />
        <code className="min-w-0 flex-1 truncate rounded-md border border-hairline bg-surface px-2 py-0.5 font-mono text-[11px] text-charcoal">
          <span className="text-spark-deep">$</span> {cmd}
        </code>
      </>
    );
  }
  return (
    <>
      <ProgressGlyph text={t} kind={kind} active={active} />
      <span className="truncate">{t}</span>
    </>
  );
}

/** 명령 실행 단계 — 클릭하면 전체 명령/상태를 펼친다. */
function CommandStep({ item, active }: { item: api.ProgressItem; active: boolean }) {
  void active;
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const cmd = (item.full || item.text.replace(RUN_PREFIX_RE, "")).trim();
  const st = item.status;
  const stLabel = st === "running" ? t("card.cmdRunning") : st === "failed" ? t("card.cmdFailed") : st === "done" ? t("card.cmdDone") : "";
  const badge =
    st === "running" ? <span className="inline-flex items-center gap-1 text-[10.5px] text-spark-deep"><Loader2 className="size-3 animate-spin" /> {stLabel}</span>
    : st === "failed" ? <span className="text-[10.5px] text-[#b04141]">{stLabel}</span>
    : st === "done" ? <span className="inline-flex items-center gap-1 text-[10.5px] text-stone"><Check className="size-3" /> {stLabel}</span>
    : null;
  return (
    <div className="w-full">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 text-left">
        <Terminal className="size-3.5 shrink-0 text-stone" />
        <code className="min-w-0 flex-1 truncate rounded-md border border-hairline bg-surface px-2 py-0.5 font-mono text-[11px] text-charcoal"><span className="text-spark-deep">$</span> {cmd}</code>
        {badge}
        <ChevronDown className={cn("size-3 shrink-0 text-stone transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="mt-1 rounded-md border border-hairline bg-surface px-2.5 py-2">
          <div className="mb-1 text-[10.5px] text-stone">{t("card.cmd")}{stLabel ? ` · ${stLabel}` : ""}</div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-slate"><span className="text-spark-deep">$</span> {cmd}</pre>
        </div>
      )}
    </div>
  );
}

/** 불명확 키워드 확인 칩 — STT가 이상하게 들은 듯한 고유명사를 사용자에게 묻고 용어집에 누적. */
function UnclearChip({ heard, guess, onConfirm, onSkip, t }: {
  heard: string; guess: string;
  onConfirm: (heard: string, term: string) => void;
  onSkip: (heard: string) => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  const [v, setV] = useState(guess || heard);
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <HelpCircle className="size-3.5 shrink-0 text-spark-deep" />
      <span className="shrink-0 text-steel">{t("unclear.q", { heard })}</span>
      <input value={v} onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onConfirm(heard, v); }}
        className="h-6 min-w-0 flex-1 rounded-md border border-hairline bg-canvas px-2 text-[12px] outline-none focus:border-ink/40" />
      <button onClick={() => onConfirm(heard, v)} className="shrink-0 rounded-md bg-ink px-2 py-1 text-[11px] font-medium text-canvas">{t("unclear.add")}</button>
      <button onClick={() => onSkip(heard)} className="shrink-0 text-[11px] text-stone hover:text-foreground">{t("unclear.skip")}</button>
    </div>
  );
}

const GHOST_KEYS = ["ghost.l0", "ghost.l1", "ghost.l2", "ghost.l3", "ghost.l4", "ghost.l5", "ghost.l6"];

/** 스트리밍 로더 — 유령작가. 트랙 위를 직선으로 지나가는 대신, 유령이 답이 될
 * 안개 줄을 직접 '쓴다'. 줄 끝에서 둥실거리며 줄이 자라나고, 다 쓰면 스르륵
 * 사라져 다음 줄 시작점에서 다시 맺힌다. 스트리밍이 끝나면 이 자리에 실제 답이
 * materialize되므로, 로더가 사라지는 게 아니라 콘텐츠가 된다. */
function GhostStreamLoader() {
  const { t } = useT();
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % GHOST_KEYS.length), 2600);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="space-y-2.5">
      <div className="relative h-[58px]">
        <div className="scribe-line scribe-line-1 absolute left-0 top-0 h-2.5 rounded-full" />
        <div className="scribe-line scribe-line-2 absolute left-0 top-6 h-2.5 rounded-full" />
        <div className="scribe-line scribe-line-3 absolute left-0 top-12 h-2.5 rounded-full" />
        <span className="scribe-ghost text-spark-deep">
          <span className="scribe-bob">
            <GhostLogo variant="mark" size={18} />
          </span>
        </span>
      </div>
      <div className="flex items-center gap-2 px-0.5 text-[12px] italic text-steel">
        <span className="soul-pulse size-1.5 shrink-0 rounded-full bg-spark" />
        <span key={i} className="wisp">{t(GHOST_KEYS[i])}</span>
      </div>
    </div>
  );
}
const GITHUB_URL = "https://github.com/HarryKane11/ghost";

/** localStorage에 영속되는 useState. (테마·음성·소스 등 재실행 시 유지) */
function usePref<T>(key: string, initial: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key);
      return s != null ? (JSON.parse(s) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
  }, [key, v]);
  return [v, setV];
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

let idc = 0;
const newId = () => `i${++idc}`;
const isMinutesReq = (q: string) => /회의록|회의\s*정리|회의\s*요약|회의\s*내용/.test(q);

function captureErrKey(e: unknown): string {
  const n = (e as { name?: string })?.name || "";
  if (["NotAllowedError", "SecurityError", "PermissionDeniedError"].includes(n)) return "err.micPermission";
  if (n === "NotFoundError") return "err.noDevice";
  if (n === "NotReadableError") return "err.deviceBusy";
  return "err.capture";
}

export default function App() {
  const [status, setStatus] = useState<api.Status | null>(null);
  const [backendErr, setBackendErr] = useState(false);
  const [active, setActive] = useState(false);
  const [source, setSource] = usePref<Source>("ghost.source", "mic");
  const [voiceOn, setVoiceOn] = usePref<boolean>("ghost.voiceOn", false);
  const [dark, setDark] = usePref<boolean>("ghost.dark", false);
  const [lang, setLangPref] = usePref<Lang>("ghost.lang", detectLang());   // 첫 실행은 시스템 언어
  const [langMenuOpen, setLangMenuOpen] = useState(false);   // 헤더 지구본 언어 피커
  const t = useMemo(() => makeT(lang), [lang]);
  const changeLang = useCallback((l: Lang) => { setLangPref(l); api.setLang(l); }, [setLangPref]);
  const [thinking, setThinking] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);   // 전체화면 관리자 페이지(톱니바퀴)
  // 진입 런처 + 모드 라우터. 매 실행 'home'(런처)에서 시작.
  const [appMode, setAppMode] = useState<"home" | "live" | "watch" | "audio">("home");
  const watchOpenRef = useRef(false);
  useEffect(() => { watchOpenRef.current = appMode === "watch"; }, [appMode]);
  const [backendMenuOpen, setBackendMenuOpen] = useState(false);
  const [ctxOpen, setCtxOpen] = useState(false);
  const [ctxText, setCtxText] = useState("");
  const [recentMeetings, setRecentMeetings] = useState<api.MeetingMeta[]>([]);
  const [histOpen, setHistOpen] = usePref("ghost.histSidebar", true);   // 좌측 회의 내역 사이드바
  const [atOpen, setAtOpen] = useState(false);  // @ 과거 회의 참조 드롭다운
  const [onboard, setOnboard] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [demoOn, setDemoOn] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = usePref<string>("ghost.micId", "");
  const [tq, setTq] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);   // 전사 옵션 메뉴
  const [sttModelsList, setSttModelsList] = useState<api.SttModels | null>(null);
  const [transTab, setTransTab] = useState<"raw" | "script" | "minutes">("raw");  // 대화기록 / 스크립트 / 회의록
  const [draft, setDraft] = useState("");          // 발화 중 라이브 초안(스트리밍 느낌) → 엔드포인트에서 최종으로 교체
  const [streamingStt, setStreamingStt] = useState(false);  // 활성 STT가 스트리밍 지원(로컬)
  // 마지막 전사에서 '실제로' 쓰인 엔진/모델(모델 전환이 백엔드에 반영됐는지 확인용 배지).
  const [engineUsed, setEngineUsed] = useState<{ model: string; engine: string; provider: string; fallback: boolean } | null>(null);
  const streamingSttRef = useRef(false);
  const nativeStreamRef = useRef(false);   // parakeet ws 네이티브 토큰-스트리밍 가능
  const interimBusyRef = useRef(false);
  const draftSeqRef = useRef(0);   // 발화 세대 — 종료(다듬기) 후 늦게 오는 초안 무시용
  const [scriptParas, setScriptParas] = useState<api.ScriptParagraph[]>([]);
  const [scriptLoading, setScriptLoading] = useState(false);
  // 회의록 탭 — 저장된 minutes.json을 보여준다(생성은 기존 카드 경로 재사용).
  const [minutesSpec, setMinutesSpec] = useState<Spec | null>(null);
  const [minutesLoading, setMinutesLoading] = useState(false);
  // 실시간 다듬기(문장 확정 후 맥락·용어집 기반 교정) + 불명확 키워드 질문 큐
  const [polishOn, setPolishOn] = usePref<boolean>("ghost.polishOn", true);
  const polishOnRef = useRef(polishOn);
  useEffect(() => { polishOnRef.current = polishOn; }, [polishOn]);
  const [unclears, setUnclears] = useState<{ heard: string; guess: string }[]>([]);
  // 디스플레이 모드 + 패널 분할 + 인터뷰 번역
  const [displayMode, setDisplayMode] = usePref<"full" | "assist">("ghost.displayMode", "full");
  const [translateOn, setTranslateOn] = usePref("ghost.translateOn", false);   // 실시간 번역 토글(우하단)
  const [translateMenuOpen, setTranslateMenuOpen] = useState(false);
  const [splitPct, setSplitPct] = usePref<number>("ghost.splitPct", 42);
  const [transLang, setTransLang] = usePref<string>("ghost.transLang", "en");
  const [transLangs, setTransLangs] = useState<api.TransLang[]>([]);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [transcript, setTranscript] = useState<{ id: string; text: string; polished?: boolean }[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [input, setInput] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  // 회의 (일시 폴더 저장 + 서버 롤링 메모리)
  const [meetingTitle, setMeetingTitle] = useState<string>("");
  const [meetingFolder, setMeetingFolder] = useState<string>("");
  const meetingIdRef = useRef<string>("");
  // 능동성 설정: 다이제스트 주기(분), 실시간 개입 민감도, 다이제스트 자동조사
  const [digestMin, setDigestMin] = usePref<number>("ghost.digestMin", 5);
  const [liveSens, setLiveSens] = usePref<"off" | "conservative" | "eager">("ghost.liveSens", "conservative");
  const [autoResearch, setAutoResearch] = usePref<boolean>("ghost.autoResearch", true);

  const actingRef = useRef(false);
  const queueRef = useRef<Array<() => void>>([]);
  const transcriptRef = useRef<string[]>([]);
  const historyRef = useRef<string[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  const transEndRef = useRef<HTMLDivElement | null>(null);
  const sttErrRef = useRef(0);
  const liveCardRef = useRef(0);   // 마지막 실시간 카드 시각(쿨다운)
  const digestTextRef = useRef("");  // 최근 다이제스트 내용(실시간 카드 dedup용)
  const digestBusyRef = useRef(false);  // 다이제스트 진행 중 → 중복 생성 방지(pile-up)
  const inputRef = useRef<HTMLInputElement | null>(null);
  const demoTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const { start, stop, release, level, speaking } = useListening();

  const g = (typeof window !== "undefined" ? (window as any).ghost : null) || {};
  const isMacApp = !!g.isElectron && g.platform === "darwin";
  const DRAG = { WebkitAppRegion: "drag" } as any;
  const NO_DRAG = { WebkitAppRegion: "no-drag" } as any;

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2800); };
  const pushHistory = useCallback((line: string) => { historyRef.current = [...historyRef.current, line].slice(-40); }, []);
  const pushFeed = useCallback((item: FeedItem) => setFeed((f) => [...f, item].slice(-50)), []);
  const updateCard = useCallback((id: string, patch: Partial<CardItem>) =>
    setFeed((f) => f.map((x) => (x.kind === "card" && x.id === id ? { ...x, ...patch } : x))), []);

  const refreshStatus = useCallback(async () => {
    try { setStatus(await api.getStatus()); setBackendErr(false); } catch { setBackendErr(true); }
  }, []);
  useEffect(() => { refreshStatus(); }, [refreshStatus]);
  // @ 참조용 최근 회의 목록 (메뉴 열 때·회의 종료 시 갱신)
  const loadRecentMeetings = useCallback(() => { api.getMeetings().then(setRecentMeetings).catch(() => {}); }, []);
  // 회의 내역에서 한 건 열기 → 회의록(또는 요약) + 최근 다이제스트를 카드로 복원.
  const openMeetingCard = useCallback(async (m: api.MeetingMeta) => {
    const full = await api.getMeeting(m.id);
    const spec = full?.minutes || { title: m.title, spoken: "", intent: "note",
      blocks: [{ type: "text", text: full?.summary || t("hist.noMinutes") }] };
    pushFeed({ kind: "card", id: newId(), query: m.title, status: "done", progress: [], spec, pinned: true });
    // 저장된 5분 다이제스트도 함께 복원(최근 2개) — 재시작 후에도 회의 흐름이 보인다.
    const digests = await api.getDigests(m.id);
    for (const d of digests.slice(-2)) {
      if (d?.spec) pushFeed({ kind: "card", id: newId(), query: `${m.title} · ${t("digest.label")}`, status: "done", progress: [], spec: d.spec });
    }
  }, [pushFeed, t]);
  useEffect(() => { loadRecentMeetings(); }, [loadRecentMeetings]);
  // 회의 내역이 비어 있으면 백엔드가 늦게 떠도 채워질 때까지 재시도 —
  // 패키징 앱은 백엔드 부팅이 렌더러보다 늦어, 1회 로드만으로는 영영 빈 사이드바가 됐다.
  useEffect(() => {
    if (recentMeetings.length) return;
    const id = setInterval(loadRecentMeetings, 4000);
    return () => clearInterval(id);
  }, [recentMeetings.length, loadRecentMeetings]);
  // 디스플레이 모드 → Electron 창 크기/always-on-top 동기화 + 번역 언어 목록
  // (창 자동 리사이즈 제거 — 모드 전환은 레이아웃만 바꾼다. assist 눌렀을 때 창이 작아지던 문제 해결)
  // 번역 언어 목록 — 첫 실행엔 백엔드가 늦게 떠 빈 배열이 올 수 있어, 채워질 때까지 재시도.
  useEffect(() => {
    if (transLangs.length) return;
    let cancelled = false;
    const tryFetch = () => api.getTranslateLangs().then((l) => { if (!cancelled && l.length) setTransLangs(l); }).catch(() => {});
    tryFetch();
    const id = setInterval(() => { if (transLangs.length) { clearInterval(id); } else { tryFetch(); } }, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [transLangs.length]);
  // 라이브 초안(실시간 느낌)을 어떤 경로로 줄지 판단.
  //  · native(parakeet ws): 진짜 토큰-스트리밍
  //  · 그 외 모든 모델/제공자: 2-pass interim 초안(주기적 빠른 전사)으로 실시간처럼.
  // 이전엔 interim을 `streaming` 플래그(parakeet 전용)에 묶어, 클라우드·Qwen3·Whisper에선
  // 발화 끝까지 아무것도 안 보였다 → 이제 네이티브가 아니면 전부 interim으로 초안을 띄운다.
  const refreshStreamingStt = useCallback(async () => {
    const native = !!(await api.getSttStreaming()).available;  // parakeet ws 가능 여부
    nativeStreamRef.current = native;
    const interim = !native;   // 네이티브가 아니면 2-pass 초안을 모든 모델에서 켠다
    setStreamingStt(interim); streamingSttRef.current = interim;
  }, []);
  useEffect(() => { refreshStreamingStt(); }, [refreshStreamingStt, adminOpen]);
  // STT 모델 목록(파형 옆 빠른 선택용). 관리자 닫힘/시작 시 갱신.
  useEffect(() => { api.getSttModels().then(setSttModelsList).catch(() => {}); }, [adminOpen]);
  // 백엔드가 늦게 떠도 목록이 채워질 때까지 재시도 — 이전엔 첫 로드 실패 시 피커가 빈 채로 남았다.
  useEffect(() => {
    if (sttModelsList) return;
    const id = setInterval(() => api.getSttModels().then((m) => m && setSttModelsList(m)).catch(() => {}), 3000);
    return () => clearInterval(id);
  }, [sttModelsList]);
  // 파형 옆에서 모델을 바로 바꾼다 — provider+model을 함께 설정해 '반영 안 됨' 문제 해결.
  const pickModel = useCallback(async (kind: "local" | "cloud", id: string) => {
    try {
      await api.setSttProvider(kind === "cloud" ? "elevenlabs" : "local");
      await api.selectSttModel(kind, id);
      setSttModelsList(await api.getSttModels());
      setStatus(await api.getStatus());
      refreshStreamingStt();
    } catch { /* ignore */ }
  }, [refreshStreamingStt]);
  // 인터뷰 모드: 번역 안 된 전사 줄을 하나씩 순차 번역(언어별 캐시).
  // ref 가드로 한 번에 하나만 — 진행 중 번역을 새 줄/상태 변화로 취소하지 않는다(이전 버그: 첫 줄 뒤 멈춤).
  const translatingRef = useRef(false);
  useEffect(() => {
    if ((!translateOn && appMode !== "watch") || translatingRef.current) return;
    const pending = transcript.find((ln) => translations[`${transLang}:${ln.id}`] === undefined);
    if (!pending) return;
    translatingRef.current = true;
    const key = `${transLang}:${pending.id}`;
    // 토큰 스트리밍: 델타를 누적해 한 줄 번역이 단어 단위로 차오르게 (openai/ollama는 진짜 토큰, codex는 통짜).
    let acc = "";
    setTranslations((m) => ({ ...m, [key]: "" }));   // 빈 문자열로 점유 → 재요청 방지
    api.streamTranslate(pending.text, transLang, {
      onDelta: (d) => { acc += d; setTranslations((m) => ({ ...m, [key]: acc })); },
      onDone: () => { setTranslations((m) => ({ ...m, [key]: acc.trim() })); translatingRef.current = false; },
      onError: () => { translatingRef.current = false; },
    });
  }, [translateOn, appMode, transLang, transcript, translations]);

  // 패널 분할 드래그(리사이즈 핸들러)
  // 포인터 캡처로 드래그가 핸들을 벗어나도(빠른 드래그·iframe·카드 위) move가 계속 들어온다.
  // pointercancel·캡처 해제까지 정리해 '가끔 안 먹히는' 문제를 없앤다.
  const splitRef = useRef<HTMLDivElement | null>(null);
  const startSplitDrag = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    try { handle.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    document.body.classList.add("split-dragging");   // 드래그 중 텍스트 선택·iframe 이벤트 차단
    const onMove = (ev: PointerEvent) => {
      const el = splitRef.current; if (!el) return;
      const r = el.getBoundingClientRect();
      setSplitPct(Math.min(72, Math.max(28, ((ev.clientX - r.left) / r.width) * 100)));
    };
    const cleanup = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", cleanup);
      handle.removeEventListener("pointercancel", cleanup);
      try { handle.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      document.body.classList.remove("split-dragging");
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", cleanup);
    handle.addEventListener("pointercancel", cleanup);
  }, [setSplitPct]);
  // 첫 실행이면 온보딩을 띄운다.
  useEffect(() => { if (!localStorage.getItem(ONBOARDED_KEY)) setOnboard(true); }, []);
  // STT 모델 준비될 때까지 폴링 (pre-warm 완료 감지)
  useEffect(() => {
    if (status?.stt_ready) return;
    const t = setInterval(refreshStatus, 3000);
    return () => clearInterval(t);
  }, [status?.stt_ready, refreshStatus]);
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);
  useEffect(() => { loadAppFont(); }, []);   // 저장된 사용자 글꼴 적용
  useEffect(() => { api.setLang(lang); }, [lang]);  // 백엔드 응답 언어 동기화
  useEffect(() => { feedEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [feed]);
  useEffect(() => { transEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [transcript]);
  // 마이크 입력 장치 목록 (권한 허용 후 라벨이 채워짐)
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const refresh = () => navigator.mediaDevices.enumerateDevices()
      .then((ds) => setMics(ds.filter((d) => d.kind === "audioinput")))
      .catch(() => {});
    refresh();
    navigator.mediaDevices.addEventListener?.("devicechange", refresh);
    return () => navigator.mediaDevices.removeEventListener?.("devicechange", refresh);
  }, [active]);

  // 청취 경과 시간 타이머
  useEffect(() => {
    if (!active) { setElapsed(0); return; }
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [active]);

  // 스크립트 탭: 열려 있으면 정제 문단을 불러오고, 청취 중엔 주기적으로 갱신(실시간 문단 요약).
  // 로딩 표시는 '처음 비어 있을 때만' — 15초 주기 갱신마다 깜빡이던 문제 수정.
  useEffect(() => {
    if (transTab !== "script") return;
    const mid = meetingIdRef.current;
    if (!mid) { setScriptParas([]); return; }
    let alive = true;
    let busy = false;   // 응답이 주기(15s)보다 느릴 때 요청이 쌓이지 않게
    const load = async (first = false) => {
      if (busy) return;
      busy = true;
      if (first) setScriptLoading(true);
      try {
        const s = await api.getScript(mid, !active);  // 정지 상태면 꼬리까지 flush
        if (alive) setScriptParas(s);
      } finally {
        busy = false;
        if (alive && first) setScriptLoading(false);
      }
    };
    load(true);
    const id = active ? setInterval(() => load(false), 15000) : null;
    return () => { alive = false; if (id) clearInterval(id); };
  }, [transTab, active]);

  // 회의록 탭: 열면 저장된 minutes.json을 불러온다. 회의 진행 중이어도 이미 만든 회의록은 보인다.
  const loadMinutesTab = useCallback(async () => {
    const mid = meetingIdRef.current;
    if (!mid) { setMinutesSpec(null); return; }
    setMinutesLoading(true);
    try {
      const full = await api.getMeeting(mid);
      setMinutesSpec((full?.minutes as Spec) || null);
    } finally { setMinutesLoading(false); }
  }, []);
  useEffect(() => { if (transTab === "minutes") loadMinutesTab(); }, [transTab, loadMinutesTab]);
  // 회의록이 아직 없으면 탭이 열린 동안 가볍게 폴링 — '회의록 생성' 진행 중 결과가 도착하면 바로 보인다.
  useEffect(() => {
    if (transTab !== "minutes" || minutesSpec) return;
    const id = setInterval(loadMinutesTab, 8000);
    return () => clearInterval(id);
  }, [transTab, minutesSpec, loadMinutesTab]);

  // 창이 비활성일 때 카드가 뜨면 데스크탑 알림
  const notify = useCallback((title: string, body: string) => {
    try {
      if (typeof Notification === "undefined" || !document.hidden) return;
      if (Notification.permission === "granted") new Notification(title, { body });
    } catch { /* ignore */ }
  }, []);

  const speak = useCallback(async (text: string) => {
    const t = (text || "").trim();
    if (!t) return;
    try {
      const url = await api.ttsUrl(t);
      if (!audioRef.current) audioRef.current = new Audio();
      audioRef.current.src = url; await audioRef.current.play();
    } catch { /* ignore */ }
  }, []);

  const showChat = useCallback((query: string, say: string) => {
    const reply = say || t("chat.defaultReply");
    const spec: Spec = { title: "Ghost", spoken: reply, intent: "answer", blocks: [{ type: "text", text: reply }] };
    pushFeed({ kind: "card", id: newId(), query, status: "chat", progress: [], spec, backend: "Ghost" });
    pushHistory(`Ghost: ${reply}`);
    if (voiceOn) speak(reply);
  }, [voiceOn, speak, pushHistory, pushFeed]);

  const pump = useCallback(() => {
    if (actingRef.current) return;
    const next = queueRef.current.shift();
    if (next) next(); else setThinking(false);
  }, []);

  const runStream = useCallback((opts: {
    query: string; ack?: string; speakAck?: boolean; pinned?: boolean; dropIfEmpty?: boolean; voice?: boolean;
    starter: (h: { onProgress: (p: api.ProgressItem) => void; onResult: (s: Spec, b?: string) => void; onError: () => void }) => (() => void) | void;
  }) => {
    const id = newId();
    pushFeed({ kind: "card", id, query: opts.query, ack: opts.ack, status: "working", progress: [], pinned: opts.pinned });
    if (opts.speakAck && (voiceOn || opts.voice) && opts.ack) speak(opts.ack);
    const work = () => {
      actingRef.current = true; setThinking(true);
      const finish = () => { actingRef.current = false; pump(); };
      let timer: ReturnType<typeof setTimeout>;
      const abort = opts.starter({
        onProgress: (p) => setFeed((f) => f.map((x) => {
          if (x.kind !== "card" || x.id !== id) return x;
          if (p.id) {
            const idx = x.progress.findIndex((q) => q.id === p.id);
            if (idx >= 0) { const next = x.progress.slice(); next[idx] = p; return { ...x, progress: next }; }
          }
          return { ...x, progress: [...x.progress, p].slice(-12) };   // 회의록 경로도 codex 단계가 흐르므로 여유 있게
        })),
        onResult: (spec, backend) => {
          clearTimeout(timer);
          const blocks = spec?.blocks || [];
          const empty = blocks.length === 0 || (blocks.length === 1 && blocks[0].type === "text" && (blocks[0].text || "").includes(opts.query));
          if (opts.dropIfEmpty && empty) setFeed((f) => f.filter((x) => !(x.kind === "card" && x.id === id)));
          else {
            updateCard(id, { status: "done", spec, backend });
            pushHistory(`Ghost[${spec?.title || ""}]: ${(spec?.spoken || blocks.find((b) => b.type === "text")?.text || "").slice(0, 180)}`);
            notify(spec?.title || "Ghost", spec?.spoken || t("notify.newCard"));
            // 플로팅 오브가 떠 있으면 — 회의 중 자기 생각을 밝히듯 말풍선으로 알린다.
            try { (window as any).ghost?.orbBubble?.(spec?.spoken || spec?.title || ""); } catch { /* ignore */ }
            if (opts.voice && spec?.spoken) speak(spec.spoken);
          }
          finish();
        },
        onError: () => {
          clearTimeout(timer);
          updateCard(id, { status: "done", spec: { title: t("card.errorTitle"), spoken: "", intent: "none", blocks: [{ type: "callout", value: "error", text: t("card.errorBody") }] } });
          finish();
        },
      });
      timer = setTimeout(() => {
        try { abort?.(); } catch { /* ignore */ }
        updateCard(id, { status: "done", spec: { title: t("card.timeoutTitle"), spoken: "", intent: "none", blocks: [{ type: "callout", value: "warn", text: t("card.timeoutBody") }] } });
        finish();
      }, 200000);
    };
    queueRef.current.push(work); pump();
  }, [voiceOn, speak, pushHistory, pushFeed, updateCard, pump, notify]);

  const startAction = useCallback((query: string, ack: string, context: string, voice = false) =>
    runStream({ query, ack, speakAck: true, voice, starter: (h) => api.streamAct(query, context, h, meetingIdRef.current) }), [runStream]);

  const generateMinutes = useCallback((ackText?: string) => {
    const transcriptStr = transcriptRef.current.join("\n");
    if (transcriptStr.trim().length < 20) { flash(t("toast.minutesShort")); return; }
    // meeting_id가 있으면 서버가 저장된 전사 전체를 쓴다(클라 200줄 제한 우회).
    runStream({ query: t("minutes.query"), ack: ackText || t("minutes.ack"), pinned: true, starter: (h) => api.streamMinutes(transcriptStr, h, meetingIdRef.current) });
  }, [runStream, t]);

  // 5분 다이제스트(설정 가능) — 회의의 기본 능동 동작. 롤링 요약 + 미해결 1건 자동조사.
  const runDigest = useCallback((label: string) => {
    const mid = meetingIdRef.current;
    if (!mid || digestBusyRef.current) return;   // 진행 중이면 건너뜀(pile-up 방지)
    digestBusyRef.current = true;
    const backstop = setTimeout(() => { digestBusyRef.current = false; }, 90000);  // 멈춰도 다음 주기는 풀림
    runStream({
      query: t("digest.label"), ack: "", pinned: true, dropIfEmpty: true,
      starter: (h) => api.streamDigest(mid, {
        onProgress: h.onProgress,
        // 요약 카드(첫 result)가 오면 busy 해제 — 조사는 백그라운드로 이어지고 다음 주기는 자유롭게.
        onResult: (spec, b) => { clearTimeout(backstop); digestBusyRef.current = false; digestTextRef.current = (spec?.blocks || []).map((x: any) => x.text || "").join(" "); h.onResult(spec, b); },
        onError: () => { clearTimeout(backstop); digestBusyRef.current = false; h.onError(); },
      }, autoResearch, label),
    });
  }, [runStream, autoResearch]);

  // 5분 다이제스트 타이머 — 회의의 기본 능동 동작(설정 가능, off=0이면 비활성).
  useEffect(() => {
    if (!active || demoOn || digestMin <= 0) return;
    const id = setInterval(() => {
      if (!meetingIdRef.current) return;
      if (transcriptRef.current.length < 4) return;  // 내용 너무 적으면 건너뜀
      const now = new Date();
      runDigest(`${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`);
    }, digestMin * 60_000);
    return () => clearInterval(id);
  }, [active, demoOn, digestMin, runDigest]);

  // 발화 중 라이브 초안(스트리밍 느낌) — 빠른 배치 전사로 미리보기. 저장/라우팅 안 함.
  const onInterim = useCallback(async (blob: Blob) => {
    if (interimBusyRef.current) return;          // 직전 초안 처리 중이면 건너뜀
    interimBusyRef.current = true;
    const seq = draftSeqRef.current;             // 이 초안이 속한 발화 세대
    try {
      const r = await api.transcribe(blob);
      // 발화가 그새 종료(다듬기)됐으면(세대 변경) 늦게 온 초안으로 덮어쓰지 않는다.
      if (r.text && seq === draftSeqRef.current) setDraft(r.text);
    }
    catch { /* ignore */ }
    finally { interimBusyRef.current = false; }
  }, []);

  // 전사된 한 발화를 처리: 화면 표시 + 라우팅(judge/act). 저장은 서버가 담당(REST·ws 공통).
  // 배치(onUtterance)와 realtime 확정(onCommitted)이 공유한다.
  const ingestUtterance = useCallback(async (text: string, mid: string) => {
    if (!text) return;
    const lineId = newId();
    transcriptRef.current = [...transcriptRef.current, text];
    setTranscript((t) => [...t, { id: lineId, text }].slice(-200));
    // 문장 확정 직후 비동기 다듬기 — 지금까지의 맥락+용어집으로 오인식만 교정(라우팅을 막지 않음).
    // 교정되면 줄을 제자리에서 갱신하고, 불명확 키워드는 사용자에게 물어 용어집으로 누적한다.
    if (polishOnRef.current && mid) {
      api.polishLine(text, mid).then((p) => {
        if (!p) return;
        if (p.changed && p.text) {
          setTranscript((ts) => ts.map((l) => (l.id === lineId ? { ...l, text: p.text, polished: true } : l)));
          const idx = transcriptRef.current.lastIndexOf(text);
          if (idx >= 0) transcriptRef.current[idx] = p.text;
        }
        if (p.unclear?.length) {
          setUnclears((u) => {
            const next = [...u];
            for (const x of p.unclear) {
              if (x.heard && !next.some((n) => n.heard === x.heard)) next.push({ heard: x.heard, guess: x.guess || "" });
            }
            return next.slice(-3);
          });
        }
      }).catch(() => {});
    }
    const histCtx = historyRef.current.slice(-12).join("\n");
    pushHistory(`발화: ${text}`);
    // wakeword("재키"/"자비스"/"고스트")로 부르면 음성으로 응답한다.
    const wake = WAKE_RE.test(text);
    const q = wake ? text.replace(WAKE_RE, "").trim() : text;
    // 인터뷰·워치 모드: 카드가 초점이 아니므로 비-호명 발화는 라우팅(judge) 생략 → codex를 번역에 양보(거의 실시간).
    if (watchOpenRef.current && !wake) return;   // 워치 모드는 자동 카드 개입 생략(스크립트 집중)
    let r: api.Route;
    try { r = await api.route(wake ? q || text : text, histCtx, mid); } catch { return; }
    if (r.kind === "chat") { showChat(q || text, r.say || ""); if (wake && r.say) speak(r.say); return; }
    // 웨이크워드 호출 = 명시 커맨드 → 항상 수행(게이트 우회).
    if (wake) {
      if (r.kind === "none") { speak(t("wake.here")); return; }
      if (actingRef.current || queueRef.current.length) return;
      startAction(r.query || q || text, r.say || "", historyRef.current.join("\n"), true);
      return;
    }
    // 부르지 않은 실시간 개입 = 게이트(문턱·쿨다운·dedup). 기본 정리는 5분 다이제스트가 한다.
    if (r.kind !== "action") return;
    const conf = r.confidence ?? 0.5;
    if (conf < (LIVE_THRESH[liveSens] ?? 0.8)) return;          // 문턱 미달 → 침묵
    if (Date.now() - liveCardRef.current < LIVE_COOLDOWN_MS) return;  // 쿨다운
    const qq = r.query || text;
    if (digestTextRef.current && digestTextRef.current.includes(qq.slice(0, 12))) return;  // 다이제스트와 중복
    if (actingRef.current || queueRef.current.length) return;
    liveCardRef.current = Date.now();
    startAction(qq, r.say || "", historyRef.current.join("\n"), false);
  }, [showChat, startAction, pushHistory, speak, liveSens]);

  // 배치 경로: VAD 엔드포인트 → WAV를 REST 전사 → ingest. (parakeet/로컬/클라우드 배치 공통)
  const onUtterance = useCallback(async (blob: Blob) => {
    const mid = meetingIdRef.current;
    draftSeqRef.current += 1;   // 새 세대 → 진행 중이던 초안(회색) 무효화
    setDraft("");   // 엔드포인트 도달 → 초안 지우고 최종(정제) 라인으로 교체
    let text = "";
    try {
      const r = await api.transcribe(blob, mid, source);
      text = r.text;
      if (r.model) setEngineUsed({ model: r.model, engine: r.engine || "", provider: r.provider || "", fallback: !!r.fallback });
    }
    catch {
      // 전사 실패를 조용히 삼키면 "마이크는 켜졌는데 아무 반응 없음"으로 보인다.
      // 8초에 한 번만 알려 토스트 폭주는 막는다.
      const now = Date.now();
      if (now - sttErrRef.current > 8000) { sttErrRef.current = now; flash(t("toast.sttFail")); }
      return;
    }
    await ingestUtterance(text, mid);
  }, [ingestUtterance, source, t]);

  // realtime 확정 경로(ElevenLabs Scribe v2 Realtime): ws committed_transcript → ingest.
  // 저장은 서버 브리지가 하므로 여기선 표시+라우팅만. 배치 REST는 돌지 않아 이중 과금 없음.
  const onCommitted = useCallback((text: string) => {
    setDraft("");
    ingestUtterance(text.trim(), meetingIdRef.current);
  }, [ingestUtterance]);

  // 불명확 키워드 확인 — 사용자가 표기를 확정하면 전역 용어집에 누적(다음 전사부터 정확해짐).
  const confirmUnclear = useCallback(async (heard: string, term: string) => {
    setUnclears((u) => u.filter((x) => x.heard !== heard));
    const v = (term || "").trim();
    if (!v) return;
    try {
      const g = await api.getGlossary();
      if (!g.some((i) => i.term === v)) await api.setGlossary([...g, { term: v, note: "" }]);
      flash(t("unclear.added", { term: v }));
    } catch { /* ignore */ }
  }, [t]);

  const toggleActive = useCallback(async () => {
    if (active) {
      setActive(false); stop(); setDraft("");
      const mid = meetingIdRef.current;
      if (mid) api.endMeeting(mid).then(loadRecentMeetings);   // 종료 표시 + 내역 갱신
      return;
    }
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
      // 새 회의 시작 → 일시 폴더 생성. 전사·요약·회의록이 여기 누적된다.
      liveCardRef.current = 0; digestTextRef.current = ""; digestBusyRef.current = false;
      try { const m = await api.startMeeting(); meetingIdRef.current = m.id; setMeetingTitle(m.title); setMeetingFolder(m.folder || ""); loadRecentMeetings(); }
      catch { meetingIdRef.current = ""; }
      setActive(true);
      // 스트리밍 경로를 '시작 시점에' 백엔드에 직접 물어 권위 있게 결정(옛 ref 의존 X).
      //   · "elevenlabs" → Scribe v2 Realtime ws: 확정 라인까지 ws가 주도(배치 REST 없음 → 이중 과금 X)
      //   · "parakeet"   → 로컬 네이티브 ws: 라이브 초안만, 최종 라인은 배치 REST
      //   · null         → 2-pass interim 초안(모든 모델/제공자) + 배치 REST 최종
      let kind: api.StreamKind = null;
      try { const ss = await api.getSttStreaming(); kind = ss.available ? (ss.kind ?? null) : null; }
      catch { /* 폴백: interim 2-pass */ }
      const ws = kind ? api.sttWsUrl(meetingIdRef.current, source) : null;
      const realtime = kind === "elevenlabs";   // ws committed가 확정 라인을 주도
      streamingSttRef.current = !kind; nativeStreamRef.current = !!kind;
      if (realtime) setEngineUsed({ model: "scribe_v2_realtime", engine: "elevenlabs-realtime", provider: "elevenlabs", fallback: false });
      // 배치(onUtterance)·interim(onInterim)은 항상 넘긴다 — ws가 살아 있는 동안엔 훅 내부에서
      // 자동으로 비활성(이중 과금 X)이고, ws가 끊기면 그대로 폴백돼 전사가 멈추지 않는다.
      await start(
        onUtterance,
        onInterim,
        source, source === "mic" ? micId || undefined : undefined,
        ws,
        kind ? setDraft : null,                     // ws 부분결과 → 라이브 초안
        realtime ? onCommitted : null,              // realtime ws 확정 → 최종 라인 + 라우팅
      );
    }
    catch (e) { setActive(false); flash(t(captureErrKey(e))); }
  }, [active, start, stop, onUtterance, onInterim, onCommitted, source, micId, t, loadRecentMeetings]);

  // 런처에서 모드 선택 → 진입. 워치는 시스템 오디오로 듣는다.
  const enterMode = useCallback((m: LaunchMode) => {
    if (m === "watch") setSource("system");
    setAppMode(m);
  }, [setSource]);
  // 어느 모드에서든 런처(home)로 복귀. 듣는 중이면 멈추고, 캐시된 시스템 스트림까지 완전 해제.
  const goHome = useCallback(() => {
    if (active) { setActive(false); setDraft(""); const mid = meetingIdRef.current; if (mid) api.endMeeting(mid); }
    release();   // stop() + 시스템 오디오 스트림 종료(다음 진입 때 권한은 OS 기억대로)
    setSource("mic");
    setAppMode("home");
  }, [active, release, setSource]);

  // @[제목] 참조를 풀어 해당 지난 회의 요약을 쿼리에 덧붙인다.
  const resolveRefs = useCallback(async (q: string): Promise<string> => {
    const ids = [...q.matchAll(/@\[([^\]]+)\]/g)].map((m) => m[1]);
    if (!ids.length) return q;
    const parts: string[] = [];
    for (const title of ids) {
      const mt = recentMeetings.find((m) => m.title === title) || recentMeetings.find((m) => m.title.includes(title));
      if (!mt) continue;
      const full = await api.getMeeting(mt.id);
      const summary = full?.summary || full?.minutes?.spoken || "";
      if (summary) parts.push(`### ${mt.title}\n${summary}`);
    }
    return parts.length ? `${q}\n\n[참조한 지난 회의]\n${parts.join("\n\n")}` : q;
  }, [recentMeetings]);

  const runManual = useCallback(async (query: string) => {
    const q = query.trim();
    if (!q) return;
    pushFeed({ kind: "user", id: newId(), text: q });   // 사용자 입력 즉시 우측 편입
    pushHistory(`요청: ${q}`);
    // 회의록/이미지 요청은 회의록 생성 경로(실제 이미지)로
    if (isMinutesReq(q) && transcriptRef.current.length) { generateMinutes(t("minutes.ackFull")); return; }
    // 순수 인사는 네트워크 없이 즉답(로컬 정규식).
    if (CHAT_RE.test(q)) { showChat(q, ""); return; }
    const qResolved = await resolveRefs(q);   // @[지난 회의] 참조 주입
    // 수동 입력 = 명시 요청 → judge(코덱스 라우팅 1회) 생략하고 바로 act.
    // 라이브(자동 개입)와 달리 분류가 불필요 → 이중 codex 왕복 제거(카드 체감 2~3초↓).
    if (actingRef.current || queueRef.current.length) { flash(t("toast.busy")); return; }
    startAction(qResolved, "", historyRef.current.join("\n"));
  }, [showChat, startAction, pushHistory, pushFeed, generateMinutes, resolveRefs, t]);

  const chooseBackend = useCallback(async (b: string) => {
    try { setStatus(await api.setBackend(b)); } catch { flash(t("toast.backendFail")); }
  }, []);

  // 전사 + 카드를 Markdown으로 내보내기 (클립보드 복사)
  const exportMd = useCallback(async () => {
    const ts = transcriptRef.current;
    const cards = feed.filter((x): x is CardItem => x.kind === "card" && x.status === "done" && !!x.spec);
    if (!ts.length && !cards.length) { flash(t("toast.exportEmpty")); return; }
    const lines: string[] = [`# ${t("export.title")}`, ""];
    if (ts.length) lines.push(`## ${t("export.transcript")}`, "", ...ts.map((t) => `- ${t}`), "");
    if (cards.length) {
      lines.push(`## ${t("export.cards")}`, "");
      for (const c of cards) {
        const s = c.spec!;
        lines.push(`### ${s.title || c.query}`);
        if (s.spoken) lines.push("", s.spoken);
        for (const b of s.blocks || []) {
          if (b.type === "stat") lines.push(`- **${b.label || ""}**: ${b.value || ""}`);
          else if (b.type === "heading") lines.push(`**${b.text || ""}**`);
          else if (b.type === "text") lines.push(b.text || "");
          else if (b.type === "list" || b.type === "table") (b.items || []).forEach((it) => lines.push(`- ${it}`));
        }
        lines.push("");
      }
    }
    const md = lines.join("\n");
    try {
      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const d = new Date();
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
      a.href = url; a.download = `${t("export.filename")}-${stamp}.md`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      flash(t("toast.exportSaved"));
    } catch {
      try { await navigator.clipboard.writeText(md); flash(t("toast.exportCopied")); }
      catch { flash(t("toast.exportFail")); }
    }
  }, [feed]);

  // 맥락 입력(상황·주제·고유명사) — brain·요약 정확도↑. 열 때 현재 회의 맥락을 불러온다.
  const openContext = useCallback(async () => {
    const mid = meetingIdRef.current;
    if (mid) { const m = await api.getMeeting(mid); setCtxText(m?.user_context || ""); }
    setCtxOpen(true);
  }, []);
  const saveContext = useCallback(async () => {
    const mid = meetingIdRef.current;
    if (!mid) { flash(t("toast.ctxNoMeeting")); return; }
    await api.setMeetingContext(mid, ctxText);
    setCtxOpen(false);
    flash(t("toast.ctxSaved"));
  }, [ctxText, t]);

  // 회의 제목 편집 — 폴더명은 불변, 제목 필드만 갱신.
  const commitTitle = useCallback((title: string) => {
    const v = title.trim();
    setMeetingTitle(v);
    const mid = meetingIdRef.current;
    if (mid && v) api.setMeetingTitle(mid, v);
  }, []);
  // 회의 폴더 분류 편집 (Tiro '폴더에 추가하기').
  const commitFolder = useCallback((folder: string) => {
    setMeetingFolder(folder);
    const mid = meetingIdRef.current;
    if (mid) api.setMeetingFolder(mid, folder.trim());
  }, []);
  // 전사 클립보드 복사.
  const copyTranscript = useCallback(async () => {
    const txt = transcriptRef.current.join("\n");
    if (!txt) { flash(t("toast.exportEmpty")); return; }
    try { await navigator.clipboard.writeText(txt); flash(t("toast.copied")); } catch { flash(t("toast.exportFail")); }
  }, [t]);

  const togglePin = useCallback((id: string) => {
    setFeed((f) => f.map((x) => (x.kind === "card" && x.id === id ? { ...x, pinned: !x.pinned } : x)));
  }, []);

  const clearSession = useCallback(() => {
    if (active) { flash(t("toast.clearWhileActive")); return; }
    setTranscript([]); transcriptRef.current = [];
    setFeed([]); historyRef.current = [];
    flash(t("toast.cleared"));
  }, [active]);

  // 데모 회의 — 백엔드 없이 전사·카드 동작을 보여준다
  const stopDemo = useCallback(() => {
    demoTimersRef.current.forEach(clearTimeout);
    demoTimersRef.current = [];
    setDemoOn(false);
  }, []);

  const runDemo = useCallback(() => {
    if (active) { flash(t("toast.demoWhileActive")); return; }
    stopDemo();
    setTranscript([]); transcriptRef.current = [];
    setFeed([]); historyRef.current = [];
    setDemoOn(true);
    const demo = getDemo(lang);   // UI 언어에 맞는 데모(영문 UI에 한국어 데모가 나오던 문제 해결)
    const timers = demoTimersRef.current;
    let delay = 500;
    demo.transcript.forEach((line, i) => {
      timers.push(setTimeout(() => {
        transcriptRef.current = [...transcriptRef.current, line];
        setTranscript((arr) => [...arr, { id: newId(), text: line }]);
        demo.cards.filter((c) => c.afterLine === i).forEach((c) => {
          const id = newId();
          timers.push(setTimeout(() => setFeed((f) => [...f, { kind: "card", id, query: c.query, ack: c.ack, status: "working", progress: [{ text: t("trans.listening") }] }]), 400));
          timers.push(setTimeout(() => updateCard(id, { status: "done", spec: c.spec, backend: t("demo.backend") }), 1700));
        });
      }, delay));
      delay += 1500;
    });
    timers.push(setTimeout(() => setDemoOn(false), delay + 1800));
  }, [active, stopDemo, updateCard, t, lang]);

  // 단축키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA";
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "l") { e.preventDefault(); toggleActive(); }
      else if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); inputRef.current?.focus(); }
      else if (mod && e.key === "/") { e.preventDefault(); setHelpOpen((v) => !v); }
      else if (e.key === "Escape") { setHelpOpen(false); setAdminOpen(false); }
      else if (!typing && e.key === " ") { e.preventDefault(); toggleActive(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleActive]);

  // 언마운트 시 데모 타이머 정리
  useEffect(() => () => demoTimersRef.current.forEach(clearTimeout), []);

  // 플로팅 오브에 청취 상태 동기화(초록 라이브 점)
  useEffect(() => {
    try { (window as any).ghost?.orbState?.({ active }); } catch { /* ignore */ }
  }, [active]);

  // 업데이트 확인 — 서명/공증 전이라 자동 업데이트 대신, 새 릴리즈를 감지해 다운로드 배너를 띄운다.
  const [updateInfo, setUpdateInfo] = useState<{ v: string; url: string } | null>(null);
  useEffect(() => {
    if (!g.isElectron) return;
    (async () => {
      try {
        const r = await fetch("https://api.github.com/repos/HarryKane11/ghost/releases/latest");
        if (!r.ok) return;
        const j = await r.json();
        const latest = String(j.tag_name || "").replace(/^v/, "");
        const cur = String(g.version || "0");
        if (latest && latest.localeCompare(cur, undefined, { numeric: true }) > 0) {
          setUpdateInfo({ v: latest, url: j.html_url || GITHUB_URL + "/releases" });
        }
      } catch { /* 오프라인 등 — 조용히 */ }
    })();
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // 트레이 / 전역 단축키(⌘⇧G)의 청취 토글 요청 구독 (Electron)
  useEffect(() => {
    const g = (window as { ghost?: { onToggleListen?: (cb: () => void) => () => void } }).ghost;
    if (!g?.onToggleListen) return;
    return g.onToggleListen(() => { void toggleActive(); });
  }, [toggleActive]);

  const codexBad = status?.backend === "codex" && status && !status.codex_logged_in;

  return (
   <LangProvider lang={lang} setLang={changeLang}>
    {appMode === "home" && <Launcher onSelect={enterMode} onSettings={() => setAdminOpen(true)} onHelp={() => setHelpOpen(true)} isMac={isMacApp} t={t} />}
    <div className={cn("h-full flex-col bg-background text-foreground", appMode === "home" ? "hidden" : "flex")}>
      {/* 상단 바 */}
      <header className="relative z-10 flex h-12 shrink-0 items-center gap-3 border-b border-hairline px-3" style={{ ...DRAG, paddingLeft: isMacApp ? 80 : undefined }}>
        <button style={NO_DRAG} onClick={goHome} title={t("header.home")} className="flex items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-surface"><GhostLogo variant="icon" size={20} className="rounded-md" /><span className="text-[14px] font-semibold tracking-tight">Ghost</span></button>
        <div style={NO_DRAG} className="relative ml-1">
          <button onClick={() => setBackendMenuOpen((o) => !o)}
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-hairline bg-surface-soft px-2.5 text-[12px] font-medium text-foreground hover:bg-surface">
            <BrandIcon name={status?.backend ?? "codex"} size={13} />
            {BACKEND_LABELS[status?.backend ?? "codex"] ?? status?.backend}
            <ChevronDown className={cn("size-3 text-stone transition-transform", backendMenuOpen && "rotate-180")} />
          </button>
          {backendMenuOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setBackendMenuOpen(false)} />
              <div className="absolute left-0 top-9 z-30 min-w-[180px] rounded-xl border border-hairline bg-background p-1 shadow-lg">
                {(status?.backends ?? ["codex", "openai"]).map((id) => (
                  <button key={id} onClick={() => { chooseBackend(id); setBackendMenuOpen(false); }}
                    className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px]",
                      status?.backend === id ? "bg-surface font-medium text-foreground" : "text-steel hover:bg-surface-soft")}>
                    <BrandIcon name={id} size={14} /> {BACKEND_LABELS[id] ?? id}
                    {status?.backend === id && <Check className="ml-auto size-3.5 text-spark-deep" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <button style={NO_DRAG} onClick={refreshStatus} className={cn("inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium",
          backendErr ? "border-[#e9b0b0] bg-[#fdeeee] text-[#b04141]" : codexBad ? "border-[#e9c46a] bg-[#fdf6e3] text-[#9a6a00]" : "border-hairline bg-surface-soft text-steel hover:text-foreground")}>
          {backendErr ? <><ShieldAlert className="size-3.5" /> {t("header.backendErr")}</> : codexBad ? <><ShieldAlert className="size-3.5" /> {t("header.loginNeeded")}</> : status?.codex_logged_in ? <><ShieldCheck className="size-3.5 text-spark-deep" /> {t("header.connected")}</> : <><RefreshCw className="size-3.5" /> {t("header.refresh")}</>}
        </button>
        <div style={NO_DRAG} className="ml-auto flex items-center gap-1">
          {/* 새 버전 배너 — 클릭하면 릴리즈 페이지(외부 브라우저) */}
          {updateInfo && (
            <a href={updateInfo.url} target="_blank" rel="noreferrer"
              className="mr-1 inline-flex h-7 items-center gap-1.5 rounded-full border border-spark-soft bg-[color-mix(in_srgb,var(--spark)_10%,transparent)] px-2.5 text-[11.5px] font-medium text-spark-deep hover:bg-[color-mix(in_srgb,var(--spark)_18%,transparent)]">
              <Download className="size-3" /> {t("update.banner", { v: updateInfo.v })}
            </a>
          )}
          {/* 디스플레이 모드 전환 */}
          <div className="mr-1 flex items-center rounded-full border border-hairline bg-surface-soft p-0.5">
            {([["full", Columns2, t("mode.full")], ["assist", PanelRight, t("mode.assist")]] as const).map(([m, Icon, label]) => (
              <button key={m} onClick={() => setDisplayMode(m)} title={label}
                className={cn("grid size-7 place-items-center rounded-full transition-colors", displayMode === m ? "bg-ink text-canvas" : "text-steel hover:text-foreground")}>
                <Icon className="size-3.5" />
              </button>
            ))}
          </div>
          {/* UI 언어(지구본) — 한국어/English/中文 */}
          <div className="relative">
            <button onClick={() => setLangMenuOpen((v) => !v)} title={t("header.uiLang")}
              className="grid size-8 place-items-center rounded-lg text-steel hover:bg-surface hover:text-foreground"><Languages className="size-4" /></button>
            {langMenuOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setLangMenuOpen(false)} />
                <div className="absolute right-0 top-9 z-30 min-w-[130px] rounded-xl border border-hairline bg-background p-1 shadow-lg">
                  {LANGS.map((l) => (
                    <button key={l.id} onClick={() => { changeLang(l.id); setLangMenuOpen(false); }}
                      className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px]",
                        lang === l.id ? "bg-surface font-medium text-foreground" : "text-steel hover:bg-surface-soft")}>
                      {l.label}{lang === l.id && <Check className="ml-auto size-3.5 text-spark-deep" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {!!g.hideToOrb && (
            <button onClick={() => g.hideToOrb()} title={t("orb.collapse")} className="grid size-8 place-items-center rounded-lg text-steel hover:bg-surface hover:text-foreground"><GhostIcon className="size-4" /></button>
          )}
          <button onClick={() => setHelpOpen(true)} title={t("header.help")} className="grid size-8 place-items-center rounded-lg text-steel hover:bg-surface hover:text-foreground"><HelpCircle className="size-4" /></button>
          <button onClick={() => setAdminOpen(true)} title={t("header.settings")} className="grid size-8 place-items-center rounded-lg text-steel hover:bg-surface hover:text-foreground"><Settings className="size-4" /></button>
          <button onClick={goHome} title={t("header.home")} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-hairline px-2.5 text-[12px] text-steel hover:bg-surface hover:text-foreground"><Home className="size-3.5" /> {t("header.home")}</button>
          <button onClick={() => setVoiceOn((v) => !v)} title={voiceOn ? t("header.voiceOff") : t("header.voiceOn")} className="grid size-8 place-items-center rounded-lg text-steel hover:bg-surface hover:text-foreground">{voiceOn ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}</button>
          <button onClick={() => setDark((d) => !d)} title={t("header.theme")} className="grid size-8 place-items-center rounded-lg text-steel hover:bg-surface hover:text-foreground">{dark ? <Moon className="size-4" /> : <Sun className="size-4" />}</button>
        </div>
      </header>

      {/* 본문 — 모드별 레이아웃 (full/interview: 전사+우측, assist: 카드만) */}
      <div ref={splitRef} className="flex min-h-0 flex-1">
        {/* 좌측 회의 내역 사이드바 (접기 가능) */}
        <aside className={cn("flex shrink-0 flex-col border-r border-hairline bg-surface-soft/30 transition-[width]", histOpen ? "w-56" : "w-11")}>
          <div className="flex items-center gap-1.5 px-2 py-2.5">
            <button onClick={() => setHistOpen((v) => !v)} title={t("hist.title")} className="grid size-7 place-items-center rounded-lg text-stone hover:bg-surface hover:text-foreground"><History className="size-4" /></button>
            {histOpen && <span className="text-[12px] font-semibold text-foreground">{t("hist.title")}</span>}
          </div>
          {histOpen && (
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
              {recentMeetings.length === 0 ? (
                <p className="px-2 py-6 text-center text-[11.5px] leading-relaxed text-stone">{t("hist.empty")}</p>
              ) : recentMeetings.map((m) => (
                <button key={m.id} onClick={() => openMeetingCard(m)}
                  className="flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-surface">
                  <span className="truncate text-[12.5px] text-charcoal">{m.title}</span>
                  <span className="text-[10.5px] text-stone">{m.duration_sec ? t("hist.mins", { n: Math.max(1, Math.round(m.duration_sec / 60)) }) : t("hist.utts", { n: m.utterance_count ?? 0 })}{m.has_minutes ? ` · ${t("hist.minutesBadge")}` : ""}</span>
                </button>
              ))}
            </div>
          )}
        </aside>
        {/* 좌: 실시간 전사 (assist 모드에선 숨김) */}
        <section className={cn("flex min-h-0 flex-col border-r border-hairline", displayMode === "assist" && "hidden")}
          style={displayMode === "assist" ? undefined : { width: `${splitPct}%` }}>
          <div className="flex items-center gap-2 px-4 py-2.5">
            <AudioLines className="size-3.5 text-stone" />
            <div className="flex items-center gap-1">
              {(["raw", "script", "minutes"] as const).map((tab) => (
                <button key={tab} onClick={() => setTransTab(tab)}
                  className={cn("whitespace-nowrap rounded-md px-2 py-0.5 text-[11.5px] font-medium transition-colors", transTab === tab ? "bg-surface text-foreground" : "text-stone hover:text-foreground")}>
                  {tab === "raw" ? t("trans.tabRaw") : tab === "script" ? t("trans.tabScript") : t("trans.tabMinutes")}
                </button>
              ))}
              {translateOn && transTab === "raw" && (
                <span className="ml-1 inline-flex items-center gap-0.5 rounded-md bg-spark/15 px-1.5 py-0.5 text-[10.5px] font-medium text-spark-deep" title={t("trans.translateTo")}>
                  <Globe className="size-3" /> {(transLangs.find((l) => l.code === transLang)?.label) || transLang}
                </span>
              )}
            </div>
            <div className="ml-auto flex items-center gap-1">
              {/* 도구 더보기(⋯) — 맥락·검색·복사·내보내기·비우기를 라벨과 함께 한 메뉴로 */}
              <div className="relative">
                <button onClick={() => setToolsOpen((v) => !v)} title={t("trans.more")} className="inline-flex h-7 items-center gap-1 rounded-lg border border-hairline px-2 text-[11.5px] font-medium text-steel hover:bg-surface hover:text-foreground"><MoreHorizontal className="size-3.5" /> {t("trans.more")}</button>
                {toolsOpen && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setToolsOpen(false)} />
                    <div className="absolute right-0 top-9 z-30 w-52 rounded-xl border border-hairline bg-background p-1 shadow-lg">
                      <button onClick={() => { openContext(); setToolsOpen(false); }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] text-steel hover:bg-surface-soft"><FileText className="size-4 shrink-0 text-stone" /> {t("trans.context")}</button>
                      <button onClick={() => setPolishOn((v) => !v)} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] text-steel hover:bg-surface-soft">
                        <Sparkles className="size-4 shrink-0 text-stone" /> {t("trans.polish")}
                        {polishOn && <Check className="ml-auto size-3.5 shrink-0 text-spark-deep" />}
                      </button>
                      <button onClick={() => { setSearchOpen((v) => !v); if (searchOpen) setTq(""); setToolsOpen(false); }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] text-steel hover:bg-surface-soft"><Search className="size-4 shrink-0 text-stone" /> {t("trans.search")}</button>
                      <button onClick={() => { copyTranscript(); setToolsOpen(false); }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] text-steel hover:bg-surface-soft"><Copy className="size-4 shrink-0 text-stone" /> {t("trans.copy")}</button>
                      <button onClick={() => { exportMd(); setToolsOpen(false); }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] text-steel hover:bg-surface-soft"><Download className="size-4 shrink-0 text-stone" /> {t("trans.export")}</button>
                      <button onClick={() => { clearSession(); setToolsOpen(false); }} disabled={active} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] text-steel hover:bg-surface-soft disabled:opacity-40"><Trash2 className="size-4 shrink-0 text-stone" /> {t("trans.clear")}</button>
                    </div>
                  </>
                )}
              </div>
              <div className="ml-1 flex items-center rounded-full border border-hairline bg-surface-soft p-0.5">
                {([["mic", t("trans.mic")], ["system", t("trans.system")]] as const).map(([s, label]) => (
                  <button key={s} disabled={active} onClick={() => setSource(s)} className={cn("inline-flex h-5.5 items-center gap-1 rounded-full px-2 text-[11px] font-medium transition-colors disabled:opacity-50", source === s ? "bg-ink text-canvas" : "text-steel hover:text-foreground")}>
                    {s === "mic" ? <Mic className="size-3" /> : <MonitorSpeaker className="size-3" />}{label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {meetingTitle && (
            <div className="flex items-center gap-1.5 px-4 pb-2">
              <input
                value={meetingTitle}
                onChange={(e) => setMeetingTitle(e.target.value)}
                onBlur={(e) => commitTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                placeholder={t("trans.titlePlaceholder")} title={t("trans.titleEdit")}
                className="min-w-0 flex-1 truncate rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[13px] font-medium text-foreground outline-none hover:border-hairline focus:border-ink/40 focus:bg-surface-soft"
              />
              <span className="shrink-0 text-stone">/</span>
              <input
                value={meetingFolder}
                onChange={(e) => setMeetingFolder(e.target.value)}
                onBlur={(e) => commitFolder(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                placeholder={t("trans.folder")} title={t("trans.folder")}
                className="w-28 shrink-0 truncate rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[12px] text-steel outline-none hover:border-hairline focus:border-ink/40 focus:bg-surface-soft"
              />
            </div>
          )}
          {(searchOpen || (source === "mic" && mics.length > 1)) && (
            <div className="flex items-center gap-2 px-4 pb-2">
              {source === "mic" && mics.length > 1 && (
                <select value={micId} onChange={(e) => setMicId(e.target.value)} disabled={active}
                  title={t("trans.micDevice")} className="h-7 max-w-[180px] truncate rounded-lg border border-hairline bg-surface-soft px-2 text-[11.5px] text-steel outline-none focus:border-ink/40 disabled:opacity-50">
                  <option value="">{t("trans.micDefault")}</option>
                  {mics.map((m) => <option key={m.deviceId} value={m.deviceId}>{m.label || t("trans.micN", { id: m.deviceId.slice(0, 4) })}</option>)}
                </select>
              )}
              {searchOpen && (
                <input autoFocus value={tq} onChange={(e) => setTq(e.target.value)} placeholder={t("trans.searchPlaceholder")}
                  className="ml-auto h-7 w-40 rounded-lg border border-hairline bg-surface-soft px-2.5 text-[12px] outline-none placeholder:text-stone focus:border-ink/40" />
              )}
            </div>
          )}
          <div className="flex items-center gap-2 border-y border-hairline/60 bg-surface-soft/50 px-4 py-2">
            <Waveform active={active} level={level} bars={20} />
            <span className="ml-auto flex items-center gap-2 text-[11px] text-stone">
              {/* 현재 음성 인식 모델 — 클릭하면 바로 교체(provider+model 함께 설정) */}
              <ModelPicker provider={status?.stt_provider} models={sttModelsList} onPick={pickModel} disabled={active} fallbackColor={!!engineUsed?.fallback} t={t} />
              {active && <span className="font-mono tabular-nums text-steel">{fmtTime(elapsed)}</span>}
              {status && !status.stt_ready ? t("trans.loadingModel") : demoOn ? t("trans.demoPlaying") : active ? (speaking ? t("trans.listening") : t("trans.waiting")) : t("trans.off")}
            </span>
          </div>
          {/* 불명확 키워드 질문 — 사용자가 표기를 확정하면 용어집에 누적돼 다음 전사가 정확해진다 */}
          {unclears.length > 0 && transTab === "raw" && (
            <div className="space-y-1.5 border-b border-hairline/60 px-4 py-2">
              {unclears.map((u) => (
                <UnclearChip key={u.heard} heard={u.heard} guess={u.guess} t={t}
                  onConfirm={confirmUnclear}
                  onSkip={(h) => setUnclears((x) => x.filter((y) => y.heard !== h))} />
              ))}
            </div>
          )}
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 py-3">
            {/* 회의록 탭: 저장된 minutes.json (실시간 스크립트와 별개의 산출물) */}
            {transTab === "minutes" ? (
              <div className="space-y-3.5">
                {minutesLoading && !minutesSpec ? (
                  <p className="rounded-lg border border-dashed border-hairline px-3 py-6 text-center text-[12px] text-stone">{t("trans.minutesLoading")}</p>
                ) : minutesSpec ? (
                  <>
                    <GenUI spec={minutesSpec} onAction={runManual} />
                    <div className="flex justify-end">
                      <button onClick={() => { generateMinutes(); }} disabled={thinking}
                        className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-[11.5px] text-steel hover:text-foreground disabled:opacity-40">
                        <RefreshCw className="size-3" /> {t("trans.minutesRegen")}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="rounded-lg border border-dashed border-hairline px-3 py-6 text-center">
                    <p className="text-[12px] leading-relaxed text-stone">
                      {meetingIdRef.current ? t("trans.minutesEmpty") : t("trans.minutesNeedMeeting")}
                    </p>
                    {!!meetingIdRef.current && transcriptRef.current.length > 0 && (
                      <button onClick={() => { generateMinutes(); }} disabled={thinking}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 text-[12px] font-medium text-canvas disabled:opacity-40">
                        <FileText className="size-3.5" /> {t("trans.minutesGenerate")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : transTab === "script" ? (
              <div className="space-y-3.5">
                {scriptParas.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-hairline px-3 py-6 text-center text-[12px] text-stone">
                    {scriptLoading ? t("trans.scriptLoading") : t("trans.scriptEmpty")}
                  </p>
                ) : scriptParas.map((p, i) => (
                  <div key={i} className="ghost-line">
                    {p.bullets?.length > 0 && (
                      <ul className="mb-1 space-y-0.5">
                        {p.bullets.map((b, j) => (
                          <li key={j} className="flex gap-1.5 text-[12.5px] font-medium leading-relaxed text-foreground">
                            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-spark" />{b}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="text-[12.5px] leading-relaxed text-stone">{p.cleaned}</p>
                  </div>
                ))}
                {active && <p className="text-[11px] italic text-stone">{t("trans.scriptLive")}</p>}
              </div>
            ) : (<>
            {transcript.length === 0 && <p className="rounded-lg border border-dashed border-hairline px-3 py-6 text-center text-[12px] text-stone">{active ? t("trans.emptyActive") : t("trans.emptyIdle")}</p>}
            {(() => {
              const q = tq.trim().toLowerCase();
              const shown = q ? transcript.filter((t) => t.text.toLowerCase().includes(q)) : transcript;
              if (q && shown.length === 0) return <p className="px-1 py-2 text-center text-[12px] text-stone">{t("trans.noResults", { q: tq })}</p>;
              // 새 줄은 유령 커서가 좌→우로 쓸고 지나간 듯(ghost-line) 드러난다.
              // 인터뷰 모드면 각 줄 아래 번역을 함께 보여준다(이중 언어).
              return shown.map((ln) => (
                <div key={ln.id} className="transcript-settle rounded-md px-1">
                  <p className={cn("text-[13px] leading-relaxed text-slate", ln.polished && "polish-glow")}>{ln.text}</p>
                  {translateOn && (
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-spark-deep">
                      {translations[`${transLang}:${ln.id}`] ?? <span className="italic text-stone">…</span>}
                    </p>
                  )}
                </div>
              ));
            })()}
            {/* 라이브 초안 — 인식되는 단어마다 초록 칩으로 강조(실시간성). 확정되면 위 라인으로 settle. */}
            {draft && active && !tq.trim() && (
              <p className="flex flex-wrap items-center gap-1 px-1 text-[13px] leading-relaxed">
                {draft.split(/\s+/).filter(Boolean).map((w, i, arr) => (
                  <span key={i} className={cn("rounded px-1 py-px transition-colors duration-200",
                    i === arr.length - 1 ? "bg-spark/25 text-spark-deep" : "bg-spark/10 text-charcoal")}>{w}</span>
                ))}
                <span className="draft-cursor font-medium text-spark-deep">▍</span>
              </p>
            )}
            {/* 듣는 중(초안 전): shimmer 구조만 (통통 튀는 블록 제거) */}
            {active && !tq.trim() && !demoOn && !draft && (
              <div className="mt-1 space-y-2 px-1">
                <div className="mist h-3 w-3/4 rounded-full" />
                <div className="mist h-3 w-1/2 rounded-full" />
              </div>
            )}
            </>)}
            <div ref={transEndRef} />
          </div>
        </section>

        {/* 리사이즈 핸들러 (assist 모드 제외) */}
        {displayMode !== "assist" && (
          <div onPointerDown={startSplitDrag} title={t("split.resize")}
            className="group relative w-1 shrink-0 cursor-col-resize bg-hairline/40 transition-colors hover:bg-spark/40">
            <div className="absolute inset-y-0 -left-1 -right-1" />
          </div>
        )}

        {/* 우: 대화 피드 (사용자 입력 + Ghost 카드) */}
        <section className="relative flex min-h-0 flex-1 flex-col">
          {feed.length === 0 && !demoOn && <PhantomField />}
          {demoOn && (
            <div className="flex items-center gap-2 border-b border-hairline bg-spark-soft/20 px-5 py-2 text-[12px] text-spark-deep">
              <span className="soul-pulse size-1.5 rounded-full bg-spark" /> {t("feed.demoBanner")}
              <button onClick={stopDemo} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-steel hover:text-foreground"><Square className="size-3" /> {t("feed.stop")}</button>
            </div>
          )}
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
            {feed.length === 0 && (
              <div className="relative flex h-full flex-col items-center justify-center text-center">
                <PhantomGhost size={34} className="text-steel" />
                <p className="mt-4 max-w-[260px] text-[12.5px] leading-relaxed text-stone">{t("feed.emptyTitle")}<br />{t("feed.emptySub")}</p>
                {!active && (
                  <button onClick={runDemo} className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-hairline bg-canvas px-3.5 py-2 text-[12.5px] font-medium text-steel hover:text-foreground">
                    <Play className="size-3.5" /> {t("feed.demo")}
                  </button>
                )}
              </div>
            )}
            {feed.map((it) =>
              it.kind === "user" ? (
                <div key={it.id} className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-br-md bg-ink px-3.5 py-2 text-[13.5px] leading-relaxed text-canvas">{it.text}</div>
                </div>
              ) : (
                <article key={it.id} className={cn("materialize rounded-2xl border bg-canvas/90 p-4 backdrop-blur-sm",
                  it.pinned ? "border-spark-soft shadow-[0_6px_30px_-6px_color-mix(in_srgb,var(--spark)_32%,transparent)]" : "border-hairline shadow-[0_4px_24px_-8px_rgba(10,10,10,0.12)]",
                  it.status === "working" && "possessed")}>
                  <div className="mb-2.5 flex items-start gap-2">
                    <GhostLogo variant="icon" size={18} className="mt-0.5 shrink-0 rounded-[5px]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-semibold tracking-tight">{it.spec?.title || it.query}</p>
                      {it.spec?.title && it.query !== it.spec.title && <p className="truncate text-[11px] text-stone">{it.query}</p>}
                    </div>
                    {it.status === "done" && (
                      <button onClick={() => togglePin(it.id)} title={it.pinned ? t("card.unpin") : t("card.pin")}
                        className={cn("shrink-0 transition-colors", it.pinned ? "text-spark-deep" : "text-stone hover:text-foreground")}>
                        <Pin className={cn("size-3.5", it.pinned && "fill-current")} />
                      </button>
                    )}
                    <button onClick={() => setFeed((f) => f.filter((x) => x !== it))} className="text-stone hover:text-foreground" title={t("card.close")}><X className="size-4" /></button>
                  </div>
                  {it.status === "working" ? (
                    <div className="relative space-y-3 py-1">
                      {it.ack && <p className="wisp text-[13px] italic leading-relaxed text-steel">{it.ack}</p>}
                      <GhostStreamLoader />
                      <div className="space-y-1.5">
                        {it.progress.map((p, i) => {
                          const last = i === it.progress.length - 1;
                          const op = last ? 1 : Math.max(0.22, 0.66 - (it.progress.length - 1 - i) * 0.16);
                          if (p.kind === "command")
                            return <div key={p.id || i} style={{ opacity: op }} className="wisp"><CommandStep item={p} active={last} /></div>;
                          return <div key={i} style={{ opacity: op }} className={cn("wisp flex items-center gap-2 text-[12px]", last ? "haze text-foreground" : "text-stone")}><ProgressLine text={p.text} kind={p.kind} active={last} /></div>;
                        })}
                      </div>
                    </div>
                  ) : it.spec ? (
                    <>
                      {it.ack && it.status === "done" && <p className="mb-2.5 text-[12.5px] leading-relaxed text-steel">{it.ack}</p>}
                      <GenUI spec={it.spec} onAction={runManual} />
                      <div className="mt-3 flex items-center gap-2">
                        {it.backend && <span className="inline-flex items-center gap-1 text-[11px] text-stone">{/Codex/.test(it.backend) ? <BrandIcon name="codex" size={11} /> : /OpenAI/.test(it.backend) ? <BrandIcon name="openai" size={11} /> : null}{it.backend}</span>}
                        {it.spec.spoken && <button onClick={() => speak(it.spec!.spoken)} className="ml-auto inline-flex items-center gap-1 text-[11px] text-steel hover:text-foreground"><Volume2 className="size-3" /> {t("card.listen")}</button>}
                      </div>
                    </>
                  ) : null}
                </article>
              )
            )}
            <div ref={feedEndRef} />
          </div>
        </section>
      </div>

      {/* 하단: 추천 프롬프트 칩 + 컴팩트 듣기 + 입력 (@로 지난 회의 참조) */}
      <footer className="shrink-0 border-t border-hairline bg-surface-soft/50 px-4 py-2.5">
        <div className="mx-auto max-w-3xl">
          {/* 추천 프롬프트 칩 (Ask 패널) */}
          {!thinking && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {(["ask.summary", "ask.actions", "ask.decisions", "ask.terms"] as const).map((k) => (
                <button key={k} onClick={() => runManual(t(k))}
                  className="inline-flex items-center gap-1 rounded-full border border-hairline bg-canvas px-2.5 py-1 text-[11.5px] text-steel hover:border-ink/30 hover:text-foreground">
                  <Sparkles className="size-3 text-spark-deep" /> {t(k)}
                </button>
              ))}
            </div>
          )}
          <div className="relative flex items-center gap-2">
            <button onClick={toggleActive} title={active ? t("footer.listenStop") : t("footer.listenStart")}
              className={cn("relative grid size-10 shrink-0 place-items-center rounded-full transition-colors", active ? "bg-ink text-canvas" : "border border-hairline bg-canvas text-steel hover:text-foreground")}>
              {active && <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-spark ring-2 ring-background" />}
              {active ? <Square className="size-3.5" /> : <Mic className="size-4" />}
            </button>
            {thinking && <Loader2 className="size-4 shrink-0 animate-spin text-stone" />}
            {/* @ 지난 회의 참조 드롭다운 */}
            {atOpen && recentMeetings.length > 0 && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setAtOpen(false)} />
                <div className="absolute bottom-12 left-12 z-30 max-h-56 w-72 overflow-y-auto rounded-xl border border-hairline bg-background p-1 shadow-lg">
                  <div className="px-2 py-1 text-[10.5px] text-stone">{t("ask.refHint")}</div>
                  {recentMeetings
                    .filter((m) => { const q = (input.match(/@(\S*)$/) || [])[1] || ""; return !q || m.title.toLowerCase().includes(q.toLowerCase()); })
                    .slice(0, 6)
                    .map((m) => (
                      <button key={m.id} onClick={() => { setInput((v) => v.replace(/@(\S*)$/, `@[${m.title}] `)); setAtOpen(false); inputRef.current?.focus(); }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-steel hover:bg-surface-soft">
                        <FileText className="size-3.5 shrink-0 text-stone" /><span className="truncate">{m.title}</span>
                      </button>
                    ))}
                </div>
              </>
            )}
            <form onSubmit={(e) => { e.preventDefault(); runManual(input); setInput(""); setAtOpen(false); }} className="flex flex-1 items-center gap-2">
              <input ref={inputRef} value={input}
                onChange={(e) => { const v = e.target.value; setInput(v); setAtOpen(/@(\S*)$/.test(v)); }}
                placeholder={t("footer.placeholder")}
                className="h-10 flex-1 rounded-full border border-hairline bg-canvas px-4 text-[14px] outline-none placeholder:text-stone focus:border-ink/40" />
              <button type="submit" disabled={!input.trim()} className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-canvas disabled:opacity-40"><Send className="size-4" /></button>
            </form>
          </div>
        </div>
      </footer>

      {/* 우하단 실시간 번역 토글 (창모드에서 분리) — 켜면 각 전사 줄 아래 번역 표시 */}
      <div className="absolute bottom-24 right-5 z-30 flex flex-col items-end gap-2" style={NO_DRAG}>
        {translateMenuOpen && (
          <div className="max-h-64 w-44 overflow-y-auto rounded-xl border border-hairline bg-background p-1 shadow-xl">
            {(transLangs.length ? transLangs : [{ code: "en", name: "English", label: "English" }, { code: "ko", name: "Korean", label: "한국어" }] as api.TransLang[]).map((l) => (
              <button key={l.code} onClick={() => { setTransLang(l.code); setTranslateOn(true); setTranslateMenuOpen(false); }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-steel hover:bg-surface-soft">
                {l.label}{transLang === l.code && <Check className="ml-auto size-3.5 text-spark-deep" />}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center overflow-hidden rounded-full border border-hairline bg-canvas shadow-lg">
          <button onClick={() => setTranslateOn((v) => !v)} title={t("translate.toggle")}
            className={cn("flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium transition-colors", translateOn ? "bg-spark text-white" : "text-steel hover:text-foreground")}>
            <Globe className="size-3.5" /> {translateOn ? (transLangs.find((l) => l.code === transLang)?.label || transLang) : t("translate.off")}
          </button>
          <button onClick={() => setTranslateMenuOpen((v) => !v)} title={t("trans.translateTo")} className="border-l border-hairline px-1.5 py-2 text-stone hover:text-foreground"><ChevronDown className="size-3.5" /></button>
        </div>
      </div>

      {ctxOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={() => setCtxOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl border border-hairline bg-background p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center gap-2">
              <FileText className="size-4 text-steel" />
              <h2 className="text-[15px] font-semibold tracking-tight">{t("ctx.title")}</h2>
              <button onClick={() => setCtxOpen(false)} className="ml-auto grid size-7 place-items-center rounded-lg text-stone hover:bg-surface hover:text-foreground"><X className="size-4" /></button>
            </div>
            <p className="mb-3 text-[12px] leading-relaxed text-stone">{t("ctx.desc")}</p>
            <textarea value={ctxText} onChange={(e) => setCtxText(e.target.value)}
              rows={7} placeholder={t("ctx.placeholder")}
              className="w-full resize-none rounded-xl border border-hairline bg-surface-soft p-3 text-[13px] leading-relaxed text-foreground outline-none focus:border-ink/40" />
            <div className="mt-3 flex items-center justify-end gap-2">
              <button onClick={() => setCtxOpen(false)} className="h-9 rounded-lg border border-hairline px-3.5 text-[13px] text-steel hover:text-foreground">{t("ctx.cancel")}</button>
              <button onClick={saveContext} className="h-9 rounded-lg bg-ink px-4 text-[13px] font-medium text-canvas">{t("ctx.save")}</button>
            </div>
          </div>
        </div>
      )}

    </div>
    {/* ↓ 전체화면 오버레이들은 hidden 컨테이너 '밖'에 둔다 — 런처(home)에서 설정/도움말/온보딩이
        안 열리던 버그 수정(부모 display:none이 fixed 자식까지 숨겼다). */}
      {/* 전체화면 관리자 페이지(톱니바퀴) — 회의 아카이브 + 모델·커넥터·용어집·저장 설정 */}
      <SettingsMenu variant="page" open={adminOpen} isMac={isMacApp} onClose={() => setAdminOpen(false)} status={status}
        onStatus={setStatus}
        onReplayGuide={() => { setAdminOpen(false); setOnboard(true); }}
        digestMin={digestMin} setDigestMin={setDigestMin}
        liveSens={liveSens} setLiveSens={setLiveSens}
        autoResearch={autoResearch} setAutoResearch={setAutoResearch}
        onOpenMeeting={(title, spec) => { setAdminOpen(false); pushFeed({ kind: "card", id: newId(), query: title, status: "done", progress: [], spec, pinned: true }); }} />

      {/* YouTube 워치 모드 — 임베드 영상 + 시스템오디오 STT 스크립트·번역 + 플로팅 고스트 챗 */}
      <WatchView
        open={appMode === "watch"}
        onClose={goHome}
        active={active}
        onToggleListen={toggleActive}
        transcript={transcript}
        translations={translations}
        transLang={transLang}
        setTransLang={setTransLang}
        transLangs={transLangs}
        draft={draft}
        cards={feed.filter((x): x is CardItem => x.kind === "card").slice(-4)}
        onAsk={runManual}
        t={t}
        isMac={isMacApp}
        provider={status?.stt_provider} models={sttModelsList} onPickModel={pickModel}
        source={source} setSource={setSource}
      />

      {/* 음성 파일 모드 — 업로드 → 타임스탬프 전사 + 재생 + 회의록(구간 재생 주석) */}
      <AudioView open={appMode === "audio"} onClose={goHome} isMac={isMacApp} t={t}
        provider={status?.stt_provider} models={sttModelsList} onPickModel={pickModel} transLangs={transLangs} lang={lang} />

      <Onboarding
        open={onboard}
        status={status}
        onRefreshStatus={refreshStatus}
        onSetBackend={chooseBackend}
        onClose={() => { localStorage.setItem(ONBOARDED_KEY, "1"); setOnboard(false); }}
        onStart={() => { localStorage.setItem(ONBOARDED_KEY, "1"); setOnboard(false); if (!active) toggleActive(); }}
      />

      <Help open={helpOpen} onClose={() => setHelpOpen(false)} isMac={isMacApp} />

      {toast && <div className="pointer-events-none fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-[12.5px] text-canvas shadow-lg">{toast}</div>}
   </LangProvider>
  );
}
