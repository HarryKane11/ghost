"""앱 사용량 추적 — Codex 토큰/비용 + ElevenLabs STT 시간/비용. ~/.ghost/usage.json에 누적.

이 앱이 '실제로' 쓴 양만 기록한다(계정 전체가 아니라). Codex는 exec --json의
turn.completed.usage를, ElevenLabs는 전송/전사한 오디오 길이를 합산한다.

비용은 추정치(공개 단가는 변동 가능 — RATES를 조정해 맞춘다). 토큰 수는 정확하다.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Optional

_PATH = Path.home() / ".ghost" / "usage.json"
_LOCK = threading.Lock()

# ── 비용 단가(추정, USD) — 필요시 조정 ──────────────────────────────────────
# Codex(=OpenAI) per 1M tokens: (input, output). cached input은 input의 10%로 본다.
CODEX_RATES = {
    "gpt-5.5": (1.25, 10.0),
    "gpt-5.4": (1.25, 10.0),
    "gpt-5.4-mini": (0.25, 2.0),
    "gpt-5.3-codex": (1.25, 10.0),
    "gpt-5.3-codex-spark": (0.50, 4.0),
    "gpt-5.2": (1.25, 10.0),
    "_default": (1.25, 10.0),
}
ELEVEN_STT_USD_PER_HOUR = 0.40   # Scribe 추정 단가(시간당)

_EMPTY = {
    "codex": {"requests": 0, "input_tokens": 0, "cached_input_tokens": 0,
              "output_tokens": 0, "reasoning_tokens": 0, "cost_usd": 0.0,
              "by_model": {}},
    "elevenlabs_stt": {"requests": 0, "seconds": 0.0, "cost_usd": 0.0},
    # 사용자가 설정하는 월 예산(한도 대비 차지율 표시용). 0이면 미설정.
    "codex_budget_usd": 0.0,
}


def _load() -> dict:
    try:
        d = json.loads(_PATH.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 — 없거나 깨졌으면 빈 상태
        return json.loads(json.dumps(_EMPTY))
    # 누락 키 보강(스키마 진화 대비)
    for k, v in _EMPTY.items():
        if k not in d:
            d[k] = json.loads(json.dumps(v))
        elif isinstance(v, dict):
            for kk, vv in v.items():
                d[k].setdefault(kk, vv)
    return d


def _save(d: dict) -> None:
    try:
        _PATH.parent.mkdir(parents=True, exist_ok=True)
        _PATH.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:  # noqa: BLE001 — 추적 실패가 기능을 막지 않게
        pass


def _codex_cost(model: str, inp: int, cached: int, out: int, reasoning: int) -> float:
    in_rate, out_rate = CODEX_RATES.get(model or "_default", CODEX_RATES["_default"])
    non_cached = max(0, inp - cached)
    return (non_cached * in_rate + cached * in_rate * 0.1 + (out + reasoning) * out_rate) / 1_000_000


def record_codex(model: Optional[str], usage: dict) -> None:
    """codex turn.completed.usage 1건을 누적. usage: {input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens}."""
    if not isinstance(usage, dict):
        return
    model = model or "_default"
    inp = int(usage.get("input_tokens") or 0)
    cached = int(usage.get("cached_input_tokens") or 0)
    out = int(usage.get("output_tokens") or 0)
    reasoning = int(usage.get("reasoning_output_tokens") or 0)
    if inp == 0 and out == 0:
        return
    cost = _codex_cost(model, inp, cached, out, reasoning)
    with _LOCK:
        d = _load()
        c = d["codex"]
        c["requests"] += 1
        c["input_tokens"] += inp
        c["cached_input_tokens"] += cached
        c["output_tokens"] += out
        c["reasoning_tokens"] += reasoning
        c["cost_usd"] = round(c["cost_usd"] + cost, 6)
        bm = c["by_model"].setdefault(model, {"requests": 0, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0})
        bm["requests"] += 1
        bm["input_tokens"] += inp
        bm["output_tokens"] += out + reasoning
        bm["cost_usd"] = round(bm["cost_usd"] + cost, 6)
        _save(d)


def record_eleven_stt(seconds: float) -> None:
    """ElevenLabs STT로 전사한 오디오 길이(초)를 누적 + 비용 추정."""
    seconds = float(seconds or 0)
    if seconds <= 0:
        return
    cost = seconds / 3600.0 * ELEVEN_STT_USD_PER_HOUR
    with _LOCK:
        d = _load()
        s = d["elevenlabs_stt"]
        s["requests"] += 1
        s["seconds"] = round(s["seconds"] + seconds, 2)
        s["cost_usd"] = round(s["cost_usd"] + cost, 6)
        _save(d)


def set_codex_budget(usd: float) -> dict:
    with _LOCK:
        d = _load()
        d["codex_budget_usd"] = max(0.0, float(usd or 0))
        _save(d)
        return snapshot_unlocked(d)


def reset() -> dict:
    with _LOCK:
        d = json.loads(json.dumps(_EMPTY))
        _save(d)
        return snapshot_unlocked(d)


def snapshot_unlocked(d: dict) -> dict:
    c = d["codex"]
    budget = d.get("codex_budget_usd") or 0.0
    pct = round(c["cost_usd"] / budget * 100, 1) if budget > 0 else None
    return {
        "codex": {**c, "budget_usd": budget, "budget_pct": pct},
        "elevenlabs_stt": d["elevenlabs_stt"],
    }


def snapshot() -> dict:
    with _LOCK:
        return snapshot_unlocked(_load())
