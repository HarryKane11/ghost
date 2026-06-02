"""STT 스테이지 — Qwen3-ASR 0.6B (MLX, Apple Silicon)."""

from __future__ import annotations

import concurrent.futures
import threading
from functools import lru_cache
from pathlib import Path
from typing import Optional

from mlx_audio.stt.generate import generate_transcription, load_model

# 한국어 지원 Qwen3-ASR (1.7B = 오픈 최대). bf16 = 풀 정밀도로 8bit보다 정확.
# (M-series 48GB면 ~3.4GB라 부담 없음. 첫 실행 시 1회 다운로드.)
DEFAULT_STT_MODEL = "mlx-community/Qwen3-ASR-1.7B-bf16"
# 진행률 표시용 예상 총량(bf16 1.7B ≈ 3.4GB). 정확값은 다운로드 중 갱신될 수 있음.
_EXPECTED_BYTES = 3_500_000_000

# 모델 다운로드 상태(완전 로컬 에디션 첫 실행 흐름용). 패키징하지 않고 런타임에 받는다.
_DL: dict = {"state": "idle", "error": None}  # idle | downloading | done | error

# MLX의 GPU Stream은 스레드 로컬이다. 모델을 로드한 스레드와 추론을 돌리는 스레드가
# 다르면 "There is no Stream(gpu, N) in current thread" 런타임 에러가 난다.
# (예: startup 데몬 스레드에서 warmup → FastAPI 요청 스레드에서 transcribe.)
# 모든 MLX 호출을 단일 전용 워커 스레드에 고정해 로드·추론 스레드를 일치시킨다.
_EXECUTOR = concurrent.futures.ThreadPoolExecutor(
    max_workers=1, thread_name_prefix="mlx-stt"
)


@lru_cache(maxsize=2)
def _get_model(model_path: str):
    """모델을 한 번만 로드해 재사용 (반드시 워커 스레드에서 호출)."""
    return load_model(model_path)


def _warmup_impl(model_path: str) -> None:
    _get_model(model_path)


def _transcribe_impl(audio_path: str, model_path: str) -> str:
    model = _get_model(model_path)
    result = generate_transcription(model=model, audio=audio_path, verbose=False)
    text: Optional[str] = getattr(result, "text", None)
    if text is None and isinstance(result, dict):
        text = result.get("text")
    return (text or "").strip()


def warmup(model_path: str = DEFAULT_STT_MODEL) -> None:
    """모델을 미리 메모리에 올린다(첫 전사 지연 제거). 전용 워커 스레드에서 로드."""
    _EXECUTOR.submit(_warmup_impl, model_path).result()


def _hf_cache_dir(repo: str) -> Path:
    """해당 repo의 HuggingFace 캐시 폴더 경로."""
    try:
        from huggingface_hub.constants import HF_HUB_CACHE
        base = Path(HF_HUB_CACHE)
    except Exception:  # noqa: BLE001
        base = Path.home() / ".cache" / "huggingface" / "hub"
    return base / ("models--" + repo.replace("/", "--"))


def _dir_size(p: Path) -> int:
    if not p.exists():
        return 0
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file())


def model_present(model_path: str = DEFAULT_STT_MODEL) -> bool:
    """모델이 이미 로컬 캐시에 받아져 있는지(네트워크 없이 확인)."""
    try:
        from huggingface_hub import snapshot_download
        snapshot_download(model_path, local_files_only=True)
        return True
    except Exception:  # noqa: BLE001
        return False


def download_status(model_path: str = DEFAULT_STT_MODEL) -> dict:
    """모델 다운로드 상태 + 진행률(완전 로컬 에디션 첫 실행 UI용)."""
    present = model_present(model_path)
    state = _DL["state"]
    if present and state != "downloading":
        state = "done"
    downloaded = _dir_size(_hf_cache_dir(model_path))
    return {
        "repo": model_path,
        "present": present,
        "state": state,
        "downloaded": downloaded,
        "total": _EXPECTED_BYTES,
        "percent": min(100, int(downloaded * 100 / _EXPECTED_BYTES)) if not present else 100,
        "error": _DL["error"],
    }


def start_download(model_path: str = DEFAULT_STT_MODEL) -> dict:
    """모델을 백그라운드로 받기 시작한다(재개 가능). 이미 받는 중이면 무시."""
    if _DL["state"] == "downloading":
        return download_status(model_path)
    _DL.update(state="downloading", error=None)

    def _w():
        try:
            from huggingface_hub import snapshot_download
            snapshot_download(model_path)  # 재개 지원, HF 캐시에 저장
            _DL["state"] = "done"
        except Exception as ex:  # noqa: BLE001
            _DL.update(state="error", error=str(ex))

    threading.Thread(target=_w, daemon=True).start()
    return download_status(model_path)


def transcribe(audio_path: str, model_path: str = DEFAULT_STT_MODEL) -> str:
    """오디오 파일을 한국어 전사 텍스트로 변환한다.

    MLX 추론은 모델을 로드한 것과 동일한 전용 워커 스레드에서 수행한다
    (GPU Stream 스레드 로컬 문제 회피).

    Args:
        audio_path: wav/mp3 등 오디오 파일 경로.
        model_path: MLX ASR 모델 repo.

    Returns:
        전사된 텍스트.
    """
    return _EXECUTOR.submit(_transcribe_impl, audio_path, model_path).result()
