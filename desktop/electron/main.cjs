const { app, BrowserWindow, session, shell, desktopCapturer, Tray, Menu, globalShortcut, nativeImage, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const BACKEND_PORT = 8765;
const TOGGLE_SHORTCUT = "CommandOrControl+Shift+G";
let backendProc = null;
let win = null;
let tray = null;

const HOME = os.homedir();
const BIN_DIRS = ["/opt/homebrew/bin", path.join(HOME, ".local/bin"), "/usr/local/bin", "/usr/bin"];

function firstExisting(names, dirs = BIN_DIRS) {
  for (const d of dirs) for (const n of names) {
    const p = path.join(d, n);
    if (fs.existsSync(p)) return p;
  }
  return names[0];
}

function backendEnv() {
  const env = { ...process.env };
  // GUI 앱은 셸 PATH를 상속하지 않으므로 보강 (uv·ollama·codex·ffmpeg 탐색)
  env.PATH = [...BIN_DIRS, env.PATH || ""].join(":");
  return env;
}

function backendAlive() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port: BACKEND_PORT, path: "/api/health", timeout: 800 },
      (res) => resolve(res.statusCode === 200)
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

/** 패키징 시 번들된 백엔드를 쓰기 가능한 위치로 복사하고 그 경로를 반환. */
function resolveBackendDir() {
  if (!app.isPackaged) return path.join(__dirname, "..", "..", "local");
  const src = path.join(process.resourcesPath, "backend");
  const dst = path.join(app.getPath("userData"), "backend");
  try {
    const srcLock = path.join(src, "uv.lock");
    const dstLock = path.join(dst, "uv.lock");
    const needCopy =
      !fs.existsSync(dstLock) ||
      (fs.existsSync(srcLock) &&
        fs.statSync(srcLock).mtimeMs > fs.statSync(dstLock).mtimeMs);
    if (needCopy) {
      fs.cpSync(src, dst, { recursive: true });
    }
  } catch (e) {
    console.error("[backend] copy failed:", e.message);
  }
  return dst;
}

async function ensureBackend() {
  if (await backendAlive()) return;
  const cwd = resolveBackendDir();
  const uv = firstExisting(["uv"]);
  backendProc = spawn(
    uv,
    ["run", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", String(BACKEND_PORT), "--log-level", "warning"],
    { cwd, stdio: "inherit", env: backendEnv() }
  );
  backendProc.on("error", (e) => console.error("[backend] spawn failed:", e.message));
  // 첫 실행은 uv sync(의존성 다운로드)로 수 분 걸릴 수 있음 → 넉넉히 대기
  for (let i = 0; i < 600; i++) {
    if (await backendAlive()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error("[backend] did not become healthy in time");
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 880,
    minHeight: 560,
    backgroundColor: "#ffffff",
    titleBarStyle: "hiddenInset",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.once("ready-to-show", () => win.show());

  const MEDIA_PERMS = ["media", "audioCapture", "mediaKeySystem", "display-capture"];
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(MEDIA_PERMS.includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    MEDIA_PERMS.includes(permission)
  );

  // 시스템 오디오(상대방 목소리) 루프백 캡처
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
        callback({ video: sources[0], audio: "loopback" });
      });
    },
    { useSystemPicker: false }
  );

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) shell.openExternal(url);
    return { action: "deny" };
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

// 디스플레이 모드별 창 크기/always-on-top. assist=컴팩트 플로팅, full/interview=넓게.
ipcMain.on("ghost:window-mode", (_e, mode) => {
  if (!win) return;
  try {
    if (mode === "assist") {
      win.setMinimumSize(360, 460);
      win.setSize(440, 640, true);
      win.setAlwaysOnTop(true, "floating");
    } else {
      win.setAlwaysOnTop(false);
      win.setMinimumSize(880, 560);
      const [w, h] = win.getSize();
      if (w < 880 || h < 560) win.setSize(Math.max(w, 1100), Math.max(h, 720), true);
    }
  } catch { /* ignore */ }
});

function showWindow() {
  if (!win) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// 트레이/전역 단축키 → 렌더러에 청취 토글 요청
function requestToggleListen() {
  showWindow();
  win?.webContents.send("ghost:toggle-listen");
}

function trayIcon() {
  const candidates = [
    path.join(process.resourcesPath || "", "tray-icon.png"), // 패키지 (extraResources)
    path.join(__dirname, "..", "build", "icon.png"),          // 개발
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const img = nativeImage.createFromPath(p).resize({ width: 18, height: 18 });
        if (!img.isEmpty()) return img;
      }
    } catch { /* ignore */ }
  }
  return null;
}

function createTray() {
  const icon = trayIcon();
  if (!icon) return; // 아이콘이 없으면 트레이 생략
  try {
    tray = new Tray(icon);
    tray.setToolTip("Ghost — 회의 어시스턴트");
    const menu = Menu.buildFromTemplate([
      { label: "Ghost 열기", click: showWindow },
      { label: `청취 시작/정지  (${TOGGLE_SHORTCUT.replace("CommandOrControl", "⌘")})`, click: requestToggleListen },
      { type: "separator" },
      { label: "종료", click: () => app.quit() },
    ]);
    tray.setContextMenu(menu);
    tray.on("click", showWindow);
  } catch (e) {
    console.error("[tray] failed:", e.message);
  }
}

app.whenReady().then(() => {
  createWindow();        // 창을 먼저 띄우고
  ensureBackend();       // 백엔드는 백그라운드로 (UI가 상태 폴링)
  createTray();
  try { globalShortcut.register(TOGGLE_SHORTCUT, requestToggleListen); } catch (e) { console.error("[shortcut] failed:", e.message); }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  try { globalShortcut.unregisterAll(); } catch { /* ignore */ }
});

app.on("quit", () => {
  if (backendProc) { try { backendProc.kill(); } catch {} }
  if (tray) { try { tray.destroy(); } catch {} }
});
