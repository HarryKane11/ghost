"""brain 유틸 테스트 — JSON 추출(문자열 인식)·spec 검증·도구 인벤토리."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ghost_local import brain  # noqa: E402


def test_extract_json_basic():
    assert brain._extract_json('전망: {"a": 1} 입니다') == {"a": 1}
    assert brain._extract_json("json 없음") is None


def test_extract_json_braces_inside_strings():
    # 문자열 안의 중괄호/이스케이프가 brace 매칭을 깨지 않는다 (opencode/hermes 강등 버그).
    raw = '{"title": "code", "blocks": [{"type": "code", "text": "if (x) { return {y}; }"}]}'
    out = brain._extract_json(raw)
    assert out and out["blocks"][0]["text"] == "if (x) { return {y}; }"
    raw2 = '{"a": "escaped \\" quote { brace", "b": 2}'
    assert brain._extract_json(raw2) == {"a": 'escaped " quote { brace', "b": 2}


def test_spec_has_content():
    assert brain._spec_has_content({"blocks": [{"type": "text", "text": "x"}]})
    assert not brain._spec_has_content({"blocks": []})
    assert not brain._spec_has_content({"blocks": [{"type": "callout", "value": "error", "text": "x"}]})
    assert not brain._spec_has_content(None)


def test_tools_line_uses_cache(monkeypatch):
    brain._MCP_CACHE.update(t=9e12, names=["atlassian", "slack", "node_repl"])
    cfg = brain.BrainConfig(backend="codex")
    line = brain._tools_line(cfg)
    assert "atlassian" in line and "slack" in line and "node_repl" not in line
    assert brain._tools_line(brain.BrainConfig(backend="ollama")) == ""


def test_normalize_spec_fallback():
    spec = brain._normalize_spec(None, fallback_text="원문")
    assert spec["blocks"][0]["text"] == "원문"
    assert spec["title"] == "Ghost"
