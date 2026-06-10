import { useEffect, useState } from "react";
import { X, ShieldCheck, ShieldAlert, KeyRound, History, Check, Compass, Code, Loader2, Plus, Link2, AudioLines, Volume2, ChevronRight, ChevronLeft, Download, Search, Gauge, Type, Cpu, Sparkles, PanelLeftClose, Trash2 } from "lucide-react";
import * as api from "@/lib/api";
import type { Spec } from "@/components/GenUI";
import { BrandIcon, hasBrand, EntityIcon, hasEntityIcon } from "@/components/BrandIcon";
import { FontSettings } from "@/components/FontSettings";
import { UsageDashboard } from "@/components/UsageDashboard";
import { useT, LANGS } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { Languages } from "lucide-react";


const GITHUB_URL = "https://github.com/HarryKane11/ghost";
const APP_VERSION =
  (typeof window !== "undefined" && (window as { ghost?: { version?: string } }).ghost?.version) || "0.1.0";

export function SettingsMenu({
  open, onClose, status, onOpenMeeting, onReplayGuide, onStatus,
  digestMin, setDigestMin, liveSens, setLiveSens, autoResearch, setAutoResearch,
  variant = "drawer", isMac = false,
}: {
  open: boolean;
  onClose: () => void;
  status: api.Status | null;
  onOpenMeeting: (title: string, spec: Spec) => void;
  onReplayGuide?: () => void;
  onStatus?: (s: api.Status) => void;
  digestMin: number;
  setDigestMin: (v: number) => void;
  liveSens: "off" | "conservative" | "eager";
  setLiveSens: (v: "off" | "conservative" | "eager") => void;
  autoResearch: boolean;
  setAutoResearch: (v: boolean) => void;
  variant?: "drawer" | "page";   // drawer=빠른 설정 드롭다운, page=전체화면 관리자 페이지
  isMac?: boolean;
}) {
  const page = variant === "page";
  const [mq, setMq] = useState("");   // 회의 아카이브 검색어(page 변형)
  const [nav, setNav] = useState("usage");   // 관리자 좌측 사이드바 선택 그룹
  const [navCollapsed, setNavCollapsed] = useState(false);   // 사이드바 접기
  const { t, lang, setLang } = useT();
  // 좌측 사이드바 네비게이션 그룹(page 변형 전용)
  const NAV: { id: string; label: string; icon: React.ReactNode }[] = [
    { id: "usage", label: t("admin.navUsage"), icon: <Gauge className="size-4" /> },
    { id: "appearance", label: t("admin.navAppearance"), icon: <Type className="size-4" /> },
    { id: "agent", label: t("admin.navAgent"), icon: <Cpu className="size-4" /> },
    { id: "stt", label: t("admin.navStt"), icon: <AudioLines className="size-4" /> },
    { id: "tts", label: t("admin.navTts"), icon: <Volume2 className="size-4" /> },
    { id: "connectors", label: t("admin.navConnectors"), icon: <Link2 className="size-4" /> },
    { id: "proactive", label: t("admin.navProactive"), icon: <Sparkles className="size-4" /> },
    { id: "storage", label: t("admin.navStorage"), icon: <KeyRound className="size-4" /> },
    { id: "meetings", label: t("admin.navMeetings"), icon: <History className="size-4" /> },
  ];
  // 그룹 래퍼: 드로어(전체 스크롤)는 항상 표시, 페이지(사이드바)는 선택 그룹만.
  const Grp = ({ id, children }: { id: string; children: React.ReactNode }) =>
    (!page || nav === id) ? <>{children}</> : null;
  const [connectors, setConnectors] = useState<{ name: string; status: string }[]>([]);
  const [tools, setTools] = useState<{ name: string; desc: string; on: boolean }[]>([]);
  const [meetings, setMeetings] = useState<api.MeetingMeta[]>([]);
  const [apiKey, setApiKeyVal] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const [elevenKey, setElevenKeyVal] = useState("");
  const [registry, setRegistry] = useState<api.RegistryConnector[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [customUrl, setCustomUrl] = useState("");
  const [customName, setCustomName] = useState("");
  const [storage, setStorage] = useState<api.Storage | null>(null);
  const [storagePath, setStoragePath] = useState("");
  const [sttModel, setSttModel] = useState<api.SttModel | null>(null);
  const [sttModels, setSttModels] = useState<api.SttModels | null>(null);
  const [sttStreaming, setSttStreaming] = useState<{ available: boolean } | null>(null);
  const [engineInstall, setEngineInstall] = useState<api.EngineInstall>({ state: "idle" });
  const [customModel, setCustomModel] = useState("");
  const [glossary, setGlossaryState] = useState<api.GlossaryItem[]>([]);
  const [connIndex, setConnIndex] = useState<api.ConnectorIndex>({});
  const [indexing, setIndexing] = useState<string | null>(null);
  const [gTerm, setGTerm] = useState("");
  const [gNote, setGNote] = useState("");

  const loadConnectors = () => {
    api.getConnectors().then(setConnectors).catch(() => {});
    api.getTools().then(setTools).catch(() => {});
    api.getConnectorRegistry().then((r) => setRegistry(r.connectors)).catch(() => {});
    api.getConnectorIndex().then(setConnIndex).catch(() => {});
  };
  const doIndex = async (name: string) => {
    setIndexing(name);
    const r = await api.indexConnector(name);
    setIndexing(null);
    if (r.ok) setConnIndex(await api.getConnectorIndex());
    else alert(r.message || r.error || "인덱싱 실패");
  };

  useEffect(() => {
    if (!open) return;
    loadConnectors();
    api.getMeetings().then(setMeetings);
    api.getStorage().then((s) => { setStorage(s); setStoragePath(s?.home || ""); });
    api.getSttModel().then(setSttModel);
    api.getSttModels().then(setSttModels);
    api.getSttStreaming().then(setSttStreaming);
    api.getEngineInstall().then(setEngineInstall);
    api.getGlossary().then(setGlossaryState);
    setKeySaved(false);
  }, [open]);

  const addTerm = async () => {
    const term = gTerm.trim();
    if (!term) return;
    // 중복 용어는 노트만 갱신(같은 용어가 줄줄이 쌓이던 문제).
    const next = glossary.some((g) => g.term === term)
      ? glossary.map((g) => (g.term === term ? { term, note: gNote.trim() || g.note } : g))
      : [...glossary, { term, note: gNote.trim() }];
    setGlossaryState(await api.setGlossary(next));
    setGTerm(""); setGNote("");
  };
  const removeTerm = async (i: number) => {
    setGlossaryState(await api.setGlossary(glossary.filter((_, idx) => idx !== i)));
  };
  // 용어집 내보내기/가져오기 — 팀 온보딩·기기 이전용 JSON.
  const exportGlossary = () => {
    const blob = new Blob([JSON.stringify(glossary, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "ghost-glossary.json";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };
  const importGlossary = async (file?: File | null) => {
    if (!file) return;
    try {
      const items = JSON.parse(await file.text());
      if (!Array.isArray(items)) throw new Error("형식 오류");
      const merged = [...glossary];
      for (const it of items) {
        const term = String(it?.term || "").trim();
        if (term && !merged.some((g) => g.term === term)) merged.push({ term, note: String(it?.note || "").trim() });
      }
      setGlossaryState(await api.setGlossary(merged));
    } catch { alert(t("settings.glossaryImportFail")); }
  };

  const pickLocalModel = async (id: string) => {
    await api.selectSttModel("local", id);
    setSttModels(await api.getSttModels());
    setSttModel(await api.getSttModel());
    setSttStreaming(await api.getSttStreaming());
  };
  const pickCloudModel = async (id: string) => {
    await api.selectSttModel("cloud", id);
    setSttModels(await api.getSttModels());
  };

  const refreshSttState = async () => {
    setSttModels(await api.getSttModels());
    setSttModel(await api.getSttModel());
    setSttStreaming(await api.getSttStreaming());
    if (onStatus) onStatus(await api.getStatus());   // tts 설치 반영
  };
  const doInstall = async (target: string) => {
    setEngineInstall(await api.installEngine(target));
  };
  // 설치 중이면 진행 폴링 → 완료 시 상태 새로고침.
  useEffect(() => {
    if (!open || engineInstall.state !== "installing") return;
    const id = setInterval(async () => {
      try {
        const s = await api.getEngineInstall();
        setEngineInstall(s);
        if (s.state === "done" || s.state === "error") { clearInterval(id); if (s.state === "done") refreshSttState(); }
      } catch { /* 일시 네트워크 오류 — 다음 폴링에서 재시도 */ }
    }, 2500);
    return () => clearInterval(id);
  }, [open, engineInstall.state]);

  // 모델 다운로드 중이면 진행률 폴링.
  useEffect(() => {
    if (!open || sttModel?.state !== "downloading") return;
    const id = setInterval(() => api.getSttModel().then(setSttModel).catch(() => {}), 1500);
    return () => clearInterval(id);
  }, [open, sttModel?.state]);

  const saveStorage = async () => {
    const r = await api.setStorage(storagePath.trim());
    if (r.ok) { setStorage(await api.getStorage()); }
    else alert(r.message || r.error || "저장 위치를 바꿀 수 없어요.");
  };
  const downloadModel = async () => { setSttModel(await api.downloadSttModel()); };
  const gb = (n: number) => `${(n / 1e9).toFixed(1)}GB`;

  const connect = async (name: string, url = "") => {
    setBusy(name);
    const r = await api.connectConnector(name, url);
    setBusy(null);
    loadConnectors();
    if (!r.ok) alert(r.error || r.message || t("settings.connFail"));
  };
  const disconnect = async (name: string) => {
    setBusy(name);
    await api.removeConnector(name);
    setBusy(null);
    // 끊은 커넥터의 지형 인덱스 캐시도 함께 비워 stale 표시를 막는다.
    setConnIndex((m) => { const n = { ...m }; delete n[name]; return n; });
    loadConnectors();
  };
  const addCustom = async () => {
    const n = customName.trim(), u = customUrl.trim();
    if (!n || !u) return;
    await connect(n, u);
    setCustomName(""); setCustomUrl("");
  };

  // Codex 도구 라벨 → 아이콘 키
  const toolKey = (label: string): string => {
    const l = label.toLowerCase();
    if (l.startsWith("커넥터:")) return label.split(":")[1]?.trim() || "";
    if (l.includes("web_search")) return "web_search";
    if (l.includes("image_gen")) return "image_gen";
    if (l.includes("node_repl") || l.includes("code")) return "node_repl";
    return "";
  };

  if (!open) return null;

  const saveKey = async () => {
    if (!apiKey.trim()) return;
    const ok = await api.setApiKey(apiKey.trim());
    setKeySaved(ok);
    if (ok) setApiKeyVal("");
  };

  return (
    <div
      className={page
        ? "fixed inset-0 z-50 flex flex-col bg-canvas"
        : "fixed inset-0 z-50 flex items-start justify-center bg-ink/20 backdrop-blur-sm"}
      onClick={page ? undefined : onClose}
    >
      {/* 관리자: 좌측 고정 사이드바 네비게이션 (접기 가능) */}
      {page && (
        <aside className={cn("fixed inset-y-0 left-0 z-[51] flex flex-col border-r border-hairline bg-surface-soft/50 transition-[width]", navCollapsed ? "w-[60px]" : "w-[224px]")}>
          <div className="flex items-center gap-2 px-2 py-3.5 text-[13px] font-semibold tracking-tight text-foreground" style={{ paddingLeft: isMac ? 84 : undefined }}>
            <button onClick={onClose} className="grid size-7 shrink-0 place-items-center rounded-lg text-stone hover:bg-surface hover:text-foreground" title={t("admin.back")}><ChevronLeft className="size-4" /></button>
            {!navCollapsed && <span className="flex-1 truncate">{t("admin.title")}</span>}
            <button onClick={() => setNavCollapsed((v) => !v)} className="grid size-7 shrink-0 place-items-center rounded-lg text-stone hover:bg-surface hover:text-foreground" title={navCollapsed ? "펼치기" : "접기"}>
              {navCollapsed ? <ChevronRight className="size-4" /> : <PanelLeftClose className="size-4" />}
            </button>
          </div>
          <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-1">
            {NAV.map((n) => (
              <button key={n.id} onClick={() => setNav(n.id)} title={n.label}
                className={cn("flex w-full items-center gap-2.5 rounded-lg py-2 text-left text-[12.5px] font-medium transition-colors",
                  navCollapsed ? "justify-center px-0" : "px-2.5",
                  nav === n.id ? "bg-ink text-canvas" : "text-steel hover:bg-surface hover:text-foreground")}>
                {n.icon}{!navCollapsed && n.label}
              </button>
            ))}
          </nav>
          {onReplayGuide && !navCollapsed && (
            <button onClick={onReplayGuide} className="m-2 inline-flex items-center justify-center gap-1.5 rounded-lg border border-hairline px-2.5 py-2 text-[12px] text-steel hover:bg-surface hover:text-foreground">
              <Compass className="size-3.5" /> {t("settings.replayGuide")}
            </button>
          )}
        </aside>
      )}
      <div
        className={page
          ? cn("w-full flex-1 overflow-y-auto py-5 pr-7 transition-[padding]", navCollapsed ? "pl-[84px]" : "pl-[248px]")
          : "mt-16 max-h-[80vh] w-[560px] overflow-y-auto rounded-2xl border border-hairline bg-canvas p-5 shadow-2xl"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={cn("mb-4 flex items-center justify-between", page && "hidden")}>
          <div className="flex items-center gap-2">
            {page && (
              <button onClick={onClose} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-hairline px-2.5 text-[12px] text-steel hover:bg-surface hover:text-foreground">
                <ChevronLeft className="size-4" /> {t("admin.back")}
              </button>
            )}
            <h2 className="text-[15px] font-semibold tracking-tight">{page ? t("admin.title") : t("settings.title")}</h2>
          </div>
          <div className="flex items-center gap-1">
            {onReplayGuide && (
              <button onClick={onReplayGuide} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-hairline px-2.5 text-[12px] text-steel hover:bg-surface hover:text-foreground">
                <Compass className="size-3.5" /> {t("settings.replayGuide")}
              </button>
            )}
            {!page && <button onClick={onClose} className="text-stone hover:text-foreground"><X className="size-4.5" /></button>}
          </div>
        </div>

        <Grp id="usage">
        {/* 파이프라인 플로우 — STT → Agent → TTS(선택) */}
        {(() => {
          const isCloud = status?.stt_provider === "elevenlabs";
          const sttM = sttModels?.local.find((x) => x.id === sttModels.local_active);
          const cloudM = sttModels?.cloud.find((x) => x.id === sttModels.cloud_active);
          const sttName = isCloud
            ? (cloudM?.label?.split(" · ")[0] || "ElevenLabs Scribe")
            : (sttM?.label?.split(" · ")[0] || (sttModels?.local_active || "").split("/").pop() || "STT");
          const sttReady = isCloud ? !!status?.elevenlabs_key : (sttModel?.present && (sttM?.engine_ready !== false));
          const Stage = ({ icon, label, value, ok, accent }: { icon: React.ReactNode; label: string; value: string; ok?: boolean | null; accent?: boolean }) => (
            <div className={cn("flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-3 py-2.5", accent ? "border-spark-soft bg-spark-soft/30" : "border-hairline bg-surface-soft")}>
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-canvas text-steel">{icon}</span>
              <div className="min-w-0">
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-stone">{label}
                  {ok === true && <span className="size-1.5 rounded-full bg-spark" />}
                  {ok === false && <span className="size-1.5 rounded-full bg-[#e0a23a]" />}
                </div>
                <div className="truncate text-[12px] font-medium text-charcoal">{value}</div>
              </div>
            </div>
          );
          return (
            <div className="mb-4 flex items-stretch gap-1">
              <Stage icon={<AudioLines className="size-4" />} label="STT" value={sttModels ? sttName : "…"} ok={sttModels ? !!sttReady : null}
                accent />
              <div className="flex shrink-0 items-center text-stone"><ChevronRight className="size-4" /></div>
              <Stage icon={status?.backend ? <BrandIcon name={status.backend} size={16} /> : <Code className="size-4" />} label="Agent"
                value={status?.backend_label || "…"} ok={status ? (status.backend !== "codex" || status.codex_logged_in) : null} />
              <div className="flex shrink-0 items-center text-stone"><ChevronRight className="size-4" /></div>
              <Stage icon={<Volume2 className="size-4" />} label={t("settings.pipeTtsOptional")}
                value={status?.tts?.name || "Supertonic"} ok={status?.tts ? status.tts.available : null} />
            </div>
          );
        })()}

        {/* 관리자 전용: 사용량·비용 대시보드 */}
        {page && <UsageDashboard t={t} />}
        </Grp>
        <Grp id="appearance">
        {page && <FontSettings t={t} />}

        {/* 언어 */}
        <Section icon={<Languages className="size-4 text-steel" />} title={t("settings.language")}>
          <div className="flex items-center gap-1.5">
            {LANGS.map((l) => (
              <button key={l.id} onClick={() => setLang(l.id)}
                className={`h-8 flex-1 rounded-lg border text-[12.5px] font-medium transition-colors ${lang === l.id ? "border-ink bg-ink text-canvas" : "border-hairline text-steel hover:text-foreground"}`}>
                {l.label}
              </button>
            ))}
          </div>
        </Section>

        </Grp>
        <Grp id="agent">
        {/* Codex auth */}
        <Section icon={<BrandIcon name="codex" size={16} />} title={t("settings.codexTitle")}>
          <div className="mb-2 flex items-center gap-2">
            <BrandIcon name="codex" size={18} />
            <span className="text-stone">×</span>
            <BrandIcon name="openai" size={18} />
            <span className="text-[12px] text-stone">ChatGPT</span>
            {status?.codex_logged_in
              ? <span className="ml-auto inline-flex items-center gap-1 text-[12px] text-spark-deep"><ShieldCheck className="size-3.5" /> {t("settings.connected")}</span>
              : <span className="ml-auto inline-flex items-center gap-1 text-[12px] text-[#9a6a00]"><ShieldAlert className="size-3.5" /> {t("header.loginNeeded")}</span>}
          </div>
          <div className="text-[12.5px] text-slate">
            {status?.codex_logged_in
              ? t("settings.codexConnected")
              : t("settings.codexLogin")}
          </div>
          {/* 모델 / 추론 강도 */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[11px] text-stone">
              {t("settings.model")}
              <select
                value={status?.codex_model ?? ""}
                onChange={async (e) => { const s = await api.setCodex(e.target.value || null, status?.reasoning_effort); onStatus?.(s); }}
                className="h-8 rounded-lg border border-hairline bg-surface-soft px-2 text-[12.5px] text-charcoal outline-none focus:border-ink/40"
              >
                <option value="">{t("settings.modelDefault")}</option>
                {(status?.codex_models ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-stone">
              {t("settings.effort")}
              <select
                value={status?.reasoning_effort ?? "low"}
                onChange={async (e) => { const s = await api.setCodex(status?.codex_model ?? null, e.target.value); onStatus?.(s); }}
                className="h-8 rounded-lg border border-hairline bg-surface-soft px-2 text-[12.5px] text-charcoal outline-none focus:border-ink/40"
              >
                {(status?.reasoning_efforts ?? ["low", "medium", "high"]).map((x) => <option key={x} value={x}>{x === "low" ? t("settings.effortLow") : x === "medium" ? t("settings.effortMed") : t("settings.effortHigh")}</option>)}
              </select>
            </label>
          </div>
        </Section>

        {/* API key */}
        <Section icon={<KeyRound className="size-4 text-steel" />} title={t("settings.apiKeyTitle")}>
          <div className="flex items-center gap-2">
            <input
              type="password" value={apiKey} onChange={(e) => setApiKeyVal(e.target.value)}
              placeholder={status?.openai_key ? "설정됨 (••••)" : "sk-..."}
              className="h-9 flex-1 rounded-lg border border-hairline bg-surface-soft px-3 text-[13px] outline-none focus:border-ink/40"
            />
            <button onClick={saveKey} className="h-9 rounded-lg bg-ink px-3.5 text-[13px] font-medium text-canvas">{t("settings.save")}</button>
          </div>
          {keySaved && <div className="mt-1.5 flex items-center gap-1 text-[12px] text-spark-deep"><Check className="size-3.5" /> {t("settings.saved")}</div>}
        </Section>

        </Grp>
        <Grp id="stt">
        {/* STT (음성 인식) */}
        <Section icon={<AudioLines className="size-4 text-steel" />} title={t("settings.sttTitle")}>
          <div className="flex items-center gap-1.5">
            {[{ id: "local", label: t("settings.sttLocal") }, { id: "elevenlabs", label: t("settings.sttCloud") }].map((p) => (
              <button key={p.id}
                onClick={async () => { const s = await api.setSttProvider(p.id); onStatus?.(s); }}
                className={`h-8 flex-1 rounded-lg border text-[12px] font-medium transition-colors ${status?.stt_provider === p.id ? "border-ink bg-ink text-canvas" : "border-hairline text-steel hover:text-foreground"}`}>
                {p.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-stone">
            {status?.stt_provider === "elevenlabs" ? t("settings.sttCloudDesc") : t("settings.sttLocalDesc")}
          </p>

          {/* 모델 목록 로드 실패(백엔드 미연결/구버전) → 빈 화면 대신 안내 */}
          {status?.stt_provider !== "elevenlabs" && !sttModels && (
            <p className="mt-2.5 text-[11.5px] text-[#b06a00]">{t("settings.sttModelsFail")}</p>
          )}
          {/* 로컬 모델 선택 (영어권 포함 여러 HF 모델 + 커스텀) */}
          {status?.stt_provider !== "elevenlabs" && sttModels && (
            <div className="mt-2.5">
              <div className="mb-1 text-[11px] text-stone">{t("settings.sttModel")}</div>
              <select value={sttModels.local.some((m) => m.id === sttModels.local_active) ? sttModels.local_active : "__custom__"}
                onChange={(e) => { if (e.target.value !== "__custom__") pickLocalModel(e.target.value); }}
                className="h-9 w-full rounded-lg border border-hairline bg-surface-soft px-2 text-[12.5px] text-charcoal outline-none focus:border-ink/40">
                {sttModels.local.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                <option value="__custom__">{t("settings.sttCustom")}</option>
              </select>
              <div className="mt-2 flex items-center gap-2">
                <input value={customModel} onChange={(e) => setCustomModel(e.target.value)}
                  placeholder="huggingface repo (예: mlx-community/...)"
                  className="h-9 min-w-0 flex-1 rounded-lg border border-hairline bg-surface-soft px-2.5 text-[12px] text-charcoal outline-none focus:border-ink/40" />
                <button onClick={() => customModel.trim() && pickLocalModel(customModel.trim())} disabled={!customModel.trim()}
                  className="h-9 shrink-0 rounded-lg border border-hairline px-3 text-[12.5px] text-steel hover:text-foreground disabled:opacity-40">{t("settings.sttUseCustom")}</button>
              </div>
              {/* 선택된 모델의 엔진·능력 배지 + 미설치 안내 */}
              {(() => {
                const m = sttModels.local.find((x) => x.id === sttModels.local_active);
                if (!m?.engine) return null;
                return (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-surface px-2 py-0.5 text-[10.5px] text-steel">{m.engine}</span>
                    {m.streaming && <span className="rounded-full bg-spark-soft px-2 py-0.5 text-[10.5px] text-spark-deep">⚡ {t("settings.sttStreaming")}</span>}
                    {m.diarization && <span className="rounded-full bg-spark-soft px-2 py-0.5 text-[10.5px] text-spark-deep">👥 {t("settings.sttDiarization")}</span>}
                    {/* 엔진 미설치 → 앱에서 바로 설치 (터미널 불필요) */}
                    {m.engine_ready === false && (
                      <span className="flex w-full items-center gap-1.5 text-[11px] text-[#b06a00]">
                        {t("settings.sttNeedInstall")}
                        <InstallBtn target={m.engine === "mlx" ? "local" : (m.engine || "local")} state={engineInstall} onInstall={doInstall} t={t} />
                      </span>
                    )}
                    {/* 스트리밍 모델: 활성 여부 + 비활성 시 앱에서 설치 */}
                    {m.streaming && m.engine_ready !== false && (
                      sttStreaming?.available
                        ? <span className="w-full text-[11px] text-spark-deep">⚡ {t("settings.streamActive")}</span>
                        : <span className="flex w-full items-center gap-1.5 text-[11px] text-[#b06a00]">
                            {t("settings.streamInactive2b")}
                            <InstallBtn target="local" state={engineInstall} onInstall={doInstall} t={t} />
                          </span>
                    )}
                  </div>
                );
              })()}
              {/* 선택한 모델 미다운로드 또는 다운로드 중 → 다운로드 UI (진행률은 state 기준으로 표시) */}
              {sttModel && (sttModels?.local.find((x) => x.id === sttModels.local_active)?.engine_ready !== false)
                && (sttModel.state === "downloading" || !sttModel.present) && (
                <div className="mt-2">
                  {sttModel.state === "downloading" ? (
                    <div>
                      <div className="h-2 overflow-hidden rounded-full bg-surface"><div className="h-full rounded-full bg-spark transition-all" style={{ width: `${sttModel.percent}%` }} /></div>
                      <div className="mt-1 text-[11px] text-stone">{t("settings.modelDownloading")} {gb(sttModel.downloaded)} / {gb(sttModel.total)} ({sttModel.percent}%)</div>
                    </div>
                  ) : (
                    <button onClick={downloadModel} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-[12px] font-medium text-canvas">
                      <Download className="size-3.5" /> {t("settings.modelDownload")} (~{gb(sttModel.total)})
                    </button>
                  )}
                </div>
              )}
              <p className="mt-1.5 text-[11px] leading-relaxed text-stone">{t("settings.sttModelDesc")}</p>
            </div>
          )}

          {status?.stt_provider === "elevenlabs" && (
            <div className="mt-2.5">
              {sttModels && (
                <div className="mb-2.5">
                  <div className="mb-1 text-[11px] text-stone">{t("settings.sttModel")}</div>
                  <select value={sttModels.cloud_active} onChange={(e) => pickCloudModel(e.target.value)}
                    className="h-9 w-full rounded-lg border border-hairline bg-surface-soft px-2 text-[12.5px] text-charcoal outline-none focus:border-ink/40">
                    {sttModels.cloud.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
              )}
              <div className="mb-1 text-[11px] text-stone">{t("settings.elevenKey")}</div>
              <div className="flex items-center gap-2">
                <input type="password" value={elevenKey} onChange={(e) => setElevenKeyVal(e.target.value)}
                  placeholder={status?.elevenlabs_key ? "설정됨 (••••)" : "sk_..."}
                  className="h-9 flex-1 rounded-lg border border-hairline bg-surface-soft px-3 text-[13px] outline-none focus:border-ink/40" />
                <button onClick={async () => { const s = await api.setElevenKey(elevenKey.trim()); setElevenKeyVal(""); onStatus?.(s); }}
                  className="h-9 rounded-lg bg-ink px-3.5 text-[13px] font-medium text-canvas">{t("settings.save")}</button>
              </div>
              {status?.elevenlabs_key && <div className="mt-1.5 flex items-center gap-1 text-[12px] text-spark-deep"><Check className="size-3.5" /> {t("settings.elevenKeySet")}</div>}
              <p className="mt-1.5 text-[11px] leading-relaxed text-stone">{t("settings.elevenKeyHint")}</p>
            </div>
          )}
        </Section>

        </Grp>
        <Grp id="tts">
        {/* TTS (음성 응답) — 설치형, 목록만 제공 */}
        <Section icon={<Volume2 className="size-4 text-steel" />} title={t("settings.ttsTitle")}>
          <div className="flex items-center gap-2 text-[12.5px]">
            <span className="font-medium text-charcoal">{status?.tts?.name || "Supertonic 3"}</span>
            {status?.tts?.available
              ? <span className="inline-flex items-center gap-1 text-spark-deep"><Check className="size-3.5" /> {t("settings.ttsReady")}</span>
              : <span className="text-stone">— {t("settings.ttsOff")}</span>}
            <span className="ml-auto text-[11px] text-stone">{(status?.tts?.voices || []).length} {t("settings.ttsVoices")}</span>
          </div>
          {status?.tts && !status.tts.available && (
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[#b06a00]">{t("settings.ttsNeedInstall")}
              <InstallBtn target="tts" state={engineInstall} onInstall={doInstall} t={t} />
            </div>
          )}
          <p className="mt-1.5 text-[11px] leading-relaxed text-stone">{t("settings.ttsDesc")}</p>
        </Section>

        </Grp>
        <Grp id="connectors">
        {/* MCP connectors */}
        <Section icon={<BrandIcon name="codex" size={16} />} title={`${t("settings.connectorsTitle")} (${connectors.length})`}>
          {connectors.length === 0 ? (
            <div className="text-[12.5px] text-stone">{t("settings.connectorsEmpty")}</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {connectors.map((c) => (
                <span key={c.name} className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-2.5 py-1 text-[12px] text-slate">
                  {hasEntityIcon(c.name) ? <EntityIcon name={c.name} size={15} /> : <span className={`size-1.5 rounded-full ${c.status === "enabled" ? "bg-spark" : "bg-stone"}`} />}
                  {c.name}
                </span>
              ))}
            </div>
          )}
        </Section>

        {/* 커넥터 연결 (exec에 도구 노출) */}
        <Section icon={<Link2 className="size-4 text-steel" />} title={t("settings.connectTitle")}>
          <p className="mb-2.5 text-[11.5px] leading-relaxed text-stone">
            {t("settings.connectDesc")}
          </p>
          <div className="space-y-1.5">
            {registry.map((c) => (
              <div key={c.name} className="flex items-center gap-2.5 rounded-lg border border-hairline px-3 py-2">
                {hasBrand(c.name)
                  ? <span className="grid size-5 shrink-0 place-items-center"><BrandIcon name={c.name} size={20} /></span>
                  : <span className={`size-1.5 shrink-0 rounded-full ${c.connected ? "bg-spark" : "bg-stone"}`} />}
                <span className="flex-1 truncate text-[12.5px] font-medium text-charcoal">{c.label}</span>
                {c.connected && (
                  indexing === c.name
                    ? <span className="inline-flex items-center gap-1 text-[11px] text-stone"><Loader2 className="size-3.5 animate-spin" /> {t("settings.indexing")}</span>
                    : <button onClick={() => doIndex(c.name)} title={connIndex[c.name] ? `${t("settings.indexed")} · ${connIndex[c.name].indexed_at?.slice(0, 10)}` : t("settings.indexHint")}
                        className={cn("rounded-md border border-hairline px-2 py-1 text-[11px]", connIndex[c.name] ? "text-spark-deep" : "text-steel hover:text-foreground")}>
                        {connIndex[c.name] ? `✓ ${t("settings.indexBtn")}` : t("settings.indexBtn")}
                      </button>
                )}
                {busy === c.name ? (
                  <Loader2 className="size-4 animate-spin text-stone" />
                ) : c.connected ? (
                  <button onClick={() => disconnect(c.name)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-spark-deep hover:text-foreground"><Check className="size-3.5" /> {t("settings.connected")}</button>
                ) : (
                  <button onClick={() => connect(c.name)} className="rounded-md bg-ink px-2.5 py-1 text-[11.5px] font-medium text-canvas">{t("settings.connect")}</button>
                )}
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder={t("settings.customName")}
              className="h-8 w-20 rounded-lg border border-hairline bg-surface-soft px-2 text-[12px] outline-none focus:border-ink/40" />
            <input value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} placeholder="원격 MCP URL (https://…/mcp)"
              className="h-8 flex-1 rounded-lg border border-hairline bg-surface-soft px-2.5 text-[12px] outline-none focus:border-ink/40" />
            <button onClick={addCustom} disabled={!customName.trim() || !customUrl.trim() || busy !== null} className="grid size-8 place-items-center rounded-lg bg-ink text-canvas disabled:opacity-40"><Plus className="size-4" /></button>
          </div>
          <p className="mt-1.5 text-[11px] text-stone">{t("settings.connectHint")}</p>
        </Section>

        </Grp>
        <Grp id="agent">
        {/* Codex tools */}
        <Section icon={<BrandIcon name="codex" size={16} />} title={t("settings.toolsTitle")}>
          <div className="space-y-2">
            {tools.map((t) => {
              const key = toolKey(t.name);
              return (
                <div key={t.name} className="flex items-center gap-2 text-[12.5px]">
                  {hasEntityIcon(key)
                    ? <span className="grid size-4 shrink-0 place-items-center"><EntityIcon name={key} size={15} /></span>
                    : <span className={`size-1.5 shrink-0 rounded-full ${t.on ? "bg-spark" : "bg-stone"}`} />}
                  <span className="font-medium text-charcoal">{t.name}</span>
                  <span className="truncate text-stone">— {t.desc}</span>
                </div>
              );
            })}
          </div>
        </Section>

        </Grp>
        <Grp id="proactive">
        {/* 능동성 — 다이제스트 주기 · 실시간 개입 민감도 · 자동 조사 */}
        <Section icon={<AudioLines className="size-4 text-steel" />} title={t("settings.proactiveTitle")}>
          <div className="mb-1 text-[11px] text-stone">{t("settings.digestEvery")}</div>
          <select value={digestMin} onChange={(e) => setDigestMin(Number(e.target.value))}
            className="mb-3 h-9 w-full rounded-lg border border-hairline bg-surface-soft px-2 text-[13px] text-charcoal outline-none focus:border-ink/40">
            {[0, 3, 5, 10, 15].map((m) => <option key={m} value={m}>{m === 0 ? t("settings.digestOff") : t("settings.minutes", { n: String(m) })}</option>)}
          </select>
          <div className="mb-1 text-[11px] text-stone">{t("settings.liveSens")}</div>
          <div className="mb-3 flex items-center rounded-full border border-hairline bg-surface-soft p-0.5">
            {(["off", "conservative", "eager"] as const).map((s) => (
              <button key={s} onClick={() => setLiveSens(s)}
                className={`h-7 flex-1 rounded-full text-[12px] font-medium transition-colors ${liveSens === s ? "bg-ink text-canvas" : "text-steel hover:text-foreground"}`}>
                {t(`settings.sens.${s}`)}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[12.5px] text-charcoal">
            <input type="checkbox" checked={autoResearch} onChange={(e) => setAutoResearch(e.target.checked)} className="size-3.5 accent-[var(--spark,#5e6ad2)]" />
            {t("settings.autoResearch")}
          </label>
          <p className="mt-1.5 text-[11px] leading-relaxed text-stone">{t("settings.autoResearchDesc")}</p>
        </Section>

        </Grp>
        <Grp id="storage">
        {/* 저장 위치 + 로컬 모델 */}
        <Section icon={<History className="size-4 text-steel" />} title={t("settings.storageTitle")}>
          <div className="mb-1 text-[11px] text-stone">{t("settings.storagePath")}</div>
          <div className="flex items-center gap-2">
            <input value={storagePath} onChange={(e) => setStoragePath(e.target.value)}
              disabled={!!storage?.env_locked}
              placeholder="~/Ghost"
              className="h-9 min-w-0 flex-1 rounded-lg border border-hairline bg-surface-soft px-2.5 text-[12.5px] text-charcoal outline-none focus:border-ink/40 disabled:opacity-50" />
            <button onClick={saveStorage} disabled={!!storage?.env_locked || !storagePath.trim() || storagePath.trim() === storage?.home}
              className="h-9 shrink-0 rounded-lg bg-ink px-3.5 text-[13px] font-medium text-canvas disabled:opacity-40">{t("settings.save")}</button>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-stone">
            {storage?.env_locked ? t("settings.storageEnvLocked") : t("settings.storageDesc")}
          </p>

          {/* 로컬 ASR 모델(완전 로컬 에디션 첫 실행) */}
          {sttModel && (
            <div className="mt-3 border-t border-hairline pt-3">
              <div className="mb-1 text-[11px] text-stone">{t("settings.localModel")}</div>
              {sttModel.state === "downloading" ? (
                <div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface">
                    <div className="h-full rounded-full bg-spark transition-all" style={{ width: `${sttModel.percent}%` }} />
                  </div>
                  <div className="mt-1 text-[11px] text-stone">{t("settings.modelDownloading")} {gb(sttModel.downloaded)} / {gb(sttModel.total)} ({sttModel.percent}%)</div>
                </div>
              ) : sttModel.present ? (
                <div className="flex items-center gap-1.5 text-[12.5px] text-spark-deep"><Check className="size-3.5" /> {t("settings.modelReady")}</div>
              ) : (
                <div>
                  <button onClick={downloadModel} className="h-9 rounded-lg bg-ink px-3.5 text-[13px] font-medium text-canvas">
                    {t("settings.modelDownload")} (~{gb(sttModel.total)})
                  </button>
                  {sttModel.state === "error" && <div className="mt-1 text-[11px] text-[#b04141]">{sttModel.error}</div>}
                  <p className="mt-1.5 text-[11px] leading-relaxed text-stone">{t("settings.modelDesc")}</p>
                </div>
              )}
            </div>
          )}
        </Section>

        {/* 용어집 (Word Memory) — 모든 회의에 자동 주입 */}
        <Section icon={<KeyRound className="size-4 text-steel" />} title={t("settings.glossaryTitle")}>
          <p className="mb-2 text-[11px] leading-relaxed text-stone">{t("settings.glossaryDesc")}</p>
          {glossary.length > 0 && (
            <div className="mb-2 space-y-1">
              {glossary.map((g, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-hairline px-2.5 py-1.5 text-[12.5px]">
                  <span className="font-medium text-charcoal">{g.term}</span>
                  {g.note && <span className="truncate text-stone">— {g.note}</span>}
                  <button onClick={() => removeTerm(i)} className="ml-auto text-stone hover:text-[#b04141]"><X className="size-3.5" /></button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input value={gTerm} onChange={(e) => setGTerm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTerm()}
              placeholder={t("settings.glossaryTerm")}
              className="h-9 w-2/5 min-w-0 rounded-lg border border-hairline bg-surface-soft px-2.5 text-[12.5px] outline-none focus:border-ink/40" />
            <input value={gNote} onChange={(e) => setGNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTerm()}
              placeholder={t("settings.glossaryNote")}
              className="h-9 min-w-0 flex-1 rounded-lg border border-hairline bg-surface-soft px-2.5 text-[12.5px] outline-none focus:border-ink/40" />
            <button onClick={addTerm} disabled={!gTerm.trim()} className="h-9 shrink-0 rounded-lg bg-ink px-3 text-[12.5px] font-medium text-canvas disabled:opacity-40"><Plus className="size-3.5" /></button>
          </div>
          {/* 내보내기/가져오기 — 팀 온보딩(용어집 공유)·기기 이전 */}
          <div className="mt-2 flex items-center gap-2">
            <button onClick={exportGlossary} disabled={!glossary.length}
              className="h-7 rounded-lg border border-hairline px-2.5 text-[11.5px] text-steel hover:text-foreground disabled:opacity-40">{t("settings.glossaryExport")}</button>
            <label className="h-7 cursor-pointer rounded-lg border border-hairline px-2.5 text-[11.5px] leading-7 text-steel hover:text-foreground">
              {t("settings.glossaryImport")}
              <input type="file" accept="application/json,.json" className="hidden"
                onChange={(e) => { importGlossary(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
          </div>
        </Section>

        </Grp>
        <Grp id="meetings">
        {/* Meeting history */}
        <Section icon={<History className="size-4 text-steel" />} title={`${t("settings.meetingsTitle")} (${meetings.length})`}>
          {meetings.length === 0 ? (
            <div className="text-[12.5px] text-stone">{t("settings.meetingsEmpty")}</div>
          ) : (
            <div className="space-y-3">
              {meetings.length > 4 && (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-stone" />
                  <input value={mq} onChange={(e) => setMq(e.target.value)} placeholder={t("admin.searchMeetings")}
                    className="h-8 w-full rounded-lg border border-hairline bg-surface-soft pl-8 pr-2.5 text-[12.5px] text-charcoal outline-none placeholder:text-stone focus:border-ink/40" />
                </div>
              )}
              {(() => {
                const fmtDur = (s?: number | null) => (s == null ? "" : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`);
                const q = mq.trim().toLowerCase();
                const filtered = q ? meetings.filter((m) => (m.title || "").toLowerCase().includes(q) || (m.folder || "").toLowerCase().includes(q)) : meetings;
                const groups: Record<string, api.MeetingMeta[]> = {};
                for (const m of filtered) (groups[m.folder || ""] ||= []).push(m);
                const folders = Object.keys(groups).sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
                const openMeeting = async (m: api.MeetingMeta) => {
                  const full = await api.getMeeting(m.id);
                  const spec = full?.minutes || { title: m.title, spoken: "", intent: "note",
                    blocks: [{ type: "text", text: full?.summary || t("settings.meetingNoMinutes") }] };
                  onOpenMeeting(m.title, spec as Spec); onClose();
                };
                // 회의 영구 삭제 — 프라이버시 기본 권리(확인 다이얼로그 1회).
                const removeMeeting = async (m: api.MeetingMeta) => {
                  if (!window.confirm(t("settings.deleteConfirm", { title: m.title }))) return;
                  const ok = await api.deleteMeeting(m.id);
                  if (ok) setMeetings((arr) => arr.filter((x) => x.id !== m.id));
                  else alert(t("settings.deleteFail"));
                };
                return folders.map((f) => (
                  <div key={f || "__none__"} className="space-y-1">
                    <div className="px-1 text-[11px] font-medium text-stone">{f || t("settings.folderNone")}</div>
                    {groups[f].map((m) => (
                      <div key={m.id} className="group flex w-full items-center gap-2 rounded-lg border border-hairline px-3 py-2 text-[13px] hover:bg-surface-soft">
                        <button onClick={() => openMeeting(m)} className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left">
                          <span className="truncate">{m.title}</span>
                          <span className="shrink-0 text-[11px] text-stone">{fmtDur(m.duration_sec) && `${fmtDur(m.duration_sec)} · `}{m.has_minutes ? t("settings.open") : `${m.utterance_count ?? 0}`}</span>
                        </button>
                        <button onClick={() => removeMeeting(m)} title={t("settings.deleteMeeting")}
                          className="shrink-0 text-stone opacity-0 transition-opacity hover:text-[#b04141] group-hover:opacity-100">
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ));
              })()}
            </div>
          )}
        </Section>

        </Grp>
        {/* 정보 */}
        <div className="flex items-center justify-between px-1 pt-1 text-[11.5px] text-stone">
          <span>Ghost v{APP_VERSION} · {t("settings.oss")}</span>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
            <Code className="size-3" /> GitHub
          </a>
        </div>
      </div>
    </div>
  );
}

/** 앱에서 바로 옵셔널 엔진 설치(터미널 불필요). 전역 1개씩 — 설치 중이면 진행 표시. */
function InstallBtn({ target, state, onInstall, t }: { target: string; state: api.EngineInstall; onInstall: (target: string) => void; t: (k: string) => string }) {
  const installingThis = state.state === "installing" && state.target === target;
  const anyInstalling = state.state === "installing";
  if (installingThis) return <span className="inline-flex items-center gap-1 text-spark-deep"><Loader2 className="size-3 animate-spin" /> {t("settings.installing")}</span>;
  return (
    <button onClick={() => onInstall(target)} disabled={anyInstalling}
      className="inline-flex items-center gap-1 rounded-md bg-ink px-2 py-0.5 text-[11px] font-medium text-canvas disabled:opacity-40">
      <Download className="size-3" /> {t("settings.installInApp")}
    </button>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded-xl border border-hairline p-3.5">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold tracking-tight">{icon}{title}</div>
      {children}
    </div>
  );
}
