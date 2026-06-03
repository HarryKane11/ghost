"""ElevenLabs Scribe v2 Realtime STT 브리지 — 클라 ws(16k mono float32) ↔ ElevenLabs realtime ws.

API 키는 서버에만 둔다(Electron 렌더러에 키/토큰 노출 X). 클라가 보내는 16kHz mono
float32 PCM을 int16 LE로 변환→base64→`input_audio_chunk`(JSON)로 ElevenLabs에 전달하고,
`partial_transcript`→{text,final:false}(라이브 초안), `committed_transcript`→{text,final:true}
(확정 라인)으로 되돌린다. `commit_strategy=vad`라 ElevenLabs가 발화 경계를 직접 잡는다.

numpy는 코어 의존성이 아니라(로컬 extra), 변환은 stdlib(array)만 쓴다.
"""

from __future__ import annotations

import array
import asyncio
import base64
import json
from typing import Callable, Optional

REALTIME_URL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime"
_LANG = {"ko": "ko", "en": "en", "zh": "zh"}


def _f32_to_pcm16_b64(buf: bytes) -> str:
    """16kHz mono float32(LE) 바이트 → 16-bit signed PCM(LE) → base64."""
    f = array.array("f")
    f.frombytes(buf)
    out = array.array("h", (0 for _ in range(len(f))))
    for i, x in enumerate(f):
        if x > 1.0:
            x = 1.0
        elif x < -1.0:
            x = -1.0
        out[i] = int(x * 32767.0)
    return base64.b64encode(out.tobytes()).decode("ascii")


async def bridge(
    client_ws,
    lang: Optional[str],
    api_key: str,
    on_committed: Optional[Callable[[str], None]] = None,
    model_id: str = "scribe_v2_realtime",
) -> None:
    """클라 ws ↔ ElevenLabs realtime ws를 양방향 중계. 둘 중 하나가 끊기면 종료."""
    import websockets  # uvicorn[standard] 경유로 항상 존재

    code = _LANG.get(lang or "")
    params = f"?model_id={model_id}&audio_format=pcm_16000&commit_strategy=vad"
    if code:
        params += f"&language_code={code}"
    url = REALTIME_URL + params

    try:
        el = await websockets.connect(url, additional_headers={"xi-api-key": api_key}, max_size=None)
    except Exception as ex:  # noqa: BLE001 — 연결 실패 → 클라가 폴백
        try:
            await client_ws.send_json({"text": "", "final": True, "error": f"realtime 연결 실패: {ex}"})
        except Exception:  # noqa: BLE001
            pass
        return

    sent = {"samples": 0}   # 전송한 16kHz 샘플 수(사용량/비용 추정)

    async def client_to_el() -> None:
        try:
            while True:
                msg = await client_ws.receive()
                if msg.get("type") == "websocket.disconnect":
                    break
                b = msg.get("bytes")
                if b:
                    sent["samples"] += len(b) // 4   # float32 → 샘플 수
                    await el.send(json.dumps({
                        "message_type": "input_audio_chunk",
                        "audio_base_64": _f32_to_pcm16_b64(b),
                        "sample_rate": 16000,
                    }))
                # 클라 텍스트 프레임('{"final":true}')은 무시 — ElevenLabs VAD가 commit을 직접 한다.
        except Exception:  # noqa: BLE001
            pass
        finally:
            try:
                await el.close()
            except Exception:  # noqa: BLE001
                pass

    async def el_to_client() -> None:
        try:
            async for raw in el:
                try:
                    e = json.loads(raw)
                except Exception:  # noqa: BLE001
                    continue
                mt = e.get("message_type")
                if mt == "partial_transcript":
                    await client_ws.send_json({"text": e.get("text", ""), "final": False})
                elif mt in ("committed_transcript", "committed_transcript_with_timestamps"):
                    txt = (e.get("text") or "").strip()
                    await client_ws.send_json({"text": txt, "final": True})
                    if on_committed and txt:
                        try:
                            on_committed(txt)
                        except Exception:  # noqa: BLE001
                            pass
                elif mt and "error" in mt:
                    await client_ws.send_json({"text": "", "final": True, "error": str(e.get("error") or mt)})
        except Exception:  # noqa: BLE001
            pass

    try:
        await asyncio.gather(client_to_el(), el_to_client())
    finally:
        try:
            await el.close()
        except Exception:  # noqa: BLE001
            pass
        try:  # 세션 동안 전송한 오디오 길이 → 사용량/비용 누적
            from ghost_local import usage
            usage.record_eleven_stt(sent["samples"] / 16000.0)
        except Exception:  # noqa: BLE001
            pass
