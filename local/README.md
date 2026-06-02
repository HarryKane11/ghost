# Ghost — 완전 로컬 파이프라인

Apple Silicon(M-series)에서 **외부 클라우드 없이** 도는 회의 어시스턴트 코어.
STT → Brain → TTS 3스테이지를 온디바이스로 검증한 PoC.

```
오디오(발화) ─► STT ─────► Brain ─────► TTS ─────► 오디오(답변)
              Qwen3-ASR    (백엔드 선택)  Supertonic 3
               0.6B/MLX                   ONNX·CPU·44.1kHz
```

## 브레인 = 3개 백엔드 선택 (STT/TTS는 항상 로컬)

| backend | 방식 | 모델 | 데이터 |
|---------|------|------|--------|
| `ollama` | Gemma 4 E4B 직접 호출 | `gemma4:e4b` | **외부 유출 0 (완전 로컬)** |
| `codex`  | **Codex CLI를 ChatGPT 구독 auth로** (Hermes 방식, `--oss` 아님) | 계정 기본(gpt-5.x) | 사용자 OpenAI 계약 하 |
| `openai` | OpenAI API | `gpt-5.4-mini` | 외부 클라우드 (유료 기본) |

> `codex` 백엔드는 `~/.codex/auth.json`의 ChatGPT 구독 토큰을 그대로 쓴다.
> API 키도, `--oss`도 아니다. Hermes agent가 Codex를 가져오는 방식과 동일.

## speak-first 패턴

본 답변(수 초) 전에 **ollama로 즉시 짧은 ack**를 발화해 체감 지연을 가린다.
1. STT 질문 인식 → 2. quick_ack("네, 찾아볼게요", ~0.7s) 음성 → 3. 본 답변 → 4. TTS.

## 모델 (전부 Apache-2.0 / 오픈)

| 역할 | repo / 패키지 |
|------|------|
| STT | aufklarer/Qwen3-ASR-0.6B-MLX-8bit (Apache-2.0) |
| LLM(local) | google/gemma-4-E4B-it → `ollama gemma4:e4b` (Apache-2.0) |
| TTS | **Supertonic 3** (`pip supertonic`, ONNX·CPU·44.1kHz / 코드 MIT·모델 OpenRAIL-M) |

## 사전 준비

```bash
ollama pull gemma4:e4b          # 로컬 브레인
codex login                     # codex 백엔드용 (ChatGPT 구독)
uv sync                         # 의존성
```

## 실행

```bash
# 완전 로컬 (기본)
uv run python -m ghost_local.pipeline utterance.wav --backend ollama
# Codex 구독 auth (Hermes 방식)
uv run python -m ghost_local.pipeline utterance.wav --backend codex
# 유료 클라우드
OPENAI_API_KEY=... uv run python -m ghost_local.pipeline utterance.wav --backend openai
```

```python
from ghost_local import stt, brain, tts
text = stt.transcribe("utterance.wav")
ans  = brain.answer(text, brain.BrainConfig(backend="codex"))   # ChatGPT auth
wav  = tts.speak(ans, "/tmp/out.wav")
```

## 검증 결과 (M5 Pro, 48GB, warm)

| 스테이지 | ollama backend | codex(auth) backend |
|---------|------|------|
| STT (Qwen3-ASR) | ~1.6–3s | ~1.6–3s |
| ack (speak-first) | ~0.7s | ~0.7s |
| Brain | **~8s** | **~5s** |
| TTS (Supertonic 3) | ~2.6s (warm, 44.1kHz) | ~2.6s |

전 구간 한국어 정확. 완전 로컬(`ollama`)은 외부 클라우드 0, Codex(`auth`)는 구독 인증.

## 알려진 한계 / TODO

- **web_search 미연결**: 완전 로컬 데모라 외부 검색 없음 → 브레인이 "출처 필요"로 정직하게 답함. 프로덕션은 검색 결과를 컨텍스트로 주입.
- **화자분리·VAD**: 이 PoC 범위 밖(회의 후 오프라인 파이프라인에서 처리).
