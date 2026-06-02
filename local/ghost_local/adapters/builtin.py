"""내장 어댑터 — codex / ollama / openai. 기존 brain 내부 함수를 래핑(동작 불변).

리팩터 원칙: 로직을 옮기지 않고 위임만 한다. 기존 _act_codex/_act_ollama/_act_openai/
act_stream(codex)의 검증된 동작을 그대로 노출하고, 위에 Capabilities만 선언한다.
"""

from __future__ import annotations

from typing import Iterator

from ghost_local import brain
from ghost_local.adapters.base import AgentAdapter, Capabilities, Event


class CodexAdapter(AgentAdapter):
    """Codex CLI — subprocess+JSONL. 웹검색·MCP·스키마출력·세션resume 전부 1급."""
    name = "codex"
    caps = Capabilities(structured_output=True, streaming_events=True,
                        web_search=True, mcp=True, sessions=True)

    def run_stream(self, query: str, context: str, cfg, system: str) -> Iterator[Event]:
        # 분리된 codex 전용 스트림을 사용(act_stream은 디스패처라 재귀 위험).
        yield from brain.codex_act_stream(query, context, cfg, system)


class OllamaAdapter(AgentAdapter):
    """Ollama(Gemma) — 완전 로컬. 외부 검색/MCP 없음(프라이버시). 스트림 이벤트 없음."""
    name = "ollama"
    caps = Capabilities(structured_output=True, streaming_events=False,
                        web_search=False, mcp=False, sessions=False)

    def run_stream(self, query: str, context: str, cfg, system: str) -> Iterator[Event]:
        yield ("progress", {"text": "생각하는 중…"})
        yield ("result", brain._act_ollama(query, context, cfg, system))


class OpenAIAdapter(AgentAdapter):
    """OpenAI API(gpt) — 스키마 출력 가능. 기본 도구 없음(brain에서 미연결)."""
    name = "openai"
    caps = Capabilities(structured_output=True, streaming_events=False,
                        web_search=False, mcp=False, sessions=False)

    def run_stream(self, query: str, context: str, cfg, system: str) -> Iterator[Event]:
        yield ("progress", {"text": "생각하는 중…"})
        yield ("result", brain._act_openai(query, context, cfg, system))
