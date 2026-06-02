"""회의 영속 저장소 — 일시 기준 폴더에 전사·메타·회의록을 누적한다.

레이아웃 (베이스는 env GHOST_HOME, 기본 ~/Ghost):
  <GHOST_HOME>/meetings/<YYYY-MM-DD_HH-MM-SS>/
    ├── meeting.json     메타: id·title(편집가능)·started_at·ended_at·backend·lang·summary 등
    ├── transcript.jsonl 발화마다 실시간 append: {"t": ISO8601, "text": str, "source": str}
    ├── minutes.json     최종 회의록 spec (생성 시)
    ├── minutes.png      손글씨 회의록 (선택)
    └── digests.jsonl    5분 다이제스트 카드 누적 (선택)

폴더명(=id)은 시작 일시로 고정한다. 제목이 바뀌어도 폴더는 리네임하지 않는다.
별도 DB 없이 폴더 자체가 저장소다(재시작 생존). MCP 서버가 이 저장소 전체를 읽는다.
"""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

# 파일 쓰기 직렬화 (transcribe는 동시 호출될 수 있다).
_LOCK = threading.RLock()

_ID_FMT = "%Y-%m-%d_%H-%M-%S"


# 앱 설정 파일(저장 위치 등) — 회의 저장소와 분리(저장 위치를 바꿔도 설정은 유지).
_CONFIG_PATH = Path.home() / ".ghost" / "config.json"


def _load_config() -> dict:
    try:
        return json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def _save_config(cfg: dict) -> None:
    _CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    _CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")


def ghost_home() -> Path:
    """저장소 베이스 디렉터리. 우선순위: env GHOST_HOME > 설정파일 home > 기본 ~/Ghost."""
    env = os.environ.get("GHOST_HOME", "").strip()
    if env:
        return Path(env).expanduser()
    saved = (_load_config().get("home") or "").strip()
    if saved:
        return Path(saved).expanduser()
    return Path.home() / "Ghost"


def get_glossary() -> List[dict]:
    """사용자 전역 용어집 [{term, note}] — 모든 회의에 자동 주입돼 정확도가 누적된다(Tiro Word Memory)."""
    items = _load_config().get("glossary", [])
    return [i for i in items if isinstance(i, dict) and i.get("term")]


def set_glossary(items: List[dict]) -> List[dict]:
    """용어집 저장(영속). [{term, note}] 형태로 정규화."""
    clean: List[dict] = []
    for i in items or []:
        if isinstance(i, dict) and str(i.get("term", "")).strip():
            clean.append({"term": str(i["term"]).strip(), "note": str(i.get("note", "")).strip()})
    cfg = _load_config()
    cfg["glossary"] = clean
    _save_config(cfg)
    return clean


def glossary_text() -> str:
    """용어집을 프롬프트 주입용 평문으로. 비어 있으면 빈 문자열."""
    items = get_glossary()
    if not items:
        return ""
    return "\n".join(f"- {i['term']}" + (f": {i['note']}" if i.get("note") else "") for i in items)


def set_home(path: str) -> dict:
    """회의록 저장 위치를 사용자 지정으로 변경(영속). 새 경로의 meetings 디렉터리를 만든다.

    기존 회의는 이전 폴더에 그대로 남는다(이동하지 않음). 새 회의부터 새 위치에 저장된다.
    """
    p = (path or "").strip()
    if not p:
        return {"ok": False, "error": "empty path"}
    root = Path(p).expanduser()
    try:
        (root / "meetings").mkdir(parents=True, exist_ok=True)
    except Exception as ex:  # noqa: BLE001 — 쓰기 불가 경로
        return {"ok": False, "error": f"폴더를 만들 수 없어요: {ex}"}
    cfg = _load_config()
    cfg["home"] = str(root)
    _save_config(cfg)
    return {"ok": True, "home": str(root), "meetings_dir": str(root / "meetings")}


def meetings_dir() -> Path:
    d = ghost_home() / "meetings"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _meeting_path(meeting_id: str) -> Path:
    return meetings_dir() / meeting_id


def _read_json(path: Path) -> Optional[dict]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 — 손상/부재 파일은 None으로 흡수
        return None


def _write_json(path: Path, data: dict) -> None:
    """원자적 쓰기(임시파일 → rename)로 부분 쓰기 손상을 막는다."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _default_title(started_at: str) -> str:
    """시작 일시 기반 기본 제목. 예: '2026-06-02 14:30 회의'."""
    try:
        dt = datetime.fromisoformat(started_at)
        return dt.strftime("%Y-%m-%d %H:%M 회의")
    except Exception:  # noqa: BLE001
        return "회의"


# ── 회의 생성/조회 ──────────────────────────────────────────────────────────
def create_meeting(backend: str = "", lang: str = "ko") -> dict:
    """새 회의 폴더를 만들고 meeting.json을 초기화한다. 메타 dict 반환."""
    with _LOCK:
        now = datetime.now()
        meeting_id = now.strftime(_ID_FMT)
        folder = _meeting_path(meeting_id)
        # 같은 초에 두 번 시작하는 충돌 방지.
        suffix = 1
        while folder.exists():
            meeting_id = now.strftime(_ID_FMT) + f"-{suffix}"
            folder = _meeting_path(meeting_id)
            suffix += 1
        folder.mkdir(parents=True, exist_ok=True)
        started_at = _now_iso()
        meta = {
            "id": meeting_id,
            "title": _default_title(started_at),
            "title_custom": False,  # 사용자가 직접 수정했는지 (자동 제목 갱신 억제용)
            "user_context": "",     # 사용자가 입력한 회의 맥락(상황·주제·고유명사) — 정확도↑
            "folder": "",           # 회의 분류 폴더(사용자 지정)
            "started_at": started_at,
            "ended_at": None,
            "backend": backend,
            "lang": lang,
            "summary": "",
            "decisions": [],
            "action_items": [],
            "open_questions": [],
            "glossary": {},
            "key_numbers": {},
            "utterance_count": 0,
        }
        _write_json(folder / "meeting.json", meta)
        return meta


def get_meta(meeting_id: str) -> Optional[dict]:
    return _read_json(_meeting_path(meeting_id) / "meeting.json")


def update_meta(meeting_id: str, patch: Dict[str, Any]) -> Optional[dict]:
    """meeting.json의 일부 필드를 병합 갱신한다."""
    with _LOCK:
        folder = _meeting_path(meeting_id)
        meta = _read_json(folder / "meeting.json")
        if meta is None:
            return None
        meta.update(patch)
        _write_json(folder / "meeting.json", meta)
        return meta


def set_folder(meeting_id: str, folder: str) -> Optional[dict]:
    """회의를 폴더로 분류(사용자 지정). 폴더명 비우면 미분류."""
    return update_meta(meeting_id, {"folder": (folder or "").strip()})


def _duration_sec(meta: dict) -> Optional[int]:
    """started_at~ended_at 회의 길이(초). 종료 안 됐으면 None."""
    s, e = meta.get("started_at"), meta.get("ended_at")
    if not s or not e:
        return None
    try:
        return max(0, int((datetime.fromisoformat(e) - datetime.fromisoformat(s)).total_seconds()))
    except Exception:  # noqa: BLE001
        return None


def set_context(meeting_id: str, text: str) -> Optional[dict]:
    """사용자가 입력한 회의 맥락(상황·주제·고유명사)을 저장. brain·요약 정확도에 쓰인다."""
    return update_meta(meeting_id, {"user_context": (text or "").strip()})


def get_context(meeting_id: str) -> str:
    meta = get_meta(meeting_id)
    return (meta or {}).get("user_context", "") if meta else ""


def set_title(meeting_id: str, title: str) -> Optional[dict]:
    """사용자가 회의 제목을 편집. 폴더명은 불변, title 필드만 갱신."""
    title = (title or "").strip()
    if not title:
        return get_meta(meeting_id)
    return update_meta(meeting_id, {"title": title, "title_custom": True})


def end_meeting(meeting_id: str) -> Optional[dict]:
    return update_meta(meeting_id, {"ended_at": _now_iso()})


# ── 전사 실시간 누적 ────────────────────────────────────────────────────────
import re as _re

# 문장 종결 부호(한국어·영어·중국어). 이 뒤에서 문장을 끊어 md에 한 줄씩 적는다.
_SENT_SPLIT = _re.compile(r"(?<=[.!?。！？…])\s+")


def _append_md(folder: Path, text: str) -> None:
    """전사 텍스트를 문장 마침 기준으로 transcript.md에 실시간 누적(사람이 읽기 쉬운 형식)."""
    md_path = folder / "transcript.md"
    if not md_path.exists():
        title = (_read_json(folder / "meeting.json") or {}).get("title", "회의")
        md_path.write_text(f"# {title} — 전사\n\n", encoding="utf-8")
    # 문장 단위로 쪼개 한 줄씩(종결 부호가 없으면 통째로 한 줄).
    sentences = [s.strip() for s in _SENT_SPLIT.split(text) if s.strip()]
    if sentences:
        with open(md_path, "a", encoding="utf-8") as f:
            f.write("\n".join(sentences) + "\n")


def append_transcript(meeting_id: str, text: str, source: str = "mic") -> None:
    """발화 1건을 transcript.jsonl에 즉시 append하고, transcript.md(문장 단위)도 갱신."""
    text = (text or "").strip()
    if not text:
        return
    with _LOCK:
        folder = _meeting_path(meeting_id)
        if not folder.exists():
            return
        line = json.dumps({"t": _now_iso(), "text": text, "source": source}, ensure_ascii=False)
        with open(folder / "transcript.jsonl", "a", encoding="utf-8") as f:
            f.write(line + "\n")
        _append_md(folder, text)  # 문장 마침 기준 md 실시간 업데이트
        meta = _read_json(folder / "meeting.json")
        if meta is not None:
            meta["utterance_count"] = int(meta.get("utterance_count", 0)) + 1
            _write_json(folder / "meeting.json", meta)


def read_transcript(meeting_id: str) -> List[dict]:
    """전사 전체를 [{t, text, source}] 리스트로 반환."""
    folder = _meeting_path(meeting_id)
    path = folder / "transcript.jsonl"
    if not path.exists():
        return []
    out: List[dict] = []
    try:
        for raw in path.read_text(encoding="utf-8").splitlines():
            raw = raw.strip()
            if not raw:
                continue
            try:
                out.append(json.loads(raw))
            except json.JSONDecodeError:
                continue
    except Exception:  # noqa: BLE001
        return out
    return out


def transcript_text(meeting_id: str) -> str:
    """전사를 줄바꿈으로 이은 평문(LLM 입력용)."""
    return "\n".join(item.get("text", "") for item in read_transcript(meeting_id))


# ── 회의록 / 다이제스트 저장 ────────────────────────────────────────────────
def save_minutes(meeting_id: str, spec: dict) -> None:
    with _LOCK:
        folder = _meeting_path(meeting_id)
        if folder.exists():
            _write_json(folder / "minutes.json", spec)


def get_minutes(meeting_id: str) -> Optional[dict]:
    return _read_json(_meeting_path(meeting_id) / "minutes.json")


def append_digest(meeting_id: str, spec: dict) -> None:
    with _LOCK:
        folder = _meeting_path(meeting_id)
        if not folder.exists():
            return
        rec = {"t": _now_iso(), "spec": spec}
        with open(folder / "digests.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")


# ── 목록 / 검색 (MCP·과거 회의 접근) ────────────────────────────────────────
def list_meetings(limit: int = 50) -> List[dict]:
    """최근 회의 메타 요약 목록 (최신순). MCP list_meetings용."""
    out: List[dict] = []
    for folder in sorted(meetings_dir().iterdir(), reverse=True):
        if not folder.is_dir():
            continue
        meta = _read_json(folder / "meeting.json")
        if meta is None:
            continue
        out.append({
            "id": meta.get("id", folder.name),
            "title": meta.get("title", folder.name),
            "folder": meta.get("folder", ""),
            "started_at": meta.get("started_at"),
            "ended_at": meta.get("ended_at"),
            "duration_sec": _duration_sec(meta),
            "utterance_count": meta.get("utterance_count", 0),
            "has_minutes": (folder / "minutes.json").exists(),
        })
        if len(out) >= limit:
            break
    return out


def get_meeting(meeting_id: str, include_transcript: bool = True) -> Optional[dict]:
    """회의 1건 전체(메타 + 회의록 + 선택적 전사). MCP get_meeting용."""
    meta = get_meta(meeting_id)
    if meta is None:
        return None
    out: Dict[str, Any] = dict(meta)
    minutes = get_minutes(meeting_id)
    if minutes is not None:
        out["minutes"] = minutes
    if include_transcript:
        out["transcript"] = transcript_text(meeting_id)
    return out


def search_meetings(query: str, limit: int = 20) -> List[dict]:
    """전체 회의의 전사·제목·요약·결정에서 query를 부분일치 검색. MCP search_meeting용.

    경량 substring 검색(대소문자 무시). 매칭된 회의마다 스니펫을 함께 반환.
    """
    q = (query or "").strip().lower()
    if not q:
        return []
    hits: List[dict] = []
    for folder in sorted(meetings_dir().iterdir(), reverse=True):
        if not folder.is_dir():
            continue
        meta = _read_json(folder / "meeting.json")
        if meta is None:
            continue
        # 검색 대상 텍스트 모음.
        haystack_parts: List[str] = [
            str(meta.get("title", "")),
            str(meta.get("summary", "")),
            " ".join(str(d) for d in meta.get("decisions", [])),
            " ".join(str(a) for a in meta.get("action_items", [])),
        ]
        transcript = transcript_text(meta.get("id", folder.name))
        haystack_parts.append(transcript)
        haystack = "\n".join(haystack_parts)
        low = haystack.lower()
        idx = low.find(q)
        if idx == -1:
            continue
        start = max(0, idx - 60)
        snippet = haystack[start: idx + len(q) + 100].replace("\n", " ").strip()
        hits.append({
            "id": meta.get("id", folder.name),
            "title": meta.get("title", folder.name),
            "started_at": meta.get("started_at"),
            "snippet": ("…" if start > 0 else "") + snippet + "…",
        })
        if len(hits) >= limit:
            break
    return hits
