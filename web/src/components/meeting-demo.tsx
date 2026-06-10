"use client";

import * as React from "react";
import { Globe, FileText, BookOpen, Mic } from "lucide-react";
import { GhostLogo } from "@/components/ghost-logo";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useI18n, type Lang } from "@/lib/i18n";

type Turn = { speaker: string; text: string; you?: boolean };
type GhostCard = {
  kind: "web" | "internal" | "glossary";
  title: string;
  body: string;
  source: string;
  confidence: number;
};

type Step = { turn: Turn; card?: GhostCard };

// 데모 대화는 언어별 풀세트 — 사이트 언어를 따라간다.
const SCRIPTS: Record<Lang, Step[]> = {
  ko: [
    {
      turn: { speaker: "지현", text: "이번 분기 국내 SaaS 시장 성장률이 얼마였죠?" },
      card: { kind: "web", title: "국내 SaaS 시장 성장률",
        body: "2025년 국내 SaaS 시장은 전년 대비 약 18.5% 성장, 약 2.4조 원 규모로 추정.",
        source: "소프트웨어정책연구소 · 2일 전", confidence: 0.92 },
    },
    {
      turn: { speaker: "민재", text: "저번 회의에서 가격 정책 어떻게 정했더라?", you: true },
      card: { kind: "internal", title: "지난 회의 결정사항",
        body: "Pro 티어 ₩39,000/석 확정. 온프레미스는 별도 견적. (4/22 제품 회의)",
        source: "회의록 · Notion", confidence: 0.88 },
    },
    {
      turn: { speaker: "지현", text: "그 DER 수치가 우리 목표보다 높지 않았나요?" },
      card: { kind: "glossary", title: "DER (Diarization Error Rate)",
        body: "화자분리 오류율. 오프라인 배치 기준 10~15%, 실시간은 20~35%.",
        source: "사내 용어집", confidence: 0.95 },
    },
  ],
  en: [
    {
      turn: { speaker: "Sarah", text: "What was the SaaS market growth rate this quarter?" },
      card: { kind: "web", title: "SaaS market growth",
        body: "The SaaS market grew ~18.5% YoY in 2025, reaching an estimated $2.1B.",
        source: "Industry research · 2 days ago", confidence: 0.92 },
    },
    {
      turn: { speaker: "Mike", text: "What did we decide on pricing last meeting?", you: true },
      card: { kind: "internal", title: "Decision from last meeting",
        body: "Pro tier locked at $29/seat. On-prem goes to custom quotes. (Apr 22 product meeting)",
        source: "Meeting notes · Notion", confidence: 0.88 },
    },
    {
      turn: { speaker: "Sarah", text: "Wasn't that DER number above our target?" },
      card: { kind: "glossary", title: "DER (Diarization Error Rate)",
        body: "Speaker-separation error rate. 10–15% for offline batch, 20–35% for realtime.",
        source: "Team glossary", confidence: 0.95 },
    },
  ],
  zh: [
    {
      turn: { speaker: "小李", text: "这个季度 SaaS 市场的增长率是多少来着？" },
      card: { kind: "web", title: "SaaS 市场增长率",
        body: "2025 年 SaaS 市场同比增长约 18.5%，规模约 150 亿元。",
        source: "行业研究 · 2 天前", confidence: 0.92 },
    },
    {
      turn: { speaker: "小王", text: "上次会议定价是怎么定的来着？", you: true },
      card: { kind: "internal", title: "上次会议的决定",
        body: "Pro 档定为每席 ¥199/月。私有化部署另行报价。（4/22 产品会议）",
        source: "会议纪要 · Notion", confidence: 0.88 },
    },
    {
      turn: { speaker: "小李", text: "那个 DER 指标不是高于我们的目标吗？" },
      card: { kind: "glossary", title: "DER（说话人分离错误率）",
        body: "说话人分离错误率。离线批处理约 10~15%，实时约 20~35%。",
        source: "团队术语表", confidence: 0.95 },
    },
  ],
};

export function MeetingDemo({ className }: { className?: string }) {
  const { lang, t } = useI18n();
  const SCRIPT = SCRIPTS[lang] || SCRIPTS.ko;
  const KIND = {
    web: { icon: Globe, label: t("demo.kindWeb") },
    internal: { icon: FileText, label: t("demo.kindInternal") },
    glossary: { icon: BookOpen, label: t("demo.kindGlossary") },
  } as const;
  const [index, setIndex] = React.useState(0);
  const [cards, setCards] = React.useState<GhostCard[]>([]);

  // 언어가 바뀌면 데모를 처음부터(이전 언어 카드 잔존 방지).
  React.useEffect(() => { setIndex(0); setCards([]); }, [lang]);

  React.useEffect(() => {
    const step = SCRIPT[index % SCRIPT.length];
    const cardTimer = setTimeout(() => {
      if (step.card) setCards((c) => [step.card!, ...c].slice(0, 3));
    }, 900);
    const nextTimer = setTimeout(() => {
      setIndex((i) => i + 1);
    }, 3600);
    return () => {
      clearTimeout(cardTimer);
      clearTimeout(nextTimer);
    };
  }, [index]);

  const visibleTurns = SCRIPT.slice(
    Math.max(0, (index % SCRIPT.length) - 2),
    (index % SCRIPT.length) + 1
  );

  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-3 sm:grid-cols-[1.1fr_1fr]",
        className
      )}
    >
      {/* Transcript panel */}
      <div className="rounded-2xl border border-hairline bg-canvas p-4 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
        <div className="mb-4 flex items-center gap-2 text-[13px] text-steel">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-2 animate-ping rounded-full bg-spark opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-spark" />
          </span>
          {t("demo.live")}
        </div>
        <div className="space-y-3">
          {visibleTurns.map((s, i) => (
            <div
              key={`${index}-${i}`}
              className={cn(
                "animate-rise flex flex-col gap-1",
                s.turn.you ? "items-end" : "items-start"
              )}
            >
              <span className="px-1 text-[11px] font-medium text-stone">
                {s.turn.speaker}
              </span>
              <span
                className={cn(
                  "max-w-[88%] rounded-2xl px-3.5 py-2 text-[13.5px] leading-relaxed",
                  s.turn.you
                    ? "bg-ink text-canvas"
                    : "bg-surface text-slate"
                )}
              >
                {s.turn.text}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Ghost side panel */}
      <div className="rounded-2xl border border-hairline bg-surface-soft p-4">
        <div className="mb-4 flex items-center gap-2">
          <GhostLogo variant="icon" size={20} className="rounded-[6px]" />
          <span className="text-[13px] font-semibold tracking-tight">Ghost</span>
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-stone">
            <Mic className="size-3" /> {t("demo.silent")}
          </span>
        </div>

        <div className="space-y-3">
          {cards.length === 0 && (
            <div className="rounded-xl border border-dashed border-hairline px-4 py-8 text-center text-[12.5px] text-stone">
              {t("demo.empty")}
            </div>
          )}
          {cards.map((card, i) => {
            const meta = KIND[card.kind];
            const Icon = meta.icon;
            return (
              <div
                key={`${card.title}-${i}`}
                className="animate-rise rounded-xl border border-hairline bg-canvas p-3.5 shadow-[0_2px_8px_rgba(10,10,10,0.04)]"
              >
                <div className="mb-1.5 flex items-center gap-1.5">
                  <Icon className="size-3.5 text-steel" />
                  <span className="text-[11px] font-medium text-steel">
                    {meta.label}
                  </span>
                  <Badge variant="soft" size="sm" className="ml-auto">
                    {Math.round(card.confidence * 100)}%
                  </Badge>
                </div>
                <p className="text-[13.5px] font-semibold tracking-tight">
                  {card.title}
                </p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-slate">
                  {card.body}
                </p>
                <p className="mt-2 text-[11px] text-stone">{card.source}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
