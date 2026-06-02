"""OpenCode(SST) 어댑터 — subprocess `run --format json` 경로.

조사 결론: opencode는 어댑터 친화적 — `opencode run "<prompt>"` headless, `run --format json`으로
이벤트 스트림, 스키마 출력·웹검색·MCP·세션 모두 지원. (server+SDK fast-path도 가능하나 1단계는
subprocess floor로 둔다.) 스키마 표면은 버전마다 다를 수 있어 프롬프트로 JSON 유도 + post-parse를
기본으로 하고, --format json 이벤트는 best-effort 진행 표시로만 쓴다.

설치돼 있을 때만 registry에 등록된다(미설치면 조용히 생략).
"""

from __future__ import annotations

import json
import shutil
import subprocess
from typing import Iterator, Optional

from ghost_local import brain
from ghost_local.adapters.base import AgentAdapter, Capabilities, Event


def _opencode_bin() -> Optional[str]:
    return shutil.which("opencode")


def _event_label(e: dict) -> Optional[str]:
    """opencode --format json 이벤트 → 사람이 읽는 진행 한 줄(best-effort)."""
    t = e.get("type") or e.get("event") or ""
    if "tool" in str(t).lower():
        name = e.get("tool") or e.get("name") or "도구"
        return f"{name} 사용 중…"
    if "search" in str(t).lower():
        return "웹 검색 중…"
    return None


class OpenCodeAdapter(AgentAdapter):
    name = "opencode"
    caps = Capabilities(structured_output=True, streaming_events=True,
                        web_search=True, mcp=True, sessions=True)

    def __init__(self) -> None:
        if not _opencode_bin():
            raise RuntimeError("opencode 바이너리를 찾을 수 없습니다.")

    def run_stream(self, query: str, context: str, cfg, system: str) -> Iterator[Event]:
        yield ("progress", {"text": "OpenCode 생각하는 중…"})
        prompt = (
            f"{system}{brain._lang_line(cfg)}\n\n"
            f"[맥락]\n{context}\n\n[요청]\n{query}\n\n"
            "반드시 위 형식의 JSON 한 개만 출력(설명·코드블록 금지)."
        )
        cmd = ["opencode", "run", "--format", "json"]
        if cfg.codex_model:
            cmd += ["-m", cfg.codex_model]
        cmd.append(prompt)

        final_text = ""
        try:
            proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                    stderr=subprocess.DEVNULL, text=True, bufsize=1)
            for line in proc.stdout or []:
                line = line.strip()
                if not line:
                    continue
                if line.startswith("{"):
                    try:
                        e = json.loads(line)
                    except json.JSONDecodeError:
                        final_text += line
                        continue
                    label = _event_label(e)
                    if label:
                        yield ("progress", {"text": label})
                    # 최종 메시지 후보를 모은다(스키마 표면 버전차 대비 post-parse).
                    msg = e.get("text") or e.get("message") or e.get("content")
                    if isinstance(msg, str):
                        final_text = msg
                else:
                    final_text += line + "\n"
            proc.wait(timeout=240)
        except Exception as ex:  # noqa: BLE001
            yield ("result", {"title": "OpenCode 실패", "spoken": "", "intent": "none",
                              "blocks": [{"type": "callout", "value": "error",
                                          "text": f"OpenCode 실행 실패: {ex}"}]})
            return
        spec = brain._extract_json(final_text)
        fallback = final_text.strip() if (final_text and not final_text.lstrip().startswith("{")) else query
        yield ("result", brain._normalize_spec(spec, fallback_text=fallback))
