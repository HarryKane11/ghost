"""클라우드 STT — ElevenLabs Scribe v2 (REST). 키는 환경변수에서만 읽는다."""

from __future__ import annotations

import os
from typing import Optional

import httpx

ELEVEN_URL = "https://api.elevenlabs.io/v1/speech-to-text"

# ElevenLabs language_code(ISO-639-1) 매핑
_LANG = {"ko": "ko", "en": "en", "zh": "zh"}


def elevenlabs_key() -> str:
    return (os.environ.get("ELEVENLABS_API_KEY") or "").strip()


def transcribe(audio_path: str, lang: Optional[str] = None, timeout: int = 60) -> str:
    """오디오 파일 → ElevenLabs Scribe v2 전사 텍스트.

    키가 없으면 RuntimeError. 호출부에서 로컬 STT로 폴백.
    """
    key = elevenlabs_key()
    if not key:
        raise RuntimeError("ELEVENLABS_API_KEY not set")
    data = {"model_id": "scribe_v2"}
    code = _LANG.get(lang or "")
    if code:
        data["language_code"] = code
    with open(audio_path, "rb") as f:
        files = {"file": ("audio.wav", f, "audio/wav")}
        r = httpx.post(ELEVEN_URL, headers={"xi-api-key": key}, data=data, files=files, timeout=timeout)
    r.raise_for_status()
    return (r.json().get("text") or "").strip()
