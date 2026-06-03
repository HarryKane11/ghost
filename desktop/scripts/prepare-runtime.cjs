// 프리즈 백엔드 + ffmpeg/ffprobe 바이너리를 build/runtime/ 으로 모아 electron-builder가 동봉.
// 결과: resources/backend/(프리즈 실행) + resources/bin/(ffmpeg·ffprobe). 사용자 PC에 의존성 0.
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const runtime = path.join(root, "build", "runtime");
const isWin = process.platform === "win32";

fs.rmSync(runtime, { recursive: true, force: true });
fs.mkdirSync(path.join(runtime, "bin"), { recursive: true });

// 1) ffmpeg / ffprobe
const ffmpeg = require("ffmpeg-static");
const ffprobe = require("ffprobe-static").path;
const cp = (src, name) => {
  if (!src || !fs.existsSync(src)) throw new Error(`binary missing: ${name} (${src})`);
  const dst = path.join(runtime, "bin", name);
  fs.copyFileSync(src, dst);
  if (!isWin) fs.chmodSync(dst, 0o755);
};
cp(ffmpeg, isWin ? "ffmpeg.exe" : "ffmpeg");
cp(ffprobe, isWin ? "ffprobe.exe" : "ffprobe");

// 2) 프리즈 백엔드 (local/dist_pyi/ghost-backend → build/runtime/backend)
const src = path.join(root, "..", "local", "dist_pyi", "ghost-backend");
if (!fs.existsSync(src)) {
  console.error("[prepare-runtime] frozen backend not found at", src, "\n  → run `node scripts/build-backend.cjs` first");
  process.exit(1);
}
fs.cpSync(src, path.join(runtime, "backend"), { recursive: true });
console.log("[prepare-runtime] ready →", runtime);
