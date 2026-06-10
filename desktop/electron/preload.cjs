const { contextBridge, ipcRenderer } = require("electron");

let version = "0.1.0";
try { version = require("../package.json").version || version; } catch { /* ignore */ }

// 메인 프로세스가 발급한 API 토큰(--ghost-token=...) — 렌더러가 모든 백엔드 요청에 동봉.
const token = (process.argv.find((a) => a.startsWith("--ghost-token=")) || "").split("=")[1] || "";

// 렌더러는 백엔드를 HTTP(localhost:8765)로 직접 호출하므로 별도 브리지는 최소화.
contextBridge.exposeInMainWorld("ghost", {
  platform: process.platform,
  isElectron: true,
  version,
  token,
  // macOS 개인정보 설정 열기 ("microphone" | "screen") — 권한 거부 사용자 구제.
  openPrivacy: (pane) => ipcRenderer.send("ghost:open-privacy", pane),
  // 트레이/전역 단축키에서 청취 토글 요청 → 렌더러 구독. 해제 함수 반환.
  onToggleListen: (cb) => {
    const h = () => cb();
    ipcRenderer.on("ghost:toggle-listen", h);
    return () => ipcRenderer.removeListener("ghost:toggle-listen", h);
  },
  // 디스플레이 모드별 창 크기/always-on-top 조절 (full | assist | interview).
  setWindowMode: (mode) => ipcRenderer.send("ghost:window-mode", mode),
  // ── 플로팅 고스트 오브 ──
  // 메인 창을 숨기고 작은 오브 창으로 전환(백그라운드 전사 유지).
  hideToOrb: () => ipcRenderer.send("ghost:hide-to-orb"),
  // 오브에서 메인 창 복귀.
  showMain: () => ipcRenderer.send("ghost:show-main"),
  // 메인 → 오브: 말풍선 텍스트(카드 도착 시 자기 생각을 밝히듯).
  orbBubble: (text) => ipcRenderer.send("ghost:orb-bubble", text),
  onOrbBubble: (cb) => {
    const h = (_e, text) => cb(text);
    ipcRenderer.on("ghost:orb-bubble", h);
    return () => ipcRenderer.removeListener("ghost:orb-bubble", h);
  },
  // 메인 → 오브: 청취 상태({active}) — 라이브 점 표시용.
  orbState: (state) => ipcRenderer.send("ghost:orb-state", state),
  onOrbState: (cb) => {
    const h = (_e, state) => cb(state);
    ipcRenderer.on("ghost:orb-state", h);
    return () => ipcRenderer.removeListener("ghost:orb-state", h);
  },
});
