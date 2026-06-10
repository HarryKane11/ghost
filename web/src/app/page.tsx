"use client";

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
  Languages,
  Check,
} from "lucide-react";
import * as React from "react";
import { GhostLogo } from "@/components/ghost-logo";
import { MeetingDemo } from "@/components/meeting-demo";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useI18n, LANGS } from "@/lib/i18n";

const GITHUB_URL = "https://github.com/HarryKane11/ghost";

/** 상단 지구본 — 사이트 언어 전환 (한국어/English/中文, localStorage 기억) */
function LangToggle() {
  const { lang, setLang, t } = useI18n();
  const [open, setOpen] = React.useState(false);
  void t;
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} aria-label="Language"
        className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <Languages className="size-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-50 min-w-[130px] rounded-xl border border-hairline bg-background p-1 shadow-lg">
            {LANGS.map((l) => (
              <button key={l.id} onClick={() => { setLang(l.id); setOpen(false); }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-steel transition-colors hover:bg-surface-soft hover:text-foreground">
                {l.label}
                {lang === l.id && <Check className="ml-auto size-3.5 text-spark-deep" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function Home() {
  const { t } = useI18n();

  const FEATURES = [
    { icon: Sparkles, title: t("feat.f1t"), body: t("feat.f1b") },
    { icon: FileText, title: t("feat.f2t"), body: t("feat.f2b") },
    { icon: Globe, title: t("feat.f3t"), body: t("feat.f3b") },
    { icon: Volume2, title: t("feat.f4t"), body: t("feat.f4b") },
    { icon: ListChecks, title: t("feat.f5t"), body: t("feat.f5b") },
    { icon: Shield, title: t("feat.f6t"), body: t("feat.f6b") },
  ];
  const STEPS = [
    { n: "01", title: t("how.s1t"), body: t("how.s1b") },
    { n: "02", title: t("how.s2t"), body: t("how.s2b") },
    { n: "03", title: t("how.s3t"), body: t("how.s3b") },
  ];
  const OSS_POINTS = [
    { icon: Download, title: t("oss.o1t"), body: t("oss.o1b") },
    { icon: Shield, title: t("oss.o2t"), body: t("oss.o2b") },
    { icon: SquareTerminal, title: t("oss.o3t"), body: t("oss.o3b") },
  ];

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
            <a className="transition-colors hover:text-foreground" href="#features">{t("nav.features")}</a>
            <a className="transition-colors hover:text-foreground" href="#how">{t("nav.how")}</a>
            <a className="transition-colors hover:text-foreground" href="#opensource">{t("nav.oss")}</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <LangToggle />
            <ThemeToggle />
            <a href={GITHUB_URL} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              <Code className="size-4" />
              GitHub
            </a>
            <a href={GITHUB_URL + "/releases"} className={buttonVariants({ size: "sm" })}>{t("nav.download")}</a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
        <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-10 text-center">
          <Badge variant="outline" size="md" className="mx-auto">
            <Sparkles className="size-3 text-spark-deep" />
            {t("hero.badge")}
          </Badge>
          <h1 className="mx-auto mt-6 max-w-3xl text-[44px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-6xl">
            {t("hero.title1")}
            <br />
            <span className="text-stone">{t("hero.title2")}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-[16px] leading-relaxed text-steel">
            {t("hero.sub")}
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <a href={GITHUB_URL + "/releases"} className={buttonVariants({ size: "lg" })}>
              <Download className="size-4" />
              {t("hero.ctaMac")}
            </a>
            <a href={GITHUB_URL} className={buttonVariants({ variant: "secondary", size: "lg" })}>
              <Code className="size-4" />
              {t("hero.ctaGit")}
            </a>
          </div>
          <p className="mt-4 text-[12.5px] text-stone">
            {t("hero.fineprint")}
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
              {t("feat.title")}
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-steel">
              {t("feat.sub")}
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
              <Badge variant="soft" size="md">{t("how.badge")}</Badge>
              <h2 className="mt-5 text-[32px] font-semibold leading-tight tracking-[-0.02em] sm:text-4xl">
                {t("how.title1")}
                <br />
                {t("how.title2")}
              </h2>
              <p className="mt-4 max-w-md text-[16px] leading-relaxed text-steel">
                {t("how.sub")}
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
              {t("oss.badge")}
            </Badge>
            <h2 className="mt-5 text-[32px] font-semibold tracking-[-0.02em] sm:text-4xl">
              {t("oss.title")}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-[16px] leading-relaxed text-steel">
              {t("oss.sub")}
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
              {t("nav.download")}
            </a>
            <a href={GITHUB_URL} className={buttonVariants({ variant: "secondary", size: "lg" })}>
              <Star className="size-4" />
              {t("oss.ctaStar")}
            </a>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-hairline">
        <div className="mx-auto max-w-6xl px-6 py-24 text-center">
          <GhostLogo variant="icon" size={56} className="mx-auto rounded-2xl" />
          <h2 className="mx-auto mt-7 max-w-xl text-[32px] font-semibold leading-tight tracking-[-0.02em] sm:text-[40px]">
            {t("cta.title")}
          </h2>
          <div className="mt-8 flex items-center justify-center gap-3">
            <a href={GITHUB_URL + "/releases"} className={buttonVariants({ size: "lg" })}>
              <Download className="size-4" />
              {t("hero.ctaMac")}
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
            <a href={GITHUB_URL + "/blob/main/LICENSE"} className="transition-colors hover:text-foreground">{t("footer.license")}</a>
            <span>© 2026 Ghost</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
