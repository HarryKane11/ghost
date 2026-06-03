"""진짜 토큰-스트리밍 STT — parakeet-mlx의 transcribe_stream로 부분 결과를 실시간 emit.

설계: ws로 들어오는 연속 오디오(16k mono float32)를 스트리밍 디코더에 계속 add_audio하고,
result.text(부분 가설)를 콜백으로 흘린다. 최종(정제)은 클라이언트의 기존 VAD 엔드포인트 →
배치 전사가 담당하므로, 여기는 '라이브 초안'만 책임진다(실패해도 배치 최종은 그대로).

MLX는 스레드-로컬(GPU stream)이라, 모델 로드·add_audio·result를 모두 '같은 전용 스레드'에서
수행해야 한다. 그래서 세션마다 전용 워커 스레드를 두고 그 안에서 모델을 로드한다(동시 세션=마이크 1개라
메모리 부담 적음). 의존성(parakeet-mlx)이 없으면 streaming_supported=False → 클라가 2-pass로 폴백.
"""

from __future__ import annotations

import importlib.util
import queue
import threading
from typing import Callable, Optional

_FINAL = "__FINAL__"


def streaming_supported(model_id: str) -> bool:
    """parakeet-mlx 설치 + 활성 모델이 parakeet 계열일 때만 네이티브 스트리밍 가능."""
    if importlib.util.find_spec("parakeet_mlx") is None:
        return False
    return "parakeet" in (model_id or "").lower()


class StreamSession:
    """ws 연결 1개당 1세션. feed(samples)로 오디오를 넣고, emit(text, final)로 부분 결과를 받는다."""

    def __init__(self, repo: str, emit: Callable[[str, bool], None]) -> None:
        self.repo = repo
        self.emit = emit
        self._q: "queue.Queue" = queue.Queue()
        self._alive = True
        self._t = threading.Thread(target=self._run, daemon=True, name="stt-stream")
        self._t.start()

    def _run(self) -> None:
        try:
            import mlx.core as mx
            import parakeet_mlx
            model = parakeet_mlx.from_pretrained(self.repo)  # 반드시 이 스레드에서 로드(MLX 스레드-로컬)
            with model.transcribe_stream(context_size=(256, 256)) as tr:
                while self._alive:
                    item = self._q.get()
                    if item is None:
                        break
                    if isinstance(item, str) and item == _FINAL:
                        try:
                            self.emit(tr.result.text, True)
                        except Exception:  # noqa: BLE001
                            pass
                        continue
                    try:
                        tr.add_audio(mx.array(item))
                        self.emit(tr.result.text, False)
                    except Exception:  # noqa: BLE001 — 한 청크 실패는 무시(스트림 유지)
                        pass
        except Exception as ex:  # noqa: BLE001 — 로드/런타임 실패 → 클라가 2-pass로 폴백
            try:
                self.emit(f"__error__:{ex}", True)
            except Exception:  # noqa: BLE001
                pass

    def feed(self, samples) -> None:
        """16kHz mono float32 numpy 배열을 투입."""
        if self._alive:
            self._q.put(samples)

    def finalize(self) -> None:
        if self._alive:
            self._q.put(_FINAL)

    def close(self) -> None:
        self._alive = False
        self._q.put(None)


def make_session(repo: str, emit: Callable[[str, bool], None]) -> Optional["StreamSession"]:
    if importlib.util.find_spec("parakeet_mlx") is None:
        return None
    return StreamSession(repo, emit)
