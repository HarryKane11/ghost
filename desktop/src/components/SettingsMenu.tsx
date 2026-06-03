import { useEffect, useState } from "react";
import { X, ShieldCheck, ShieldAlert, KeyRound, History, Check, Compass, Code, Loader2, Plus, Link2, AudioLines, Volume2, ChevronRight, Download } from "lucide-react";
import * as api from "@/lib/api";
import type { Spec } from "@/components/GenUI";
import { BrandIcon, hasBrand, EntityIcon, hasEntityIcon } from "@/components/BrandIcon";
import { useT, LANGS } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { Languages } from "lucide-react";

// TODO: 실제 저장소 URL로 교체하세요.
const GITHUB_URL = "https://github.com/ghost-app/ghost";
const APP_VERSION =
  (typeof window !== "undefined" && (window as { ghost?: { version?: string } }).ghost?.version) || "0.1.0";

export function SettingsMenu({
  open, onClose, status, onOpenMeeting, onReplayGuide, onStatus,
  digestMin, setDigestMin, liveSens, setLiveSens, autoResearch, setAutoResearch,
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
}) {
  const { t, lang, setLang } = useT();
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
  const [customModel, setCustomModel] = useState("");
  const [glossary, setGlossaryState] = useState<api.GlossaryItem[]>([]);
  const [connIndex, setConnIndex] = useState<api.ConnectorIndex>({});
  const [indexing, setIndexing] = useState<string | null>(null);
  const [gTerm, setGTerm] = useState("");
  const [gNote, setGNote] = useState("");

  const loadConnectors = () => {
    api.getConnectors().then(setConnectors);
    api.getTools().then(setTools);
    api.getConnectorRegistry().then((r) => setRegistry(r.connectors));
    api.getConnectorIndex().then(setConnIndex);
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
    api.getGlossary().then(setGlossaryState);
    setKeySaved(false);
  }, [open]);

  const addTerm = async () => {
    const term = gTerm.trim();
    if (!term) return;
    const next = [...glossary, { term, note: gNote.trim() }];
    setGlossaryState(await api.setGlossary(next));
    setGTerm(""); setGNote("");
  };
  const removeTerm = async (i: number) => {
    setGlossaryState(await api.setGlossary(glossary.filter((_, idx) => idx !== i)));
  };

  const pickLocalModel = async (id: string) => {
    await api.selectSttModel("local", id);
    setSttModels(await api.getSttModels());
    setSttModel(await api.getSttModel());
  };
  const pickCloudModel = async (id: string) => {
    await api.selectSttModel("cloud", id);
    setSttModels(await api.getSttModels());
  };

  // 모델 다운로드 중이면 진행률 폴링.
  useEffect(() => {
    if (!open || sttModel?.state !== "downloading") return;
    const id = setInterval(() => api.getSttModel().then(setSttModel), 1500);
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
  const disconnect = async (name: string) => { setBusy(name); await api.removeConnector(name); setBusy(null); loadConnectors(); };
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
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/20 backdrop-blur-sm" onClick={onClose}>
      <div
        className="mt-16 max-h-[80vh] w-[560px] overflow-y-auto rounded-2xl border border-hairline bg-canvas p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold tracking-tight">{t("settings.title")}</h2>
          <div className="flex items-center gap-1">
            {onReplayGuide && (
              <button onClick={onReplayGuide} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-hairline px-2.5 text-[12px] text-steel hover:bg-surface hover:text-foreground">
                <Compass className="size-3.5" /> {t("settings.replayGuide")}
              </button>
            )}
            <button onClick={onClose} className="text-stone hover:text-foreground"><X className="size-4.5" /></button>
          </div>
        </div>

        {/* 파이프라인 플로우 — STT → Agent → TTS(선택) */}
        {(() => {
          const sttM = sttModels?.local.find((x) => x.id === sttModels.local_active);
          const sttName = sttM?.label?.split(" · ")[0] || (sttModels?.local_active || "").split("/").pop() || "STT";
          const sttReady = sttModel?.present && (sttM?.engine_ready !== false);
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
              <Stage icon={<Volume2 className="size-4" />} label={t("settings.pipeTtsOptional")} value="Supertonic" ok={null} />
            </div>
          );
        })()}

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
                    {m.engine_ready === false && m.install && (
                      <span className="w-full text-[11px] text-[#b06a00]">{t("settings.sttNeedInstall")} <code className="rounded bg-surface px-1 font-mono">{m.install}</code></span>
                    )}
                  </div>
                );
              })()}
              {/* 선택한 모델 미다운로드 → 바로 다운로드 */}
              {sttModel && !sttModel.present && (sttModels?.local.find((x) => x.id === sttModels.local_active)?.engine_ready !== false) && (
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
              {sttModel.present ? (
                <div className="flex items-center gap-1.5 text-[12.5px] text-spark-deep"><Check className="size-3.5" /> {t("settings.modelReady")}</div>
              ) : sttModel.state === "downloading" ? (
                <div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface">
                    <div className="h-full rounded-full bg-spark transition-all" style={{ width: `${sttModel.percent}%` }} />
                  </div>
                  <div className="mt-1 text-[11px] text-stone">{t("settings.modelDownloading")} {gb(sttModel.downloaded)} / {gb(sttModel.total)} ({sttModel.percent}%)</div>
                </div>
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
        </Section>

        {/* Meeting history */}
        <Section icon={<History className="size-4 text-steel" />} title={`${t("settings.meetingsTitle")} (${meetings.length})`}>
          {meetings.length === 0 ? (
            <div className="text-[12.5px] text-stone">{t("settings.meetingsEmpty")}</div>
          ) : (
            <div className="space-y-3">
              {(() => {
                const fmtDur = (s?: number | null) => (s == null ? "" : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`);
                const groups: Record<string, api.MeetingMeta[]> = {};
                for (const m of meetings) (groups[m.folder || ""] ||= []).push(m);
                const folders = Object.keys(groups).sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
                const openMeeting = async (m: api.MeetingMeta) => {
                  const full = await api.getMeeting(m.id);
                  const spec = full?.minutes || { title: m.title, spoken: "", intent: "note",
                    blocks: [{ type: "text", text: full?.summary || t("settings.meetingNoMinutes") }] };
                  onOpenMeeting(m.title, spec as Spec); onClose();
                };
                return folders.map((f) => (
                  <div key={f || "__none__"} className="space-y-1">
                    <div className="px-1 text-[11px] font-medium text-stone">{f || t("settings.folderNone")}</div>
                    {groups[f].map((m) => (
                      <button key={m.id} onClick={() => openMeeting(m)}
                        className="flex w-full items-center justify-between gap-2 rounded-lg border border-hairline px-3 py-2 text-left text-[13px] hover:bg-surface-soft">
                        <span className="truncate">{m.title}</span>
                        <span className="shrink-0 text-[11px] text-stone">{fmtDur(m.duration_sec) && `${fmtDur(m.duration_sec)} · `}{m.has_minutes ? t("settings.open") : `${m.utterance_count ?? 0}`}</span>
                      </button>
                    ))}
                  </div>
                ));
              })()}
            </div>
          )}
        </Section>

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

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded-xl border border-hairline p-3.5">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold tracking-tight">{icon}{title}</div>
      {children}
    </div>
  );
}
