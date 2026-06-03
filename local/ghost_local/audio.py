"""업로드 음성 파일 → 타임스탬프 세그먼트 전사.

전략: 네이티브 타임스탬프 우선(ElevenLabs 단어 타임스탬프 · faster-whisper · whisperx),
지원 안 하는 모델(mlx Qwen3/Whisper · granite)은 ffmpeg로 N초 청크 분할 후 각 청크를
전사해 근사 타임스탬프를 만든다. 어떤 ASR을 골라도 [{start,end,text}]가 나온다.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
import uuid
from typing import Callable, List, Optional

Segment = dict  # {"start": float, "end": float, "text": str}

CHUNK_SEC = 20.0   # 폴백 청크 길이(초)


def _duration(path: str) -> float:
    """오디오 길이(초). ffprobe 실패 시 0."""
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            capture_output=True, text=True, timeout=30,
        )
        return float((r.stdout or "0").strip() or 0)
    except Exception:  # noqa: BLE001
        return 0.0


def _to_wav16k(src: str) -> str:
    dst = os.path.join(tempfile.gettempdir(), f"ghost_aud_{uuid.uuid4().hex}.wav")
    subprocess.run(["ffmpeg", "-y", "-i", src, "-ar", "16000", "-ac", "1", dst],
                   capture_output=True, check=False)
    return dst


# ── ElevenLabs Scribe: 단어 타임스탬프 → 문장 세그먼트 ────────────────────────
def _eleven_segments(path: str, lang: Optional[str], key: str) -> List[Segment]:
    import httpx
    from ghost_local import stt_cloud
    data = {"model_id": "scribe_v2", "timestamps_granularity": "word"}
    code = {"ko": "ko", "en": "en", "zh": "zh"}.get(lang or "")
    if code:
        data["language_code"] = code
    with open(path, "rb") as f:
        r = httpx.post(stt_cloud.ELEVEN_URL, headers={"xi-api-key": key},
                       data=data, files={"file": ("audio.wav", f, "audio/wav")}, timeout=600)
    r.raise_for_status()
    j = r.json()
    words = j.get("words") or []
    if not words:
        text = (j.get("text") or "").strip()
        return [{"start": 0.0, "end": _duration(path), "text": text}] if text else []
    # 단어들을 문장 경계(.?!。…) 또는 ~10초 단위로 묶는다.
    segs: List[Segment] = []
    cur: List[str] = []
    seg_start: Optional[float] = None
    last_end = 0.0
    for w in words:
        if w.get("type") not in (None, "word", "spacing"):
            continue
        txt = w.get("text") or ""
        st = float(w.get("start") or last_end)
        en = float(w.get("end") or st)
        last_end = en
        if seg_start is None:
            seg_start = st
        cur.append(txt)
        joined = "".join(cur).strip()
        ends_sentence = txt.strip().endswith((".", "?", "!", "。", "…", "?", "!"))
        if joined and (ends_sentence or (en - seg_start) >= 10.0):
            segs.append({"start": round(seg_start, 2), "end": round(en, 2), "text": joined})
            cur, seg_start = [], None
    if cur and seg_start is not None:
        segs.append({"start": round(seg_start, 2), "end": round(last_end, 2), "text": "".join(cur).strip()})
    return [s for s in segs if s["text"]]


# ── faster-whisper / whisperx: 네이티브 세그먼트 ─────────────────────────────
def _local_native_segments(path: str, model_id: str, engine: str) -> List[Segment]:
    from ghost_local import stt
    repo = stt._repo(model_id)
    if engine == "faster-whisper":
        segments, _info = stt._fw_model(repo).transcribe(path, beam_size=1)
        return [{"start": round(float(s.start), 2), "end": round(float(s.end), 2), "text": (s.text or "").strip()}
                for s in segments if (s.text or "").strip()]
    if engine == "whisperx":
        import whisperx
        model = whisperx.load_model("large-v3", device="cpu", compute_type="int8")
        result = model.transcribe(path, batch_size=8)
        out: List[Segment] = []
        for seg in result.get("segments", []):
            t = (seg.get("text") or "").strip()
            if t:
                out.append({"start": round(float(seg.get("start", 0)), 2),
                            "end": round(float(seg.get("end", 0)), 2), "text": t})
        return out
    return []


# ── 청크 폴백: 어떤 ASR이든 동작(N초 분할 후 각 청크 전사) ────────────────────
def _chunk_segments(path: str, transcribe_fn: Callable[[str], str], window: float = CHUNK_SEC) -> List[Segment]:
    wav = _to_wav16k(path)
    out_dir = tempfile.mkdtemp(prefix="ghost_chunks_")
    pattern = os.path.join(out_dir, "chunk_%04d.wav")
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", wav, "-f", "segment", "-segment_time", str(int(window)),
             "-ar", "16000", "-ac", "1", pattern],
            capture_output=True, check=False,
        )
        files = sorted(f for f in os.listdir(out_dir) if f.startswith("chunk_"))
        segs: List[Segment] = []
        for i, fn in enumerate(files):
            fp = os.path.join(out_dir, fn)
            try:
                text = (transcribe_fn(fp) or "").strip()
            except Exception:  # noqa: BLE001 — 한 청크 실패는 건너뜀
                text = ""
            if text:
                segs.append({"start": round(i * window, 2), "end": round((i + 1) * window, 2), "text": text})
        return segs
    finally:
        for fn in os.listdir(out_dir):
            try:
                os.unlink(os.path.join(out_dir, fn))
            except OSError:
                pass
        try:
            os.rmdir(out_dir)
        except OSError:
            pass
        try:
            os.unlink(wav)
        except OSError:
            pass


def transcribe_segments(path: str, provider: str, lang: Optional[str], eleven_key: str = "") -> List[Segment]:
    """업로드 음성 → 타임스탬프 세그먼트. 네이티브 우선, 안 되면 청크 폴백."""
    from ghost_local import stt

    # 1) 클라우드(ElevenLabs) — 단어 타임스탬프
    if provider == "elevenlabs" and eleven_key:
        try:
            segs = _eleven_segments(path, lang, eleven_key)
            if segs:
                return segs
        except Exception:  # noqa: BLE001 — 실패 시 로컬/청크로
            pass

    # 2) 로컬 네이티브 세그먼트(faster-whisper / whisperx)
    mid = stt.active_model()
    eng = stt._engine(mid)
    if eng in ("faster-whisper", "whisperx") and stt.engine_available(eng):
        try:
            segs = _local_native_segments(path, mid, eng)
            if segs:
                return segs
        except Exception:  # noqa: BLE001
            pass

    # 3) 청크 폴백(mlx Qwen3/Whisper · granite 등 — 어떤 모델이든)
    return _chunk_segments(path, lambda p: stt.transcribe(p))
