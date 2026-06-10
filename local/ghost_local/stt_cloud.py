"""클라우드 STT — ElevenLabs Scribe v2 (REST). 키는 환경변수에서만 읽는다."""

from __future__ import annotations

import os
from typing import Optional

import httpx

ELEVEN_URL = "https://api.elevenlabs.io/v1/speech-to-text"

# ElevenLabs language_code(ISO-639-1) 매핑
_LANG = {"ko": "ko", "en": "en", "zh": "zh"}

# 선택 가능한 클라우드 STT 모델.
#   · scribe_v2/v1 : 파일 업로드 REST(발화 끝나면 배치 전사)
#   · scribe_v2_realtime : WebSocket 실시간 스트리밍(부분 결과를 토큰처럼 흘림) — streaming 전용
REALTIME_MODEL = "scribe_v2_realtime"
CLOUD_MODELS = [
    {"id": "scribe_v2_realtime", "label": "Scribe v2 Realtime · 실시간 스트리밍", "streaming": True, "realtime": True},
    {"id": "scribe_v2", "label": "Scribe v2 · 최신·고정확 (배치)"},
    {"id": "scribe_v1", "label": "Scribe v1 · 안정 (배치)"},
]
DEFAULT_CLOUD_MODEL = "scribe_v2"
_active: dict = {"model": DEFAULT_CLOUD_MODEL}


def active_model() -> str:
    return _active["model"]


def realtime_active() -> bool:
    """현재 클라우드 모델이 WebSocket 실시간 스트리밍 모델인지."""
    return _active["model"] == REALTIME_MODEL


def set_model(model_id: str) -> str:
    """활성 클라우드 STT 모델을 바꾼다."""
    mid = (model_id or "").strip()
    if mid in {m["id"] for m in CLOUD_MODELS}:
        _active["model"] = mid
    return _active["model"]


def elevenlabs_key() -> str:
    return (os.environ.get("ELEVENLABS_API_KEY") or "").strip()


def _clean_keyterms(keyterms: Optional[list]) -> list:
    """Scribe keyterm 제약(50자, 금지문자, 최대 1000개)에 맞춰 정리."""
    out = []
    for k in keyterms or []:
        s = str(k).strip()
        if not s or len(s) > 50 or any(c in s for c in "<>{}[]\\"):
            continue
        out.append(s)
        if len(out) >= 100:   # 용어집 규모상 충분 + 요청 크기 억제
            break
    return out


def transcribe(audio_path: str, lang: Optional[str] = None, timeout: int = 60,
               model_id: Optional[str] = None, keyterms: Optional[list] = None) -> str:
    """오디오 파일 → ElevenLabs Scribe 전사 텍스트(활성 모델 사용).

    keyterms: 용어집의 고유명사 목록 — Scribe keyterm prompting으로 전사를 바이어싱해
    제품명·사람 이름 같은 희귀 단어의 인식률을 올린다(맥락 기반, 강제 아님).
    키가 없으면 RuntimeError. 호출부에서 로컬 STT로 폴백.
    """
    key = elevenlabs_key()
    if not key:
        raise RuntimeError("ELEVENLABS_API_KEY not set")
    # realtime 모델은 ws 전용 → REST 배치(폴백·인터림)에선 동급 배치 모델로 대체.
    model = model_id or active_model()
    if model == REALTIME_MODEL:
        model = "scribe_v2"
    data: dict = {"model_id": model}
    code = _LANG.get(lang or "")
    if code:
        data["language_code"] = code
    terms = _clean_keyterms(keyterms)

    def _post(payload: dict) -> httpx.Response:
        with open(audio_path, "rb") as f:
            files = {"file": ("audio.wav", f, "audio/wav")}
            return httpx.post(ELEVEN_URL, headers={"xi-api-key": key}, data=payload, files=files, timeout=timeout)

    r = _post({**data, "keyterms": terms} if terms else data)
    if terms and r.status_code >= 400:
        # keyterms 미지원 모델/요청 형식 오류여도 전사 자체는 살린다 — 한 번은 키텀 없이 재시도.
        r = _post(data)
    r.raise_for_status()
    return (r.json().get("text") or "").strip()
