<div align="center">

# 👻 Ghost

**회의를 들으며 필요한 걸 알아서 띄우는, 완전 로컬 데스크탑 어시스턴트.**

흐름은 끊지 않고, 부를 때만 말합니다. 당신의 키로 동작하고, 오디오는 컴퓨터를 벗어나지 않습니다.

[![License: MIT](https://img.shields.io/badge/License-MIT-00d4a4.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS%20(Apple%20Silicon)-111.svg)
![Status](https://img.shields.io/badge/status-alpha-888.svg)

</div>

---

## 무엇인가요

Ghost는 회의 오디오를 **실시간으로 전사**하고, 맥락을 잃지 않게 기억하며, 회의가 끝나면 요약·결정·액션아이템을 **회의록**으로 정리합니다. 오디오는 컴퓨터를 벗어나지 않습니다.

- 🎙 **실시간 전사** — 마이크 또는 시스템 소리(화상회의)를 받아 적어요 (온디바이스 Qwen3-ASR, MLX)
- 🧠 **긴 회의도 맥락 유지** — 롤링 요약 메모리로 회의가 길어져도 초반 결정을 잊지 않아요
- 📋 **5분 다이제스트(기본)** — 5분마다(설정 가능) 요약·결정·액션·미해결을 카드 하나로. 능력이 되는 백엔드는 가장 중요한 미해결 1건을 **직접 조사**해 근거까지 붙여요
- 🗣 **부를 때만 일합니다** — "고스트~"로 부르면(웨이크워드) 그 요청을 수행. 부르지 않은 자동 개입은 정말 중요한 순간에만, 인색하게 (민감도 설정)
- 📝 **회의록** — 끝나면 요약·결정·액션아이템 자동 정리 (+ 손글씨 스케치노트)
- 💾 **로컬 영속** — 회의는 `~/Ghost/meetings/<일시>/` 폴더에 실시간 저장. 제목 편집·저장 위치 변경 가능. 재시작해도 안 사라져요
- 🔒 **로컬 우선** — 브레인을 여러 에이전트 중에서 선택. 오디오는 외부로 안 나갑니다

## 에이전트 상위 레이어

Ghost는 특정 모델에 묶이지 않습니다. **교체 가능한 에이전트 엔진** 위에 회의 레이어로 앉습니다.

| 백엔드 | Brain | 웹·도구 | 데이터 | 노출 조건 |
|--------|-------|---------|--------|-----------|
| `codex` | Codex CLI ← ChatGPT 구독 | 웹검색·브라우저·MCP | 사용자 계약 하 | Codex CLI 설치 시 |
| `openai` | OpenAI API | (기본 없음) | 외부 클라우드 | API 키 입력 시 |
| `ollama` | Gemma (ollama) | 없음 | **외부 유출 0** | **ollama 데몬 실행 시에만** (opt-in) |
| `opencode` | OpenCode | 웹·MCP | 설정에 따름 | opencode 설치 시 |
| `hermes` | Nous hermes-agent | 웹·MCP | 설정에 따름 | hermes 설치 시 |

> 능력(웹검색·구조화 출력·이벤트 스트림 등)은 백엔드마다 다릅니다. Ghost는 capability를 감지해 codex는 1급으로, 기능이 적은 백엔드는 우아하게 강등해 동작합니다. 모든 사용자가 로컬 모델을 받을 필요는 없으니, `ollama`는 직접 띄웠을 때만 옵션으로 나타납니다.

### 내 에이전트에 회의 맥락 꽂기 (ghost-meeting MCP)

Ghost는 MCP 서버로도 동작해, **당신이 터미널에서 쓰는 에이전트**가 회의록 전체(현재 + 지난 회의)에 접근하게 합니다.

```bash
codex mcp add ghost-meeting -- uv run --directory <ghost>/local python -m ghost_local.mcp_server
```

연결하면 어느 에이전트에서든 `"방금 회의 기준으로 후속 메일 초안 써줘"`, `"지난주 가격 정책 회의 결정이 뭐였지?"` 같은 게 동작합니다. (도구: `list_meetings` · `get_meeting` · `search_meetings` · `get_transcript` · `get_summary` · `current_meeting` — 읽기 전용)

## 구성

```
ghost/
├── desktop/   Electron + React (Vite) — 캡처·전사 UI·카드·온보딩·설정
├── local/     FastAPI 로컬 백엔드
│   └── ghost_local/
│       ├── stt.py        STT (Qwen3-ASR, MLX) + 모델 다운로드
│       ├── brain.py      라우팅·judge·act·회의록
│       ├── memory.py     롤링 회의 메모리 (긴 회의 맥락)
│       ├── store.py      일시별 폴더 영속 저장
│       ├── digest.py     5분 다이제스트
│       ├── adapters/     교체 가능한 에이전트 엔진 (codex/openai/ollama/opencode/hermes)
│       └── mcp_server.py ghost-meeting MCP (회의록 노출)
└── web/       Next.js 소개 사이트
```

## 빠른 시작 (macOS · Apple Silicon)

요구: [uv](https://github.com/astral-sh/uv), [pnpm](https://pnpm.io), `ffmpeg` (`brew install ffmpeg`). 브레인으로 Codex를 쓰려면 [Codex CLI](https://github.com/openai/codex), OpenAI를 쓰려면 API 키, 완전 로컬을 쓰려면 [ollama](https://ollama.com).

```bash
# 1) 로컬 백엔드 (STT·brain·메모리·TTS)
cd local
uv sync
uv run uvicorn server:app --host 127.0.0.1 --port 8765

# 2) 데스크탑 앱 (다른 터미널)
cd desktop
pnpm install
pnpm dev        # Vite + Electron
```

앱을 처음 열면 **온보딩**이 브레인 연결(OpenAI 키 붙여넣기 또는 `codex login`)과 마이크 권한을 안내합니다. 설정·관리 메뉴에서 **‘가이드 다시 보기’**로 언제든 다시 볼 수 있어요.

### DMG로 빌드

```bash
cd desktop && pnpm dist     # → desktop/release/Ghost-<버전>-arm64.dmg
```

## 음성 모델 (완전 로컬 전사)

온디바이스 전사 모델(Qwen3-ASR ~3.4GB)은 **설치 파일에 포함하지 않고, 첫 실행 때 받습니다.** 설정의 **저장 · 로컬 모델**에서 진행률을 보며 한 번만 내려받으면 돼요. 클라우드 전사(ElevenLabs Scribe v2)를 쓰면 다운로드 없이 바로 됩니다.

- **완전 로컬**: Qwen3-ASR(전사) + ollama(brain) → 오디오·텍스트 모두 외부로 안 나감
- **클라우드**: ElevenLabs(전사) / codex·openai(brain) → 더 빠른 셋업, 더 높은 정확도

## 데이터는 어디에

회의는 `~/Ghost/meetings/<YYYY-MM-DD_HH-MM-SS>/`에 저장됩니다 (설정에서 위치 변경 가능, `GHOST_HOME` 환경변수로도 지정).

```
~/Ghost/meetings/2026-06-02_14-30-05/
├── meeting.json     제목(편집 가능)·요약·결정·액션·미해결
├── transcript.jsonl 발화마다 실시간 누적
├── minutes.json     회의록
└── digests.jsonl    5분 다이제스트 기록
```

## 라이선스

[MIT](LICENSE). 자유롭게 쓰고, 고치고, 배포하세요. 기여 환영합니다.
