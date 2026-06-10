import {
  Sparkles,
  Globe,
  FileText,
  Volume2,
  ListChecks,
  Shield,
  ArrowRight,
  Code,
  Star,
  Download,
  SquareTerminal,
} from "lucide-react";
import { GhostLogo } from "@/components/ghost-logo";
import { MeetingDemo } from "@/components/meeting-demo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";


const GITHUB_URL = "https://github.com/HarryKane11/ghost";

const FEATURES = [
  {
    icon: Sparkles,
    title: "실시간 카드",
    body: "질문이나 정보 공백을 감지하면, 회의를 끊지 않고 옆에 조용히 카드를 띄웁니다.",
  },
  {
    icon: FileText,
    title: "사내 지식",
    body: "Notion·드라이브의 과거 결정과 회의록을 찾아 '저번에 어떻게 했더라'에 답합니다.",
  },
  {
    icon: Globe,
    title: "웹 검색",
    body: "최신 통계·시장·경쟁사 정보를 출처와 함께. 회의 속도에 맞춰 3초 안에.",
  },
  {
    icon: Volume2,
    title: "부를 때만 음성",
    body: '평소엔 무음. "재키"라고 부를 때만 또렷한 한국어 음성으로 답합니다.',
  },
  {
    icon: ListChecks,
    title: "회의 후 정리",
    body: "끝나면 화자별 액션아이템과 결정사항을 추출해 자동으로 기록합니다.",
  },
  {
    icon: Shield,
    title: "온프레미스 보안",
    body: "음성이 외부로 나가면 안 되는 팀을 위해, 사내 서버 전용 모드를 제공합니다.",
  },
];

const STEPS = [
  { n: "01", title: "조용히 듣습니다", body: "데스크탑 앱이 회의 오디오를 듣고 맥락을 이해합니다." },
  { n: "02", title: "필요한 걸 찾습니다", body: "정보 공백을 감지해 웹·사내 지식에서 근거를 검색합니다." },
  { n: "03", title: "카드로 띄웁니다", body: "출처와 신뢰도를 붙여, 흐름을 끊지 않고 보여줍니다." },
];

const OSS_POINTS = [
  {
    icon: Download,
    title: "무료로 받아서 바로",
    body: "계정도, 구독도, 신용카드도 없습니다. 받아서 당신의 키만 연결하면 끝.",
  },
  {
    icon: Shield,
    title: "로컬에서 동작",
    body: "전사는 온디바이스(Qwen3-ASR)에서. 오디오는 당신의 컴퓨터를 벗어나지 않습니다.",
  },
  {
    icon: SquareTerminal,
    title: "코드가 공개돼 있어요",
    body: "무엇을 보내고 무엇을 저장하는지 직접 감사하세요. MIT 라이선스, 자유롭게 포크.",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-hairline/80 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-6">
          <a href="#" className="flex items-center gap-2">
            <GhostLogo variant="icon" size={28} className="rounded-lg" />
            <span className="text-[15px] font-semibold tracking-tight">Ghost</span>
          </a>
          <nav className="ml-6 hidden items-center gap-6 text-[13.5px] text-steel md:flex">
            <a className="transition-colors hover:text-foreground" href="#features">기능</a>
            <a className="transition-colors hover:text-foreground" href="#how">작동 방식</a>
            <a className="transition-colors hover:text-foreground" href="#opensource">오픈소스</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <a href={GITHUB_URL} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              <Code className="size-4" />
              GitHub
            </a>
            <a href={GITHUB_URL + "/releases"} className={buttonVariants({ size: "sm" })}>다운로드</a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
        <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-10 text-center">
          <Badge variant="outline" size="md" className="mx-auto">
            <Sparkles className="size-3 text-spark-deep" />
            회의 중 능동 어시스턴트
          </Badge>
          <h1 className="mx-auto mt-6 max-w-3xl text-[44px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-6xl">
            회의가 멈추지 않게.
            <br />
            <span className="text-stone">곁에서 조용히 찾아주는 AI.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-[16px] leading-relaxed text-steel">
            Ghost는 회의를 듣다가 필요한 정보를 웹과 사내 지식에서 찾아 카드로 띄웁니다.
            흐름은 끊지 않고, 부를 때만 말합니다.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <a href={GITHUB_URL + "/releases"} className={buttonVariants({ size: "lg" })}>
              <Download className="size-4" />
              macOS 다운로드
            </a>
            <a href={GITHUB_URL} className={buttonVariants({ variant: "secondary", size: "lg" })}>
              <Code className="size-4" />
              GitHub에서 보기
            </a>
          </div>
          <p className="mt-4 text-[12.5px] text-stone">
            무료 · 오픈소스(MIT) · 로컬 실행 · 신용카드 불필요
          </p>
        </div>

        {/* Live demo */}
        <div className="relative mx-auto max-w-5xl px-6 pb-24">
          <div className="rounded-[28px] border border-hairline bg-surface-soft p-3 shadow-[0_24px_80px_-24px_rgba(10,10,10,0.18)]">
            <MeetingDemo />
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-hairline bg-surface-soft/50">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="max-w-2xl">
            <h2 className="text-[32px] font-semibold tracking-[-0.02em] sm:text-4xl">
              똑똑하게, 그러나 방해하지 않게.
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-steel">
              알림 피로 없이. Ghost는 확실할 때만 나서고, 애매하면 물러섭니다.
            </p>
          </div>
          <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-hairline bg-hairline sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="bg-canvas p-7 transition-colors hover:bg-surface-soft">
                <div className="flex size-10 items-center justify-center rounded-xl border border-hairline bg-surface-soft">
                  <f.icon className="size-[18px] text-ink" />
                </div>
                <h3 className="mt-5 text-[17px] font-semibold tracking-tight">{f.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-steel">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-t border-hairline">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
            <div>
              <Badge variant="soft" size="md">작동 방식</Badge>
              <h2 className="mt-5 text-[32px] font-semibold leading-tight tracking-[-0.02em] sm:text-4xl">
                듣고, 찾고,
                <br />
                띄웁니다.
              </h2>
              <p className="mt-4 max-w-md text-[16px] leading-relaxed text-steel">
                세 단계. 설정도, 명령도 필요 없습니다. 회의를 시작하면 Ghost가 알아서 합니다.
              </p>
            </div>
            <div className="space-y-3">
              {STEPS.map((s) => (
                <div
                  key={s.n}
                  className="flex items-start gap-5 rounded-2xl border border-hairline bg-canvas p-6"
                >
                  <span className="font-mono text-[13px] text-stone">{s.n}</span>
                  <div>
                    <h3 className="text-[17px] font-semibold tracking-tight">{s.title}</h3>
                    <p className="mt-1 text-[14px] leading-relaxed text-steel">{s.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Open source */}
      <section id="opensource" className="border-t border-hairline bg-surface-soft/50">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="text-center">
            <Badge variant="soft" size="md" className="mx-auto">
              <Code className="size-3" />
              오픈소스
            </Badge>
            <h2 className="mt-5 text-[32px] font-semibold tracking-[-0.02em] sm:text-4xl">
              무료이고, 열려 있습니다.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-[16px] leading-relaxed text-steel">
              Ghost는 가격표가 없습니다. 받아서, 당신의 AI 키를 연결하고, 그대로 쓰세요.
              필요하면 코드를 고쳐 당신의 팀에 맞추세요.
            </p>
          </div>
          <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-hairline bg-hairline sm:grid-cols-3">
            {OSS_POINTS.map((p) => (
              <div key={p.title} className="bg-canvas p-7">
                <div className="flex size-10 items-center justify-center rounded-xl border border-hairline bg-surface-soft">
                  <p.icon className="size-[18px] text-ink" />
                </div>
                <h3 className="mt-5 text-[17px] font-semibold tracking-tight">{p.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-steel">{p.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 flex items-center justify-center gap-3">
            <a href={GITHUB_URL + "/releases"} className={buttonVariants({ size: "lg" })}>
              <Download className="size-4" />
              다운로드
            </a>
            <a href={GITHUB_URL} className={buttonVariants({ variant: "secondary", size: "lg" })}>
              <Star className="size-4" />
              소스 보기 · 별표
            </a>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-hairline">
        <div className="mx-auto max-w-6xl px-6 py-24 text-center">
          <GhostLogo variant="icon" size={56} className="mx-auto rounded-2xl" />
          <h2 className="mx-auto mt-7 max-w-xl text-[32px] font-semibold leading-tight tracking-[-0.02em] sm:text-[40px]">
            다음 회의부터, 곁에 두세요.
          </h2>
          <div className="mt-8 flex items-center justify-center gap-3">
            <a href={GITHUB_URL + "/releases"} className={buttonVariants({ size: "lg" })}>
              <Download className="size-4" />
              macOS 다운로드
              <ArrowRight className="size-4" />
            </a>
            <a href={GITHUB_URL} className={buttonVariants({ variant: "secondary", size: "lg" })}>
              <Code className="size-4" />
              GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-hairline">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 sm:flex-row">
          <div className="flex items-center gap-2">
            <GhostLogo variant="mark" size={20} className="text-ink" />
            <span className="text-[13px] font-medium">Ghost</span>
          </div>
          <div className="flex items-center gap-5 text-[12.5px] text-stone">
            <a href={GITHUB_URL} className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground">
              <Code className="size-3.5" /> GitHub
            </a>
            <a href={GITHUB_URL + "/blob/main/LICENSE"} className="transition-colors hover:text-foreground">MIT 라이선스</a>
            <span>© 2026 Ghost</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
