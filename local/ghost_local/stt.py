"""STT 스테이지 — 엔진 추상화(mlx / faster-whisper / whisperx / granite).

각 모델은 engine을 가지며, 엔진 의존성이 설치돼 있을 때만 활성화된다(없으면 설치 안내).
다운로드는 모두 HuggingFace repo라 동일 흐름. caps: streaming / diarization을 UI에 노출.
mlx 엔진이 기본(Apple Silicon 네이티브)이고, 나머지는 사용자가 선택 시 의존성을 깔면 동작.
"""

from __future__ import annotations

import concurrent.futures
import importlib
import importlib.util
import shutil
import subprocess
import sys
import threading
from functools import lru_cache
from pathlib import Path
from typing import Optional

# 선택 가능한 로컬 ASR 모델.
#   engine: mlx | faster-whisper | whisperx | granite
#   repo:   HF repo (다운로드·캐시 키). 생략 시 id.
#   streaming/diarization: capability 플래그(UI 배지).
#   install: 엔진 의존성 설치 명령(미설치 시 안내).
LOCAL_MODELS = [
    # ── MLX (Apple Silicon 네이티브, 추가 설치 불필요) ──
    {"id": "mlx-community/Qwen3-ASR-1.7B-bf16", "label": "Qwen3-ASR 1.7B · 한국어·다국어 (기본)", "lang": "multi", "approx_gb": 3.4, "engine": "mlx", "streaming": False, "diarization": False},
    {"id": "mlx-community/parakeet-tdt-0.6b-v3", "label": "Parakeet TDT 0.6b v3 · 다국어·초고속·스트리밍", "lang": "multi", "approx_gb": 2.5, "engine": "mlx", "streaming": True, "diarization": False},
    {"id": "mlx-community/whisper-large-v3-turbo", "label": "Whisper large-v3 turbo · 다국어·빠름", "lang": "multi", "approx_gb": 1.6, "engine": "mlx", "streaming": False, "diarization": False},
    {"id": "mlx-community/whisper-large-v3-mlx", "label": "Whisper large-v3 · 최고 정확도", "lang": "multi", "approx_gb": 3.1, "engine": "mlx", "streaming": False, "diarization": False},
    # ── faster-whisper (CTranslate2) ──
    {"id": "Systran/faster-whisper-large-v3", "label": "faster-whisper large-v3 · 정확·가벼움", "lang": "multi", "approx_gb": 3.1, "engine": "faster-whisper", "streaming": False, "diarization": False, "install": "uv pip install faster-whisper"},
    # ── WhisperX (단어 타임스탬프 + 화자분리) ──
    {"id": "whisperx-large-v3", "repo": "Systran/faster-whisper-large-v3", "label": "WhisperX large-v3 · 화자분리+타임스탬프", "lang": "multi", "approx_gb": 3.1, "engine": "whisperx", "streaming": False, "diarization": True, "install": "uv pip install whisperx"},
    # ── IBM Granite Speech 4.1 2B ──
    {"id": "ibm-granite/granite-speech-4.1-2b", "label": "Granite Speech 4.1 2B · 다국어 ASR", "lang": "multi", "approx_gb": 5.0, "engine": "granite", "streaming": False, "diarization": False, "install": "uv pip install 'transformers>=4.52' torchaudio peft"},
    {"id": "ibm-granite/granite-speech-4.1-2b-plus", "label": "Granite Speech 4.1 2B Plus · 화자분리 내장", "lang": "multi", "approx_gb": 5.0, "engine": "granite", "streaming": False, "diarization": True, "install": "uv pip install 'transformers>=4.52' torchaudio peft"},
]

DEFAULT_STT_MODEL = LOCAL_MODELS[0]["id"]
_DEFAULT_APPROX_GB = 3.4


def _meta(model_id: str) -> dict:
    for m in LOCAL_MODELS:
        if m["id"] == model_id:
            return m
    return {"id": model_id, "engine": "mlx", "approx_gb": _DEFAULT_APPROX_GB}


def _repo(model_id: str) -> str:
    """다운로드·캐시용 HF repo (repo 필드 우선, 없으면 id)."""
    return _meta(model_id).get("repo") or model_id


def _engine(model_id: str) -> str:
    return _meta(model_id).get("engine", "mlx")


_ENGINE_MODULE = {"faster-whisper": "faster_whisper", "whisperx": "whisperx", "granite": "torchaudio"}


def engine_available(engine: str) -> bool:
    """엔진 의존성이 설치돼 있는지(없으면 모델 선택은 되지만 전사 시 설치 안내)."""
    if engine == "mlx":
        return importlib.util.find_spec("mlx_audio") is not None
    mod = _ENGINE_MODULE.get(engine)
    return bool(mod and importlib.util.find_spec(mod) is not None)


def models_with_status() -> list:
    """UI용 모델 목록 + 엔진 설치 여부 + 디스크 점유(다운로드된 실제 용량)."""
    out = []
    for m in LOCAL_MODELS:
        repo = m.get("repo") or m["id"]
        size = _dir_size(_hf_cache_dir(repo))
        out.append({
            **m,
            "engine_ready": engine_available(m.get("engine", "mlx")),
            "present": size > 0,
            "size_bytes": size,   # 실제 다운로드된 디스크 용량(0이면 미다운로드)
        })
    return out


# ── 인앱 설치 — 터미널 없이 앱에서 옵셔널 엔진(로컬 STT·스트리밍·TTS 등)을 설치 ──
# 백엔드 venv에 `uv pip install`(없으면 python -m pip)로 설치. 설치 후 importlib 캐시 무효화 → 즉시 사용.
INSTALL_PKGS = {
    "local": ["mlx-audio>=0.4.3", "mlx-whisper>=0.4.3", "soundfile>=0.13.1", "parakeet-mlx>=0.5.1"],  # 배치+스트리밍
    "faster-whisper": ["faster-whisper>=1.0"],
    "whisperx": ["whisperx>=3.1"],
    "granite": ["transformers>=4.52", "torchaudio", "peft"],
    "tts": ["supertonic>=1.3.1"],
}
_INSTALL: dict = {"state": "idle", "target": None, "error": None}  # idle|installing|done|error


def install_target_for(model_id: str) -> str:
    """모델을 쓰려면 설치해야 할 타깃(extra 이름). mlx 계열은 'local'(배치+스트리밍 한 번에)."""
    return {"faster-whisper": "faster-whisper", "whisperx": "whisperx", "granite": "granite"}.get(_engine(model_id), "local")


def engine_install_status() -> dict:
    return dict(_INSTALL)


def install_engine(target: str) -> dict:
    """옵셔널 엔진 패키지를 백엔드 venv에 설치(백그라운드). 진행 상태는 engine_install_status."""
    pkgs = INSTALL_PKGS.get(target)
    if not pkgs:
        return {"ok": False, "error": f"unknown target: {target}"}
    if _INSTALL["state"] == "installing":
        return dict(_INSTALL)
    _INSTALL.update(state="installing", target=target, error=None)

    def _w():
        # 실행 중인 '바로 그 venv'(sys.executable)에 설치 — DMG에선 userData/backend/.venv(쓰기 가능).
        # cwd·VIRTUAL_ENV에 의존하지 않게 --python으로 정확히 타깃.
        attempts = [
            ["uv", "pip", "install", "--python", sys.executable, *pkgs],
            [sys.executable, "-m", "pip", "install", *pkgs],   # uv 없을 때 폴백
        ]
        last_err = "설치 실패"
        try:
            for cmd in attempts:
                try:
                    r = subprocess.run(cmd, capture_output=True, text=True, timeout=2400)
                except FileNotFoundError:
                    continue   # uv 미존재 → 다음 폴백
                if r.returncode == 0:
                    importlib.invalidate_caches()   # 새 패키지를 find_spec/import가 인식
                    _INSTALL.update(state="done", error=None)
                    return
                last_err = (r.stderr or last_err)[-400:]
            _INSTALL.update(state="error", error=last_err)
        except Exception as ex:  # noqa: BLE001
            _INSTALL.update(state="error", error=str(ex))

    threading.Thread(target=_w, daemon=True).start()
    return dict(_INSTALL)

# 현재 활성 로컬 모델(서버가 /api/stt/select로 바꾼다).
_active: dict = {"model": DEFAULT_STT_MODEL}

# 모델 다운로드 상태(완전 로컬 에디션 첫 실행 흐름용). 패키징하지 않고 런타임에 받는다.
_DL: dict = {"state": "idle", "error": None}  # idle | downloading | done | error


def active_model() -> str:
    return _active["model"]


def set_model(model_id: str) -> str:
    """활성 로컬 ASR 모델을 바꾼다(커스텀 HF repo도 허용). 다음 전사부터 적용.

    전환 즉시 백그라운드 warmup을 걸어 '전환 후 첫 전사가 멈칫'하는 문제를 없앤다
    (모델 로드가 단일 executor 직렬·lru_cache라, 미리 데워두면 체감 지연이 사라진다).
    """
    mid = (model_id or "").strip()
    if mid and mid != _active["model"]:
        _active["model"] = mid
        _DL.update(state="idle", error=None)  # 새 모델 다운로드 상태 리셋
        # mlx 엔진 + 의존성 설치 + 이미 다운로드돼 있으면 미리 로드(비차단).
        try:
            if _engine(mid) == "mlx" and engine_available("mlx") and model_present(mid):
                _EXECUTOR.submit(_warmup_impl, mid)
        except Exception:  # noqa: BLE001 — warmup 실패는 다음 전사에서 자연 재시도
            pass
    return _active["model"]


def _approx_bytes(model_id: str) -> int:
    for m in LOCAL_MODELS:
        if m["id"] == model_id:
            return int(m["approx_gb"] * 1e9)
    return int(_DEFAULT_APPROX_GB * 1e9)

# MLX의 GPU Stream은 스레드 로컬이다. 모델을 로드한 스레드와 추론을 돌리는 스레드가
# 다르면 "There is no Stream(gpu, N) in current thread" 런타임 에러가 난다.
# (예: startup 데몬 스레드에서 warmup → FastAPI 요청 스레드에서 transcribe.)
# 모든 MLX 호출을 단일 전용 워커 스레드에 고정해 로드·추론 스레드를 일치시킨다.
_EXECUTOR = concurrent.futures.ThreadPoolExecutor(
    max_workers=1, thread_name_prefix="mlx-stt"
)


# ── 엔진별 모델 로드/전사 (의존성은 lazy import — 미설치 엔진은 선택 시 안내) ──
@lru_cache(maxsize=2)
def _mlx_model(repo: str):
    from mlx_audio.stt.generate import load_model
    return load_model(repo)


@lru_cache(maxsize=1)
def _fw_model(repo: str):
    from faster_whisper import WhisperModel
    return WhisperModel(repo, device="auto", compute_type="int8")


@lru_cache(maxsize=1)
def _granite(repo: str):
    from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor  # noqa: F401
    proc = AutoProcessor.from_pretrained(repo)
    model = AutoModelForSpeechSeq2Seq.from_pretrained(repo)
    return proc, model


def _need(engine: str) -> None:
    if not engine_available(engine):
        hint = next((m.get("install") for m in LOCAL_MODELS if m.get("engine") == engine and m.get("install")), "")
        raise RuntimeError(f"'{engine}' 엔진 미설치 — {hint}" if hint else f"'{engine}' 엔진 미설치")


def _warmup_impl(model_id: str) -> None:
    eng, repo = _engine(model_id), _repo(model_id)
    if eng == "mlx":
        _mlx_model(repo)  # mlx만 사전 로드(나머지는 첫 전사 때 lazy)


def _transcribe_impl(audio_path: str, model_id: str) -> str:
    eng, repo = _engine(model_id), _repo(model_id)
    if eng == "mlx":
        from mlx_audio.stt.generate import generate_transcription
        result = generate_transcription(model=_mlx_model(repo), audio=audio_path, verbose=False)
        text = getattr(result, "text", None)
        if text is None and isinstance(result, dict):
            text = result.get("text")
        return (text or "").strip()
    if eng == "faster-whisper":
        _need(eng)
        segments, _info = _fw_model(repo).transcribe(audio_path, beam_size=1)
        return " ".join(s.text for s in segments).strip()
    if eng == "whisperx":
        _need(eng)
        import whisperx
        model = whisperx.load_model("large-v3", device="cpu", compute_type="int8")
        result = model.transcribe(audio_path, batch_size=8)
        return " ".join(seg.get("text", "") for seg in result.get("segments", [])).strip()
    if eng == "granite":
        _need(eng)
        import torch
        import torchaudio
        proc, model = _granite(repo)
        wav, sr = torchaudio.load(audio_path)
        if wav.shape[0] > 1:                       # 멀티채널 → 모노
            wav = wav.mean(dim=0, keepdim=True)
        if sr != 16000:
            wav = torchaudio.functional.resample(wav, sr, 16000)
        # Granite Speech는 chat-template + <|audio|> placeholder 기반 멀티모달 LLM이다.
        chat = [{"role": "user", "content": "<|audio|>Transcribe this speech to text."}]
        text = proc.apply_chat_template(chat, tokenize=False, add_generation_prompt=True)
        inputs = proc(text, wav, return_tensors="pt")
        with torch.no_grad():
            out = model.generate(**inputs, max_new_tokens=256, num_beams=1, do_sample=False)
        n_in = inputs["input_ids"].shape[-1]       # 입력 토큰 이후(생성분)만 디코드
        new_tokens = out[:, n_in:]
        return proc.tokenizer.batch_decode(new_tokens, skip_special_tokens=True)[0].strip()
    return ""


def warmup(model_path: Optional[str] = None) -> None:
    """모델을 미리 메모리에 올린다(첫 전사 지연 제거). 전용 워커 스레드에서 로드."""
    _EXECUTOR.submit(_warmup_impl, model_path or active_model()).result()


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


@lru_cache(maxsize=16)
def _repo_total_bytes(repo: str) -> int:
    """HF repo의 실제 총 파일 크기(정확한 진행률용). 실패 시 0 → approx로 폴백. (repo당 1회 네트워크)"""
    try:
        from huggingface_hub import HfApi
        info = HfApi().model_info(repo, files_metadata=True)
        return sum((s.size or 0) for s in (info.siblings or []))
    except Exception:  # noqa: BLE001
        return 0


def model_present(model_path: Optional[str] = None) -> bool:
    """모델이 이미 로컬 캐시에 받아져 있는지(네트워크 없이 확인). repo 기준."""
    repo = _repo(model_path or active_model())
    try:
        from huggingface_hub import snapshot_download
        snapshot_download(repo, local_files_only=True)
        return True
    except Exception:  # noqa: BLE001
        return False


def download_status(model_path: Optional[str] = None) -> dict:
    """현재(또는 지정) 로컬 모델 다운로드 상태 + 진행률(완전 로컬 에디션 첫 실행 UI용)."""
    mp = model_path or active_model()
    repo = _repo(mp)
    present = model_present(mp)
    state = _DL["state"]
    # 완료 판단은 '워커 스레드 종료(state)' 기준. present가 다운로드 막판에 먼저 True로 떠도
    # state가 downloading이면 계속 진행 중으로 본다(진행률 바가 갑자기 사라지지 않게).
    if present and state == "idle":
        state = "done"
    downloaded = _dir_size(_hf_cache_dir(repo))
    total = _repo_total_bytes(repo) or _approx_bytes(mp)
    done = state == "done" or (present and state != "downloading")
    pct = 100 if done else min(99, int(downloaded * 100 / total)) if total else 0
    return {
        "repo": repo,
        "present": present,
        "state": state,
        "downloaded": downloaded,
        "total": total,
        "percent": max(0, pct),
        "error": _DL["error"],
    }


def start_download(model_path: Optional[str] = None) -> dict:
    """현재(또는 지정) 모델을 백그라운드로 받기 시작한다(재개 가능). 이미 받는 중이면 무시."""
    mp = model_path or active_model()
    repo = _repo(mp)
    if _DL["state"] == "downloading":
        return download_status(mp)
    _DL.update(state="downloading", error=None)

    def _w():
        try:
            from huggingface_hub import snapshot_download
            snapshot_download(repo)  # 재개 지원, HF 캐시에 저장
            _DL["state"] = "done"
        except Exception as ex:  # noqa: BLE001
            _DL.update(state="error", error=str(ex))

    threading.Thread(target=_w, daemon=True).start()
    return download_status(mp)


def delete_model(model_path: Optional[str] = None) -> dict:
    """현재(또는 지정) 모델의 HuggingFace 캐시를 repo 단위로 삭제한다."""
    mp = model_path or active_model()
    repo = _repo(mp)
    cache_dir = _hf_cache_dir(repo)
    deleted = _dir_size(cache_dir)
    if cache_dir.exists() or cache_dir.is_symlink():
        if cache_dir.is_symlink() or cache_dir.is_file():
            cache_dir.unlink()
        else:
            shutil.rmtree(cache_dir)
    _mlx_model.cache_clear()
    _fw_model.cache_clear()
    _granite.cache_clear()
    if repo == _repo(active_model()):
        _DL.update(state="idle", error=None)
    return {
        "ok": True,
        "repo": repo,
        "present": False,
        "deleted": deleted,
    }


def transcribe(audio_path: str, model_path: Optional[str] = None) -> str:
    """오디오 파일을 한국어 전사 텍스트로 변환한다.

    MLX 추론은 모델을 로드한 것과 동일한 전용 워커 스레드에서 수행한다
    (GPU Stream 스레드 로컬 문제 회피).

    Args:
        audio_path: wav/mp3 등 오디오 파일 경로.
        model_path: MLX ASR 모델 repo.

    Returns:
        전사된 텍스트.
    """
    return _EXECUTOR.submit(_transcribe_impl, audio_path, model_path or active_model()).result()
