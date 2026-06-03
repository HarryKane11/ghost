// uv + ffmpeg/ffprobe 바이너리를 build/runtime/bin 으로 모아 electron-builder가 동봉.
// → resources/bin 에 들어가고, 앱은 PATH 최우선으로 써서 사용자 PC에 아무 설치 없이도
//   uv가 Python·의존성·STT 엔진을 필요할 때 자동 다운로드(on-demand)한다.
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const outBin = path.join(root, "build", "runtime", "bin");
const isWin = process.platform === "win32";

fs.rmSync(path.join(root, "build", "runtime"), { recursive: true, force: true });
fs.mkdirSync(outBin, { recursive: true });

const cp = (src, name) => {
  if (!src || !fs.existsSync(src)) throw new Error(`binary missing: ${name} (${src})`);
  const dst = path.join(outBin, name);
  fs.copyFileSync(src, dst);
  if (!isWin) fs.chmodSync(dst, 0o755);
  console.log("  +", name, `(${(fs.statSync(dst).size / 1e6).toFixed(0)}MB)`);
};

// ffmpeg / ffprobe (정적 바이너리)
cp(require("ffmpeg-static"), isWin ? "ffmpeg.exe" : "ffmpeg");
cp(require("ffprobe-static").path, isWin ? "ffprobe.exe" : "ffprobe");

// uv (Python/의존성/엔진 on-demand 설치 도구). GHOST_UV 우선, 없으면 PATH에서 탐색.
let uv = process.env.GHOST_UV || "";
if (!uv) {
  try { uv = execSync(isWin ? "where uv" : "command -v uv", { encoding: "utf8" }).split(/\r?\n/)[0].trim(); }
  catch { /* not found */ }
}
if (!uv || !fs.existsSync(uv)) {
  throw new Error("uv 바이너리를 못 찾음 — uv 설치 후 빌드하거나 GHOST_UV=경로 지정");
}
cp(uv, isWin ? "uv.exe" : "uv");

console.log("[prepare-runtime] ready →", outBin);
