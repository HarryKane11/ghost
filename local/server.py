"""Ghost 로컬 백엔드 — 상시 청취 + 능동 개입 + Generative UI.

  GET  /api/status        백엔드 + codex 로그인 상태
  POST /api/config        브레인 백엔드 변경 (ollama|codex|openai)
  POST /api/transcribe    오디오 → 전사 텍스트 (Qwen3-ASR)
  POST /api/utterance     발화 텍스트 → judge → 필요 시 act → {act, spec}
  POST /api/ask           수동 요청 → 항상 act → {spec}
  POST /api/tts           텍스트 → audio/wav (Supertonic 3)
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import uuid
from typing import Optional

import asyncio

from fastapi import FastAPI, UploadFile, File, Form, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from ghost_local import audio, brain, memory, stt, stt_cloud, stt_cloud_stream, stt_stream, store, tts


def _config_dir():
    """쓰기 가능한 설정 디렉터리. 프리즈된 앱은 번들이 읽기전용이라 여기에 .env를 둔다.
    우선순위: env GHOST_CONFIG_DIR(앱이 userData로 지정) > ~/.ghost."""
    import pathlib
    d = (os.environ.get("GHOST_CONFIG_DIR") or "").strip()
    base = pathlib.Path(d) if d else (pathlib.Path.home() / ".ghost")
    try:
        base.mkdir(parents=True, exist_ok=True)
    except Exception:  # noqa: BLE001
        pass
    return base


def _env_paths():
    """읽을 .env 후보들: 쓰기 가능 설정 디렉터리(우선) + 소스 옆(dev 하위호환)."""
    import pathlib
    return [_config_dir() / ".env", pathlib.Path(__file__).resolve().parent / ".env"]


def _load_dotenv() -> None:
    """.env에서 KEY=VALUE를 읽어 환경변수로. 시크릿은 여기에만 둔다(gitignore)."""
    for p in _env_paths():
        if not p.exists():
            continue
        try:
            for line in p.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
        except Exception:  # noqa: BLE001
            pass


# ── 시크릿 저장 — macOS는 Keychain(암호화), 그 외/실패 시 .env(0600) 폴백 ──────
_KEYCHAIN_SERVICE = "ghost-app"


def _keychain_set(key: str, value: str) -> bool:
    if sys.platform != "darwin":
        return False
    try:
        r = subprocess.run(
            ["security", "add-generic-password", "-U", "-s", _KEYCHAIN_SERVICE, "-a", key, "-w", value],
            capture_output=True, timeout=10,
        )
        return r.returncode == 0
    except Exception:  # noqa: BLE001
        return False


def _keychain_get(key: str) -> str:
    if sys.platform != "darwin":
        return ""
    try:
        r = subprocess.run(
            ["security", "find-generic-password", "-s", _KEYCHAIN_SERVICE, "-a", key, "-w"],
            capture_output=True, text=True, timeout=10,
        )
        return r.stdout.strip() if r.returncode == 0 else ""
    except Exception:  # noqa: BLE001
        return ""


def _scrub_env_file(key: str) -> None:
    """키체인 저장에 성공한 키를 평문 .env에서 제거(이중 보관 방지)."""
    p = _config_dir() / ".env"
    try:
        if not p.exists():
            return
        lines = [l for l in p.read_text(encoding="utf-8").splitlines()
                 if not (l.strip() and not l.strip().startswith("#") and l.split("=", 1)[0].strip() == key)]
        p.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
        os.chmod(p, 0o600)
    except Exception:  # noqa: BLE001
        pass


def _persist_secret(key: str, value: str) -> None:
    """API 키 영속 저장 — macOS Keychain 우선(암호화), 실패 시 .env(0600)."""
    if _keychain_set(key, value):
        _scrub_env_file(key)   # 평문 사본 제거
        return
    _persist_env(key, value)


def _load_keychain_secrets() -> None:
    """시작 시 Keychain에 저장된 키를 환경변수로 복원(.env보다 우선하지 않게 setdefault)."""
    for key in ("ELEVENLABS_API_KEY", "OPENAI_API_KEY"):
        if not os.environ.get(key):
            v = _keychain_get(key)
            if v:
                os.environ[key] = v


def _persist_env(key: str, value: str) -> None:
    """키를 쓰기 가능한 .env에 영속 저장(앱 재시작 후에도 유지). 기존 키는 갱신, 나머지는 보존."""
    p = _config_dir() / ".env"
    try:
        lines = p.read_text(encoding="utf-8").splitlines() if p.exists() else []
        out, found = [], False
        for line in lines:
            if line.strip() and not line.strip().startswith("#") and line.split("=", 1)[0].strip() == key:
                out.append(f"{key}={value}"); found = True
            else:
                out.append(line)
        if not found:
            out.append(f"{key}={value}")
        p.write_text("\n".join(out) + "\n", encoding="utf-8")
        os.chmod(p, 0o600)   # API 키 평문 파일 — 소유자만 읽게(백업·멀티유저 노출 방지)
    except Exception:  # noqa: BLE001 — 영속 실패해도 런타임 환경변수는 이미 설정됨
        pass


_load_dotenv()
_load_keychain_secrets()   # macOS Keychain에 저장된 API 키 복원(평문 .env보다 안전한 1순위 저장소)

app = FastAPI(title="Ghost Local Backend")
# CORS: 렌더러(localhost vite/내부 http 서버)만 허용. 이전의 "*"는 브라우저의 아무 사이트가
# localhost:8765로 회의 전사를 읽어갈 수 있는 구멍이었다.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["*"], allow_headers=["*"],
)

# 토큰 인증: 데스크탑 앱이 기동 시 GHOST_TOKEN을 발급해 백엔드와 렌더러에 같이 꽂는다.
# 토큰이 설정된 경우에만 강제(수동 uvicorn 개발 흐름은 그대로 동작). /api/health는 예외(버전 식별용).
_AUTH_TOKEN = (os.environ.get("GHOST_TOKEN") or "").strip()


@app.middleware("http")
async def _auth_guard(request, call_next):
    if _AUTH_TOKEN and request.url.path.startswith("/api") and request.url.path != "/api/health":
        if request.method != "OPTIONS" and request.headers.get("x-ghost-token", "") != _AUTH_TOKEN:
            from fastapi.responses import JSONResponse
            return JSONResponse({"error": "unauthorized"}, status_code=401)
    return await call_next(request)

# 기본은 Cloud(가벼움) — STT=ElevenLabs(키), brain=Codex(auth). 로컬은 설치해야 쓰는 옵션.
STATE = {"backend": "codex", "stt_ready": False, "codex_model": None, "reasoning_effort": "low", "lang": "ko", "stt_provider": "elevenlabs"}
LANGS = ["ko", "en", "zh"]
STT_PROVIDERS = ["local", "elevenlabs"]  # local=Qwen3-ASR(온디바이스), elevenlabs=Scribe v2(클라우드)

# 백엔드 표시명. 실제 선택 가능한 목록은 설치된 어댑터(registry)와 교집합으로 정해진다.
_BACKEND_LABELS = {
    "codex": "Codex · ChatGPT",
    "openai": "OpenAI · gpt-5.4-mini",
    "ollama": "Ollama · 완전 로컬",
    "opencode": "OpenCode",
    "hermes": "Hermes",
}


def _ollama_up() -> bool:
    """ollama 데몬이 실제로 떠 있는지(localhost:11434). 다운이면 연결 거부로 즉시 False."""
    import urllib.request
    try:
        with urllib.request.urlopen(f"{brain.OLLAMA_URL}/api/tags", timeout=0.5):
            return True
    except Exception:
        return False


def _available_backends() -> list:
    """선택 가능한 백엔드. 설치된 어댑터만 노출하고, ollama는 데몬이 켜져 있을 때만(opt-in).

    모든 사용자가 ollama 모델을 받을 수는 없으므로, 로컬 백엔드는 사용자가 ollama를
    실제로 띄웠을 때만 옵션으로 나타난다(나머지 opencode/hermes도 설치 시에만 노출).
    """
    from ghost_local.adapters import available
    have = set(available())
    out = []
    for b in _BACKEND_LABELS:
        if b not in have:
            continue
        if b == "ollama" and not _ollama_up():
            continue
        out.append(b)
    return out


def _backend_label(name: str) -> str:
    return _BACKEND_LABELS.get(name, name)


# 하위호환: 기존 코드가 BACKEND_LABEL[...]로 접근 → 안전한 dict-like 래퍼.
class _LabelMap:
    def __getitem__(self, k: str) -> str:
        return _backend_label(k)

    def keys(self):
        return _available_backends()


BACKEND_LABEL = _LabelMap()
# 사용자가 고를 수 있는 Codex 모델 (빠름→강함). None = config.toml 기본값 사용.
CODEX_MODELS = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.2"]
REASONING_EFFORTS = ["low", "medium", "high"]


def _recheck_stt() -> None:
    """STT 준비 상태를 재평가하고 가능하면 모델을 미리 로드(백그라운드).

    시작 시 1회만 평가하던 이전 구조에선 인앱 엔진 설치·모델 다운로드가 끝나도
    재시작 전까지 stt_ready가 False로 남았다. 설치/다운로드/전환 완료 시마다 호출한다.
    """
    def _w():
        # 클라우드 STT는 로컬 모델 로드가 불필요 → 즉시 ready (가벼운 기본 경로).
        if STATE.get("stt_provider") == "elevenlabs":
            STATE["stt_ready"] = True
            STATE["stt_error"] = None
            return
        # 로컬 STT 엔진(mlx 등)이 설치돼 있을 때만 warmup. 미설치면 설치 안내.
        if not stt.engine_available(stt._engine(stt.active_model())):
            STATE["stt_ready"] = False
            STATE["stt_error"] = "로컬 STT 미설치 — 설정 > 음성 인식에서 '앱에서 설치'"
            return
        # 모델 미다운로드면 warmup을 걸지 않는다 — 모델 로드가 HF 다운로드를 암묵적으로
        # 시작해 3GB+를 진행률 표시 없이 받게 되던 문제. 다운로드는 UI 버튼으로만.
        if not stt.model_present():
            STATE["stt_ready"] = False
            STATE["stt_error"] = "모델 미다운로드 — 설정 > 음성 인식에서 다운로드"
            return
        try:
            stt.warmup()
            STATE["stt_ready"] = True
            STATE["stt_error"] = None
        except Exception as ex:  # noqa: BLE001
            STATE["stt_ready"] = False
            STATE["stt_error"] = str(ex)
    threading.Thread(target=_w, daemon=True).start()


@app.on_event("startup")
def _prewarm() -> None:
    """앱 시작 시 STT 준비 상태 평가 + 모델 프리로드 (첫 전사 24초 지연 제거)."""
    _recheck_stt()


def _codex_logged_in() -> bool:
    try:
        out = subprocess.run(["codex", "login", "status"], capture_output=True, text=True, timeout=10)
        return "Logged in" in (out.stdout + out.stderr)
    except Exception:
        return False


@app.get("/api/status")
def status() -> dict:
    return {
        "backend": STATE["backend"],
        "backend_label": BACKEND_LABEL[STATE["backend"]],
        "codex_logged_in": _codex_logged_in(),
        "backends": list(BACKEND_LABEL.keys()),
        "openai_key": bool(os.environ.get("OPENAI_API_KEY")),
        "stt_ready": STATE.get("stt_ready", False),
        "stt_error": STATE.get("stt_error"),
        "codex_model": STATE.get("codex_model"),
        "codex_models": CODEX_MODELS,
        "reasoning_effort": STATE.get("reasoning_effort", "low"),
        "reasoning_efforts": REASONING_EFFORTS,
        "lang": STATE.get("lang", "ko"),
        "langs": LANGS,
        "stt_provider": STATE.get("stt_provider", "elevenlabs"),
        "stt_providers": STT_PROVIDERS,
        "elevenlabs_key": bool(stt_cloud.elevenlabs_key()),
        "tts": tts.info(),   # 설치 여부·보이스 목록·설치 안내
    }


class SttReq(BaseModel):
    provider: str


@app.post("/api/stt")
def set_stt(req: SttReq) -> dict:
    """STT 제공자 전환 (local|elevenlabs)."""
    if req.provider in STT_PROVIDERS:
        STATE["stt_provider"] = req.provider
        _recheck_stt()   # 전환 즉시 준비 상태 재평가(local ↔ cloud)
    return {"ok": True, "stt_provider": STATE["stt_provider"]}


class ElevenKeyReq(BaseModel):
    key: str


@app.post("/api/apikey/elevenlabs")
def set_eleven_key(req: ElevenKeyReq) -> dict:
    """ElevenLabs 키를 런타임 환경변수로 설정(프로세스 메모리). 영구 저장은 local/.env 권장."""
    k = (req.key or "").strip()
    if k:
        os.environ["ELEVENLABS_API_KEY"] = k
        _persist_secret("ELEVENLABS_API_KEY", k)   # Keychain 우선, 재시작 후에도 유지
    return {"ok": bool(k), "set": bool(stt_cloud.elevenlabs_key())}


class LangReq(BaseModel):
    lang: str


@app.post("/api/lang")
def set_lang(req: LangReq) -> dict:
    """UI/응답 언어 설정 (ko|en|zh)."""
    if req.lang in LANGS:
        STATE["lang"] = req.lang
    return {"ok": True, "lang": STATE["lang"]}


class ConfigReq(BaseModel):
    backend: str


@app.post("/api/config")
def set_config(req: ConfigReq) -> dict:
    if req.backend not in _available_backends():
        if req.backend == "ollama":
            return {"ok": False, "error": "ollama_unavailable",
                    "message": "Ollama가 실행 중이 아니에요. `ollama serve`로 띄우고 모델(gemma)을 받은 뒤 다시 선택하세요."}
        return {"ok": False, "error": "unknown or unavailable backend"}
    STATE["backend"] = req.backend
    return {"ok": True, "backend": req.backend, "backend_label": _backend_label(req.backend)}


class CodexReq(BaseModel):
    model: Optional[str] = None
    effort: Optional[str] = None


@app.post("/api/codex")
def set_codex(req: CodexReq) -> dict:
    """Codex 모델/추론강도 설정. model=None|"" → config.toml 기본값."""
    m = (req.model or "").strip()
    STATE["codex_model"] = m if m in CODEX_MODELS else None
    if req.effort in REASONING_EFFORTS:
        STATE["reasoning_effort"] = req.effort
    return {"ok": True, "codex_model": STATE["codex_model"], "reasoning_effort": STATE["reasoning_effort"]}


@app.get("/api/connectors")
def connectors() -> dict:
    """Codex에 연결된 커넥터 목록.

    Codex의 커넥터는 대부분 마켓플레이스 플러그인(`codex plugin list`)으로 관리된다.
    레거시 `codex mcp list`는 [mcp_servers]에 직접 등록한 서버(node_repl 등)만
    보여줘서 slack·github·notion·hugging-face 같은 실제 연결 커넥터를 모두 놓친다.
    두 소스를 합쳐 노출한다.
    """
    out: list[dict] = []
    seen: set[str] = set()

    def _add(name: str, status: str) -> None:
        if name and name not in seen:
            seen.add(name)
            out.append({"name": name, "status": status})

    # 1) 마켓플레이스 플러그인 (slack, github, atlassian-rovo, hugging-face 등)
    try:
        r = subprocess.run(["codex", "plugin", "list"], capture_output=True, text=True, timeout=15)
        for raw in r.stdout.splitlines():
            s = raw.strip()
            if not s or s.startswith("Marketplace") or s.startswith("PLUGIN") or s.startswith("/"):
                continue
            low = s.lower()
            if "not installed" in low:
                continue  # 설치 안 된 카탈로그 항목은 제외 (실제 연결된 게 아님)
            # "name@marketplace  installed, enabled  <ver>  <path>" — 표시는 @앞 짧은 이름.
            name = s.split()[0].split("@")[0]
            _add(name, "enabled" if "enabled" in low else "disabled")
    except Exception:
        pass

    # 2) 레거시 MCP 서버 ([mcp_servers] — node_repl 등)
    try:
        r = subprocess.run(["codex", "mcp", "list"], capture_output=True, text=True, timeout=10)
        for raw in r.stdout.splitlines():
            s = raw.strip()
            if not s or s.lower().startswith("name"):
                continue
            low = s.lower()
            status = "enabled" if "enabled" in low else ("disabled" if "disabled" in low else "")
            _add(s.split()[0].split("@")[0], status)
    except Exception:
        pass

    return {"connectors": out}


# exec(codex exec)에 실제 도구가 노출되는 커넥터 = [mcp_servers]에 등록된 원격 MCP.
# 앱 플러그인(slack 등)은 인터랙티브 앱 전용이라, 아래 공식 원격 MCP로 한 번 등록(+OAuth)
# 해야 codex exec(=Ghost)에서도 쓸 수 있다.
KNOWN_CONNECTORS = [
    {"name": "atlassian", "label": "Atlassian · Jira/Confluence", "url": "https://mcp.atlassian.com/v1/mcp"},
    {"name": "slack", "label": "Slack", "url": "https://mcp.slack.com/mcp"},
    {"name": "notion", "label": "Notion", "url": "https://mcp.notion.com/mcp"},
    {"name": "linear", "label": "Linear", "url": "https://mcp.linear.app/mcp"},
    {"name": "github", "label": "GitHub", "url": "https://api.githubcopilot.com/mcp/"},
]


def _mcp_server_names() -> list:
    """codex exec에 노출되는 [mcp_servers] 등록 서버 이름 목록."""
    names = []
    try:
        r = subprocess.run(["codex", "mcp", "list"], capture_output=True, text=True, timeout=10)
        for raw in r.stdout.splitlines():
            s = raw.strip()
            if not s or s.lower().startswith("name"):
                continue
            names.append(s.split()[0])
    except Exception:
        pass
    return names


@app.get("/api/connectors/registry")
def connectors_registry() -> dict:
    """알려진 커넥터 목록 + 현재 exec에 연결됐는지(원격 MCP 서버로 등록됐는지)."""
    connected = set(_mcp_server_names())
    items = [{**c, "connected": c["name"] in connected} for c in KNOWN_CONNECTORS]
    known = {c["name"] for c in KNOWN_CONNECTORS}
    custom = [n for n in connected if n not in known and n != "node_repl"]
    return {"connectors": items, "custom": custom}


class ConnectReq(BaseModel):
    name: str
    url: str = ""


@app.post("/api/connectors/connect")
def connector_connect(req: ConnectReq) -> dict:
    """원격 MCP 서버를 등록(+OAuth). `codex mcp add`가 브라우저 OAuth를 자동으로 연다."""
    name = (req.name or "").strip()
    url = (req.url or "").strip()
    if not name:
        return {"ok": False, "error": "name required"}
    if not url:
        match = next((c for c in KNOWN_CONNECTORS if c["name"] == name), None)
        url = match["url"] if match else ""
    if not url:
        return {"ok": False, "error": "이 커넥터의 원격 MCP URL을 모릅니다. URL을 직접 입력하세요."}
    try:
        r = subprocess.run(["codex", "mcp", "add", name, "--url", url], capture_output=True, text=True, timeout=180)
        out = (r.stdout + r.stderr).strip()
        low = out.lower()
        failed = ("error" in low) or ("failed" in low) or ("not supported" in low)
        if failed:
            # add는 됐는데 OAuth가 실패하면 깨진 항목이 남아 exec를 방해한다 → 정리.
            subprocess.run(["codex", "mcp", "remove", name], capture_output=True, text=True, timeout=15)
            msg = out[-400:]
            if "dynamic client registration" in low or "dynamic registration" in low:
                msg = (f"{name}은(는) 자동 OAuth(동적 등록)를 지원하지 않습니다. "
                       "해당 서비스에서 앱을 만들어 client_id를 발급받아야 합니다.")
            return {"ok": False, "error": "oauth_failed", "message": msg}
        ok = name in _mcp_server_names()
        return {"ok": ok, "connected": ok, "message": out[-400:]}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "timeout", "message": "브라우저에서 OAuth 승인을 완료한 뒤 새로고침하세요."}
    except Exception as ex:  # noqa: BLE001
        return {"ok": False, "error": str(ex)}


class NameReq(BaseModel):
    name: str


@app.post("/api/connectors/remove")
def connector_remove(req: NameReq) -> dict:
    """등록된 원격 MCP 서버 제거."""
    name = (req.name or "").strip()
    if not name:
        return {"ok": False}
    try:
        subprocess.run(["codex", "mcp", "remove", name], capture_output=True, text=True, timeout=15)
        return {"ok": name not in _mcp_server_names()}
    except Exception as ex:  # noqa: BLE001
        return {"ok": False, "error": str(ex)}


@app.get("/api/connectors/index")
def get_connector_index_ep() -> dict:
    """커넥터별 사전 인덱스(지형) — 인덱싱 시각 포함."""
    return {"index": store.get_connector_index()}


@app.post("/api/connectors/index")
def index_connector_ep(req: NameReq) -> dict:
    """codex가 해당 커넥터를 열거해 지형 인덱스를 만들고 저장 → 모든 회의 컨텍스트에 주입."""
    name = (req.name or "").strip()
    if not name:
        return {"ok": False, "error": "name required"}
    if STATE["backend"] != "codex":
        return {"ok": False, "error": "codex_only", "message": "커넥터 인덱싱은 codex 백엔드에서만 됩니다."}
    summary = brain.index_connector(name, _cfg())
    if not summary:
        return {"ok": False, "error": "no_result", "message": "인덱싱 결과가 비었어요(커넥터 연결/권한 확인)."}
    rec = store.set_connector_index(name, summary)
    return {"ok": True, "name": name, "record": rec}


@app.get("/api/tools")
def tools() -> dict:
    """Codex 백엔드가 쓸 수 있는 도구."""
    base = [
        {"name": "web_search", "desc": "실시간 웹 검색", "on": True},
        {"name": "image_gen (gpt-image-2)", "desc": "이미지 생성 (회의록 손글씨)", "on": True},
        {"name": "browser / code (node_repl)", "desc": "브라우저·코드 실행", "on": True},
    ]
    conns = connectors().get("connectors", [])
    for c in conns:
        base.append({"name": f"커넥터: {c['name']}", "desc": "Codex 플러그인", "on": c.get("status") == "enabled"})
    return {"tools": base}


class ApiKeyReq(BaseModel):
    key: str


@app.post("/api/apikey")
def set_apikey(req: ApiKeyReq) -> dict:
    """OpenAI API 키 설정 (openai 백엔드용)."""
    k = (req.key or "").strip()
    if k:
        os.environ["OPENAI_API_KEY"] = k
        _persist_secret("OPENAI_API_KEY", k)   # Keychain 우선, 재시작 후에도 유지
    return {"ok": bool(k), "set": bool(os.environ.get("OPENAI_API_KEY"))}


# ── 공통 헬퍼 ────────────────────────────────────────────────────────────────
def _cfg() -> brain.BrainConfig:
    return brain.BrainConfig(
        backend=STATE["backend"],
        codex_model=STATE.get("codex_model"),
        reasoning_effort=STATE.get("reasoning_effort", "low"),
        lang=STATE.get("lang", "ko"),
    )


def _resolve_context(meeting_id: str, fallback: str) -> str:
    """meeting_id가 있으면 서버 롤링 메모리로 컨텍스트를 조립(맥락 손실 방지).
    없으면 클라이언트가 보낸 fallback 컨텍스트를 쓴다(하위호환)."""
    mid = (meeting_id or "").strip()
    if mid and store.get_meta(mid) is not None:
        ctx = memory.build_context(mid)
        if ctx:
            return ctx
    return fallback or ""


# ── 회의 라이프사이클 + 영속 저장 ────────────────────────────────────────────
class StartReq(BaseModel):
    pass


@app.post("/api/meetings")
def start_meeting() -> dict:
    """새 회의 시작 → 타임스탬프 폴더 생성. {id, title, ...} 반환."""
    meta = store.create_meeting(backend=STATE["backend"], lang=STATE.get("lang", "ko"))
    return {"ok": True, "meeting": meta}


@app.get("/api/meetings")
def meetings() -> dict:
    """저장된 회의 목록(최신순) — 디스크 폴더 스캔."""
    return {"meetings": store.list_meetings()}


@app.get("/api/meetings/{meeting_id}")
def get_meeting_ep(meeting_id: str) -> dict:
    m = store.get_meeting(meeting_id)
    if m is None:
        return {"ok": False, "error": "not found"}
    return {"ok": True, "meeting": m}


class MeetingEditReq(BaseModel):
    title: Optional[str] = None
    folder: Optional[str] = None


@app.patch("/api/meetings/{meeting_id}")
def edit_meeting(meeting_id: str, req: MeetingEditReq) -> dict:
    """회의 제목/폴더 편집(폴더명=ID 불변, title·folder 필드만)."""
    meta = None
    if req.title is not None:
        meta = store.set_title(meeting_id, req.title)
    if req.folder is not None:
        meta = store.set_folder(meeting_id, req.folder)
    if meta is None:
        meta = store.get_meta(meeting_id)
    if meta is None:
        return {"ok": False, "error": "not found"}
    return {"ok": True, "meeting": meta}


@app.post("/api/meetings/{meeting_id}/end")
def end_meeting_ep(meeting_id: str) -> dict:
    meta = store.end_meeting(meeting_id)
    return {"ok": meta is not None, "meeting": meta}


@app.delete("/api/meetings/{meeting_id}")
def delete_meeting_ep(meeting_id: str) -> dict:
    """회의 폴더 영구 삭제(전사·회의록·다이제스트 포함). 프라이버시 기본 권리."""
    return {"ok": store.delete_meeting(meeting_id)}


class CardReq(BaseModel):
    query: str = ""
    ack: str = ""
    spec: dict
    backend: str = ""


@app.get("/api/meetings/{meeting_id}/cards")
def get_cards_ep(meeting_id: str) -> dict:
    """회의별 질의응답 카드(채팅 세션) 기록 — 회의 클릭 시 복원용."""
    return {"cards": store.read_cards(meeting_id)}


@app.post("/api/meetings/{meeting_id}/cards")
def add_card_ep(meeting_id: str, req: CardReq) -> dict:
    """완료된 질의응답 카드를 회의에 저장(회의별 채팅 세션)."""
    return {"ok": store.append_card(meeting_id, {"query": req.query, "ack": req.ack, "spec": req.spec, "backend": req.backend})}


@app.get("/api/meetings/{meeting_id}/digests")
def get_digests_ep(meeting_id: str) -> dict:
    """저장된 5분 다이제스트 기록 — 재시작 후 UI 복원용."""
    if store.get_meta(meeting_id) is None:
        return {"digests": []}
    return {"digests": store.read_digests(meeting_id)}


class ContextReq(BaseModel):
    context: str


@app.post("/api/meetings/{meeting_id}/context")
def set_meeting_context(meeting_id: str, req: ContextReq) -> dict:
    """회의 맥락(상황·주제·고유명사) 저장 → brain·요약 정확도↑."""
    meta = store.set_context(meeting_id, req.context)
    return {"ok": meta is not None, "meeting": meta}


class PolishReq(BaseModel):
    text: str
    meeting_id: str = ""


@app.post("/api/polish")
def polish_ep(req: PolishReq) -> dict:
    """문장 확정 직후 실시간 다듬기 — 맥락·용어집 기반 오인식 교정 + 불명확 키워드 추출.

    교정되면 저장된 전사(jsonl)도 함께 갱신된다. {text, changed, unclear[]} 반환.
    """
    from ghost_local import polish
    try:
        return polish.polish_line(req.meeting_id, req.text, _cfg())
    except Exception:  # noqa: BLE001 — 다듬기 실패는 원문 유지(핫패스 보호)
        return {"text": (req.text or "").strip(), "changed": False, "unclear": []}


@app.get("/api/meetings/{meeting_id}/script")
def get_script_ep(meeting_id: str, flush: bool = False) -> dict:
    """스크립트(문단별 정제+불릿 요약). 새 문단을 증분 처리 후 전체 반환. flush=true면 꼬리까지."""
    from ghost_local import script
    if store.get_meta(meeting_id) is None:
        return {"script": []}
    return {"script": script.build_script(meeting_id, _cfg(), flush_tail=flush)}


# ── 회의록 저장 위치 (사용자 설정) ───────────────────────────────────────────
@app.get("/api/storage")
def get_storage() -> dict:
    home = store.ghost_home()
    return {"home": str(home), "meetings_dir": str(home / "meetings"),
            "env_locked": bool(os.environ.get("GHOST_HOME", "").strip())}


class StorageReq(BaseModel):
    path: str


@app.post("/api/storage")
def set_storage(req: StorageReq) -> dict:
    """회의록 저장 위치 변경(영속). 기존 회의는 이동하지 않고 새 회의부터 새 위치에 저장."""
    if os.environ.get("GHOST_HOME", "").strip():
        return {"ok": False, "error": "env_locked",
                "message": "GHOST_HOME 환경변수가 설정돼 있어 UI에서 변경할 수 없어요."}
    return store.set_home(req.path)


# ── STT 모델 다운로드 (완전 로컬 에디션 첫 실행) ──────────────────────────────
@app.get("/api/stt/model")
def stt_model_status() -> dict:
    """현재 로컬 ASR 모델 보유/다운로드 상태 + 진행률."""
    return stt.download_status()


@app.post("/api/stt/model/download")
def stt_model_download() -> dict:
    """현재 로컬 ASR 모델 다운로드 시작(백그라운드, 재개 가능). 완료 시 stt_ready 재평가."""
    return stt.start_download(on_done=_recheck_stt)


# 인터뷰 모드 번역 대상 언어.
TRANSLATE_LANGS = [
    {"code": "en", "name": "English", "label": "English"},
    {"code": "ko", "name": "Korean", "label": "한국어"},
    {"code": "zh", "name": "Simplified Chinese", "label": "中文"},
    {"code": "ja", "name": "Japanese", "label": "日本語"},
    {"code": "es", "name": "Spanish", "label": "Español"},
    {"code": "fr", "name": "French", "label": "Français"},
    {"code": "de", "name": "German", "label": "Deutsch"},
    {"code": "vi", "name": "Vietnamese", "label": "Tiếng Việt"},
]
_LANG_NAME = {x["code"]: x["name"] for x in TRANSLATE_LANGS}


class TranslateReq(BaseModel):
    text: str
    target: str = "en"


@app.post("/api/translate")
def translate_ep(req: TranslateReq) -> dict:
    """한 문장 번역(인터뷰 모드). target=언어 코드."""
    name = _LANG_NAME.get(req.target, req.target)
    return {"text": brain.translate(req.text, name, _cfg())}


@app.post("/api/translate/stream")
def translate_stream_ep(req: TranslateReq) -> StreamingResponse:
    """번역을 토큰 단위로 스트리밍(인터뷰 모드). ollama/openai는 진짜 델타, codex는 통짜 1청크."""
    name = _LANG_NAME.get(req.target, req.target)
    cfg = _cfg()

    def gen():
        try:
            for delta in brain.translate_stream(req.text, name, cfg):
                if delta:
                    yield _sse("delta", {"text": delta})
        except Exception as ex:  # noqa: BLE001
            yield _sse("error", {"error": str(ex)})
        yield _sse("done", {})

    return StreamingResponse(
        gen(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/translate/langs")
def translate_langs() -> dict:
    return {"langs": TRANSLATE_LANGS}


@app.get("/api/glossary")
def get_glossary_ep() -> dict:
    """사용자 전역 용어집(Word Memory)."""
    return {"glossary": store.get_glossary()}


class GlossaryReq(BaseModel):
    glossary: list


@app.post("/api/glossary")
def set_glossary_ep(req: GlossaryReq) -> dict:
    return {"ok": True, "glossary": store.set_glossary(req.glossary)}


@app.get("/api/stt/streaming")
def stt_streaming() -> dict:
    """실시간 스트리밍 전사가 가능한 경로를 알려준다.

    kind:
      · "elevenlabs" — Scribe v2 Realtime(ws). 클라우드 + realtime 모델 + 키 있을 때.
      · "parakeet"   — 로컬 네이티브 토큰-스트리밍(parakeet-mlx 설치 + 모델 다운로드).
      · None         — 스트리밍 불가 → 클라가 2-pass interim 초안으로 폴백.
    """
    if (STATE.get("stt_provider") == "elevenlabs"
            and stt_cloud.realtime_active() and stt_cloud.elevenlabs_key()):
        return {"available": True, "kind": "elevenlabs", "model": stt_cloud.active_model()}
    mid = stt.active_model()
    ok = (STATE.get("stt_provider") != "elevenlabs"
          and stt_stream.streaming_supported(mid)
          and stt.model_present(mid))
    return {"available": ok, "kind": "parakeet" if ok else None, "model": mid}


@app.websocket("/ws/stt")
async def ws_stt(ws: WebSocket) -> None:
    """연속 오디오(16k mono float32, binary) → 실시간 전사 → 부분/확정 결과를 돌려준다.

    경로 선택:
      · 클라우드 + Scribe v2 Realtime → ElevenLabs realtime ws로 브리지(확정 라인은 서버가 저장).
      · 로컬 parakeet → 네이티브 토큰-스트리밍(라이브 초안만; 최종은 클라 배치가 담당).

    바이너리 프레임 = 오디오. 텍스트 '{"final":true}' = 클라 VAD 엔드포인트 신호.
    """
    await ws.accept()
    # 브라우저 WebSocket은 커스텀 헤더를 못 보내므로 토큰은 쿼리로 검증.
    if _AUTH_TOKEN and ws.query_params.get("token", "") != _AUTH_TOKEN:
        await ws.close(code=4401)
        return
    mid = ws.query_params.get("meeting_id", "")
    src = ws.query_params.get("source", "mic")

    # ── 1) ElevenLabs Scribe v2 Realtime (스트리밍 전용 옵션) ──
    if (STATE.get("stt_provider") == "elevenlabs"
            and stt_cloud.realtime_active() and stt_cloud.elevenlabs_key()):
        def _store_committed(text: str) -> None:
            # 확정 전사를 회의 폴더에 실시간 누적(REST 경로와 동일한 저장·fold).
            if text and mid and store.get_meta(mid) is not None:
                store.append_transcript(mid, text, source=src or "mic")
                _bg_fold(mid)
        await stt_cloud_stream.bridge(ws, STATE.get("lang"), stt_cloud.elevenlabs_key(), on_committed=_store_committed)
        return

    # ── 2) 로컬 parakeet 네이티브 스트리밍 ──
    import numpy as np
    loop = asyncio.get_running_loop()
    repo = stt._repo(stt.active_model())

    def emit(text: str, final: bool) -> None:
        try:
            asyncio.run_coroutine_threadsafe(ws.send_json({"text": text, "final": final}), loop)
        except Exception:  # noqa: BLE001
            pass

    if not (stt_stream.streaming_supported(stt.active_model()) and stt.model_present(stt.active_model())):
        await ws.send_json({"text": "", "final": True, "error": "현재 모델은 네이티브 스트리밍 미지원/미다운로드"})
        await ws.close()
        return
    sess = stt_stream.make_session(repo, emit)
    if sess is None:
        await ws.send_json({"text": "", "final": True, "error": "parakeet-mlx 미설치"})
        await ws.close()
        return
    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            b = msg.get("bytes")
            if b:
                sess.feed(np.frombuffer(b, dtype=np.float32).copy())
            elif msg.get("text") and "final" in msg["text"]:
                sess.finalize()
    except Exception:  # noqa: BLE001
        pass
    finally:
        sess.close()


class EngineInstallReq(BaseModel):
    target: str


@app.post("/api/stt/engine/install")
def stt_engine_install(req: EngineInstallReq) -> dict:
    """터미널 없이 앱에서 옵셔널 엔진 설치(로컬 STT·스트리밍·TTS 등). 완료 시 stt_ready 재평가."""
    return stt.install_engine(req.target, on_done=_recheck_stt)


@app.get("/api/stt/engine/install")
def stt_engine_install_status() -> dict:
    return stt.engine_install_status()


@app.get("/api/stt/engine/target")
def stt_engine_target() -> dict:
    """현재 STT 모델을 쓰려면 설치해야 할 타깃(extra 이름)."""
    return {"target": stt.install_target_for(stt.active_model())}


# ── 사용량 대시보드 (Codex 토큰/비용 · ElevenLabs STT · 로컬 모델 디스크) ──────
@app.get("/api/usage")
def get_usage() -> dict:
    """이 앱이 쓴 사용량: Codex 토큰/비용, ElevenLabs STT 시간/비용, 로컬 ASR 디스크 점유."""
    from ghost_local import usage
    snap = usage.snapshot()
    models = stt.models_with_status()
    local_total = sum(int(m.get("size_bytes") or 0) for m in models)
    snap["local_models"] = [
        {"id": m["id"], "label": m["label"], "present": m.get("present", False),
         "size_bytes": m.get("size_bytes", 0), "approx_gb": m.get("approx_gb")}
        for m in models
    ]
    snap["local_total_bytes"] = local_total
    snap["rates"] = {"eleven_stt_usd_per_hour": usage.ELEVEN_STT_USD_PER_HOUR}
    return snap


class BudgetReq(BaseModel):
    usd: float


@app.post("/api/usage/budget")
def set_usage_budget(req: BudgetReq) -> dict:
    """Codex 월 예산(USD) 설정 → 한도 대비 차지율 표시용."""
    from ghost_local import usage
    return usage.set_codex_budget(req.usd)


@app.post("/api/usage/reset")
def reset_usage() -> dict:
    """사용량 카운터 초기화."""
    from ghost_local import usage
    return usage.reset()


@app.get("/api/stt/models")
def stt_models() -> dict:
    """선택 가능한 로컬/클라우드 STT 모델 목록 + 현재 활성 모델."""
    return {
        "local": stt.models_with_status(),   # engine·streaming·diarization·engine_ready 포함
        "local_active": stt.active_model(),
        "cloud": stt_cloud.CLOUD_MODELS,
        "cloud_active": stt_cloud.active_model(),
    }


class SttSelectReq(BaseModel):
    kind: str       # "local" | "cloud"
    model_id: str


@app.post("/api/stt/select")
def stt_select(req: SttSelectReq) -> dict:
    """로컬/클라우드 STT 모델 선택. 로컬은 커스텀 HF repo도 허용."""
    if req.kind == "cloud":
        return {"ok": True, "kind": "cloud", "model": stt_cloud.set_model(req.model_id)}
    out = {"ok": True, "kind": "local", "model": stt.set_model(req.model_id)}
    _recheck_stt()   # 모델 교체 즉시 준비 상태 재평가(미설치/미다운로드 안내 갱신)
    return out


# ── STT ─────────────────────────────────────────────────────────────────────
def _secure_tmp(prefix: str, suffix: str = "") -> str:
    """0600 권한 임시 파일 — 멀티유저 시스템에서 회의 오디오가 타 계정에 노출되지 않게."""
    fd, path = tempfile.mkstemp(prefix=prefix, suffix=suffix)
    os.close(fd)
    return path


def _to_wav(src: str) -> str:
    dst = _secure_tmp("ghost_in_", ".wav")
    subprocess.run(["ffmpeg", "-y", "-i", src, "-ar", "16000", "-ac", "1", dst], capture_output=True, check=False)
    return dst


def _wav_seconds(path: str) -> float:
    """WAV 길이(초). 사용량 추정용. 실패 시 0."""
    try:
        import wave
        with wave.open(path, "rb") as w:
            fr = w.getframerate() or 16000
            return w.getnframes() / float(fr)
    except Exception:  # noqa: BLE001
        return 0.0


# Whisper류가 무음에서 지어내는 전형적 보일러플레이트(언어 불문 안전하게 거를 수 있는 것만).
_HALLU_BOILERPLATE = (
    "thank you for watching", "thanks for watching", "please subscribe",
    "시청해 주셔서 감사합니다", "구독과 좋아요", "다음 영상에서 만나요",
    "ご視聴ありがとうございました",
)


def _looks_like_hallucination(text: str) -> bool:
    """무음·잡음에서 STT가 지어낸 환각 추정 — UI 언어를 존중한다.

    이전 규칙(한글 0개 + 짧은 영어 → 버림)은 영어 회의에서 "okay sounds good" 같은
    정상 발화를 통째로 버렸다. 이제:
      · ko 모드: 기존 규칙 유지(한국어 회의에 끼어드는 짧은 영어 환각 차단)
      · 그 외(en/zh 등): 언어 불문 보일러플레이트 문구만 거른다(짧은 발화는 보존).
    """
    t = (text or "").strip()
    if not t:
        return True
    low = t.lower()
    if any(b in low for b in _HALLU_BOILERPLATE):
        return True
    if STATE.get("lang", "ko") != "ko":
        return False   # 비한국어 모드: 짧다고 버리지 않는다
    import re
    has_hangul = bool(re.search(r"[가-힣]", t))
    if has_hangul:
        return False
    words = t.split()
    has_signal = bool(re.search(r"[0-9]|[A-Z]{2,}|[#@/]", t))  # 숫자·약어·기호 = 실제 발화 신호
    return len(words) <= 6 and not has_signal


def _bg_fold(meeting_id: str) -> None:
    """신규 발화가 충분히 쌓였으면 백그라운드로 롤링 요약 fold(전사 핫패스 비차단)."""
    def _w():
        try:
            memory.fold(meeting_id, _cfg(), force=False)
        except Exception:  # noqa: BLE001 — fold 실패는 다음 기회에 재시도
            pass
    threading.Thread(target=_w, daemon=True).start()


@app.post("/api/transcribe")
async def transcribe(audio: UploadFile = File(...), meeting_id: str = Form(""), source: str = Form("mic")) -> dict:
    raw = _secure_tmp("ghost_up_")
    with open(raw, "wb") as f:
        shutil.copyfileobj(audio.file, f)
    wav = _to_wav(raw)
    # 실제로 어떤 경로(provider/model/engine)가 전사했는지 추적해 응답에 에코한다
    # → 클라가 "지금 진짜 이 모델로 전사 중"을 배지로 보여줄 수 있다(모델 전환 신뢰성).
    used = {"provider": "local", "model": stt.active_model(), "engine": stt._engine(stt.active_model())}
    # 로컬 폴백이 실제로 가능한지(엔진 설치 + 모델 보유) — 불가능하면 연쇄 예외로 500이 나던 경로.
    local_ok = stt.engine_available(stt._engine(stt.active_model()))
    try:
        if STATE.get("stt_provider") == "elevenlabs" and stt_cloud.elevenlabs_key():
            try:
                # 용어집을 Scribe keyterm prompting에 주입 → 제품명·이름 같은 희귀 고유명사 인식률↑.
                keyterms = [g["term"] for g in store.get_glossary()]
                text = stt_cloud.transcribe(wav, lang=STATE.get("lang"), keyterms=keyterms)
                used = {"provider": "elevenlabs", "model": stt_cloud.active_model(), "engine": "elevenlabs"}
                try:
                    from ghost_local import usage
                    usage.record_eleven_stt(_wav_seconds(wav))   # 전사한 오디오 길이 → 사용량/비용 누적
                except Exception:  # noqa: BLE001
                    pass
            except Exception:
                if not local_ok:
                    # 클라우드 실패 + 로컬 미설치 → 연쇄 예외 대신 명확한 안내로.
                    from fastapi.responses import JSONResponse
                    for p in (raw, wav):
                        try:
                            os.unlink(p)
                        except OSError:
                            pass
                    return JSONResponse({"error": "stt_unavailable",
                                         "message": "클라우드 전사 실패 + 로컬 STT 미설치 — 키/네트워크를 확인하거나 설정에서 로컬 모델을 설치하세요."},
                                        status_code=503)
                text = stt.transcribe(wav)  # 클라우드 실패 시 로컬 폴백
                used = {"provider": "local", "model": stt.active_model(), "engine": stt._engine(stt.active_model()), "fallback": True}
        else:
            text = stt.transcribe(wav)
    finally:
        for p in (raw, wav):
            try:
                os.unlink(p)
            except OSError:
                pass
    if _looks_like_hallucination(text):
        return {"text": "", "filtered": True, **used}
    # 전사 실시간 누적(회의 종료 안 기다림) + 충분히 쌓이면 백그라운드 fold.
    mid = (meeting_id or "").strip()
    if text and mid and store.get_meta(mid) is not None:
        store.append_transcript(mid, text, source=source or "mic")
        _bg_fold(mid)
    return {"text": text, **used}


# ── 음성 파일 업로드 → 타임스탬프 전사 + 회의록 ──────────────────────────────
def _fmt_ts(sec: float) -> str:
    sec = int(sec or 0)
    h, m, s = sec // 3600, (sec % 3600) // 60, sec % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


@app.post("/api/audio/transcribe")
async def audio_transcribe(audio_file: UploadFile = File(...)) -> dict:
    """업로드 음성(mp3/mp4/m4a/wav…) → 설정된 ASR로 타임스탬프 세그먼트 전사."""
    raw = _secure_tmp("ghost_audio_")
    with open(raw, "wb") as f:
        shutil.copyfileobj(audio_file.file, f)
    try:
        provider = STATE.get("stt_provider", "elevenlabs")
        segs = audio.transcribe_segments(raw, provider, STATE.get("lang"), stt_cloud.elevenlabs_key())
        # ElevenLabs로 전사했으면 사용량 누적(전체 길이).
        try:
            if provider == "elevenlabs" and stt_cloud.elevenlabs_key() and segs:
                from ghost_local import usage
                usage.record_eleven_stt(audio._duration(raw))
        except Exception:  # noqa: BLE001
            pass
        model = stt_cloud.active_model() if provider == "elevenlabs" and stt_cloud.elevenlabs_key() else stt.active_model()
        return {"ok": True, "segments": segs, "provider": provider, "model": model, "duration": audio._duration(raw)}
    finally:
        try:
            os.unlink(raw)
        except OSError:
            pass


class AudioMinutesReq(BaseModel):
    segments: list = []   # [{start, end, text}]
    context: str = ""
    lang: str = ""        # 회의록 출력 언어(빈값이면 현재 설정 언어). 입력 음성 언어와 무관하게 적용.


@app.post("/api/audio/minutes/stream")
def audio_minutes_stream(req: AudioMinutesReq) -> StreamingResponse:
    """타임스탬프 전사 → AI 백엔드로 상세 회의록(각 항목에 [mm:ss] 인용) 생성. lang으로 출력 언어 강제."""
    cfg = _cfg()
    label = BACKEND_LABEL[STATE["backend"]]
    # 출력 언어 강제 — 입력 음성 언어와 무관하게 사용자가 고른 언어로 회의록 작성.
    system = brain.MINUTES_TS_SYSTEM
    if req.lang:
        name = _LANG_NAME.get(req.lang, req.lang)
        system += (f"\n\n[출력 언어 — 매우 중요] 입력 음성이 어떤 언어든, 회의록의 모든 텍스트"
                   f"(title·heading·내용)를 반드시 {name}로 작성한다. 단, 타임스탬프 [mm:ss]는 그대로 둔다.")
    # 전사를 [mm:ss] text 줄로 직렬화 → 모델이 시각을 인용할 수 있게.
    lines = []
    for s in (req.segments or []):
        if isinstance(s, dict) and (s.get("text") or "").strip():
            spk = f" [화자{s['speaker']}]" if s.get("speaker") else ""
            lines.append(f"[{_fmt_ts(s.get('start', 0))}]{spk} {s['text'].strip()}")
    transcript = "\n".join(lines)

    def gen():
        if not transcript:
            yield _sse("error", {"error": "전사 내용이 비었어요."})
            return
        try:
            for kind, payload in brain.minutes_stream(transcript, cfg, context=req.context,
                                                      system=system, with_image=False):
                if kind == "progress":
                    yield _sse("progress", payload if isinstance(payload, dict) else {"text": payload})
                elif kind == "result":
                    yield _sse("result", {"spec": payload, "backend_label": label})
        except Exception as ex:  # noqa: BLE001
            yield _sse("error", {"error": str(ex)})

    return StreamingResponse(
        gen(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── 라우팅 + 스트리밍 액션 ──────────────────────────────────────────────────
class UtteranceReq(BaseModel):
    text: str
    context: str = ""
    meeting_id: str = ""


@app.post("/api/route")
def route(req: UtteranceReq) -> dict:
    """발화 → chat/action/none 분류. action이면 먼저 건넬 한마디(say)도 함께.

    confidence(0~1)와 kind를 함께 반환 → 클라이언트가 실시간 개입 문턱을 게이트한다.
    """
    text = (req.text or "").strip()
    if len(text) < 2:
        return {"kind": "none", "confidence": 0.0}
    cfg = _cfg()
    ctx = _resolve_context(req.meeting_id, req.context)
    v = brain.judge(text, ctx, cfg)
    if v["kind"] == "chat" and not v["say"]:
        v["say"] = brain.chat_reply(text, ctx, cfg).get("spoken", "")
    return {"kind": v["kind"], "query": v["query"], "say": v["say"], "confidence": v.get("confidence", 0.5)}


class ActReq(BaseModel):
    query: str
    context: str = ""
    meeting_id: str = ""


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _stream_response(query: str, context: str, system: str) -> StreamingResponse:
    cfg = _cfg()
    label = BACKEND_LABEL[STATE["backend"]]

    def gen():
        try:
            for kind, payload in brain.act_stream(query, context, cfg, system):
                if kind == "progress":
                    yield _sse("progress", payload if isinstance(payload, dict) else {"text": payload})
                elif kind == "result":
                    yield _sse("result", {"spec": payload, "backend_label": label})
        except Exception as ex:  # noqa: BLE001
            yield _sse("error", {"error": str(ex)})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/act/stream")
def act_stream_ep(req: ActReq) -> StreamingResponse:
    """작업을 수행하며 진행상황을 SSE로 스트리밍. progress* → result."""
    return _stream_response(req.query, _resolve_context(req.meeting_id, req.context), brain.ACT_SYSTEM)


class TranscriptReq(BaseModel):
    transcript: str = ""
    meeting_id: str = ""


@app.post("/api/minutes/stream")
def minutes_stream_ep(req: TranscriptReq) -> StreamingResponse:
    """회의 종료 → 회의록(요약·결정·액션 + codex 손글씨 이미지) 생성 후 폴더에 저장."""
    cfg = _cfg()
    label = BACKEND_LABEL[STATE["backend"]]
    mid = (req.meeting_id or "").strip()
    # meeting_id가 있으면 저장된 전사 전체 + 사용자 맥락을 쓴다(클라이언트 200줄 제한 우회, 정확도↑).
    has_meeting = bool(mid and store.get_meta(mid))
    transcript = store.transcript_text(mid) if has_meeting else req.transcript
    # 회의별 맥락 + 전역 용어집을 함께 codex에 주입(고유명사 정확도↑).
    user_ctx = "\n".join(p for p in [store.glossary_text(), store.get_context(mid) if has_meeting else ""] if p)

    def gen():
        try:
            for kind, payload in brain.minutes_stream(transcript, cfg, context=user_ctx):
                if kind == "progress":
                    yield _sse("progress", payload if isinstance(payload, dict) else {"text": payload})
                elif kind == "result":
                    saved = False
                    if mid and store.get_meta(mid) is not None:
                        # 폴더에 영속(재시작 생존). 빈/에러 spec은 저장 거부 → 기존 회의록 보호.
                        saved = store.save_minutes(mid, payload)
                    yield _sse("result", {"spec": payload, "backend_label": label, "saved": saved})
        except Exception as ex:  # noqa: BLE001
            yield _sse("error", {"error": str(ex)})

    return StreamingResponse(
        gen(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/proactive/stream")
def proactive_stream_ep(req: TranscriptReq) -> StreamingResponse:
    """회의 흐름을 보고 지금 도움이 될 것을 스스로 하나 생성(백그라운드)."""
    ctx = _resolve_context(req.meeting_id, req.transcript)
    return _stream_response("지금 회의에 도움이 될 것을 하나 만들어줘.", ctx, brain.PROACTIVE_SYSTEM)


class DigestReq(BaseModel):
    meeting_id: str
    auto_research: bool = True
    when_label: str = ""


@app.post("/api/digest/stream")
def digest_stream_ep(req: DigestReq) -> StreamingResponse:
    """5분 다이제스트(기본 동작): 롤링 요약 + 미해결 1건 자동 조사(능력 될 때만)."""
    from ghost_local import digest
    cfg = _cfg()
    label = BACKEND_LABEL[STATE["backend"]]

    def gen():
        try:
            for kind, payload in digest.digest_stream(req.meeting_id, cfg, req.auto_research, req.when_label):
                if kind == "progress":
                    yield _sse("progress", payload if isinstance(payload, dict) else {"text": payload})
                elif kind == "result":
                    yield _sse("result", {"spec": payload, "backend_label": label})
        except Exception as ex:  # noqa: BLE001
            yield _sse("error", {"error": str(ex)})

    return StreamingResponse(
        gen(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── TTS ─────────────────────────────────────────────────────────────────────
@app.get("/api/tts/info")
def tts_info() -> dict:
    """TTS(음성 응답) 설치 여부·보이스 목록·설치 안내. 설치형 — 미설치면 텍스트만."""
    return tts.info()


class TtsReq(BaseModel):
    text: str
    voice: Optional[str] = None


@app.post("/api/tts")
def synth(req: TtsReq):
    text = (req.text or "").strip()
    if not text:
        return {"ok": False, "error": "empty text"}
    if not tts.available():
        return {"ok": False, "error": "tts_not_installed", "message": f"음성 응답 미설치 — {tts.TTS_INSTALL}"}
    out = os.path.join(tempfile.gettempdir(), f"ghost_tts_{uuid.uuid4().hex}.wav")
    path = tts.speak(text, out_path=out, voice=req.voice or tts.DEFAULT_VOICE)
    return FileResponse(path, media_type="audio/wav", filename="ghost.wav")


@app.get("/api/health")
def health() -> dict:
    # version: 앱이 띄운 번들 백엔드만 GHOST_BUILD를 갖는다(데스크탑 앱이 주입).
    # 외부/옛 백엔드(수동 uvicorn)는 이 값이 없어 "dev"로 보고, 앱이 '내 백엔드가 아님'을 판별한다.
    return {"ok": True, "version": os.environ.get("GHOST_BUILD", "dev")}
