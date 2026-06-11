const { app, BrowserWindow, session, shell, desktopCapturer, Tray, Menu, globalShortcut, nativeImage, ipcMain, screen } = require("electron");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const BACKEND_PORT = 8765;
const TOGGLE_SHORTCUT = "CommandOrControl+Shift+G";
// API 토큰: 앱이 발급해 백엔드(env)와 렌더러(preload argv)에 같이 꽂는다.
// 브라우저의 임의 사이트가 localhost:8765로 회의 전사를 읽어가는 것을 차단.
// 개발 모드(수동 uvicorn)는 백엔드에 GHOST_TOKEN이 없으므로 인증이 강제되지 않는다.
// 토큰은 설치 단위로 userData에 영속한다 — 실행마다 재발급하면 이전 실행의 백엔드가
// 포트에 살아남았을 때(자식 uvicorn이 kill을 비껴간 경우) health/버전은 정상이라 재사용되는데
// 토큰만 어긋나 모든 요청이 401 → 재시작 후 '백엔드 끊김'으로 보였다.
function loadOrCreateToken() {
  try {
    const p = path.join(app.getPath("userData"), "api-token");
    try {
      const t = fs.readFileSync(p, "utf8").trim();
      if (/^[0-9a-f]{32,}$/.test(t)) return t;
    } catch { /* first run */ }
    const t = crypto.randomBytes(24).toString("hex");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, t, { mode: 0o600 });
    return t;
  } catch {
    return crypto.randomBytes(24).toString("hex");   // userData 접근 불가 시 세션 한정 토큰
  }
}
const GHOST_TOKEN = loadOrCreateToken();
let backendProc = null;
let win = null;
let tray = null;
let orb = null;   // 플로팅 고스트 오브(미니 창) — 메인 창을 숨겨도 백그라운드 전사는 계속된다

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
  // GUI 앱은 셸 PATH를 상속하지 않으므로 보강. 패키징 시 동봉한 ffmpeg/ffprobe(bin)를 최우선.
  const dirs = [...BIN_DIRS];
  if (app.isPackaged) dirs.unshift(path.join(process.resourcesPath, "bin"));
  env.PATH = [...dirs, env.PATH || ""].join(path.delimiter);
  env.GHOST_BUILD = expectedBuild();   // /api/health가 echo → '내 백엔드' 식별
  env.GHOST_PORT = String(BACKEND_PORT);
  if (app.isPackaged) env.GHOST_TOKEN = GHOST_TOKEN;   // 패키징 앱만 API 토큰 강제(dev는 자유)
  try { env.GHOST_CONFIG_DIR = app.getPath("userData"); } catch { /* ignore */ }   // 쓰기 가능 .env 위치
  return env;
}

// 동봉된 uv 경로(패키징 시 resources/bin/uv). 없으면 PATH에서 탐색.
// uv가 Python·의존성·STT 엔진을 필요할 때 자동 다운로드하므로 사용자 PC에 아무 설치도 불필요.
function uvPath() {
  if (app.isPackaged) {
    const p = path.join(process.resourcesPath, "bin", IS_WIN ? "uv.exe" : "uv");
    if (fs.existsSync(p)) return p;
  }
  return firstExisting(["uv"]);
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

/** 기존 백엔드가 '내 토큰'을 받아주는지(인증 포함) 확인. health는 토큰 예외라 따로 본다. */
function backendAuthOk() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port: BACKEND_PORT, path: "/api/status", timeout: 1500, headers: { "x-ghost-token": GHOST_TOKEN } },
      (res) => { res.resume(); resolve(res.statusCode === 200); }
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
// 렌더러 포트는 고정 후보를 순서대로 시도한다. 임의 포트(listen 0)는 실행마다 origin이
// 바뀌어 localStorage(온보딩 완료 플래그·테마·언어 등)가 매번 초기화됐다 — 가이드가
// 재실행 때마다 다시 뜨던 원인. 고정 포트가 전부 점유된 경우에만 임시 포트로 폴백.
const RENDERER_PORTS = [8766, 8767, 8768];
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
    const ports = [...RENDERER_PORTS, 0];
    const tryNext = () => {
      const p = ports.shift();
      if (p === undefined) return resolve(null);
      srv.once("error", (e) => { if (e && e.code === "EADDRINUSE") tryNext(); else resolve(null); });
      srv.listen(p, "127.0.0.1", () => { rendererBase = `http://127.0.0.1:${srv.address().port}`; resolve(rendererBase); });
    };
    tryNext();
  });
}

/** 패키징 시 번들된 백엔드를 쓰기 가능한 위치로 복사하고 그 경로를 반환. */
function resolveBackendDir() {
  if (!app.isPackaged) return path.join(__dirname, "..", "..", "local");
  const src = path.join(process.resourcesPath, "backend");
  const dst = path.join(app.getPath("userData"), "backend");
  try {
    // 갱신 판단: 앱 버전 마커로 본다. 이전의 mtime 비교(uv.lock·server.py)는
    // ghost_local/*.py만 바뀐 릴리즈에서 복사를 건너뛰어 구버전 백엔드가 계속 돌았다.
    const marker = path.join(dst, ".ghost-build");
    const cur = expectedBuild();
    let prev = "";
    try { prev = fs.readFileSync(marker, "utf8").trim(); } catch { /* first run */ }
    if (prev !== cur || !fs.existsSync(path.join(dst, "uv.lock"))) {
      fs.cpSync(src, dst, { recursive: true });   // .venv는 src에 없어 보존됨(코드만 갱신)
      fs.writeFileSync(marker, cur);
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
    // 패키징 모드: 내 빌드 + 내 토큰을 받아주는 백엔드만 재사용(토큰은 userData에 영속이라
    // 정상적으로 살아남은 백엔드는 통과한다). 버전이 다르거나 인증이 어긋나면 회수 후 재기동.
    if (ver === expectedBuild() && await backendAuthOk()) return;
    console.error(`[backend] stale/foreign backend on ${BACKEND_PORT} (version=${ver}, expected=${expectedBuild()}) → reclaiming`);
    await reclaimPort();
  }
  const env = backendEnv();
  // 동봉 uv로 소스 백엔드 구동. uv가 첫 실행 시 Python·의존성을 자동 다운로드(무설치).
  const cwd = resolveBackendDir();
  const uv = uvPath();
  backendProc = spawn(
    uv,
    ["run", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", String(BACKEND_PORT), "--log-level", "warning"],
    // detached: POSIX에서 자기 프로세스 그룹을 만들어, 종료 시 uv의 자식(uvicorn)까지
    // 그룹째 죽일 수 있게 한다(uv만 죽으면 uvicorn이 고아로 포트를 계속 점유).
    { cwd, stdio: "inherit", env, detached: !IS_WIN }
  );
  backendProc.on("error", (e) => console.error("[backend] spawn failed:", e.message));
  // 첫 실행은 uv의 Python/의존성 다운로드로 1~수 분 걸릴 수 있음 → 넉넉히 대기.
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
      // 오브 모드에서 창을 숨겨도 렌더러의 오디오 캡처·전사 루프가 멈추지 않게.
      backgroundThrottling: false,
      additionalArguments: [`--ghost-token=${GHOST_TOKEN}`],
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

// ── 플로팅 고스트 오브 — 작은 투명 창. 클릭하면 메인 창 복귀, 카드 도착 시 말풍선. ──
async function createOrbWindow() {
  if (orb) return;
  const wa = screen.getPrimaryDisplay().workArea;
  orb = new BrowserWindow({
    width: 320, height: 200,
    x: wa.x + wa.width - 332, y: wa.y + wa.height - 212,
    frame: false, transparent: true, resizable: false, hasShadow: false,
    alwaysOnTop: true, skipTaskbar: true, show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      additionalArguments: [`--ghost-token=${GHOST_TOKEN}`],
    },
  });
  orb.setAlwaysOnTop(true, "floating");
  try { orb.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch { /* ignore */ }
  orb.on("closed", () => { orb = null; });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    await orb.loadURL(`${devUrl}#orb`);
  } else {
    const base = await startRendererServer();
    if (base) await orb.loadURL(`${base}/index.html#orb`);
    else await orb.loadFile(path.join(__dirname, "..", "dist", "index.html"), { hash: "orb" });
  }
}

ipcMain.on("ghost:hide-to-orb", async () => {
  try {
    await createOrbWindow();
    orb?.show();
    win?.hide();   // 숨겨도 backgroundThrottling=false라 전사는 계속
  } catch (e) { console.error("[orb] failed:", e.message); }
});
ipcMain.on("ghost:show-main", () => {
  orb?.hide();
  showWindow();
});
// 메인 렌더러 → 오브로 릴레이: 말풍선(카드 spoken/title), 청취 상태(라이브 점).
ipcMain.on("ghost:orb-bubble", (_e, text) => {
  if (orb && orb.isVisible()) orb.webContents.send("ghost:orb-bubble", text);
});
ipcMain.on("ghost:orb-state", (_e, state) => {
  orb?.webContents.send("ghost:orb-state", state);
});

// macOS 개인정보 설정 딥링크 — 마이크/화면기록 권한이 거부된 사용자를 바로 설정으로 보낸다.
ipcMain.on("ghost:open-privacy", (_e, pane) => {
  const PANES = {
    microphone: "Privacy_Microphone",
    screen: "Privacy_ScreenCapture",
  };
  const p = PANES[pane] || PANES.microphone;
  if (process.platform === "darwin") {
    shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${p}`);
  } else if (process.platform === "win32") {
    shell.openExternal("ms-settings:privacy-microphone");
  }
});

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
  if (backendProc) {
    try {
      if (IS_WIN) {
        // /T: uv의 자식(uvicorn)까지 트리째 종료. 비동기 spawn은 앱 종료 전에 못 끝낼 수 있어 sync.
        require("node:child_process").spawnSync("taskkill", ["/pid", String(backendProc.pid), "/T", "/F"], { windowsHide: true });
      } else {
        try { process.kill(-backendProc.pid, "SIGTERM"); }   // 프로세스 그룹째(uvicorn 포함) 종료
        catch { backendProc.kill(); }
      }
    } catch { /* ignore */ }
  }
  if (tray) { try { tray.destroy(); } catch {} }
});
