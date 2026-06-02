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
import tempfile
import threading
import uuid
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from ghost_local import brain, memory, stt, stt_cloud, store, tts


def _load_dotenv() -> None:
    """local/.env (gitignore됨)에서 KEY=VALUE를 읽어 환경변수로. 시크릿은 여기에만 둔다."""
    import pathlib
    p = pathlib.Path(__file__).resolve().parent / ".env"
    if not p.exists():
        return
    try:
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except Exception:
        pass


_load_dotenv()

app = FastAPI(title="Ghost Local Backend")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

STATE = {"backend": "codex", "stt_ready": False, "codex_model": None, "reasoning_effort": "low", "lang": "ko", "stt_provider": "local"}
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


@app.on_event("startup")
def _prewarm() -> None:
    """앱 시작 시 STT 모델을 백그라운드로 미리 로드 (첫 전사 24초 지연 제거)."""
    def _w():
        try:
            stt.warmup()
            STATE["stt_ready"] = True
            STATE["stt_error"] = None
        except Exception as ex:  # noqa: BLE001
            # 실패를 stt_ready=True로 가리면 전사 500이 조용히 발생한다 → 에러를 남긴다.
            STATE["stt_ready"] = False
            STATE["stt_error"] = str(ex)
    threading.Thread(target=_w, daemon=True).start()


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
        "stt_provider": STATE.get("stt_provider", "local"),
        "stt_providers": STT_PROVIDERS,
        "elevenlabs_key": bool(stt_cloud.elevenlabs_key()),
    }


class SttReq(BaseModel):
    provider: str


@app.post("/api/stt")
def set_stt(req: SttReq) -> dict:
    """STT 제공자 전환 (local|elevenlabs)."""
    if req.provider in STT_PROVIDERS:
        STATE["stt_provider"] = req.provider
    return {"ok": True, "stt_provider": STATE["stt_provider"]}


class ElevenKeyReq(BaseModel):
    key: str


@app.post("/api/apikey/elevenlabs")
def set_eleven_key(req: ElevenKeyReq) -> dict:
    """ElevenLabs 키를 런타임 환경변수로 설정(프로세스 메모리). 영구 저장은 local/.env 권장."""
    k = (req.key or "").strip()
    if k:
        os.environ["ELEVENLABS_API_KEY"] = k
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


class TitleReq(BaseModel):
    title: str


@app.patch("/api/meetings/{meeting_id}")
def edit_meeting(meeting_id: str, req: TitleReq) -> dict:
    """회의 제목 편집(폴더명 불변)."""
    meta = store.set_title(meeting_id, req.title)
    if meta is None:
        return {"ok": False, "error": "not found"}
    return {"ok": True, "meeting": meta}


@app.post("/api/meetings/{meeting_id}/end")
def end_meeting_ep(meeting_id: str) -> dict:
    meta = store.end_meeting(meeting_id)
    return {"ok": meta is not None, "meeting": meta}


class ContextReq(BaseModel):
    context: str


@app.post("/api/meetings/{meeting_id}/context")
def set_meeting_context(meeting_id: str, req: ContextReq) -> dict:
    """회의 맥락(상황·주제·고유명사) 저장 → brain·요약 정확도↑."""
    meta = store.set_context(meeting_id, req.context)
    return {"ok": meta is not None, "meeting": meta}


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
    """현재 로컬 ASR 모델 다운로드 시작(백그라운드, 재개 가능)."""
    return stt.start_download()


@app.get("/api/glossary")
def get_glossary_ep() -> dict:
    """사용자 전역 용어집(Word Memory)."""
    return {"glossary": store.get_glossary()}


class GlossaryReq(BaseModel):
    glossary: list


@app.post("/api/glossary")
def set_glossary_ep(req: GlossaryReq) -> dict:
    return {"ok": True, "glossary": store.set_glossary(req.glossary)}


@app.get("/api/stt/models")
def stt_models() -> dict:
    """선택 가능한 로컬/클라우드 STT 모델 목록 + 현재 활성 모델."""
    return {
        "local": stt.LOCAL_MODELS,
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
    return {"ok": True, "kind": "local", "model": stt.set_model(req.model_id)}


# ── STT ─────────────────────────────────────────────────────────────────────
def _to_wav(src: str) -> str:
    dst = os.path.join(tempfile.gettempdir(), f"ghost_in_{uuid.uuid4().hex}.wav")
    subprocess.run(["ffmpeg", "-y", "-i", src, "-ar", "16000", "-ac", "1", dst], capture_output=True, check=False)
    return dst


def _looks_like_hallucination(text: str) -> bool:
    """무음·잡음에서 STT가 지어낸 환각 추정. 한국어 위주 회의 기준:
    한글 0개 + 짧은 영어 + 숫자/약어 없음 → 환각으로 보고 버린다.
    (영어 기술용어는 보통 한글과 섞이거나 숫자/대문자 약어를 포함하므로 보존됨.)
    """
    t = (text or "").strip()
    if not t:
        return True
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
    raw = os.path.join(tempfile.gettempdir(), f"ghost_up_{uuid.uuid4().hex}")
    with open(raw, "wb") as f:
        shutil.copyfileobj(audio.file, f)
    wav = _to_wav(raw)
    try:
        if STATE.get("stt_provider") == "elevenlabs" and stt_cloud.elevenlabs_key():
            try:
                text = stt_cloud.transcribe(wav, lang=STATE.get("lang"))
            except Exception:
                text = stt.transcribe(wav)  # 클라우드 실패 시 로컬 폴백
        else:
            text = stt.transcribe(wav)
    finally:
        for p in (raw, wav):
            try:
                os.unlink(p)
            except OSError:
                pass
    if _looks_like_hallucination(text):
        return {"text": "", "filtered": True}
    # 전사 실시간 누적(회의 종료 안 기다림) + 충분히 쌓이면 백그라운드 fold.
    mid = (meeting_id or "").strip()
    if text and mid and store.get_meta(mid) is not None:
        store.append_transcript(mid, text, source=source or "mic")
        _bg_fold(mid)
    return {"text": text}


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
                    if mid and store.get_meta(mid) is not None:
                        store.save_minutes(mid, payload)  # 폴더에 영속(재시작 생존)
                    yield _sse("result", {"spec": payload, "backend_label": label})
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
class TtsReq(BaseModel):
    text: str


@app.post("/api/tts")
def synth(req: TtsReq):
    text = (req.text or "").strip()
    if not text:
        return {"ok": False, "error": "empty text"}
    out = os.path.join(tempfile.gettempdir(), f"ghost_tts_{uuid.uuid4().hex}.wav")
    path = tts.speak(text, out_path=out)
    return FileResponse(path, media_type="audio/wav", filename="ghost.wav")


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}
