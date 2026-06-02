"""Hermes(Nous hermes-agent) 어댑터 — best-effort 강등.

조사·실측 결론: headless = `hermes chat -q "<prompt>" -Q`(quiet, 프로그래밍용 → stdout에 최종 응답만).
**스키마 강제 출력 없음 + 구조화 이벤트 스트림 없음** → 프롬프트로 JSON을 유도하고 post-parse한다.
진행 표시는 코스(coarse)하게. 웹은 toolset(`-t web`)로, 세션은 `--resume`으로.
"""

from __future__ import annotations

import shutil
import subprocess
from typing import Iterator, Optional

from ghost_local import brain
from ghost_local.adapters.base import AgentAdapter, Capabilities, Event

# 기본 활성 toolset(회의 조사에 유용한 웹). 콤마구분으로 늘릴 수 있다.
_DEFAULT_TOOLSETS = "web"


def _hermes_bin() -> Optional[str]:
    return shutil.which("hermes")


class HermesAdapter(AgentAdapter):
    name = "hermes"
    # 스키마·이벤트 둘 다 없음 → 강등. 웹/MCP·세션은 지원.
    caps = Capabilities(structured_output=False, streaming_events=False,
                        web_search=True, mcp=True, sessions=True)

    def __init__(self, toolsets: str = _DEFAULT_TOOLSETS) -> None:
        if not _hermes_bin():
            raise RuntimeError("hermes 바이너리를 찾을 수 없습니다.")
        self.toolsets = toolsets

    def run_stream(self, query: str, context: str, cfg, system: str) -> Iterator[Event]:
        yield ("progress", {"text": "Hermes 생각하는 중…"})
        prompt = (
            f"{system}{brain._lang_line(cfg)}\n\n"
            f"[맥락]\n{context}\n\n[요청]\n{query}\n\n"
            "반드시 위 형식의 JSON 한 개만 출력(설명·코드블록 금지)."
        )
        cmd = ["hermes", "chat", "-q", prompt, "-Q"]
        if self.toolsets:
            cmd += ["-t", self.toolsets]
        if cfg.codex_model:  # hermes는 -m으로 모델 선택(없으면 hermes 기본)
            cmd += ["-m", cfg.codex_model]
        try:
            p = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True,
                               text=True, timeout=240)
            raw = (p.stdout or "").strip()
        except Exception as ex:  # noqa: BLE001
            yield ("result", {"title": "Hermes 실패", "spoken": "", "intent": "none",
                              "blocks": [{"type": "callout", "value": "error",
                                          "text": f"Hermes 실행 실패: {ex}"}]})
            return
        spec = brain._extract_json(raw)
        # JSON이 없으면 평문 응답을 본문으로(강등 경로).
        fallback = raw if (raw and not raw.lstrip().startswith("{")) else query
        yield ("result", brain._normalize_spec(spec, fallback_text=fallback))
