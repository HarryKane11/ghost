"""AgentAdapter SPI — Ghost가 위에 앉는 '교체 가능한 에이전트 엔진' 추상화.

설계 원칙(조사 결론): subprocess+JSONL을 바닥 계약으로, capability flag로 codex는 1급·
hermes는 우아한 강등. 메커니즘(subprocess vs server+SDK)이 아니라 **능력**을 기준으로 추상화한다.

각 어댑터는 run_stream(턴 실행 + 진행 스트림)을 제공하고, 자신의 Capabilities를 선언한다.
이벤트는 Ghost 내부 taxonomy로 정규화된 (kind, payload) 튜플로 흘린다:
  ("progress", {"text": str, "kind"?: "command"|..., "id"?, "status"?})
  ("result",   spec_dict)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Iterator, Optional, Tuple

if TYPE_CHECKING:
    from ghost_local.brain import BrainConfig

Event = Tuple[str, Any]


@dataclass(frozen=True)
class Capabilities:
    """어댑터가 지원하는 능력. digest/UI가 이 플래그로 동작을 분기한다."""
    structured_output: bool = False  # JSON schema 강제 출력 가능?
    streaming_events: bool = False   # 도구호출/추론 이벤트 스트림?
    web_search: bool = False         # 실시간 웹 검색?
    mcp: bool = False                # MCP 커넥터?
    sessions: bool = False           # 세션 resume(맥락 이어가기)?


class AgentAdapter:
    """모든 에이전트 백엔드의 공통 인터페이스. 하위 클래스가 run_stream을 구현한다."""

    name: str = "base"
    caps: Capabilities = Capabilities()

    def run_stream(
        self,
        query: str,
        context: str,
        cfg: "BrainConfig",
        system: str,
    ) -> Iterator[Event]:
        """턴을 실행하며 진행상황을 스트리밍한다. 반드시 마지막에 ("result", spec)."""
        raise NotImplementedError

    def run(self, query: str, context: str, cfg: "BrainConfig", system: str) -> dict:
        """비스트리밍 편의 메서드 — run_stream을 소진해 최종 spec만 반환."""
        spec: Optional[dict] = None
        for kind, payload in self.run_stream(query, context, cfg, system):
            if kind == "result":
                spec = payload
        return spec or {"title": "Ghost", "spoken": "", "intent": "none",
                        "blocks": [{"type": "text", "text": query}]}
