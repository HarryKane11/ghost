"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "ko" | "en" | "zh";
export const LANGS: { id: Lang; label: string }[] = [
  { id: "ko", label: "한국어" },
  { id: "en", label: "English" },
  { id: "zh", label: "中文" },
];

const KEY = "ghost.site.lang";

export function detectLang(): Lang {
  try {
    const l = (navigator.language || "").toLowerCase();
    if (l.startsWith("ko")) return "ko";
    if (l.startsWith("zh")) return "zh";
    return "en";
  } catch {
    return "en";
  }
}

type Entry = { ko: string; en: string; zh: string };
const D: Record<string, Entry> = {
  "nav.features": { ko: "기능", en: "Features", zh: "功能" },
  "nav.how": { ko: "작동 방식", en: "How it works", zh: "工作原理" },
  "nav.oss": { ko: "오픈소스", en: "Open source", zh: "开源" },
  "nav.download": { ko: "다운로드", en: "Download", zh: "下载" },

  "hero.badge": { ko: "회의 중 능동 어시스턴트", en: "Proactive in-meeting assistant", zh: "会议中的主动助手" },
  "hero.title1": { ko: "회의가 멈추지 않게.", en: "Keep the meeting moving.", zh: "让会议不再停顿。" },
  "hero.title2": { ko: "곁에서 조용히 찾아주는 AI.", en: "An AI that quietly finds answers beside you.", zh: "在你身旁安静查找答案的 AI。" },
  "hero.sub": {
    ko: "Ghost는 회의를 듣다가 필요한 정보를 웹과 사내 지식에서 찾아 카드로 띄웁니다. 흐름은 끊지 않고, 부를 때만 말합니다.",
    en: "Ghost listens to your meeting and surfaces what you need from the web and your internal knowledge — as quiet cards. It never interrupts, and only speaks when called.",
    zh: "Ghost 边听会议，边从网络和内部知识中找到所需信息，以卡片形式安静呈现。不打断节奏，只在被呼唤时开口。",
  },
  "hero.ctaMac": { ko: "macOS 다운로드", en: "Download for macOS", zh: "下载 macOS 版" },
  "hero.ctaGit": { ko: "GitHub에서 보기", en: "View on GitHub", zh: "在 GitHub 查看" },
  "hero.fineprint": { ko: "무료 · 오픈소스(MIT) · 로컬 실행 · 신용카드 불필요", en: "Free · Open source (MIT) · Runs locally · No credit card", zh: "免费 · 开源（MIT）· 本地运行 · 无需信用卡" },

  "feat.title": { ko: "똑똑하게, 그러나 방해하지 않게.", en: "Smart, but never in the way.", zh: "聪明，但绝不打扰。" },
  "feat.sub": { ko: "알림 피로 없이. Ghost는 확실할 때만 나서고, 애매하면 물러섭니다.", en: "No notification fatigue. Ghost steps in only when it's sure, and backs off when it's not.", zh: "没有通知疲劳。Ghost 只在确定时出手，不确定时退让。" },
  "feat.f1t": { ko: "실시간 카드", en: "Live cards", zh: "实时卡片" },
  "feat.f1b": { ko: "질문이나 정보 공백을 감지하면, 회의를 끊지 않고 옆에 조용히 카드를 띄웁니다.", en: "When it senses a question or an information gap, it quietly drops a card beside the meeting — without interrupting.", zh: "察觉到问题或信息空白时，在会议旁安静地弹出卡片，绝不打断。" },
  "feat.f2t": { ko: "사내 지식", en: "Internal knowledge", zh: "内部知识" },
  "feat.f2b": { ko: "Notion·드라이브의 과거 결정과 회의록을 찾아 '저번에 어떻게 했더라'에 답합니다.", en: "Finds past decisions and notes in Notion or Drive to answer “what did we decide last time?”", zh: "从 Notion、云盘中找到过去的决定与纪要，回答“上次我们是怎么定的”。" },
  "feat.f3t": { ko: "웹 검색", en: "Web search", zh: "网络搜索" },
  "feat.f3b": { ko: "최신 통계·시장·경쟁사 정보를 출처와 함께. 회의 속도에 맞춰 3초 안에.", en: "Fresh stats, market and competitor info with sources — in seconds, at meeting speed.", zh: "最新统计、市场与竞品信息并附来源——秒级响应，跟上会议节奏。" },
  "feat.f4t": { ko: "부를 때만 음성", en: "Voice only when called", zh: "呼唤才出声" },
  "feat.f4b": { ko: '평소엔 무음. 부를 때만 또렷한 음성으로 답합니다.', en: "Silent by default. It answers out loud only when you call it.", zh: "平时静音。只有呼唤它时才以清晰语音作答。" },
  "feat.f5t": { ko: "회의 후 정리", en: "Post-meeting wrap-up", zh: "会后整理" },
  "feat.f5b": { ko: "끝나면 화자별 액션아이템과 결정사항을 추출해 자동으로 기록합니다.", en: "When it ends, action items and decisions are extracted and recorded automatically.", zh: "会议结束后，自动提取并记录行动项与决定事项。" },
  "feat.f6t": { ko: "온프레미스 보안", en: "On-prem security", zh: "本地化安全" },
  "feat.f6b": { ko: "음성이 외부로 나가면 안 되는 팀을 위해, 사내 서버 전용 모드를 제공합니다.", en: "For teams whose audio must never leave the building, there's a fully on-prem mode.", zh: "为音频不能外传的团队提供纯内网模式。" },

  "how.badge": { ko: "작동 방식", en: "How it works", zh: "工作原理" },
  "how.title1": { ko: "듣고, 찾고,", en: "Listen, find,", zh: "聆听、查找、" },
  "how.title2": { ko: "띄웁니다.", en: "surface.", zh: "呈现。" },
  "how.sub": { ko: "세 단계. 설정도, 명령도 필요 없습니다. 회의를 시작하면 Ghost가 알아서 합니다.", en: "Three steps. No setup, no commands. Start the meeting and Ghost does the rest.", zh: "三个步骤。无需设置，无需命令。开始会议，Ghost 自会处理。" },
  "how.s1t": { ko: "조용히 듣습니다", en: "It listens quietly", zh: "安静聆听" },
  "how.s1b": { ko: "데스크탑 앱이 회의 오디오를 듣고 맥락을 이해합니다.", en: "The desktop app hears the meeting audio and follows the context.", zh: "桌面应用聆听会议音频并理解上下文。" },
  "how.s2t": { ko: "필요한 걸 찾습니다", en: "It finds what's needed", zh: "查找所需" },
  "how.s2b": { ko: "정보 공백을 감지해 웹·사내 지식에서 근거를 검색합니다.", en: "It detects information gaps and searches the web and internal knowledge for evidence.", zh: "察觉信息空白后，在网络与内部知识中检索依据。" },
  "how.s3t": { ko: "카드로 띄웁니다", en: "It surfaces a card", zh: "以卡片呈现" },
  "how.s3b": { ko: "출처와 신뢰도를 붙여, 흐름을 끊지 않고 보여줍니다.", en: "With source and confidence attached — shown without breaking your flow.", zh: "附上来源与置信度，在不打断节奏的前提下展示。" },

  "oss.badge": { ko: "오픈소스", en: "Open source", zh: "开源" },
  "oss.title": { ko: "무료이고, 열려 있습니다.", en: "Free, and open.", zh: "免费，且开放。" },
  "oss.sub": { ko: "Ghost는 가격표가 없습니다. 받아서, 당신의 AI 키를 연결하고, 그대로 쓰세요. 필요하면 코드를 고쳐 당신의 팀에 맞추세요.", en: "Ghost has no price tag. Download it, connect your own AI key, and use it. Fork the code and fit it to your team if you like.", zh: "Ghost 没有价格标签。下载后接入你自己的 AI 密钥即可使用。需要时尽管修改代码，适配你的团队。" },
  "oss.o1t": { ko: "무료로 받아서 바로", en: "Grab it and go", zh: "拿来即用" },
  "oss.o1b": { ko: "계정도, 구독도, 신용카드도 없습니다. 받아서 당신의 키만 연결하면 끝.", en: "No account, no subscription, no credit card. Download, connect your key, done.", zh: "无需账号、订阅或信用卡。下载并接入你的密钥即可。" },
  "oss.o2t": { ko: "로컬에서 동작", en: "Runs locally", zh: "本地运行" },
  "oss.o2b": { ko: "전사는 온디바이스(Qwen3-ASR)에서. 오디오는 당신의 컴퓨터를 벗어나지 않습니다.", en: "Transcription runs on-device (Qwen3-ASR). Audio never leaves your computer.", zh: "转写在设备端完成（Qwen3-ASR）。音频不会离开你的电脑。" },
  "oss.o3t": { ko: "코드가 공개돼 있어요", en: "The code is public", zh: "代码公开" },
  "oss.o3b": { ko: "무엇을 보내고 무엇을 저장하는지 직접 감사하세요. MIT 라이선스, 자유롭게 포크.", en: "Audit exactly what it sends and stores. MIT licensed — fork freely.", zh: "亲自审查它发送与存储的内容。MIT 许可，自由 fork。" },
  "oss.ctaStar": { ko: "소스 보기 · 별표", en: "View source · Star", zh: "查看源码 · 加星" },

  "cta.title": { ko: "다음 회의부터, 곁에 두세요.", en: "Keep it beside you, starting next meeting.", zh: "从下一场会议开始，让它伴你左右。" },
  "footer.license": { ko: "MIT 라이선스", en: "MIT License", zh: "MIT 许可证" },

  // Live demo
  "demo.live": { ko: "제품 전략 회의 · 듣는 중", en: "Product strategy meeting · listening", zh: "产品战略会议 · 聆听中" },
  "demo.silent": { ko: "무음", en: "silent", zh: "静音" },
  "demo.empty": { ko: "필요할 때 조용히 카드가 떠요", en: "Cards appear quietly when needed", zh: "需要时卡片会安静浮现" },
  "demo.kindWeb": { ko: "웹 검색", en: "Web search", zh: "网络搜索" },
  "demo.kindInternal": { ko: "사내 지식", en: "Internal knowledge", zh: "内部知识" },
  "demo.kindGlossary": { ko: "용어", en: "Glossary", zh: "术语" },
};

export type TFn = (key: string) => string;

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: TFn };
const I18nCtx = createContext<Ctx>({ lang: "ko", setLang: () => {}, t: (k) => k });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ko");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY) as Lang | null;
      const l = saved && ["ko", "en", "zh"].includes(saved) ? saved : detectLang();
      setLangState(l);
      document.documentElement.lang = l;
    } catch { /* ignore */ }
  }, []);
  const setLang = (l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(KEY, l); document.documentElement.lang = l; } catch { /* ignore */ }
  };
  const t: TFn = (k) => D[k]?.[lang] ?? D[k]?.ko ?? k;
  return <I18nCtx.Provider value={{ lang, setLang, t }}>{children}</I18nCtx.Provider>;
}

export function useI18n() {
  return useContext(I18nCtx);
}
