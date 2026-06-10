# Contributing to Ghost

기여 환영합니다! 👻

## 개발 환경

[README의 빠른 시작 — 소스에서](README.md#b-소스에서)를 따르세요. 요약:

```bash
# 백엔드
cd local && uv sync && uv run uvicorn server:app --port 8765

# 데스크탑 (다른 터미널)
cd desktop && pnpm install && pnpm dev
```

## 변경 전 체크

```bash
# 프론트엔드
cd desktop && pnpm exec tsc --noEmit && pnpm build

# 백엔드
cd local && uv run --with pytest pytest
```

CI가 PR에서 같은 검사를 돌립니다.

## 규칙

- **커밋**: Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`)
- **브랜치**: `feat/<이름>`, `fix/<설명>`
- **코드 스타일**: 주변 코드를 따르세요. 주석은 "왜"를 설명할 때만.
- **프라이버시 원칙**: 오디오/전사를 기기 밖으로 보내는 코드는 반드시 opt-in이어야 하며 PR 설명에 명시해야 합니다.
- 큰 변경은 이슈로 먼저 논의해 주세요.

## 구조 빠른 안내

```
desktop/   Electron + React (UI·캡처·오브)
local/     FastAPI 백엔드 (STT·brain·메모리·저장)
web/       Next.js 소개 사이트
```

자세한 모듈 설명은 [README 구성 섹션](README.md#구성) 참고.
