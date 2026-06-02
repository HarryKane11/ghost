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


def _summary_card(summary: Dict[str, Any], when_label: str) -> Dict[str, Any]:
    """구조화 요약 → GenUI 카드 spec(LLM 없이 결정적으로 구성)."""
    blocks: List[Dict[str, Any]] = []
    if summary.get("summary"):
        blocks.append({"type": "heading", "text": "요약"})
        blocks.append({"type": "text", "text": summary["summary"]})
    if summary.get("decisions"):
        blocks.append({"type": "heading", "text": "결정"})
        blocks.append({"type": "list", "items": list(summary["decisions"])})
    if summary.get("action_items"):
        blocks.append({"type": "heading", "text": "액션 아이템"})
        blocks.append({"type": "list", "items": list(summary["action_items"])})
    if summary.get("open_questions"):
        blocks.append({"type": "heading", "text": "미해결"})
        blocks.append({"type": "list", "items": list(summary["open_questions"])})
    if not blocks:
        blocks = [{"type": "text", "text": "아직 정리할 내용이 충분하지 않아요."}]
    return {
        "title": f"회의 다이제스트 · {when_label}",
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
        yield ("result", {"title": "회의 다이제스트", "spoken": "", "intent": "none",
                          "blocks": [{"type": "text", "text": "회의를 찾을 수 없어요."}]})
        return

    # 1) 최신 상태로 fold(force) → 구조화 요약.
    yield ("progress", {"text": "회의 흐름 정리 중…"})
    summary = memory.fold(meeting_id, cfg, force=True)
    card = _summary_card(summary, when_label or "지금까지")

    # 자동 조사 불가(능력 없음/미해결 없음/opt-out) → 요약 카드만.
    # 웹/MCP capability가 있는 백엔드만 외부 조사(ollama 등은 요약만 → 프라이버시 보존).
    question = _top_open_question(summary)
    caps = caps_for(cfg.backend)
    can_research = auto_research and (caps.web_search or caps.mcp) and bool(question)
    if not can_research:
        store.append_digest(meeting_id, card)
        yield ("result", card)
        return

    # 2) 가장 중요한 미해결 1건만 실제 조사(R1: 1건 한정 — 비용·지연 억제).
    yield ("progress", {"text": f"미해결 조사: {question[:48]}"})
    research_blocks: List[Dict[str, Any]] = []
    ctx = memory.build_context(meeting_id)
    query = f"회의 중 아직 답이 안 나온 다음 질문을 조사해서 근거와 함께 간결히 정리해줘: {question}"
    try:
        for kind, payload in brain.act_stream(query, ctx, cfg, brain.ACT_SYSTEM):
            if kind == "progress":
                yield ("progress", payload if isinstance(payload, dict) else {"text": payload})
            elif kind == "result" and isinstance(payload, dict):
                research_blocks = payload.get("blocks") or []
    except Exception:  # noqa: BLE001 — 조사 실패해도 요약 카드는 보낸다
        research_blocks = []

    if research_blocks:
        card["blocks"].append({"type": "heading", "text": f"🔎 {question}"})
        card["blocks"].extend(research_blocks)
    store.append_digest(meeting_id, card)
    yield ("result", card)
