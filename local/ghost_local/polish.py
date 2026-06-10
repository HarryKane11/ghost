"""실시간 전사 다듬기 — 문장이 확정될 때마다 맥락·용어집으로 가볍게 교정한다.

스크립트 탭(문단 정제)과 다른 레이어다: 여기서는 '방금 확정된 한 문장'을
지금까지의 회의 맥락 + 전역 용어집에 비춰 오인식(고유명사·동음어)만 고친다.
필러워드 제거·요약은 하지 않는다(원문 보존 — 그건 스크립트 탭의 일).

함께, 발음이 불명확해 보이는 키워드(unclear)를 추려 UI가 사용자에게 묻고
용어집에 누적할 수 있게 한다 → 회의가 진행될수록 전사가 정확해지는 루프.
"""

from __future__ import annotations

from typing import Optional

from ghost_local import brain, store

POLISH_SYSTEM = (
    "너는 실시간 회의 전사 교정기다. [지금까지 전사]와 [용어집·배경]을 참고해 [방금 문장]에서 "
    "잘못 들린 단어(고유명사·동음어 오인식)와 명백한 오탈자·띄어쓰기만 고친다.\n"
    "규칙:\n"
    "- 의미·어순·말투는 유지한다. 새로운 내용 추가 금지. 필러워드(음·어 등)도 그대로 둔다.\n"
    "- 용어집에 있는 표기를 최우선으로 따른다(비슷하게 들린 단어는 용어집 표기로 교정).\n"
    "- 확신이 없으면 고치지 않는다. 고친 게 없으면 원문 그대로 돌려준다.\n"
    "- 발음이 불명확해 사람이 확인해줘야 할 키워드(이상하게 전사된 듯한 고유명사)가 있으면 "
    "unclear에 담는다(최대 2개). heard=들린 그대로, guess=추정 표기(모르면 빈 문자열).\n"
    '반드시 JSON 한 개만 출력: {"text": str, "unclear": [{"heard": str, "guess": str}]}'
)


def polish_line(meeting_id: str, text: str, cfg: Optional["brain.BrainConfig"] = None) -> dict:
    """방금 확정된 발화 1줄을 교정. {text, changed, unclear} 반환.

    교정이 일어나면 저장된 transcript.jsonl의 해당 줄도 교체한다
    (회의록·요약·검색이 모두 jsonl을 읽으므로 하류 정확도가 함께 오른다).
    """
    cfg = cfg or brain.BrainConfig()
    original = (text or "").strip()
    if len(original) < 6:
        return {"text": original, "changed": False, "unclear": []}

    mid = (meeting_id or "").strip()
    recent = ""
    if mid and store.get_meta(mid) is not None:
        lines = [t.get("text", "") for t in store.read_transcript(mid)[-9:-1]]
        recent = "\n".join(s for s in lines if s)
    bg = "\n".join(p for p in [store.glossary_text(), store.get_context(mid) if mid else ""] if p)

    user = (
        (f"[용어집·배경]\n{bg}\n\n" if bg else "")
        + (f"[지금까지 전사(최근)]\n{recent}\n\n" if recent else "")
        + f"[방금 문장]\n{original}"
    )
    out = brain._brain_json(POLISH_SYSTEM + brain._lang_line(cfg), user, cfg, timeout=25) or {}
    fixed = (out.get("text") or "").strip() or original
    changed = fixed != original
    unclear = []
    for u in out.get("unclear") or []:
        if isinstance(u, dict) and str(u.get("heard", "")).strip():
            unclear.append({"heard": str(u["heard"]).strip(), "guess": str(u.get("guess", "")).strip()})
        if len(unclear) >= 2:
            break

    if changed and mid:
        store.replace_last_transcript(mid, original, fixed)
    return {"text": fixed, "changed": changed, "unclear": unclear}
