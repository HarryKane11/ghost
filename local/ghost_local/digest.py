"""5분 다이제스트 — 회의 능동성의 기본 동작.

매 인터벌마다 카드 1개: 롤링 요약 + 결정 + 액션아이템 + 미해결 질문.
그리고 가장 중요한 미해결 1건을 backend가 능력이 될 때만(web/MCP) 실제 조사해 근거를 첨부한다.
ollama처럼 외부 검색이 없는 백엔드는 요약만(프라이버시 약속 보존).

server가 import해서 SSE로 흘린다. (kind, payload) 프로토콜은 brain.act_stream과 동일.
"""

from __future__ import annotations

from typing import Any, Dict, Iterator, List, Optional, Tuple

from ghost_local import brain, memory, store
from ghost_local.adapters import caps_for


# 카드 라벨 3개 국어(코드가 결정적으로 만드는 부분 — LLM 출력은 _lang_line이 맡는다).
_L = {
    "summary":    {"ko": "요약", "en": "Summary", "zh": "摘要"},
    "decisions":  {"ko": "결정", "en": "Decisions", "zh": "决定"},
    "actions":    {"ko": "액션 아이템", "en": "Action items", "zh": "行动项"},
    "open":       {"ko": "미해결", "en": "Open questions", "zh": "未决问题"},
    "not_enough": {"ko": "아직 정리할 내용이 충분하지 않아요.", "en": "Not enough to summarize yet.", "zh": "目前还没有足够的内容可总结。"},
    "title":      {"ko": "회의 다이제스트", "en": "Meeting digest", "zh": "会议摘要"},
    "so_far":     {"ko": "지금까지", "en": "so far", "zh": "至今"},
    "folding":    {"ko": "회의 흐름 정리 중…", "en": "Catching up on the meeting…", "zh": "正在梳理会议进展…"},
    "researching": {"ko": "미해결 조사: {q}", "en": "Researching open question: {q}", "zh": "正在调查未决问题：{q}"},
    "not_found":  {"ko": "회의를 찾을 수 없어요.", "en": "Meeting not found.", "zh": "找不到该会议。"},
}


def _t(key: str, cfg: "brain.BrainConfig", **fmt) -> str:
    s = _L[key].get(cfg.lang) or _L[key]["ko"]
    return s.format(**fmt) if fmt else s


def _summary_card(summary: Dict[str, Any], when_label: str, cfg: "brain.BrainConfig") -> Dict[str, Any]:
    """구조화 요약 → GenUI 카드 spec(LLM 없이 결정적으로 구성)."""
    blocks: List[Dict[str, Any]] = []
    if summary.get("summary"):
        blocks.append({"type": "heading", "text": _t("summary", cfg)})
        blocks.append({"type": "text", "text": summary["summary"]})
    if summary.get("decisions"):
        blocks.append({"type": "heading", "text": _t("decisions", cfg)})
        blocks.append({"type": "list", "items": list(summary["decisions"])})
    if summary.get("action_items"):
        blocks.append({"type": "heading", "text": _t("actions", cfg)})
        blocks.append({"type": "list", "items": list(summary["action_items"])})
    if summary.get("open_questions"):
        blocks.append({"type": "heading", "text": _t("open", cfg)})
        blocks.append({"type": "list", "items": list(summary["open_questions"])})
    if not blocks:
        blocks = [{"type": "text", "text": _t("not_enough", cfg)}]
    return {
        "title": f"{_t('title', cfg)} · {when_label}",
        "spoken": "",  # 무음 (회의 방해 금지)
        "intent": "note",
        "blocks": blocks,
    }


def _top_open_question(summary: Dict[str, Any]) -> Optional[str]:
    qs = summary.get("open_questions") or []
    for q in qs:
        if str(q).strip():
            return str(q).strip()
    return None


def digest_stream(
    meeting_id: str,
    cfg: Optional["brain.BrainConfig"] = None,
    auto_research: bool = True,
    when_label: str = "",
) -> Iterator[Tuple[str, Any]]:
    """다이제스트 생성 스트림. yield ("progress", {...}) / ("result", spec)."""
    cfg = cfg or brain.BrainConfig()
    if store.get_meta(meeting_id) is None:
        yield ("result", {"title": _t("title", cfg), "spoken": "", "intent": "none",
                          "blocks": [{"type": "text", "text": _t("not_found", cfg)}]})
        return

    # 1) 최신 상태로 fold(force) → 구조화 요약.
    yield ("progress", {"text": _t("folding", cfg)})
    summary = memory.fold(meeting_id, cfg, force=True)
    card = _summary_card(summary, when_label or _t("so_far", cfg), cfg)

    # 1.5) 요약 카드를 '먼저' 보낸다 → 클라이언트 타임아웃 해제(조사가 느려도 카드는 떴음).
    yield ("result", card)

    # 자동 조사 불가(능력 없음/미해결 없음/opt-out) → 요약 카드로 끝.
    # 웹/MCP capability가 있는 백엔드만 외부 조사(ollama 등은 요약만 → 프라이버시 보존).
    question = _top_open_question(summary)
    caps = caps_for(cfg.backend)
    can_research = auto_research and (caps.web_search or caps.mcp) and bool(question)
    if not can_research:
        store.append_digest(meeting_id, card)
        return

    # 2) 가장 중요한 미해결 1건만 실제 조사(R1: 1건 한정). best-effort — 실패/지연돼도 요약은 이미 떴다.
    yield ("progress", {"text": _t("researching", cfg, q=question[:48])})
    research_blocks: List[Dict[str, Any]] = []
    ctx = memory.build_context(meeting_id)
    query = f"회의 중 아직 답이 안 나온 다음 질문을 조사해서 근거와 함께 간결히 정리해줘: {question}"
    try:
        for kind, payload in brain.act_stream(query, ctx, cfg, brain.ACT_SYSTEM):
            if kind == "progress":
                yield ("progress", payload if isinstance(payload, dict) else {"text": payload})
            elif kind == "result" and isinstance(payload, dict):
                research_blocks = payload.get("blocks") or []
    except Exception:  # noqa: BLE001 — 조사 실패해도 요약 카드는 이미 전달됨
        research_blocks = []

    if research_blocks:
        card["blocks"].append({"type": "heading", "text": f"🔎 {question}"})
        card["blocks"].extend(research_blocks)
        yield ("result", card)  # 조사 결과 포함해 카드 갱신(2번째 result)
    store.append_digest(meeting_id, card)
