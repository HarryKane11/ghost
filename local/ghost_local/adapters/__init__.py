"""에이전트 어댑터 — Ghost가 위에 앉는 교체 가능한 엔진 계층."""

from ghost_local.adapters.base import AgentAdapter, Capabilities, Event
from ghost_local.adapters.registry import available, caps_for, get_adapter, register

__all__ = ["AgentAdapter", "Capabilities", "Event", "get_adapter", "caps_for", "available", "register"]
