import type { Spec } from "@/components/GenUI";

/** 데모 회의 — 백엔드 없이 Ghost의 동작(전사 → 능동 카드)을 체험시키는 스크립트. */

export const DEMO_TRANSCRIPT: string[] = [
  "자, 이번 분기 국내 SaaS 시장 얘기부터 해볼까요?",
  "성장률이 생각보다 높았다고 들었는데, 정확히 얼마였죠?",
  "그리고 저번 회의에서 가격 정책 어떻게 정했는지 기억나세요?",
  "Pro 티어 가격을 다시 한 번 확인하면 좋겠어요.",
];

export const DEMO_CARDS: { afterLine: number; query: string; ack: string; spec: Spec }[] = [
  {
    afterLine: 1,
    query: "국내 SaaS 시장 성장률",
    ack: "네, 최신 수치를 찾아볼게요.",
    spec: {
      title: "국내 SaaS 시장 성장률",
      spoken: "2025년 국내 SaaS 시장은 전년 대비 약 18.5% 성장해 2.4조 원 규모로 추정됩니다.",
      intent: "web_search",
      blocks: [
        { type: "stat", label: "전년 대비 성장률", value: "+18.5%" },
        { type: "stat", label: "시장 규모(추정)", value: "₩2.4조" },
        { type: "text", text: "클라우드 전환과 AI 도입이 성장을 견인. 중견기업 도입률이 특히 빠르게 상승." },
        { type: "accordion", label: "세부 동인", items: [
          "클라우드 전환 | 온프레미스 → SaaS 이전이 가속. 특히 협업·CRM 분야에서 두드러짐.",
          "AI 도입 | 생성형 AI 기능 탑재 제품의 ARPU가 비탑재 대비 약 1.6배.",
        ] },
        { type: "list", items: ["출처: 소프트웨어정책연구소 (2일 전)", "출처: 한국SaaS협회 2025 리포트"] },
        { type: "actions", items: [
          "경쟁사 점유율 비교",
          "성장 동인 자세히 | 국내 SaaS 시장 성장 동인을 자세히 분석해줘",
          "3년 전망 | 국내 SaaS 시장 향후 3년 성장 전망",
        ] },
      ],
    },
  },
  {
    afterLine: 3,
    query: "저번 회의 가격 정책",
    ack: "지난 회의록에서 찾아볼게요.",
    spec: {
      title: "이전 결정: 가격 정책",
      spoken: "지난 회의에서 Pro 티어는 석당 월 3만 9천 원으로 확정했고, 온프레미스는 별도 견적으로 가기로 했어요.",
      intent: "internal_rag",
      blocks: [
        { type: "heading", text: "4월 22일 제품 회의 결정사항" },
        { type: "table", items: ["티어 | 가격 | 대상", "Team | ₩29,000/석·월 | 소규모 팀", "Pro | ₩39,000/석·월 | 일반 기업", "Enterprise | 별도 견적 | 온프레미스·보안"] },
        { type: "checklist", items: ["Pro 티어 가격 페이지 반영", "영업팀에 신규 단가 공유", "온프레미스 견적 템플릿 업데이트"] },
        { type: "list", items: ["출처: Notion · 제품 회의록 (4/22)"] },
        { type: "actions", items: ["후속 메일 초안 | 가격 정책 확정 내용으로 영업팀 공유 메일 초안 써줘"] },
      ],
    },
  },
];
