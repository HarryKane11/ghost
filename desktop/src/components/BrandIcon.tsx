import { OpenAI, Codex, Claude, Anthropic, Ollama, Gemini, Google, HuggingFace, Github, Notion } from "@lobehub/icons";
import { FileText, Sheet, Presentation, Globe, SquareTerminal, Image as ImageIcon, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import slackSvg from "@/assets/brands/slack.svg";
import atlassianSvg from "@/assets/brands/atlassian.svg";
import linearSvg from "@/assets/brands/linear.svg";

/**
 * 브랜드 로고 SVG. AI 브랜드는 @lobehub/icons(번들), lobehub에 없는 브랜드(Slack·Atlassian·Linear)는
 * 번들된 로컬 SVG로 표시. 알 수 없는 이름이면 null → 호출부에서 폴백.
 */

// 우리 키 → lobehub 컴포넌트
const LOBE: Record<string, { Color?: unknown; Avatar?: unknown }> = {
  openai: OpenAI, codex: Codex, chatgpt: OpenAI,
  claude: Claude, anthropic: Anthropic,
  ollama: Ollama, gemini: Gemini, google: Google,
  huggingface: HuggingFace, "hugging-face": HuggingFace,
  github: Github, notion: Notion,
};

// lobehub에 없는 브랜드 → 번들된 로컬 SVG (오프라인 OK)
const LOCAL: Record<string, string> = {
  slack: slackSvg,
  atlassian: atlassianSvg, "atlassian-rovo": atlassianSvg, jira: atlassianSvg, confluence: atlassianSvg,
  linear: linearSvg,
};

export function BrandIcon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const key = (name || "").toLowerCase().trim();

  const lobe = LOBE[key];
  if (lobe) {
    // 컬러 우선, 없으면 아바타, 없으면 기본(mono).
    const C = (lobe.Color || lobe.Avatar || lobe) as React.ComponentType<{ size?: number; className?: string }>;
    return <C size={size} className={className} />;
  }

  const local = LOCAL[key];
  if (local) {
    return <img src={local} width={size} height={size} className={className} alt={name} style={{ display: "block" }} />;
  }

  return null;
}

/** 이 이름에 브랜드 로고가 있는가 (호출부에서 폴백 결정용). */
export function hasBrand(name: string): boolean {
  const key = (name || "").toLowerCase().trim();
  return key in LOBE || key in LOCAL;
}

// 브랜드가 아닌 Codex 내장 도구 → 적절한 일반 아이콘(lucide)
const TOOL: Record<string, LucideIcon> = {
  documents: FileText,
  spreadsheets: Sheet,
  presentations: Presentation,
  browser: Globe,
  node_repl: SquareTerminal,
  web_search: Globe,
  image_gen: ImageIcon,
  code: SquareTerminal,
  command: SquareTerminal,
};

/** 브랜드면 로고, 아니면 도구 아이콘. 둘 다 없으면 null. */
export function EntityIcon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  if (hasBrand(name)) return <BrandIcon name={name} size={size} className={className} />;
  const key = (name || "").toLowerCase().trim();
  const T = TOOL[key];
  if (T) return <T size={size} className={cn("text-steel", className)} />;
  return null;
}

/** 브랜드 또는 도구 아이콘이 있는가. */
export function hasEntityIcon(name: string): boolean {
  return hasBrand(name) || (name || "").toLowerCase().trim() in TOOL;
}
