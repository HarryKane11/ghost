const { contextBridge, ipcRenderer } = require("electron");

let version = "0.1.0";
try { version = require("../package.json").version || version; } catch { /* ignore */ }

// 렌더러는 백엔드를 HTTP(localhost:8765)로 직접 호출하므로 별도 브리지는 최소화.
contextBridge.exposeInMainWorld("ghost", {
  platform: process.platform,
  isElectron: true,
  version,
  // 트레이/전역 단축키에서 청취 토글 요청 → 렌더러 구독. 해제 함수 반환.
  onToggleListen: (cb) => {
    const h = () => cb();
    ipcRenderer.on("ghost:toggle-listen", h);
    return () => ipcRenderer.removeListener("ghost:toggle-listen", h);
  },
});
