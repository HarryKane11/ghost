"""ghost-meeting MCP 서버 — Ghost를 '회의록 상위 레이어'로 노출한다.

사용자가 어떤 에이전트(codex/opencode/hermes/…)를 쓰든, 이 MCP를 연결하면 그 에이전트가
Ghost가 저장한 회의록 전체(~/Ghost/meetings/)에 접근한다. 현재 회의뿐 아니라 지난 회의까지.

연결 (codex 예):
  codex mcp add ghost-meeting -- uv run --directory <ghost>/local python -m ghost_local.mcp_server

도구:
  list_meetings()             최근 회의 목록
  get_meeting(id)             회의 1건(메타+요약+회의록+전사)
  search_meetings(query)      전체 회의 전사·요약·결정에서 검색
  get_transcript(id)          전사 평문
  get_summary(id)             롤링 요약(요약·결정·액션·미해결·용어·수치)
  current_meeting()           가장 최근(진행 중일 가능성) 회의

읽기 전용 — 회의 데이터를 수정하지 않는다(R4: brain이 이걸 다시 호출해도 부작용 없음).
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from mcp.server.fastmcp import FastMCP

from ghost_local import store

mcp = FastMCP("ghost-meeting")


@mcp.tool()
def list_meetings(limit: int = 20) -> List[dict]:
    """저장된 회의 목록을 최신순으로 반환(id·제목·시작/종료·발화수·회의록유무)."""
    return store.list_meetings(limit=limit)


@mcp.tool()
def get_meeting(meeting_id: str) -> Optional[dict]:
    """회의 1건 전체: 메타 + 롤링 요약(결정·액션·미해결) + 회의록(있으면) + 전사 평문."""
    return store.get_meeting(meeting_id, include_transcript=True)


@mcp.tool()
def search_meetings(query: str, limit: int = 10) -> List[dict]:
    """전체 회의의 전사·제목·요약·결정에서 query를 검색(스니펫 포함). 지난 회의 횡단 검색."""
    return store.search_meetings(query, limit=limit)


@mcp.tool()
def get_transcript(meeting_id: str) -> str:
    """해당 회의의 전사 전체를 평문으로 반환."""
    return store.transcript_text(meeting_id)


@mcp.tool()
def get_summary(meeting_id: str) -> Dict[str, Any]:
    """해당 회의의 롤링 요약 상태(summary·decisions·action_items·open_questions·glossary·key_numbers)."""
    meta = store.get_meta(meeting_id)
    if meta is None:
        return {}
    keys = ("summary", "decisions", "action_items", "open_questions", "glossary", "key_numbers")
    return {k: meta.get(k) for k in keys}


@mcp.tool()
def current_meeting() -> Optional[dict]:
    """가장 최근 회의(진행 중일 가능성이 높음)의 메타+요약+전사. 없으면 null."""
    items = store.list_meetings(limit=1)
    if not items:
        return None
    return store.get_meeting(items[0]["id"], include_transcript=True)


def main() -> None:
    """stdio MCP 서버 실행 (codex/opencode/hermes가 subprocess로 띄운다)."""
    mcp.run()


if __name__ == "__main__":
    main()
