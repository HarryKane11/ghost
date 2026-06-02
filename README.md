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

Ghost는 회의 오디오를 **실시간으로 전사**하고, 질문·정보 공백을 감지하면 웹·사내 지식에서 찾아 **카드로 조용히 띄웁니다**. 회의가 끝나면 요약·결정·액션아이템을 **회의록**으로 정리합니다.

- 🎙 **실시간 전사** — 마이크 또는 시스템 소리(화상회의)를 받아 적어요 (온디바이스 Qwen3-ASR, MLX)
- ✨ **능동 카드** — 흐름을 끊지 않고 근거 있는 정보를 옆에 띄워요
- 📝 **회의록** — 끝나면 요약·결정·액션아이템 자동 정리
- 🔒 **로컬 우선** — 브레인을 `ollama`(완전 로컬) · `codex`(ChatGPT 구독) · `openai`(API 키) 중에서 선택. 오디오는 외부로 안 나갑니다

## 구성

```
ghost/
├── desktop/   Electron + React (Vite) 데스크탑 앱 — 캡처·전사 UI·카드·온보딩
├── local/     FastAPI 로컬 백엔드 — STT(Qwen3-ASR)·brain(codex/openai/ollama)·TTS
└── web/       Next.js 소개 사이트
```

## 빠른 시작 (macOS · Apple Silicon)

요구: [uv](https://github.com/astral-sh/uv), [pnpm](https://pnpm.io), `ffmpeg` (`brew install ffmpeg`). 브레인으로 Codex를 쓰려면 [Codex CLI](https://github.com/openai/codex), OpenAI를 쓰려면 API 키.

```bash
# 1) 로컬 백엔드 (STT·brain·TTS)
cd local
uv sync
uv run uvicorn server:app --host 127.0.0.1 --port 8765

# 2) 데스크탑 앱 (다른 터미널)
cd desktop
pnpm install
pnpm dev        # Vite + Electron
```

앱을 처음 열면 **온보딩**이 브레인 연결(OpenAI 키 붙여넣기 또는 `codex login`)과 마이크 권한을 안내합니다. 설정·관리 메뉴에서 **‘가이드 다시 보기’**로 언제든 다시 볼 수 있어요.

## 브레인 선택

| 백엔드 | STT | Brain | 데이터 |
|--------|-----|-------|--------|
| `openai` | Qwen3-ASR (로컬) | OpenAI API | 외부 클라우드 |
| `codex` | Qwen3-ASR (로컬) | Codex CLI ← ChatGPT 구독 | 사용자 계약 하 |
| `ollama` | Qwen3-ASR (로컬) | Gemma (ollama) | **외부 유출 0** |

> Codex 커넥터(Confluence·Slack·GitHub 등)는 `codex mcp add <name> --url <원격 MCP>` + `codex mcp login`으로 연결하면 회의 중 사내 지식 검색에 쓰입니다.

## 라이선스

[MIT](LICENSE). 자유롭게 쓰고, 고치고, 배포하세요. 기여 환영합니다.
