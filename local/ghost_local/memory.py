"""롤링 회의 메모리 — 긴 회의에서도 맥락을 잃지 않는다.

핵심: 전사를 의미 단위로 자르지 않는다. 대신 점증적으로 '구조화 요약'에 접어 넣고(fold),
턴 컨텍스트는 `요약(bounded) + 최근 raw 발화 N개`로 조립한다. 백엔드 무관(ollama/hermes
처럼 네이티브 세션을 신뢰할 수 없는 경우에도 동작)하게 Ghost가 직접 메모리를 유지한다.

요약 fold는 codex 같은 무거운 경로를 쓰지 않고 경량 모델(_brain_json)로 처리한다(비용·지연 회피).
요약 상태는 store의 meeting.json에 영속된다.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from ghost_local import brain, store

# 한 번에 fold할 최소 신규 발화 수 (너무 잦은 LLM 호출 방지).
FOLD_MIN_NEW = 6
# 턴 컨텍스트에 붙일 최근 raw 발화 수.
RECENT_RAW_N = 12

FOLD_SYSTEM = (
    "너는 회의를 누적 요약하는 엔진이다. [기존 요약 상태](JSON)와 [신규 발화]를 보고, "
    "둘을 통합한 갱신된 요약 상태를 출력한다. 회의 초반 정보도 절대 버리지 말고 누적·정제한다.\n"
    "반드시 JSON 한 개만 출력(설명 금지):\n"
    '{"summary": str, "decisions": [str], "action_items": [str], '
    '"open_questions": [str], "glossary": {"용어": "뜻"}, "key_numbers": {"항목": "값"}}\n'
    "규칙:\n"
    "- summary: 회의 전체 흐름을 2~4문장으로 누적 요약(신규 발화 반영해 갱신).\n"
    "- decisions: 확정된 결정만. 중복 병합. 번복되면 최신으로 갱신.\n"
    "- action_items: '담당 - 할 일 - 기한' 형태로. 담당/기한 모르면 생략.\n"
    "- open_questions: 아직 답 안 된 질문·정보 공백·확인 필요 항목. 답이 나오면 제거.\n"
    "- glossary: 회의에서 나온 용어·약어·고유명사와 뜻(아는 범위).\n"
    "- key_numbers: 언급된 핵심 수치(매출·비율·날짜·가격 등).\n"
    "- 추측으로 채우지 말고, 발화에 근거가 있는 것만. 회의 언어로 작성."
)


def _empty_summary() -> Dict[str, Any]:
    return {
        "summary": "",
        "decisions": [],
        "action_items": [],
        "open_questions": [],
        "glossary": {},
        "key_numbers": {},
    }


def _summary_from_meta(meta: dict) -> Dict[str, Any]:
    s = _empty_summary()
    for k in s:
        if k in meta and meta[k] is not None:
            s[k] = meta[k]
    return s


def fold(meeting_id: str, cfg: Optional["brain.BrainConfig"] = None, force: bool = False) -> Dict[str, Any]:
    """신규 발화를 롤링 요약에 접어 넣고 meeting.json에 저장한다. 갱신된 요약 상태 반환.

    force=False면 신규 발화가 FOLD_MIN_NEW 미만일 때 fold를 건너뛴다(현 요약 반환).
    """
    cfg = cfg or brain.BrainConfig()
    meta = store.get_meta(meeting_id)
    if meta is None:
        return _empty_summary()

    transcript = store.read_transcript(meeting_id)
    total = len(transcript)
    folded = int(meta.get("folded_count", 0))
    new_count = total - folded
    current = _summary_from_meta(meta)

    if new_count <= 0:
        return current
    if new_count < FOLD_MIN_NEW and not force:
        return current

    new_lines = "\n".join(item.get("text", "") for item in transcript[folded:])
    user_ctx = (meta.get("user_context") or "").strip()
    glossary = store.glossary_text()
    bg = "\n".join(p for p in [glossary, user_ctx] if p)
    ctx_block = f"[용어집·회의 배경 — 고유명사 표기에 참고]\n{bg}\n\n" if bg else ""
    user = (
        f"{ctx_block}"
        f"[기존 요약 상태]\n{json.dumps(current, ensure_ascii=False)}\n\n"
        f"[신규 발화]\n{new_lines}"
    )
    out = brain._brain_json(FOLD_SYSTEM + brain._lang_line(cfg), user, cfg, timeout=90)
    if not isinstance(out, dict):
        # fold 실패 시 기존 요약 유지(맥락 손실 방지). folded_count는 올리지 않아 다음에 재시도.
        return current

    merged = _empty_summary()
    for k in merged:
        v = out.get(k)
        if isinstance(merged[k], list) and isinstance(v, list):
            merged[k] = [str(x) for x in v if str(x).strip()]
        elif isinstance(merged[k], dict) and isinstance(v, dict):
            merged[k] = {str(kk): str(vv) for kk, vv in v.items()}
        elif isinstance(merged[k], str) and isinstance(v, str):
            merged[k] = v.strip()
        else:
            merged[k] = current[k]  # 타입 불일치 시 기존값 보존

    patch: Dict[str, Any] = dict(merged)
    patch["folded_count"] = total
    # 자동 제목: 사용자가 직접 안 바꿨고, 요약이 생겼으면 첫 fold 때 주제 기반 제목 제안.
    if not meta.get("title_custom") and merged["summary"] and not meta.get("title_auto_set"):
        patch["title"] = _topic_title(merged["summary"], cfg) or meta.get("title")
        patch["title_auto_set"] = True
    store.update_meta(meeting_id, patch)
    return merged


def _topic_title(summary: str, cfg: "brain.BrainConfig") -> str:
    """요약에서 짧은 회의 제목(한 줄)을 뽑는다. 실패하면 빈 문자열."""
    txt = brain._brain_text(
        "다음 회의 요약을 보고 회의 제목을 8단어 이내 한 줄로만 출력해라. 따옴표·설명 금지." + brain._lang_line(cfg),
        summary, cfg, timeout=30,
    )
    title = (txt or "").strip().strip('"').splitlines()[0] if txt else ""
    return title[:60]


def render_summary(summary: Dict[str, Any]) -> str:
    """요약 상태를 LLM 컨텍스트용 평문으로 렌더링."""
    parts: List[str] = []
    if summary.get("summary"):
        parts.append(f"[요약]\n{summary['summary']}")
    if summary.get("decisions"):
        parts.append("[결정]\n" + "\n".join(f"- {d}" for d in summary["decisions"]))
    if summary.get("action_items"):
        parts.append("[액션아이템]\n" + "\n".join(f"- {a}" for a in summary["action_items"]))
    if summary.get("open_questions"):
        parts.append("[미해결]\n" + "\n".join(f"- {q}" for q in summary["open_questions"]))
    if summary.get("glossary"):
        parts.append("[용어]\n" + "\n".join(f"- {k}: {v}" for k, v in summary["glossary"].items()))
    if summary.get("key_numbers"):
        parts.append("[수치]\n" + "\n".join(f"- {k}: {v}" for k, v in summary["key_numbers"].items()))
    return "\n\n".join(parts)


def build_context(meeting_id: str, recent_n: int = RECENT_RAW_N) -> str:
    """턴 컨텍스트 = 롤링 요약(bounded) + 최근 raw 발화 N개. 의미 단위로 잘리지 않는다."""
    meta = store.get_meta(meeting_id)
    if meta is None:
        return ""
    summary_txt = render_summary(_summary_from_meta(meta))
    transcript = store.read_transcript(meeting_id)
    recent = transcript[-recent_n:] if recent_n > 0 else transcript
    recent_txt = "\n".join(item.get("text", "") for item in recent)
    blocks: List[str] = []
    # 커넥터 사전 인덱스 — codex가 미팅 중 '어디서' 정보를 찾을지 미리 알게 한다(채널·페이지 지형).
    conn_idx = store.connector_index_text()
    if conn_idx:
        blocks.append("## 연결된 도구 지형 (어디서 찾을지)\n" + conn_idx)
    # 전역 용어집(Word Memory) — 매 회의에 자동 주입돼 고유명사 표기가 누적 정확해진다.
    glossary = store.glossary_text()
    if glossary:
        blocks.append("## 용어집 (자주 쓰는 고유명사)\n" + glossary)
    # 사용자가 입력한 회의별 맥락(상황·주제·고유명사).
    user_ctx = (meta.get("user_context") or "").strip()
    if user_ctx:
        blocks.append("## 회의 배경 (사용자 제공)\n" + user_ctx)
    if summary_txt:
        blocks.append("## 지금까지의 회의 맥락\n" + summary_txt)
    if recent_txt:
        blocks.append("## 최근 발화\n" + recent_txt)
    return "\n\n".join(blocks)
