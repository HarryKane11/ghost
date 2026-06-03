"""TTS 스테이지 — Supertonic 3 (온디바이스 ONNX, CPU, 44.1kHz). 한국어 합성.

- GPU 불필요, ~400MB 모델이 첫 실행 시 ~/.cache/supertonic3/ 로 자동 다운로드
- 보이스: M1~M5(남), F1~F5(여)
- 라이선스: 코드 MIT / 모델 OpenRAIL-M
"""

from __future__ import annotations

import importlib.util
import os
import tempfile
from functools import lru_cache
from typing import Optional

DEFAULT_VOICE = "F1"

# 설치형 — 코어에 번들하지 않고 모델 목록만 제공. 음성 응답이 필요할 때만 설치.
TTS_NAME = "Supertonic 3"
TTS_INSTALL = "uv sync --extra tts"   # 또는 uv pip install supertonic
VOICES = ["F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5"]


def available() -> bool:
    """TTS 엔진(supertonic) 설치 여부. 미설치면 음성 응답 비활성(텍스트만)."""
    return importlib.util.find_spec("supertonic") is not None


def info() -> dict:
    return {"name": TTS_NAME, "available": available(), "install": TTS_INSTALL, "voices": VOICES, "default_voice": DEFAULT_VOICE}


@lru_cache(maxsize=1)
def _engine():
    """Supertonic TTS 엔진을 한 번만 로드해 재사용."""
    from supertonic import TTS

    return TTS(auto_download=True)


@lru_cache(maxsize=8)
def _style(voice: str):
    return _engine().get_voice_style(voice_name=voice)


def speak(
    text: str,
    out_path: Optional[str] = None,
    voice: str = DEFAULT_VOICE,
    lang_code: str = "ko",
    speed: float = 1.05,
    total_steps: int = 8,
) -> str:
    """텍스트를 음성 wav로 합성해 경로를 반환한다."""
    if out_path is None:
        out_path = os.path.join(tempfile.gettempdir(), "ghost_tts.wav")

    engine = _engine()
    wav, _dur = engine.synthesize(
        text=text,
        voice_style=_style(voice),
        lang=lang_code,
        total_steps=total_steps,
        speed=speed,
    )
    engine.save_audio(wav, out_path)
    return out_path
