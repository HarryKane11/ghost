import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import {
  Link2, Quote, ArrowUpRight, Info, TriangleAlert, CircleCheck, CircleX,
  ChevronDown, ArrowRight,
} from "lucide-react";

/** 카드 내 버튼/액션 클릭 → 후속 질의를 앱 라우팅으로 되먹임(인터랙티브 루프). */
const ActionCtx = createContext<((query: string) => void) | null>(null);
/** 음성 회의록: 텍스트 내 [mm:ss] 타임스탬프 클릭 → 해당 구간 재생. */
const SeekCtx = createContext<((sec: number) => void) | null>(null);

const TS_RE = /(\[\d{1,2}:\d{2}(?::\d{2})?\])/g;
/** 문자열 안의 [mm:ss]/[hh:mm:ss]를 재생 버튼으로 렌더(onSeek 있을 때). 없으면 평문. */
function TsText({ children }: { children?: string }) {
  const onSeek = useContext(SeekCtx);
  const { t } = useT();
  const s = children ?? "";
  if (!onSeek || !s || !/\[\d{1,2}:\d{2}/.test(s)) return <>{s}</>;
  return (
    <>
      {s.split(TS_RE).map((p, i) => {
        const m = p.match(/^\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]$/);
        if (!m) return <span key={i}>{p}</span>;
        const sec = m[3] ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
        return (
          <button key={i} onClick={() => onSeek(sec)} title={t("genui.seek")}
            className="mx-0.5 inline-flex items-center gap-0.5 rounded-md border border-spark-soft bg-[color-mix(in_srgb,var(--spark)_10%,transparent)] px-1.5 py-px align-middle text-[11px] font-medium text-spark-deep transition-colors hover:bg-[color-mix(in_srgb,var(--spark)_20%,transparent)]">
            ▶ {p.slice(1, -1)}
          </button>
        );
      })}
    </>
  );
}

/** 깨진/없는 이미지 URL이면 조용히 숨긴다 (회의록 외 image 블록 깨짐 방지) */
function ImageBlock({ url, label }: { url?: string; label?: string }) {
  const [bad, setBad] = useState(false);
  const { t } = useT();
  if (!url || bad || !/^(data:image|https?:)/.test(url)) return null;
  return (
    <figure className="overflow-hidden rounded-xl border border-hairline bg-surface-soft">
      <img src={url} alt={label || t("genui.imageAlt")} className="block w-full" loading="lazy" onError={() => setBad(true)} />
      {label && <figcaption className="px-3 py-1.5 text-[11px] text-stone">{label}</figcaption>}
    </figure>
  );
}

export type Block = {
  type: string;
  text?: string;
  label?: string;
  value?: string;
  items?: string[];
  url?: string;
};

export type Spec = {
  title: string;
  spoken: string;
  intent: string;
  blocks: Block[];
};

const PALETTE = ["#7c3aed", "#0a0a0a", "#5a5a5c", "#e9a23b", "#6b8af0", "#c4b5fd", "#d05757"];

function hostname(u: string) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; }
}
function isKorean(s: string) { return /[가-힣]/.test(s); }
function deltaTone(v: string) {
  if (/^-|▼|하락|감소/.test(v)) return "text-[#d05757]";
  if (/^\+|▲|상승|증가/.test(v)) return "text-spark-deep";
  return "text-foreground";
}

/** "라벨: 숫자 단위" → {label, value, suffix} */
function parsePoints(items: string[]) {
  return items
    .map((s) => {
      const m = s.match(/^(.*?)[:\-–—]\s*([-+]?[\d.,]+)\s*(.*)$/);
      if (!m) return null;
      const value = parseFloat(m[2].replace(/,/g, ""));
      if (Number.isNaN(value)) return null;
      return { label: m[1].trim(), value, suffix: m[3].trim() };
    })
    .filter(Boolean) as { label: string; value: number; suffix: string }[];
}

// ── 차트들 ──────────────────────────────────────────────────────────────────
function BarChart({ title, data }: { title?: string; data: ReturnType<typeof parsePoints> }) {
  const max = Math.max(...data.map((d) => Math.abs(d.value))) || 1;
  return (
    <ChartFrame title={title}>
      <div className="space-y-2">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <span className="w-24 shrink-0 truncate text-right text-[11px] text-stone" title={d.label}>{d.label}</span>
            <div className="relative h-5 flex-1 overflow-hidden rounded-md bg-[color-mix(in_srgb,var(--hairline)_70%,transparent)]">
              <div className="absolute inset-y-0 left-0 rounded-md bg-gradient-to-r from-spark to-spark-deep"
                style={{ width: `${Math.max(3, (Math.abs(d.value) / max) * 100)}%` }} />
            </div>
            <span className="w-16 shrink-0 text-right text-[11.5px] font-medium tabular-nums text-charcoal">
              {d.value.toLocaleString()}{d.suffix}
            </span>
          </div>
        ))}
      </div>
    </ChartFrame>
  );
}

function LineChart({ title, data, area }: { title?: string; data: ReturnType<typeof parsePoints>; area?: boolean }) {
  const w = 320, h = 96, pad = 10;
  const max = Math.max(...data.map((d) => d.value));
  const min = Math.min(...data.map((d) => d.value), 0);
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (w - 2 * pad)) / (data.length - 1 || 1);
  const y = (v: number) => h - pad - ((v - min) / span) * (h - 2 * pad);
  const pts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ");
  const areaPath = `M ${x(0)},${h - pad} L ${pts.split(" ").join(" L ")} L ${x(data.length - 1)},${h - pad} Z`;
  return (
    <ChartFrame title={title}>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: 110 }}>
        {area && <path d={areaPath} fill="color-mix(in srgb, var(--spark) 16%, transparent)" />}
        <polyline points={pts} fill="none" stroke="var(--spark-deep)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => <circle key={i} cx={x(i)} cy={y(d.value)} r={2.5} fill="var(--spark-deep)" />)}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-stone">
        {data.map((d, i) => <span key={i} className="truncate" style={{ maxWidth: `${100 / data.length}%` }}>{d.label}</span>)}
      </div>
    </ChartFrame>
  );
}

function PieChart({ title, data }: { title?: string; data: ReturnType<typeof parsePoints> }) {
  const total = data.reduce((s, d) => s + Math.abs(d.value), 0) || 1;
  const R = 42, C = 50, sw = 16;
  let acc = 0;
  const circ = 2 * Math.PI * R;
  return (
    <ChartFrame title={title}>
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 100 100" style={{ width: 96, height: 96 }} className="-rotate-90">
          {data.map((d, i) => {
            const frac = Math.abs(d.value) / total;
            const dash = frac * circ;
            const el = (
              <circle key={i} cx={C} cy={C} r={R} fill="none" stroke={PALETTE[i % PALETTE.length]}
                strokeWidth={sw} strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-acc * circ} />
            );
            acc += frac;
            return el;
          })}
        </svg>
        <div className="space-y-1">
          {data.map((d, i) => (
            <div key={i} className="flex items-center gap-2 text-[12px]">
              <span className="size-2.5 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
              <span className="text-slate">{d.label}</span>
              <span className="font-medium tabular-nums text-charcoal">{Math.round((Math.abs(d.value) / total) * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
    </ChartFrame>
  );
}

function ChartFrame({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-hairline bg-surface-soft px-4 py-3">
      {title && <div className="mb-2.5 text-[12px] font-medium text-steel">{title}</div>}
      {children}
    </div>
  );
}

const CALLOUT = {
  info: { icon: Info, cls: "border-[#bcd3f5] bg-[#eef4fd] text-[#2f5fb0]" },
  warn: { icon: TriangleAlert, cls: "border-[#e9c46a] bg-[#fdf6e3] text-[#9a6a00]" },
  success: { icon: CircleCheck, cls: "border-spark-soft bg-[color-mix(in_srgb,var(--spark)_10%,transparent)] text-spark-deep" },
  error: { icon: CircleX, cls: "border-[#e9b0b0] bg-[#fdeeee] text-[#b04141]" },
} as const;

// ── 인터랙티브 블록 ──────────────────────────────────────────────────────────
/** 접이식 섹션. items: ["제목 | 내용", …]. 긴 카드를 접어 정보 밀도↓. */
function Accordion({ label, items }: { label?: string; items: string[] }) {
  const rows = items.map((s) => { const [h, ...r] = s.split("|"); return { head: h.trim(), body: r.join("|").trim() }; }).filter((x) => x.head);
  const [open, setOpen] = useState<number | null>(0);
  if (!rows.length) return null;
  return (
    <div className="overflow-hidden rounded-xl border border-hairline">
      {label && <div className="border-b border-hairline bg-surface-soft px-3 py-1.5 text-[11px] font-medium text-steel">{label}</div>}
      {rows.map((r, i) => (
        <div key={i} className="border-b border-hairline last:border-b-0">
          <button onClick={() => setOpen(open === i ? null : i)}
            className="flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-[13px] font-medium text-foreground hover:bg-surface-soft">
            <span>{r.head}</span>
            <ChevronDown className={`size-3.5 shrink-0 text-stone transition-transform ${open === i ? "rotate-180" : ""}`} />
          </button>
          {open === i && <div className="px-3.5 pb-2.5 text-[12.5px] leading-relaxed text-charcoal">{r.body}</div>}
        </div>
      ))}
    </div>
  );
}

/** 탭. items: ["탭명 | 내용", …]. */
function Tabs({ items }: { items: string[] }) {
  const tabs = items.map((s) => { const [h, ...r] = s.split("|"); return { head: h.trim(), body: r.join("|").trim() }; }).filter((x) => x.head);
  const [active, setActive] = useState(0);
  if (!tabs.length) return null;
  return (
    <div className="rounded-xl border border-hairline">
      <div className="flex gap-1 border-b border-hairline bg-surface-soft px-1.5 pt-1.5">
        {tabs.map((tb, i) => (
          <button key={i} onClick={() => setActive(i)}
            className={`rounded-t-lg px-3 py-1.5 text-[12px] font-medium transition-colors ${active === i ? "bg-canvas text-foreground" : "text-stone hover:text-steel"}`}>
            {tb.head}
          </button>
        ))}
      </div>
      <div className="px-3.5 py-2.5 text-[13px] leading-relaxed text-charcoal">{tabs[active]?.body}</div>
    </div>
  );
}

/** 체크리스트(로컬 토글). items: ["할 일", …]. */
function Checklist({ items }: { items: string[] }) {
  const [done, setDone] = useState<Set<number>>(new Set());
  if (!items.length) return null;
  return (
    <ul className="space-y-1">
      {items.map((it, i) => {
        const on = done.has(i);
        return (
          <li key={i}>
            <button onClick={() => setDone((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })}
              className="flex w-full items-start gap-2 text-left text-[13px] leading-relaxed">
              <span className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors ${on ? "border-spark bg-spark text-white" : "border-hairline bg-surface"}`}>
                {on && <CircleCheck className="size-3" />}
              </span>
              <span className={on ? "text-stone line-through" : "text-charcoal"}>{it}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** 액션 버튼 — 클릭 시 후속 질의를 앱으로 되먹임. items: ["라벨 | 질의"] 또는 ["라벨"](라벨=질의). */
function Actions({ items }: { items: string[] }) {
  const onAction = useContext(ActionCtx);
  const acts = items.map((s) => { const [lab, ...q] = s.split("|"); const label = lab.trim(); const query = (q.join("|").trim() || label); return { label, query }; }).filter((x) => x.label);
  if (!acts.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {acts.map((a, i) => (
        <button key={i} disabled={!onAction} onClick={() => onAction?.(a.query)}
          className="group inline-flex items-center gap-1.5 rounded-full border border-spark-soft bg-[color-mix(in_srgb,var(--spark)_8%,transparent)] px-3 py-1.5 text-[12px] font-medium text-spark-deep transition-colors hover:bg-[color-mix(in_srgb,var(--spark)_16%,transparent)] disabled:opacity-50">
          {a.label}
          <ArrowRight className="size-3 shrink-0 transition-transform group-hover:translate-x-0.5" />
        </button>
      ))}
    </div>
  );
}

/** Mermaid 다이어그램 — 흐름도·시퀀스·간트 등. 렌더 실패 시 코드 블록으로 강등. */
let _mermaidSeq = 0;
function MermaidBlock({ code, label }: { code: string; label?: string }) {
  const [svg, setSvg] = useState("");
  const [err, setErr] = useState(false);
  const idRef = useRef(`ghost-mmd-${++_mermaidSeq}`);
  // 모델이 ```mermaid 펜스를 섞어 보내도 안전하게 벗긴다.
  const clean = (code || "").replace(/^\s*```(?:mermaid)?\s*/i, "").replace(/```\s*$/, "").trim();
  useEffect(() => {
    if (!clean) return;
    let alive = true;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        const dark = document.documentElement.classList.contains("dark");
        mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "neutral", securityLevel: "loose", fontFamily: "inherit" });
        const { svg } = await mermaid.render(idRef.current, clean);
        if (alive) { setSvg(svg); setErr(false); }
      } catch {
        if (alive) setErr(true);
      }
    })();
    return () => { alive = false; };
  }, [clean]);
  if (!clean) return null;
  if (err) return <CodeBlock text={clean} label={label || "mermaid"} />;
  if (!svg) return <div className="mist h-24 rounded-xl" />;
  return (
    <figure className="overflow-x-auto rounded-xl border border-hairline bg-surface-soft px-3 py-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full">
      <div dangerouslySetInnerHTML={{ __html: svg }} />
      {label && <figcaption className="mt-1.5 text-center text-[11px] text-stone">{label}</figcaption>}
    </figure>
  );
}

/** 코드 블록(모노스페이스). label=언어. */
function CodeBlock({ text, label }: { text: string; label?: string }) {
  if (!text) return null;
  return (
    <div className="overflow-hidden rounded-xl border border-hairline bg-[#0f1115]">
      {label && <div className="border-b border-white/10 px-3 py-1 text-[10.5px] font-medium uppercase tracking-wide text-white/40">{label}</div>}
      <pre className="overflow-x-auto px-3.5 py-2.5 text-[12px] leading-relaxed text-[#e6e6e6]"><code>{text}</code></pre>
    </div>
  );
}

// ── 블록 렌더러 레지스트리 ───────────────────────────────────────────────────
function BlockView({ b }: { b: Block }) {
  switch (b.type) {
    case "heading":
      return <h4 className="mt-3 text-[13.5px] font-semibold tracking-tight text-foreground first:mt-0">{b.text}</h4>;
    case "text":
      return <p className="text-[13.5px] leading-relaxed text-charcoal"><TsText>{b.text}</TsText></p>;
    case "divider":
      return <hr className="my-1 border-hairline" />;
    case "stat":
      return (
        <div className="rounded-xl border border-hairline bg-surface-soft px-3.5 py-2.5">
          <div className="text-[11px] text-stone">{b.label}</div>
          <div className={`mt-0.5 text-[18px] font-semibold tracking-tight ${deltaTone(b.value || "")}`}>{b.value}</div>
        </div>
      );
    case "chart": {
      const data = parsePoints(b.items || []);
      if (!data.length) return null;
      const t = (b.value || "bar").toLowerCase();
      if (t === "line") return <LineChart title={b.label} data={data} />;
      if (t === "area") return <LineChart title={b.label} data={data} area />;
      if (t === "pie" || t === "donut") return <PieChart title={b.label} data={data} />;
      return <BarChart title={b.label} data={data} />;
    }
    case "table": {
      const rows = (b.items || []).map((r) => r.split("|").map((c) => c.trim()));
      if (!rows.length) return null;
      const [head, ...body] = rows;
      return (
        <div className="overflow-hidden rounded-xl border border-hairline">
          {b.label && <div className="border-b border-hairline bg-surface-soft px-3 py-1.5 text-[11px] font-medium text-steel">{b.label}</div>}
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-surface-soft text-stone">
                {head.map((c, i) => <th key={i} className="px-3 py-1.5 text-left font-medium">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {body.map((r, i) => (
                <tr key={i} className="border-t border-hairline">
                  {r.map((c, j) => <td key={j} className="px-3 py-1.5 text-charcoal"><TsText>{c}</TsText></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "list":
      return (
        <ul className="space-y-1.5">
          {(b.items || []).map((it, i) => (
            <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-charcoal">
              <span className="mt-[7px] size-1 shrink-0 rounded-full bg-spark" /><span><TsText>{it}</TsText></span>
            </li>
          ))}
        </ul>
      );
    case "steps":
      return (
        <ol className="space-y-1.5">
          {(b.items || []).map((it, i) => (
            <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-charcoal">
              <span className="font-mono text-[11px] text-stone">{String(i + 1).padStart(2, "0")}</span><span><TsText>{it}</TsText></span>
            </li>
          ))}
        </ol>
      );
    case "keyvalue":
      return (
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl border border-hairline bg-surface-soft px-3.5 py-2.5">
          {(b.items || []).map((it, i) => {
            const [k, ...rest] = it.split(/[:：]/);
            return (
              <div key={i} className="contents">
                <span className="text-[12px] text-stone">{k?.trim()}</span>
                <span className="text-[12.5px] text-charcoal">{rest.join(":").trim()}</span>
              </div>
            );
          })}
        </div>
      );
    case "timeline":
      return (
        <div className="relative space-y-3 pl-4">
          <span className="absolute left-[5px] top-1 bottom-1 w-px bg-hairline" />
          {(b.items || []).map((it, i) => {
            const [when, ...what] = it.split("|");
            return (
              <div key={i} className="relative">
                <span className="absolute -left-4 top-1 size-2.5 rounded-full border-2 border-spark bg-canvas" />
                <div className="text-[11px] font-medium text-spark-deep">{when?.trim()}</div>
                <div className="text-[13px] text-charcoal">{what.join("|").trim()}</div>
              </div>
            );
          })}
        </div>
      );
    case "callout": {
      const v = (b.value as keyof typeof CALLOUT) in CALLOUT ? (b.value as keyof typeof CALLOUT) : "info";
      const { icon: Icon, cls } = CALLOUT[v];
      return (
        <div className={`flex gap-2.5 rounded-xl border px-3.5 py-2.5 ${cls}`}>
          <Icon className="mt-0.5 size-4 shrink-0" />
          <div>
            {b.label && <div className="text-[12.5px] font-semibold">{b.label}</div>}
            <div className="text-[12.5px] leading-relaxed opacity-90"><TsText>{b.text}</TsText></div>
          </div>
        </div>
      );
    }
    case "badges":
      return (
        <div className="flex flex-wrap gap-1.5">
          {(b.items || []).map((it, i) => (
            <span key={i} className="rounded-full border border-hairline bg-surface px-2.5 py-1 text-[11.5px] text-slate">{it}</span>
          ))}
        </div>
      );
    case "progress": {
      const v = Math.max(0, Math.min(100, parseFloat((b.value || "0").replace(/[^\d.]/g, "")) || 0));
      return (
        <div>
          <div className="mb-1 flex justify-between text-[11.5px]"><span className="text-steel">{b.label}</span><span className="font-medium tabular-nums text-charcoal">{v}%</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--hairline)_70%,transparent)]">
            <div className="h-full rounded-full bg-gradient-to-r from-spark to-spark-deep" style={{ width: `${v}%` }} />
          </div>
        </div>
      );
    }
    case "link":
      return (
        <a href={b.url} target="_blank" rel="noreferrer"
          className="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-hairline bg-surface px-3 py-1.5 text-[12px] text-steel transition-colors hover:border-ink/30 hover:text-foreground">
          <Link2 className="size-3 shrink-0" />
          <span className="truncate">{b.label || hostname(b.url || "")}</span>
          <ArrowUpRight className="size-3 shrink-0 opacity-50 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </a>
      );
    case "quote":
      return (
        <blockquote className="flex gap-2 border-l-2 border-spark-soft pl-3 text-[13px] italic leading-relaxed text-slate">
          <Quote className="size-3.5 shrink-0 text-spark-soft" />
          <span>{b.text}{b.label && <span className="mt-1 block text-[11px] not-italic text-stone">— {b.label}</span>}</span>
        </blockquote>
      );
    case "image":
      return <ImageBlock url={b.url} label={b.label} />;
    case "accordion":
      return <Accordion label={b.label} items={b.items || []} />;
    case "tabs":
      return <Tabs items={b.items || []} />;
    case "checklist":
      return <Checklist items={b.items || []} />;
    case "actions":
      return <Actions items={b.items || []} />;
    case "code":
      return <CodeBlock text={b.text || ""} label={b.label} />;
    case "mermaid":
      return <MermaidBlock code={b.text || ""} label={b.label} />;
    case "handwritten": {
      const ko = isKorean(b.text || "");
      return (
        <div className="paper overflow-hidden rounded-xl border border-hairline px-5 py-4 shadow-inner">
          <div className={`${ko ? "hand-ko text-[22px]" : "hand-en text-[20px]"} whitespace-pre-wrap text-charcoal`}>{b.text}</div>
        </div>
      );
    }
    default:
      return b.text ? <p className="text-[13px] text-charcoal">{b.text}</p> : null;
  }
}

/** 연속된 stat 블록은 한 줄(그리드)로 묶어 렌더 */
function groupBlocks(blocks: Block[]) {
  const groups: { kind: "stats" | "single"; blocks: Block[] }[] = [];
  for (const b of blocks) {
    if (b.type === "stat") {
      const last = groups[groups.length - 1];
      if (last && last.kind === "stats") last.blocks.push(b);
      else groups.push({ kind: "stats", blocks: [b] });
    } else groups.push({ kind: "single", blocks: [b] });
  }
  return groups;
}

export function GenUI({ spec, onAction, onSeek }: { spec: Spec; onAction?: (query: string) => void; onSeek?: (sec: number) => void }) {
  const groups = groupBlocks(spec.blocks || []);
  return (
    <ActionCtx.Provider value={onAction ?? null}>
    <SeekCtx.Provider value={onSeek ?? null}>
    <div className="space-y-3">
      {groups.map((g, gi) =>
        g.kind === "stats" ? (
          <div key={gi} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(g.blocks.length, 3)}, minmax(0,1fr))` }}>
            {g.blocks.map((b, i) => <BlockView key={i} b={b} />)}
          </div>
        ) : (
          g.blocks.map((b, i) => <BlockView key={`${gi}-${i}`} b={b} />)
        )
      )}
    </div>
    </SeekCtx.Provider>
    </ActionCtx.Provider>
  );
}
