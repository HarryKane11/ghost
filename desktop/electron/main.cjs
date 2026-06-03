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

const IS_WIN = process.platform === "win32";
const HOME = os.homedir();
// GUI 앱은 셸 PATH를 상속하지 않으므로 uv/ffmpeg/codex 탐색용 디렉터리를 OS별로 보강.
const BIN_DIRS = IS_WIN
  ? [
      path.join(HOME, ".local", "bin"),
      path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Links"),
      path.join(process.env.LOCALAPPDATA || "", "Programs", "uv"),
      path.join(process.env.APPDATA || "", "Python", "Scripts"),
    ].filter(Boolean)
  : ["/opt/homebrew/bin", path.join(HOME, ".local/bin"), "/usr/local/bin", "/usr/bin"];

function firstExisting(names, dirs = BIN_DIRS) {
  const cands = IS_WIN ? names.flatMap((n) => [`${n}.exe`, `${n}.cmd`, n]) : names;
  for (const d of dirs) for (const n of cands) {
    const p = path.join(d, n);
    if (fs.existsSync(p)) return p;
  }
  return IS_WIN ? `${names[0]}.exe` : names[0];   // PATH에서 .exe 해석되도록
}

// 이 빌드가 기대하는 백엔드 버전 마커. 앱이 띄운 백엔드만 이 값을 health에 보고한다.
function expectedBuild() {
  try { return app.getVersion(); } catch { return "dev"; }
}

function backendEnv() {
  const env = { ...process.env };
  // GUI 앱은 셸 PATH를 상속하지 않으므로 보강 (uv·ollama·codex·ffmpeg 탐색)
  env.PATH = [...BIN_DIRS, env.PATH || ""].join(path.delimiter);
  env.GHOST_BUILD = expectedBuild();   // /api/health가 echo → '내 백엔드' 식별
  return env;
}

/** /api/health의 version을 반환(고스트 백엔드가 아니거나 응답 없으면 null). */
function backendHealth() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port: BACKEND_PORT, path: "/api/health", timeout: 800 },
      (res) => {
        if (res.statusCode !== 200) { res.resume(); return resolve(null); }
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => { try { resolve(JSON.parse(body).version || "dev"); } catch { resolve("dev"); } });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
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

/** 포트를 점유한 '옛/외부' 고스트 백엔드를 회수(종료). best-effort. */
function reclaimPort() {
  return new Promise((resolve) => {
    try {
      const r = IS_WIN
        ? spawn("cmd", ["/c", `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${BACKEND_PORT} ^| findstr LISTENING') do taskkill /F /PID %a`], { stdio: "ignore", windowsHide: true })
        : spawn("/bin/sh", ["-c", `lsof -ti tcp:${BACKEND_PORT} | xargs kill 2>/dev/null; sleep 1`], { stdio: "ignore" });
      r.on("close", () => resolve());
      r.on("error", () => resolve());
    } catch { resolve(); }
  });
}

// 패키징 앱의 렌더러를 file:// 대신 내부 http://127.0.0.1로 서빙한다.
// file://은 origin이 없어 YouTube IFrame 등이 거부(오류 150/152/153)하므로, dev(localhost)와
// 동일한 진짜 http origin을 줘서 임베드가 정상 동작하게 한다.
let rendererBase = null;
const _MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".ico": "image/x-icon", ".json": "application/json",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".map": "application/json", ".webmanifest": "application/manifest+json",
};
function startRendererServer() {
  if (rendererBase) return Promise.resolve(rendererBase);
  const dir = path.join(__dirname, "..", "dist");
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      try {
        let p = decodeURIComponent((req.url || "/").split("?")[0]);
        if (p === "/" || p === "") p = "/index.html";
        let fp = path.normalize(path.join(dir, p));
        if (!fp.startsWith(dir)) { res.statusCode = 403; return res.end(); }   // 경로 탈출 방지
        fs.readFile(fp, (err, buf) => {
          if (err) {   // SPA 폴백 → index.html
            fs.readFile(path.join(dir, "index.html"), (e2, b2) => {
              if (e2) { res.statusCode = 404; return res.end(); }
              res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(b2);
            });
            return;
          }
          res.setHeader("Content-Type", _MIME[path.extname(fp).toLowerCase()] || "application/octet-stream");
          res.end(buf);
        });
      } catch { res.statusCode = 500; res.end(); }
    });
    srv.on("error", () => resolve(null));
    srv.listen(0, "127.0.0.1", () => { rendererBase = `http://127.0.0.1:${srv.address().port}`; resolve(rendererBase); });
  });
}

/** 패키징 시 번들된 백엔드를 쓰기 가능한 위치로 복사하고 그 경로를 반환. */
function resolveBackendDir() {
  if (!app.isPackaged) return path.join(__dirname, "..", "..", "local");
  const src = path.join(process.resourcesPath, "backend");
  const dst = path.join(app.getPath("userData"), "backend");
  try {
    // 갱신 판단: uv.lock(의존성) 또는 server.py(코드)가 번들 쪽이 더 새것이면 다시 복사.
    // (같은 버전으로 재빌드해 lock은 그대로지만 .py만 바뀐 경우도 갱신되게 server.py도 본다.)
    const newer = (name) => {
      const s = path.join(src, name), dd = path.join(dst, name);
      return fs.existsSync(s) && (!fs.existsSync(dd) || fs.statSync(s).mtimeMs > fs.statSync(dd).mtimeMs);
    };
    const needCopy = !fs.existsSync(path.join(dst, "uv.lock")) || newer("uv.lock") || newer("server.py");
    if (needCopy) {
      fs.cpSync(src, dst, { recursive: true });   // .venv는 src에 없어 보존됨(코드만 갱신)
    }
  } catch (e) {
    console.error("[backend] copy failed:", e.message);
  }
  return dst;
}

async function ensureBackend() {
  const ver = await backendHealth();
  if (ver !== null) {
    // 개발 모드는 개발자가 띄운 백엔드를 그대로 쓴다(버전 강제 X).
    if (!app.isPackaged) return;
    // 패키징 모드: 내 빌드의 백엔드면 재사용, 아니면(옛/외부 백엔드가 포트 점유) 회수 후 내 것 기동.
    if (ver === expectedBuild()) return;
    console.error(`[backend] foreign/old backend on ${BACKEND_PORT} (version=${ver}, expected=${expectedBuild()}) → reclaiming`);
    await reclaimPort();
  }
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

async function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 880,
    minHeight: 560,
    backgroundColor: "#ffffff",
    // macOS만 신호등 인셋(hiddenInset). Windows/Linux는 기본 프레임(네이티브 최소/최대/닫기).
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
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
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    // 패키징: file:// 대신 내부 http로 로드(진짜 origin → YouTube 임베드 정상). 실패 시 file:// 폴백.
    const base = await startRendererServer();
    if (base) win.loadURL(`${base}/index.html`);
    else win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
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
