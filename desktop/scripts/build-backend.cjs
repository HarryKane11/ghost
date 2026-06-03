// 백엔드를 PyInstaller로 프리즈(단일 실행 폴더) → local/dist_pyi/ghost-backend/.
// 사용자 PC에 Python/uv 없이도 백엔드가 돈다. (uv는 빌드 머신에만 필요)
const { execSync } = require("node:child_process");
const path = require("node:path");

const local = path.join(__dirname, "..", "..", "local");
const cmd = [
  "uv run --with pyinstaller pyinstaller",
  "--noconfirm --clean --name ghost-backend --onedir",
  "--distpath dist_pyi --workpath build_pyi --specpath build_pyi",
  "--collect-all uvicorn --collect-all anyio --collect-all websockets",
  "--collect-submodules ghost_local",
  "--hidden-import ghost_local.adapters.opencode --hidden-import ghost_local.adapters.hermes",
  "run.py",
].join(" ");

console.log("[build-backend] freezing backend with PyInstaller…");
execSync(cmd, { cwd: local, stdio: "inherit" });
console.log("[build-backend] done →", path.join(local, "dist_pyi", "ghost-backend"));
