"""어댑터 레지스트리 — backend 이름 → AgentAdapter 인스턴스.

brain.act/act_stream이 이 레지스트리를 경유해 백엔드를 고른다. 새 에이전트(opencode/hermes)는
여기에 한 줄 등록하면 끝 — Ghost가 그 위의 회의 상위 레이어가 된다.
"""

from __future__ import annotations

from typing import Dict, List, Optional

from ghost_local.adapters.base import AgentAdapter, Capabilities
from ghost_local.adapters.builtin import CodexAdapter, OllamaAdapter, OpenAIAdapter

_REGISTRY: Dict[str, AgentAdapter] = {}


def register(adapter: AgentAdapter) -> None:
    _REGISTRY[adapter.name] = adapter


def get_adapter(name: str) -> AgentAdapter:
    """이름으로 어댑터를 찾는다. 없으면 codex로 폴백."""
    return _REGISTRY.get(name) or _REGISTRY["codex"]


def caps_for(name: str) -> Capabilities:
    return get_adapter(name).caps


def available() -> List[str]:
    return list(_REGISTRY.keys())


# 내장 어댑터 등록.
register(CodexAdapter())
register(OllamaAdapter())
register(OpenAIAdapter())

# opencode / hermes는 설치돼 있으면 등록(없으면 조용히 생략).
try:
    from ghost_local.adapters.opencode import OpenCodeAdapter
    register(OpenCodeAdapter())
except Exception:  # noqa: BLE001
    pass
try:
    from ghost_local.adapters.hermes import HermesAdapter
    register(HermesAdapter())
except Exception:  # noqa: BLE001
    pass
