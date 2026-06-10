"""codex 상시 세션 — `codex mcp-server` 하나를 띄워두고 경량 호출을 재사용한다.

왜: judge/polish/translate/script/fold가 매번 `codex exec` 프로세스를 새로 띄우면
호출당 ~1.3s의 스폰·초기화 비용 + 동시 호출 시 auth 토큰 레이스가 생긴다(실측).
`codex mcp-server`는 한 프로세스가 모든 턴을 처리하므로 둘 다 사라진다.

설계:
  · 전용 스레드의 asyncio 루프 위에 MCP ClientSession 1개 (lazy 기동)
  · 호출 실패/프로세스 사망 → 세션 폐기 + 쿨다운, 호출부는 exec 경로로 자동 폴백
  · 동시 호출은 세마포어(4)로 제한 — codex 서버가 턴을 직렬화해도 큐 폭주 방지
  · GHOST_CODEX_SESSION=0 으로 끌 수 있다(문제 시 즉시 옛 경로)
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from typing import Any, Optional

# mcp 라이브러리가 codex의 비표준 알림(codex/event)을 검증 실패로 시끄럽게 경고한다 → 무해, 침묵.
class _DropCodexEventNoise(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:  # noqa: D102
        return "Failed to validate notification" not in record.getMessage()


logging.getLogger().addFilter(_DropCodexEventNoise())

_COOLDOWN_SEC = 120.0   # 기동 실패 후 재시도 대기(스폰 폭주 방지)
_MAX_CONCURRENT = 4


def enabled() -> bool:
    return os.environ.get("GHOST_CODEX_SESSION", "1").strip() not in ("0", "false", "off")


class _Runner:
    """전용 스레드 + asyncio 루프에서 codex mcp-server 세션을 유지한다."""

    def __init__(self) -> None:
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self._run_loop, daemon=True, name="codex-session")
        self.thread.start()
        self.session = None
        self._client_cm = None
        self._session_cm = None
        self._sem: Optional[asyncio.Semaphore] = None

    def _run_loop(self) -> None:
        asyncio.set_event_loop(self.loop)
        self.loop.run_forever()

    async def _start(self) -> None:
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client
        params = StdioServerParameters(command="codex", args=["mcp-server"])
        # codex 서버가 부팅 시 사용자의 원격 커넥터에 접속 시도하며 내는 stderr(만료 토큰 등)는
        # 우리 로그를 오염시킬 뿐 → 버린다.
        errlog = open(os.devnull, "w")  # noqa: SIM115 — 프로세스 수명과 함께 감
        self._client_cm = stdio_client(params, errlog=errlog)
        read, write = await self._client_cm.__aenter__()
        self._session_cm = ClientSession(read, write)
        self.session = await self._session_cm.__aenter__()
        await asyncio.wait_for(self.session.initialize(), timeout=30)
        self._sem = asyncio.Semaphore(_MAX_CONCURRENT)

    async def _stop(self) -> None:
        try:
            if self._session_cm is not None:
                await self._session_cm.__aexit__(None, None, None)
        except Exception:  # noqa: BLE001
            pass
        try:
            if self._client_cm is not None:
                await self._client_cm.__aexit__(None, None, None)
        except Exception:  # noqa: BLE001
            pass
        self.session = None

    async def _call(self, prompt: str, model: Optional[str], effort: str, timeout: float) -> str:
        assert self.session is not None and self._sem is not None
        args: dict[str, Any] = {
            "prompt": prompt,
            "sandbox": "read-only",
            "approval-policy": "never",
            # 분류·번역엔 도구가 불필요 → 커넥터 로딩 생략(빠름) + 웹검색 차단.
            "config": {"mcp_servers": {}, "model_reasoning_effort": effort,
                       "tools": {"web_search": False}},
        }
        if model:
            args["model"] = model
        async with self._sem:
            res = await asyncio.wait_for(self.session.call_tool("codex", args), timeout=timeout)
        if getattr(res, "isError", False):
            raise RuntimeError("codex tool error")
        return "".join(getattr(c, "text", "") for c in (res.content or [])).strip()


_lock = threading.Lock()
_runner: Optional[_Runner] = None
_failed_at = 0.0


def _ensure_runner(timeout: float) -> Optional[_Runner]:
    global _runner, _failed_at
    with _lock:
        if _runner is not None and _runner.session is not None:
            return _runner
        if time.time() - _failed_at < _COOLDOWN_SEC:
            return None
        try:
            r = _runner or _Runner()
            fut = asyncio.run_coroutine_threadsafe(r._start(), r.loop)
            fut.result(timeout=min(45.0, timeout + 30.0))
            _runner = r
            return r
        except Exception:  # noqa: BLE001 — codex 미설치/기동 실패 → 쿨다운 후 재시도
            _failed_at = time.time()
            _teardown_locked()
            return None


def _teardown_locked() -> None:
    global _runner
    r = _runner
    _runner = None
    if r is not None:
        try:
            asyncio.run_coroutine_threadsafe(r._stop(), r.loop).result(timeout=5)
        except Exception:  # noqa: BLE001
            pass


def text(prompt: str, model: Optional[str] = None, effort: str = "low", timeout: float = 60.0) -> str:
    """상시 codex 세션으로 짧은 텍스트 1개 생성. 실패하면 빈 문자열(호출부가 exec로 폴백)."""
    global _failed_at
    if not enabled():
        return ""
    r = _ensure_runner(timeout)
    if r is None:
        return ""
    try:
        fut = asyncio.run_coroutine_threadsafe(r._call(prompt, model, effort, timeout), r.loop)
        return fut.result(timeout=timeout + 5)
    except Exception:  # noqa: BLE001 — 세션 사망/타임아웃 → 폐기 후 쿨다운, exec 폴백
        with _lock:
            _failed_at = time.time()
            _teardown_locked()
        return ""
