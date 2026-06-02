"""클라우드 STT — ElevenLabs Scribe v2 (REST). 키는 환경변수에서만 읽는다."""

from __future__ import annotations

import os
from typing import Optional

import httpx

ELEVEN_URL = "https://api.elevenlabs.io/v1/speech-to-text"

# ElevenLabs language_code(ISO-639-1) 매핑
_LANG = {"ko": "ko", "en": "en", "zh": "zh"}

# 선택 가능한 클라우드 STT 모델(파일 업로드 REST 경로). 실시간(websocket)은 별도 통합 필요.
CLOUD_MODELS = [
    {"id": "scribe_v2", "label": "Scribe v2 · 최신·고정확 (기본)"},
    {"id": "scribe_v1", "label": "Scribe v1 · 안정"},
]
DEFAULT_CLOUD_MODEL = "scribe_v2"
_active: dict = {"model": DEFAULT_CLOUD_MODEL}


def active_model() -> str:
    return _active["model"]


def set_model(model_id: str) -> str:
    """활성 클라우드 STT 모델을 바꾼다."""
    mid = (model_id or "").strip()
    if mid in {m["id"] for m in CLOUD_MODELS}:
        _active["model"] = mid
    return _active["model"]


def elevenlabs_key() -> str:
    return (os.environ.get("ELEVENLABS_API_KEY") or "").strip()


def transcribe(audio_path: str, lang: Optional[str] = None, timeout: int = 60, model_id: Optional[str] = None) -> str:
    """오디오 파일 → ElevenLabs Scribe 전사 텍스트(활성 모델 사용).

    키가 없으면 RuntimeError. 호출부에서 로컬 STT로 폴백.
    """
    key = elevenlabs_key()
    if not key:
        raise RuntimeError("ELEVENLABS_API_KEY not set")
    data = {"model_id": model_id or active_model()}
    code = _LANG.get(lang or "")
    if code:
        data["language_code"] = code
    with open(audio_path, "rb") as f:
        files = {"file": ("audio.wav", f, "audio/wav")}
        r = httpx.post(ELEVEN_URL, headers={"xi-api-key": key}, data=data, files=files, timeout=timeout)
    r.raise_for_status()
    return (r.json().get("text") or "").strip()
