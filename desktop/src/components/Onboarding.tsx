import { useCallback, useEffect, useState } from "react";
import {
  X, ArrowRight, ArrowLeft, Check, Copy, KeyRound, Terminal, Mic,
  MonitorSpeaker, ShieldCheck, Sparkles, AudioLines, FileText,
} from "lucide-react";
import { GhostLogo } from "@/components/GhostLogo";
import * as api from "@/lib/api";
import { useT } from "@/lib/i18n";

/**
 * 첫 진입 온보딩 + 브레인 연결 마법사.
 * 순수 OSS BYO 기준 — 계정/페이월 없이 사용자가 자기 키(OpenAI) 또는 Codex 구독으로 brain을 연결한다.
 * 단계: 환영 → 브레인 연결 → 권한 → 첫 회의 시작.
 */
export function Onboarding({
  open, status, onRefreshStatus, onSetBackend, onClose, onStart,
}: {
  open: boolean;
  status: api.Status | null;
  onRefreshStatus: () => void;
  onSetBackend: (b: string) => void;
  onClose: () => void;
  onStart: () => void;
}) {
  const { t } = useT();
  const [step, setStep] = useState(0);
  const [key, setKey] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [micOk, setMicOk] = useState(false);
  const [micErr, setMicErr] = useState<string | null>(null);

  // 열릴 때마다 첫 화면부터. (status는 부모가 폴링)
  useEffect(() => { if (open) { setStep(0); setMicErr(null); } }, [open]);

  const backend = status?.backend ?? "openai";
  const brainReady = backend === "codex" ? !!status?.codex_logged_in : !!status?.openai_key;

  const copyCmd = useCallback(async () => {
    try { await navigator.clipboard.writeText("codex login"); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* ignore */ }
  }, []);

  const saveKey = useCallback(async () => {
    if (!key.trim()) return;
    const ok = await api.setApiKey(key.trim());
    setKeySaved(ok);
    if (ok) { setKey(""); onRefreshStatus(); }
  }, [key, onRefreshStatus]);

  const grantMic = useCallback(async () => {
    setMicErr(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      setMicOk(true);
    } catch (e) {
      const n = (e as { name?: string })?.name || "";
      setMicErr(["NotAllowedError", "SecurityError", "PermissionDeniedError"].includes(n)
        ? t("ob.micErrDenied")
        : t("ob.micErrNotFound"));
    }
  }, [t]);

  if (!open) return null;

  const STEPS = [t("ob.stepWelcome"), t("ob.stepBrain"), t("ob.stepPerm"), t("ob.stepStart")];
  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/30 backdrop-blur-md">
      <div className="materialize relative flex max-h-[88vh] w-[600px] flex-col overflow-hidden rounded-3xl border border-hairline bg-canvas shadow-2xl">
        {/* 헤더: 진행 표시 + 건너뛰기 */}
        <div className="flex items-center gap-2 px-6 pt-5">
          <div className="flex flex-1 items-center gap-1.5">
            {STEPS.map((label, i) => (
              <div key={label} className="flex items-center gap-1.5">
                <span className={`grid size-5 place-items-center rounded-full text-[10px] font-semibold transition-colors ${i < step ? "bg-spark text-ink" : i === step ? "bg-ink text-canvas" : "bg-surface text-stone"}`}>
                  {i < step ? <Check className="size-3" /> : i + 1}
                </span>
                {i < STEPS.length - 1 && <span className={`h-px w-6 ${i < step ? "bg-spark" : "bg-hairline"}`} />}
              </div>
            ))}
          </div>
          <button onClick={onClose} className="text-stone hover:text-foreground" title={t("ob.skip")}><X className="size-4.5" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
          {step === 0 && (
            <div className="text-center">
              <GhostLogo variant="icon" size={52} className="mx-auto rounded-2xl" />
              <h1 className="mt-4 text-[22px] font-semibold tracking-tight">{t("ob.welcomeTitle")}</h1>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-steel">{t("ob.welcomeSub").split("\n").map((x, i) => <span key={i}>{i > 0 && <br />}{x}</span>)}</p>
              <div className="mt-6 grid gap-2.5 text-left">
                {[
                  { icon: <AudioLines className="size-4 text-spark-deep" />, t: t("ob.f1t"), d: t("ob.f1d") },
                  { icon: <Sparkles className="size-4 text-spark-deep" />, t: t("ob.f2t"), d: t("ob.f2d") },
                  { icon: <FileText className="size-4 text-spark-deep" />, t: t("ob.f3t"), d: t("ob.f3d") },
                ].map((f) => (
                  <div key={f.t} className="flex items-start gap-3 rounded-xl border border-hairline bg-surface-soft p-3.5">
                    <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-canvas">{f.icon}</span>
                    <div><p className="text-[13.5px] font-semibold tracking-tight">{f.t}</p><p className="text-[12.5px] leading-relaxed text-steel">{f.d}</p></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <h2 className="text-[18px] font-semibold tracking-tight">{t("ob.brainTitle")}</h2>
              <p className="mt-1 text-[13px] leading-relaxed text-steel">{t("ob.brainSub")}</p>

              <div className="mt-4 flex items-center rounded-full border border-hairline bg-surface-soft p-1 text-[13px] font-medium">
                {[{ id: "openai", label: t("ob.openaiTab") }, { id: "codex", label: t("ob.codexTab") }].map((b) => (
                  <button key={b.id} onClick={() => onSetBackend(b.id)}
                    className={`h-8 flex-1 rounded-full transition-colors ${backend === b.id ? "bg-ink text-canvas" : "text-steel hover:text-foreground"}`}>{b.label}</button>
                ))}
              </div>

              {backend === "openai" ? (
                <div className="mt-4 rounded-xl border border-hairline p-4">
                  <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><KeyRound className="size-4 text-steel" /> {t("ob.openaiTitle")}</div>
                  <div className="flex items-center gap-2">
                    <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={status?.openai_key ? "설정됨 (••••)" : "sk-..."}
                      className="h-9 flex-1 rounded-lg border border-hairline bg-surface-soft px-3 text-[13px] outline-none focus:border-ink/40" />
                    <button onClick={saveKey} className="h-9 rounded-lg bg-ink px-3.5 text-[13px] font-medium text-canvas">{t("settings.save")}</button>
                  </div>
                  <p className="mt-2 text-[11.5px] leading-relaxed text-stone">
                    {t("ob.openaiHint")}
                  </p>
                  {(keySaved || status?.openai_key) && <div className="mt-2 flex items-center gap-1 text-[12px] text-spark-deep"><Check className="size-3.5" /> {t("ob.keySet")}</div>}
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-hairline p-4">
                  <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><Terminal className="size-4 text-steel" /> {t("ob.codexTitle")}</div>
                  <p className="text-[12.5px] leading-relaxed text-steel">{t("ob.codexHint")}</p>
                  <div className="mt-2 flex items-center gap-2 rounded-lg border border-hairline bg-surface px-3 py-2 font-mono text-[12.5px]">
                    <span className="flex-1 text-charcoal">codex login</span>
                    <button onClick={copyCmd} className="inline-flex items-center gap-1 text-[11px] text-steel hover:text-foreground">{copied ? <><Check className="size-3" /> {t("ob.copied")}</> : <><Copy className="size-3" /> {t("ob.copy")}</>}</button>
                  </div>
                  <button onClick={onRefreshStatus} className="mt-2 text-[12px] font-medium text-steel underline-offset-2 hover:text-foreground hover:underline">{t("ob.recheck")}</button>
                </div>
              )}

              <div className={`mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] ${brainReady ? "bg-[#eafaf4] text-spark-deep" : "bg-surface-soft text-stone"}`}>
                {brainReady ? <ShieldCheck className="size-4" /> : <span className="size-1.5 rounded-full bg-stone" />}
                {brainReady ? t("ob.brainReady") : t("ob.brainNot")}
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="text-[18px] font-semibold tracking-tight">{t("ob.permTitle")}</h2>
              <p className="mt-1 text-[13px] leading-relaxed text-steel">{t("ob.permSub")}</p>

              <div className="mt-4 rounded-xl border border-hairline p-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-surface-soft"><Mic className="size-4 text-steel" /></span>
                  <div className="flex-1">
                    <p className="text-[13.5px] font-semibold tracking-tight">{t("ob.micName")}</p>
                    <p className="text-[12.5px] leading-relaxed text-steel">{t("ob.micDesc")}</p>
                  </div>
                  {micOk ? (
                    <span className="inline-flex items-center gap-1 text-[12px] text-spark-deep"><Check className="size-3.5" /> {t("ob.allowed")}</span>
                  ) : (
                    <button onClick={grantMic} className="h-8 shrink-0 rounded-lg bg-ink px-3 text-[12.5px] font-medium text-canvas">{t("ob.allow")}</button>
                  )}
                </div>
                {micErr && (
                  <div className="mt-2 flex items-center gap-2">
                    <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-[#b04141]">{micErr}</p>
                    {/* 한 번 거부하면 OS가 다시 묻지 않는다 → 시스템 설정으로 바로 보낸다 */}
                    {!!(window as any).ghost?.openPrivacy && (
                      <button onClick={() => (window as any).ghost.openPrivacy("microphone")}
                        className="h-7 shrink-0 rounded-lg border border-hairline px-2.5 text-[11.5px] font-medium text-steel hover:text-foreground">
                        {t("ob.openSettings")}
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-3 flex items-start gap-3 rounded-xl border border-hairline p-4">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-surface-soft"><MonitorSpeaker className="size-4 text-steel" /></span>
                <div className="flex-1">
                  <p className="text-[13.5px] font-semibold tracking-tight">{t("ob.sysName")}</p>
                  <p className="text-[12.5px] leading-relaxed text-steel">{t("ob.sysDesc")}</p>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="text-center">
              <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#eafaf4]"><Check className="size-7 text-spark-deep" /></span>
              <h2 className="mt-4 text-[20px] font-semibold tracking-tight">{t("ob.doneTitle")}</h2>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-steel">{t("ob.doneSub").split("\n").map((x, i) => <span key={i}>{i > 0 && <br />}{x}</span>)}</p>
              <div className="mt-5 grid gap-2 text-left text-[12.5px]">
                <div className="flex items-center gap-2 rounded-lg bg-surface-soft px-3 py-2"><span className="size-1.5 rounded-full bg-spark" /> {t("ob.tip1")}</div>
                <div className="flex items-center gap-2 rounded-lg bg-surface-soft px-3 py-2"><span className="size-1.5 rounded-full bg-spark" /> {t("ob.tip2")}</div>
                <div className="flex items-center gap-2 rounded-lg bg-surface-soft px-3 py-2"><span className="size-1.5 rounded-full bg-spark" /> {t("ob.tip3")}</div>
              </div>
            </div>
          )}
        </div>

        {/* 하단 내비게이션 */}
        <div className="flex items-center gap-2 border-t border-hairline bg-surface-soft/60 px-6 py-3.5">
          {step > 0 ? (
            <button onClick={back} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-steel hover:text-foreground"><ArrowLeft className="size-4" /> {t("ob.back")}</button>
          ) : (
            <button onClick={onClose} className="rounded-lg px-3 py-2 text-[13px] font-medium text-stone hover:text-foreground">{t("ob.later")}</button>
          )}
          <div className="ml-auto">
            {step < STEPS.length - 1 ? (
              <button onClick={next} className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-canvas">{t("ob.next")} <ArrowRight className="size-4" /></button>
            ) : (
              <button onClick={onStart} className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-canvas"><Mic className="size-4" /> {t("ob.start")}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
