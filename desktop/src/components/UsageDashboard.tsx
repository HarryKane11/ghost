import { useEffect, useState } from "react";
import { Gauge, Cpu, Cloud, HardDrive, RotateCcw, Coins } from "lucide-react";
import * as api from "@/lib/api";

const fmtNum = (n: number) => n.toLocaleString();
const fmtUsd = (n: number) => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;
const fmtGb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(0)} MB`);
const fmtDur = (s: number) => (s >= 3600 ? `${(s / 3600).toFixed(1)}시간` : s >= 60 ? `${(s / 60).toFixed(1)}분` : `${Math.round(s)}초`);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-hairline bg-surface-soft px-3 py-2">
      <div className="text-[10.5px] text-stone">{label}</div>
      <div className="mt-0.5 text-[14px] font-semibold tabular-nums tracking-tight text-foreground">{value}</div>
    </div>
  );
}

/** 사용량·비용 대시보드 — Codex 토큰/비용/예산, ElevenLabs STT, 로컬 ASR 디스크. 관리자 화면 전용. */
export function UsageDashboard({ t }: { t: (k: string) => string }) {
  const [u, setU] = useState<api.Usage | null>(null);
  const [budget, setBudget] = useState("");

  const load = () => api.getUsage().then((x) => { setU(x); if (x) setBudget(x.codex.budget_usd ? String(x.codex.budget_usd) : ""); });
  useEffect(() => { load(); }, []);

  if (!u || !u.codex) return null;
  const c = u.codex;
  const pct = c.budget_pct;

  // 음수·문자 입력은 저장 비활성(이전: 조용히 0으로 저장돼 혼란).
  const budgetNum = parseFloat(budget);
  const budgetValid = budget.trim() === "" || (!Number.isNaN(budgetNum) && budgetNum >= 0);
  const saveBudget = async () => {
    if (!budgetValid) return;
    const x = await api.setUsageBudget(Number.isNaN(budgetNum) ? 0 : Math.max(0, budgetNum));
    if (x) setU(x);
  };
  const reset = async () => { const x = await api.resetUsage(); if (x) { setU(x); setBudget(""); } };

  return (
    <div className="mb-4 rounded-xl border border-hairline p-3.5">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold tracking-tight">
        <Gauge className="size-4 text-steel" />{t("usage.title")}
        <button onClick={load} title={t("usage.refresh")} className="ml-auto inline-flex items-center gap-1 text-[11px] text-stone hover:text-foreground">
          <RotateCcw className="size-3" /> {t("usage.refresh")}
        </button>
        <button onClick={reset} className="inline-flex items-center gap-1 text-[11px] text-stone hover:text-foreground">
          {t("usage.reset")}
        </button>
      </div>

      {/* Codex */}
      <div className="mb-3 rounded-lg border border-hairline p-3">
        <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-steel"><Cpu className="size-3.5" /> {t("usage.codex")}</div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label={t("usage.tokensIn")} value={fmtNum(c.input_tokens)} />
          <Stat label={t("usage.tokensOut")} value={fmtNum(c.output_tokens + c.reasoning_tokens)} />
          <Stat label={t("usage.estCost")} value={fmtUsd(c.cost_usd)} />
          <Stat label={t("usage.cached")} value={fmtNum(c.cached_input_tokens)} />
          <Stat label={t("usage.requests")} value={fmtNum(c.requests)} />
          <Stat label="모델" value={String(Object.keys(c.by_model).length || 0)} />
        </div>
        {/* 예산 대비 차지율 */}
        <div className="mt-2.5">
          {pct != null && (
            <div className="mb-1.5">
              <div className="mb-1 flex justify-between text-[11px]"><span className="text-steel">{t("usage.budget")}</span><span className="font-medium tabular-nums text-charcoal">{fmtUsd(c.cost_usd)} / {fmtUsd(c.budget_usd)} ({pct}%)</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--hairline)_70%,transparent)]">
                <div className="h-full rounded-full bg-gradient-to-r from-spark to-spark-deep" style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Coins className="size-3.5 text-stone" />
            <input value={budget} onChange={(e) => setBudget(e.target.value)} type="number" min="0" step="0.01" inputMode="decimal" placeholder={t("usage.budget")}
              className={`h-8 w-28 rounded-lg border bg-surface-soft px-2.5 text-[12px] text-charcoal outline-none focus:border-ink/40 ${budgetValid ? "border-hairline" : "border-[#e9b0b0]"}`} />
            <button onClick={saveBudget} disabled={!budgetValid} className="h-8 rounded-lg border border-hairline px-3 text-[12px] text-steel hover:text-foreground disabled:opacity-40">{t("usage.save")}</button>
            <span className="text-[10.5px] text-stone">{t("usage.budgetHint")}</span>
          </div>
        </div>
      </div>

      {/* ElevenLabs STT */}
      <div className="mb-3 rounded-lg border border-hairline p-3">
        <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-steel"><Cloud className="size-3.5" /> {t("usage.elevenTitle")}</div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label={t("usage.audioTime")} value={fmtDur(u.elevenlabs_stt.seconds)} />
          <Stat label={t("usage.requests")} value={fmtNum(u.elevenlabs_stt.requests)} />
          <Stat label={t("usage.estCost")} value={fmtUsd(u.elevenlabs_stt.cost_usd)} />
        </div>
      </div>

      {/* 로컬 ASR 디스크 */}
      <div className="rounded-lg border border-hairline p-3">
        <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-steel">
          <HardDrive className="size-3.5" /> {t("usage.localDisk")}
          <span className="ml-auto font-semibold tabular-nums text-foreground">{fmtGb(u.local_total_bytes)}</span>
        </div>
        <div className="space-y-1">
          {u.local_models.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-2 text-[12px]">
              <span className="truncate text-charcoal" title={m.id}>{m.label.split(" · ")[0]}</span>
              <span className={`shrink-0 tabular-nums ${m.present ? "text-steel" : "text-stone"}`}>
                {m.present ? fmtGb(m.size_bytes) : `~${m.approx_gb}GB · ${t("usage.notDownloaded")}`}
              </span>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-2 px-1 text-[10.5px] text-stone">{t("usage.estimate")}</p>
    </div>
  );
}
