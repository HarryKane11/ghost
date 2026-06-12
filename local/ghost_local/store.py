"""회의 영속 저장소 — 일시 기준 폴더에 전사·메타·회의록을 누적한다.

레이아웃 (베이스는 env GHOST_HOME, 기본 ~/Ghost):
  <GHOST_HOME>/meetings/<YYYY-MM-DD_HH-MM-SS>/
    ├── meeting.json     메타: id·title(편집가능)·started_at·ended_at·backend·lang·summary 등
    ├── transcript.jsonl 발화마다 실시간 append: {"t": ISO8601, "text": str, "source": str}
    ├── minutes.json     최종 회의록 spec (생성 시)
    ├── minutes.png      손글씨 회의록 (선택)
    ├── digests.jsonl    5분 다이제스트 카드 누적 (선택)
    └── cards.jsonl      질의응답 카드 누적 — 회의별 채팅 세션 (선택)

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


def get_connector_index() -> dict:
    """커넥터별 사전 인덱스 {name: {indexed_at, summary}} — codex가 미팅 중 어디서 정보를 찾을지 안다."""
    idx = _load_config().get("connector_index", {})
    return idx if isinstance(idx, dict) else {}


def set_connector_index(name: str, summary: str) -> dict:
    """커넥터 지형 요약(채널·페이지 목록·역할)을 저장. 모든 회의 컨텍스트에 주입된다."""
    cfg = _load_config()
    idx = cfg.get("connector_index", {})
    if not isinstance(idx, dict):
        idx = {}
    idx[name] = {"indexed_at": _now_iso(), "summary": (summary or "").strip()}
    cfg["connector_index"] = idx
    _save_config(cfg)
    return idx[name]


def connector_index_text(limit_chars: int = 2400) -> str:
    """인덱싱된 커넥터 지형을 컨텍스트 주입용 평문으로(길이 제한)."""
    idx = get_connector_index()
    if not idx:
        return ""
    parts = []
    for name, rec in idx.items():
        s = (rec or {}).get("summary", "").strip()
        if s:
            parts.append(f"### {name}\n{s}")
    text = "\n\n".join(parts)
    return text[:limit_chars]


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
        _fts_add(meeting_id, text)  # 검색 인덱스 증분(실패해도 무해 — 검색 시 백필)
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


def replace_last_transcript(meeting_id: str, old_text: str, new_text: str) -> bool:
    """가장 최근의 old_text 발화를 new_text로 교체(실시간 다듬기 반영).

    transcript.jsonl만 고친다 — 회의록·요약은 jsonl을 읽으므로 교정이 하류 전체에 반영된다.
    (transcript.md는 append-only 로그라 그대로 둔다.)"""
    old_text, new_text = (old_text or "").strip(), (new_text or "").strip()
    if not old_text or not new_text or old_text == new_text:
        return False
    with _LOCK:
        path = _meeting_path(meeting_id) / "transcript.jsonl"
        if not path.exists():
            return False
        lines = path.read_text(encoding="utf-8").splitlines()
        for i in range(len(lines) - 1, -1, -1):
            try:
                rec = json.loads(lines[i])
            except json.JSONDecodeError:
                continue
            if (rec.get("text") or "").strip() == old_text:
                rec["text"] = new_text
                rec["polished"] = True
                lines[i] = json.dumps(rec, ensure_ascii=False)
                tmp = path.with_suffix(".jsonl.tmp")
                tmp.write_text("\n".join(lines) + "\n", encoding="utf-8")
                tmp.replace(path)
                _fts_replace(meeting_id, old_text, new_text)
                return True
    return False


# ── 회의록 / 다이제스트 저장 ────────────────────────────────────────────────
def _minutes_savable(spec: dict) -> bool:
    """저장할 가치가 있는 회의록인지 — 빈 blocks·에러/타임아웃 카드(callout만)는 저장하지 않는다.

    이전엔 모델이 빈 spec이나 '응답 실패' 카드를 내도 그대로 minutes.json에 써서
    멀쩡한 회의가 '빈 회의록'으로 남았다."""
    if not isinstance(spec, dict):
        return False
    blocks = spec.get("blocks")
    if not isinstance(blocks, list) or not blocks:
        return False
    return not all(
        isinstance(b, dict) and b.get("type") == "callout" and b.get("value") in ("error", "warn")
        for b in blocks
    )


def save_minutes(meeting_id: str, spec: dict) -> bool:
    """회의록 spec을 폴더에 영속. 내용이 비었으면 저장하지 않는다(기존 회의록 보호). 저장 여부 반환."""
    if not _minutes_savable(spec):
        return False
    with _LOCK:
        folder = _meeting_path(meeting_id)
        if not folder.exists():
            return False
        _write_json(folder / "minutes.json", spec)
        return True


def get_minutes(meeting_id: str) -> Optional[dict]:
    return _read_json(_meeting_path(meeting_id) / "minutes.json")


def append_script(meeting_id: str, record: dict) -> None:
    """정제된 문단(스크립트) 1개를 script.jsonl에 append. record={cleaned, bullets}."""
    with _LOCK:
        folder = _meeting_path(meeting_id)
        if not folder.exists():
            return
        rec = {"t": _now_iso(), **record}
        with open(folder / "script.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def read_script(meeting_id: str) -> List[dict]:
    """스크립트(정제 문단) 전체. [{t, cleaned, bullets}]."""
    path = _meeting_path(meeting_id) / "script.jsonl"
    if not path.exists():
        return []
    out: List[dict] = []
    try:
        for raw in path.read_text(encoding="utf-8").splitlines():
            raw = raw.strip()
            if raw:
                try:
                    out.append(json.loads(raw))
                except json.JSONDecodeError:
                    continue
    except Exception:  # noqa: BLE001
        return out
    return out


def append_digest(meeting_id: str, spec: dict) -> None:
    with _LOCK:
        folder = _meeting_path(meeting_id)
        if not folder.exists():
            return
        rec = {"t": _now_iso(), "spec": spec}
        with open(folder / "digests.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def read_digests(meeting_id: str) -> List[dict]:
    """저장된 5분 다이제스트 기록 [{t, spec}] — 재시작 후에도 UI가 복원할 수 있게."""
    path = _meeting_path(meeting_id) / "digests.jsonl"
    if not path.exists():
        return []
    out: List[dict] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        raw = raw.strip()
        if raw:
            try:
                out.append(json.loads(raw))
            except json.JSONDecodeError:
                continue
    return out


def append_card(meeting_id: str, card: dict) -> bool:
    """완료된 질의응답 카드를 회의 폴더에 누적(cards.jsonl) — 회의별 채팅 세션 복원용."""
    with _LOCK:
        folder = _meeting_path(meeting_id)
        if not folder.exists():
            return False
        rec = {"t": _now_iso(), **card}
        with open(folder / "cards.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        return True


def read_cards(meeting_id: str) -> List[dict]:
    """저장된 질의응답 카드 [{t, query, ack, spec, backend}] — 회의 클릭 시 채팅 세션 복원."""
    path = _meeting_path(meeting_id) / "cards.jsonl"
    if not path.exists():
        return []
    out: List[dict] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        raw = raw.strip()
        if raw:
            try:
                out.append(json.loads(raw))
            except json.JSONDecodeError:
                continue
    return out


def append_note(meeting_id: str, text: str, author: str = "agent") -> bool:
    """외부 에이전트(MCP)가 회의에 메모를 남긴다 — notes.jsonl에 append(전사·회의록은 불변)."""
    text = (text or "").strip()
    if not text:
        return False
    with _LOCK:
        folder = _meeting_path(meeting_id)
        if not folder.exists():
            return False
        rec = {"t": _now_iso(), "author": (author or "agent").strip()[:40], "text": text[:2000]}
        with open(folder / "notes.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        return True


def read_notes(meeting_id: str) -> List[dict]:
    """외부 에이전트가 남긴 메모 [{t, author, text}]."""
    path = _meeting_path(meeting_id) / "notes.jsonl"
    if not path.exists():
        return []
    out: List[dict] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        raw = raw.strip()
        if raw:
            try:
                out.append(json.loads(raw))
            except json.JSONDecodeError:
                continue
    return out


def delete_meeting(meeting_id: str) -> bool:
    """회의 폴더를 통째로 삭제(전사·회의록·다이제스트 포함). 프라이버시 제품의 기본 권리.

    경로 탈출 방지: meeting_id가 meetings_dir 바로 아래의 디렉터리일 때만 지운다.
    """
    import shutil as _shutil
    mid = (meeting_id or "").strip()
    if not mid or "/" in mid or "\\" in mid or mid.startswith("."):
        return False
    with _LOCK:
        folder = _meeting_path(mid)
        try:
            if folder.resolve().parent != meetings_dir().resolve():
                return False
        except OSError:
            return False
        if not folder.is_dir():
            return False
        _shutil.rmtree(folder, ignore_errors=True)
        _fts_drop(mid)   # 검색 인덱스에서도 제거(삭제한 회의가 검색에 남지 않게)
        return not folder.exists()


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


def _card_brief(card: dict) -> dict:
    """질의응답 카드를 MCP 소비용 요약으로 — GenUI spec 전체 대신 질문·답 텍스트만."""
    spec = card.get("spec") or {}
    texts = [str(b.get("text", "")) for b in spec.get("blocks", [])
             if isinstance(b, dict) and b.get("type") == "text"]
    answer = (spec.get("spoken") or " ".join(texts)).strip()
    return {"t": card.get("t"), "query": card.get("query"),
            "title": spec.get("title"), "answer": answer[:500]}


def get_meeting(meeting_id: str, include_transcript: bool = True) -> Optional[dict]:
    """회의 1건 전체(메타 + 회의록 + 채팅 Q&A + 선택적 전사). MCP get_meeting용."""
    meta = get_meta(meeting_id)
    if meta is None:
        return None
    out: Dict[str, Any] = dict(meta)
    minutes = get_minutes(meeting_id)
    if minutes is not None:
        out["minutes"] = minutes
    notes = read_notes(meeting_id)
    if notes:
        out["notes"] = notes
    cards = read_cards(meeting_id)
    if cards:
        out["chat"] = [_card_brief(c) for c in cards]   # 회의 중 질의응답 기록(요약형)
    if include_transcript:
        out["transcript"] = transcript_text(meeting_id)
    return out


# ── FTS5 검색 인덱스 — 회의가 수백 건이어도 전사 풀스캔 없이 즉시 검색 ────────
import sqlite3


_FTS_VERSION = 2   # 스키마/토크나이저 바뀌면 올린다 → 인덱스 재생성(백필이 다시 채움)


def _search_db() -> sqlite3.Connection:
    """검색 인덱스 DB(meetings/.search.db). 없거나 버전이 다르면 스키마 (재)생성.

    토크나이저는 trigram — 한국어는 조사가 붙어 한 토큰이 되므로(예: 'Q3에')
    기본 unicode61로는 'Q3' 검색이 안 맞는다. trigram은 부분 문자열 매칭이 된다(3자+).
    """
    db = sqlite3.connect(meetings_dir() / ".search.db", timeout=5)
    if db.execute("PRAGMA user_version").fetchone()[0] != _FTS_VERSION:
        db.executescript(
            "DROP TABLE IF EXISTS lines; DROP TABLE IF EXISTS idx_state;"
        )
        db.execute("CREATE VIRTUAL TABLE lines USING fts5(meeting_id UNINDEXED, text, tokenize='trigram')")
        db.execute("CREATE TABLE idx_state (meeting_id TEXT PRIMARY KEY, n INTEGER)")
        db.execute(f"PRAGMA user_version = {_FTS_VERSION}")
        db.commit()
    return db


def _fts_add(meeting_id: str, text: str) -> None:
    """전사 1줄을 인덱스에 추가(핫패스 — 실패해도 전사 저장엔 영향 없음)."""
    try:
        with _search_db() as db:
            db.execute("INSERT INTO lines (meeting_id, text) VALUES (?, ?)", (meeting_id, text))
            db.execute(
                "INSERT INTO idx_state (meeting_id, n) VALUES (?, 1) "
                "ON CONFLICT(meeting_id) DO UPDATE SET n = n + 1",
                (meeting_id,),
            )
    except Exception:  # noqa: BLE001 — 인덱스는 보조 — 검색 시 백필로 복구된다
        pass


def _fts_replace(meeting_id: str, old_text: str, new_text: str) -> None:
    try:
        with _search_db() as db:
            db.execute(
                "DELETE FROM lines WHERE rowid IN "
                "(SELECT rowid FROM lines WHERE meeting_id = ? AND text = ? LIMIT 1)",
                (meeting_id, old_text),
            )
            db.execute("INSERT INTO lines (meeting_id, text) VALUES (?, ?)", (meeting_id, new_text))
    except Exception:  # noqa: BLE001
        pass


def _fts_drop(meeting_id: str) -> None:
    try:
        with _search_db() as db:
            db.execute("DELETE FROM lines WHERE meeting_id = ?", (meeting_id,))
            db.execute("DELETE FROM idx_state WHERE meeting_id = ?", (meeting_id,))
    except Exception:  # noqa: BLE001
        pass


def _fts_backfill(db: sqlite3.Connection) -> None:
    """인덱스가 비거나 뒤처진 회의만 증분 색인(기존 회의·인덱스 유실 복구)."""
    state = dict(db.execute("SELECT meeting_id, n FROM idx_state").fetchall())
    for folder in meetings_dir().iterdir():
        if not folder.is_dir():
            continue
        mid = folder.name
        lines = read_transcript(mid)
        done = int(state.get(mid, 0))
        if len(lines) <= done:
            continue
        for item in lines[done:]:
            txt = (item.get("text") or "").strip()
            if txt:
                db.execute("INSERT INTO lines (meeting_id, text) VALUES (?, ?)", (mid, txt))
        db.execute(
            "INSERT INTO idx_state (meeting_id, n) VALUES (?, ?) "
            "ON CONFLICT(meeting_id) DO UPDATE SET n = ?",
            (mid, len(lines), len(lines)),
        )


def _search_meetings_fts(q: str, limit: int) -> Optional[List[dict]]:
    """FTS5 검색. 실패(손상 등)·짧은 질의(trigram 최소 3자) 시 None → 풀스캔 폴백."""
    if len(q) < 3:
        return None
    try:
        with _LOCK, _search_db() as db:
            _fts_backfill(db)
            match = '"' + q.replace('"', '""') + '"'
            # snippet()은 집계와 함께 못 쓴다 → rank순으로 받아 파이썬에서 회의별 첫(최적) 매치만 취한다.
            rows = db.execute(
                "SELECT meeting_id, snippet(lines, 1, '', '', '…', 14) AS snip "
                "FROM lines WHERE lines MATCH ? ORDER BY rank LIMIT ?",
                (match, limit * 6),
            ).fetchall()
    except Exception:  # noqa: BLE001
        return None
    hits: List[dict] = []
    seen: set = set()
    for mid, snip in rows:
        if mid in seen:
            continue
        meta = get_meta(mid)
        if meta is None:
            continue
        seen.add(mid)
        hits.append({
            "id": mid,
            "title": meta.get("title", mid),
            "started_at": meta.get("started_at"),
            "snippet": snip,
        })
        if len(hits) >= limit:
            return hits
    # 제목·요약·결정(메타)은 FTS 밖 — 가볍게 보충 매치.
    ql = q.lower()
    for folder in sorted(meetings_dir().iterdir(), reverse=True):
        if not folder.is_dir() or folder.name in seen:
            continue
        meta = _read_json(folder / "meeting.json")
        if meta is None:
            continue
        hay = " ".join([str(meta.get("title", "")), str(meta.get("summary", "")),
                        " ".join(str(d) for d in meta.get("decisions", []))]).lower()
        if ql in hay:
            hits.append({"id": meta.get("id", folder.name), "title": meta.get("title", folder.name),
                         "started_at": meta.get("started_at"), "snippet": str(meta.get("summary", ""))[:120]})
            if len(hits) >= limit:
                break
    return hits


def search_meetings(query: str, limit: int = 20) -> List[dict]:
    """전체 회의의 전사·제목·요약·결정에서 query 검색. MCP search_meeting용.

    FTS5 인덱스(증분·백필)를 우선 사용 — 회의가 수백 건이어도 풀스캔 없이 즉시.
    인덱스 실패 시에만 기존 substring 풀스캔으로 폴백.
    """
    q = (query or "").strip()
    if not q:
        return []
    fts = _search_meetings_fts(q, limit)
    if fts is not None:
        return fts
    return _search_meetings_scan(q.lower(), limit)


def _search_meetings_scan(q: str, limit: int = 20) -> List[dict]:
    """레거시 substring 풀스캔(FTS 폴백)."""
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
