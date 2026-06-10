"""store 모듈 테스트 — 회의 영속·회의록 검증·삭제·교정 교체."""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture()
def store(tmp_path, monkeypatch):
    """GHOST_HOME을 임시 폴더로 돌린 store 모듈."""
    monkeypatch.setenv("GHOST_HOME", str(tmp_path))
    from ghost_local import store as s
    importlib.reload(s)
    return s


def test_meeting_lifecycle(store):
    m = store.create_meeting()
    mid = m["id"]
    store.append_transcript(mid, "첫 발화입니다.")
    store.append_transcript(mid, "두 번째 발화입니다.")
    assert store.get_meta(mid)["utterance_count"] == 2
    assert "첫 발화" in store.transcript_text(mid)


def test_minutes_rejects_empty_and_error_specs(store):
    mid = store.create_meeting()["id"]
    assert store.save_minutes(mid, {"title": "x", "blocks": []}) is False
    assert store.save_minutes(mid, {"title": "x", "blocks": [
        {"type": "callout", "value": "error", "text": "실패"}]}) is False
    assert store.get_minutes(mid) is None
    assert store.save_minutes(mid, {"title": "회의록", "blocks": [{"type": "text", "text": "요약"}]}) is True
    # 에러 spec이 기존 회의록을 덮어쓰지 않는다
    assert store.save_minutes(mid, {"title": "응답 실패", "blocks": [
        {"type": "callout", "value": "error", "text": "x"}]}) is False
    assert store.get_minutes(mid)["title"] == "회의록"


def test_replace_last_transcript(store):
    mid = store.create_meeting()["id"]
    store.append_transcript(mid, "스카이 에이엑스 담당자가 확인합니다.")
    assert store.replace_last_transcript(mid, "스카이 에이엑스 담당자가 확인합니다.", "SK AX 담당자가 확인합니다.")
    lines = store.read_transcript(mid)
    assert lines[-1]["text"] == "SK AX 담당자가 확인합니다."
    assert lines[-1].get("polished") is True


def test_delete_meeting(store):
    mid = store.create_meeting()["id"]
    store.append_transcript(mid, "지울 회의")
    assert store.delete_meeting(mid) is True
    assert store.get_meta(mid) is None
    # 경로 탈출 차단
    assert store.delete_meeting("../" + mid) is False
    assert store.delete_meeting("") is False


def test_notes_and_digests(store):
    mid = store.create_meeting()["id"]
    assert store.append_note(mid, "후속 메일 발송됨", author="codex") is True
    notes = store.read_notes(mid)
    assert notes and notes[0]["text"] == "후속 메일 발송됨"
    store.append_digest(mid, {"title": "다이제스트", "blocks": [{"type": "text", "text": "요약"}]})
    digs = store.read_digests(mid)
    assert digs and digs[0]["spec"]["title"] == "다이제스트"
    # get_meeting에 notes 포함
    full = store.get_meeting(mid)
    assert full["notes"][0]["author"] == "codex"


def test_fts_search(store):
    """FTS 인덱스 경유 검색 — 추가·교정·삭제가 인덱스에 반영된다."""
    m1 = store.create_meeting()["id"]
    store.append_transcript(m1, "쿠버네티스 마이그레이션 일정은 8월로 확정합니다.")
    store.append_transcript(m1, "예산은 다음 분기에 다시 논의합니다.")
    hits = store.search_meetings("쿠버네티스")
    assert hits and hits[0]["id"] == m1 and "쿠버네티스" in hits[0]["snippet"]
    # 교정 반영
    store.replace_last_transcript(m1, "예산은 다음 분기에 다시 논의합니다.", "예산은 Q3에 다시 논의합니다.")
    assert store.search_meetings("Q3")
    # 백필: 인덱스 없이 직접 쓴 회의도 검색됨
    import json as _json
    m2 = store.create_meeting()["id"]
    folder = store._meeting_path(m2)
    with open(folder / "transcript.jsonl", "a", encoding="utf-8") as f:
        f.write(_json.dumps({"t": "", "text": "온톨로지 설계 리뷰", "source": "mic"}, ensure_ascii=False) + "\n")
    assert any(h["id"] == m2 for h in store.search_meetings("온톨로지"))
    # 삭제 반영
    store.delete_meeting(m1)
    assert not any(h["id"] == m1 for h in store.search_meetings("쿠버네티스"))
