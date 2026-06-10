import { useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import * as api from "@/lib/api";

/** 음성 인식 모델 선택 칩 — 현재 모델을 보여주고, 누르면 클라우드/로컬 모델 목록에서 바꾼다.
 * provider+model을 함께 설정해 '변경 반영 안 됨' 문제를 막는다. 라이브·워치·오디오 공용. */
export function ModelPicker({
  provider, models, onPick, disabled, fallbackColor, t,
}: {
  provider?: string;
  models: api.SttModels | null;
  onPick: (kind: "local" | "cloud", id: string) => void;
  disabled?: boolean;
  fallbackColor?: boolean;   // 마지막 전사가 폴백이면 주황 점
  t: (k: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const isCloud = provider === "elevenlabs";
  const label = isCloud
    ? (models?.cloud.find((x) => x.id === models.cloud_active)?.label?.split(" · ")[0] || "Scribe")
    : (models?.local.find((x) => x.id === models.local_active)?.label?.split(" · ")[0] || (models?.local_active || "").split("/").pop() || "STT");

  return (
    <span className="relative">
      <button onClick={() => setOpen((v) => !v)} disabled={disabled}
        title={disabled ? t("trans.pickModelDisabled") : t("trans.pickModel")}
        className="flex items-center gap-1 rounded-full border border-hairline bg-surface px-2 py-0.5 text-[11px] font-medium text-steel hover:text-foreground disabled:opacity-60">
        <span className={`size-1.5 rounded-full ${fallbackColor ? "bg-[#e9a23b]" : "bg-spark"}`} />
        {label}<ChevronDown className="size-3 opacity-60" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-7 z-30 max-h-72 w-64 overflow-y-auto rounded-xl border border-hairline bg-background p-1 shadow-lg">
            <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-stone">{t("trans.cloud")}</div>
            {models?.cloud.map((m) => (
              <button key={m.id} onClick={() => { onPick("cloud", m.id); setOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-steel hover:bg-surface-soft">
                <span className="truncate">{m.label}</span>
                {isCloud && models?.cloud_active === m.id && <Check className="ml-auto size-3.5 shrink-0 text-spark-deep" />}
              </button>
            ))}
            <div className="mt-1 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-stone">{t("trans.local")}</div>
            {models?.local.map((m) => (
              <button key={m.id} onClick={() => { onPick("local", m.id); setOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-steel hover:bg-surface-soft">
                <span className="truncate">{m.label.split(" · ")[0]}</span>
                {m.engine_ready === false && <span className="ml-auto shrink-0 text-[9.5px] text-[#b06a00]">{t("trans.needInstall")}</span>}
                {!isCloud && models?.local_active === m.id && <Check className="ml-auto size-3.5 shrink-0 text-spark-deep" />}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}
