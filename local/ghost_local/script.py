"""스크립트 — 거친 실시간 전사를 문단 단위로 정제(필러·오탈자 제거)하고 불릿 요약한다.

Tiro의 '실시간 문단 요약'을 우리 식으로: 전사가 일정 분량 쌓여 한 문단이 완성되면, 경량 모델로
(1) 매끄럽게 정제하고 (2) 핵심을 불릿으로 요약해 script.jsonl에 누적한다. 이미 처리한 발화는
meta.scripted_count로 추적해 새 문단만 추가 처리한다(증분). 정확도를 위해 용어집·맥락을 주입.
"""

from __future__ import annotations

from typing import List, Optional

from ghost_local import brain, store

# 한 문단으로 묶을 누적 글자 수 임계(이 이상 쌓이면 문단 완성으로 보고 정제).
FLUSH_CHARS = 260

SCRIPT_SYSTEM = (
    "너는 회의 전사를 다듬는 편집자다. 주어진 '한 문단'의 거친 실시간 전사를 받아:\n"
    "1) 필러워드(음·어·그·뭐랄까)·말더듬·반복·명백한 오탈자를 제거하고 매끄러운 문장으로 정제한다."
    " (내용·의미는 절대 바꾸지 말 것. 없는 말 추가 금지.)\n"
    "2) 그 문단의 핵심을 1~3개 불릿으로 요약한다.\n"
    "회의에서 쓰인 언어로. 반드시 JSON 한 개만: "
    '{"cleaned": str, "bullets": [str]}'
)


def _process(meeting_id: str, cfg: "brain.BrainConfig", lines: List[str]) -> None:
    para = " ".join(s.strip() for s in lines if s.strip())
    if not para:
        return
    bg_parts = [store.glossary_text(), store.get_context(meeting_id)]
    bg = "\n".join(p for p in bg_parts if p)
    ctx = f"[용어집·배경 — 고유명사 표기 참고]\n{bg}\n\n" if bg else ""
    out = brain._brain_json(SCRIPT_SYSTEM + brain._lang_line(cfg), f"{ctx}[문단]\n{para}", cfg, timeout=60) or {}
    cleaned = (out.get("cleaned") or "").strip() or para
    bullets = [str(b).strip() for b in (out.get("bullets") or []) if str(b).strip()]
    store.append_script(meeting_id, {"cleaned": cleaned, "bullets": bullets})


def build_script(meeting_id: str, cfg: Optional["brain.BrainConfig"] = None, flush_tail: bool = False) -> List[dict]:
    """새로 쌓인 전사를 문단 단위로 정제·요약해 script.jsonl에 누적하고, 스크립트 전체를 반환한다.

    flush_tail=True면 임계 미만의 남은 꼬리 문단도 마저 처리한다(회의 종료/명시 요청 시).
    """
    cfg = cfg or brain.BrainConfig()
    meta = store.get_meta(meeting_id)
    if meta is None:
        return []
    transcript = store.read_transcript(meeting_id)
    done = int(meta.get("scripted_count", 0))
    i, buf, buflen, consumed = done, [], 0, done
    while i < len(transcript):
        txt = transcript[i].get("text", "")
        buf.append(txt)
        buflen += len(txt)
        i += 1
        if buflen >= FLUSH_CHARS:
            _process(meeting_id, cfg, buf)
            consumed, buf, buflen = i, [], 0
    if flush_tail and buf:
        _process(meeting_id, cfg, buf)
        consumed = i
    if consumed > done:
        store.update_meta(meeting_id, {"scripted_count": consumed})
    return store.read_script(meeting_id)
