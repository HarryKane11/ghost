import { useEffect, useState } from "react";
import { Type, Check } from "lucide-react";

const FONT_KEY = "ghost.appFont";

/** 저장된 폰트를 문서 루트에 적용(앱 시작 시 App에서 호출). 빈 값이면 기본 스택. */
export function loadAppFont(): void {
  try {
    const f = localStorage.getItem(FONT_KEY) || "";
    applyAppFont(f);
  } catch { /* ignore */ }
}

export function applyAppFont(family: string): void {
  const root = document.documentElement;
  if (family) root.style.setProperty("--app-font", `"${family}"`);
  else root.style.removeProperty("--app-font");
}

// Local Font Access API(Chromium/Electron). 타입 선언이 없어 느슨하게.
type LocalFont = { family: string };
function hasQueryLocalFonts(): boolean {
  return typeof (window as unknown as { queryLocalFonts?: unknown }).queryLocalFonts === "function";
}

/** 사용자 로컬에 설치된 폰트로 앱 글꼴을 바꾸는 설정. 관리자 화면에서 사용. */
export function FontSettings({ t }: { t: (k: string) => string }) {
  const [fonts, setFonts] = useState<string[]>([]);
  const [current, setCurrent] = useState<string>(() => {
    try { return localStorage.getItem(FONT_KEY) || ""; } catch { return ""; }
  });
  const [manual, setManual] = useState("");
  const [denied, setDenied] = useState(false);

  // 권한이 필요한 API라 버튼 클릭(사용자 제스처)으로 호출한다.
  const loadFonts = async () => {
    if (!hasQueryLocalFonts()) { setDenied(true); return; }
    try {
      const list: LocalFont[] = await (window as unknown as { queryLocalFonts: () => Promise<LocalFont[]> }).queryLocalFonts();
      const fams = Array.from(new Set(list.map((f) => f.family))).sort((a, b) => a.localeCompare(b));
      setFonts(fams);
      setDenied(false);
    } catch { setDenied(true); }
  };

  useEffect(() => { if (hasQueryLocalFonts()) loadFonts(); else setDenied(true); }, []);

  const pick = (family: string) => {
    setCurrent(family);
    applyAppFont(family);
    try { if (family) localStorage.setItem(FONT_KEY, family); else localStorage.removeItem(FONT_KEY); } catch { /* ignore */ }
  };

  return (
    <div className="mb-4 rounded-xl border border-hairline p-3.5">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold tracking-tight"><Type className="size-4 text-steel" />{t("font.title")}</div>
      <p className="mb-2.5 text-[11.5px] leading-relaxed text-stone">{t("font.desc")}</p>

      {fonts.length > 0 ? (
        <div className="flex items-center gap-2">
          <select value={current} onChange={(e) => pick(e.target.value)}
            className="h-9 min-w-0 flex-1 rounded-lg border border-hairline bg-surface-soft px-2 text-[12.5px] text-charcoal outline-none focus:border-ink/40"
            style={current ? { fontFamily: `"${current}"` } : undefined}>
            <option value="">{t("font.default")}</option>
            {fonts.map((f) => <option key={f} value={f} style={{ fontFamily: `"${f}"` }}>{f}</option>)}
          </select>
          {current && <Check className="size-4 shrink-0 text-spark-deep" />}
        </div>
      ) : (
        <div className="space-y-2">
          {denied && <p className="text-[11.5px] text-[#b06a00]">{t("font.unavailable")}</p>}
          {hasQueryLocalFonts() && (
            <button onClick={loadFonts} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-[12px] font-medium text-canvas">{t("font.scan")}</button>
          )}
          {/* 폴백: 폰트 이름 직접 입력 */}
          <div className="flex items-center gap-2">
            <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder={t("font.manualPlaceholder")}
              className="h-9 min-w-0 flex-1 rounded-lg border border-hairline bg-surface-soft px-2.5 text-[12.5px] text-charcoal outline-none placeholder:text-stone focus:border-ink/40"
              style={current ? { fontFamily: `"${current}"` } : undefined} />
            <button onClick={() => manual.trim() && pick(manual.trim())} disabled={!manual.trim()}
              className="h-9 shrink-0 rounded-lg border border-hairline px-3 text-[12.5px] text-steel hover:text-foreground disabled:opacity-40">{t("font.apply")}</button>
          </div>
          {current && (
            <div className="flex items-center justify-between text-[11.5px] text-stone">
              <span>{t("font.applied")}: <span className="font-medium text-charcoal" style={{ fontFamily: `"${current}"` }}>{current}</span></span>
              <button onClick={() => pick("")} className="text-steel hover:text-foreground underline">{t("font.reset")}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
