# Ghost Desktop — 자비스풍 상시 청취 어시스턴트

Electron + React(Vite). 사용자의 말을 **상시 듣다가**, codex가 개입 시점을 판단해
**알아서 정보를 찾아 Generative UI 카드로 띄운다.** 평소 무음, 말할 가치가 있을 때만 음성.

## 동작 흐름 (chat / action 2분기 + 스트리밍)

```
[상시 청취] mic/시스템 오디오
   │  VAD endpointing (에너지+침묵 750ms로 발화 단위 분할, 고정창 아님)
   ▼
POST /api/transcribe (Qwen3-ASR) → 전사
   ▼
POST /api/route  → judge(로컬, 내부): chat | action | none
   ├─ none   : 무시
   ├─ chat   : 직접 말 걸기 → 바로 대화 응답(+음성)
   └─ action : ① say("네, ~ 찾아볼게요") 먼저 대답(+음성)
               ② POST /api/act/stream (SSE):
                  progress…(웹 검색: …) 라이브 + 스켈레톤 모션
               ③ result: GenUI {spoken, blocks[]} 로 교체 (무음)
```

- 백엔드는 **codex**(웹·브라우저·MCP 내장) 또는 **openai**. 로컬(ollama) 액션 백엔드는 폐기.
  (라우터/챗 ack는 내부적으로 로컬 모델로 빠르게 처리)
- action 결과 자체는 **무음**(회의 방해 X), 먼저 건넨 say와 직접 대화(chat)만 음성.

- `src/lib/useListening.ts` — **VAD 기반 endpointing** (대화형 AI 방식). 음성/침묵 판정 → 발화 종료 감지
- `src/components/Orb.tsx` — 음성 반응 리스닝 오브 (유령 코어·호흡 링·입자)
- `src/components/GenUI.tsx` — **Generative UI 렌더러**: 모델이 고른 블록(heading/text/stat/list/steps/link/quote)을 컴포넌트로
- `electron/main.cjs` — 백엔드 자동 spawn, 마이크/화면 권한, 시스템오디오 루프백

## 동작하는 UI 요소 (전부 실연결)

| 요소 | 동작 |
|------|------|
| 리스닝 오브 (클릭) | 상시 청취 on/off. 음성에 반응(레벨·speaking), 처리 중 thinking |
| 입력 소스 (마이크/시스템) | getUserMedia / getDisplayMedia 루프백(상대방 목소리) |
| 백엔드 선택 (로컬/Codex/OpenAI) | `POST /api/config` |
| 연결됨 pill | `GET /api/status` (codex 로그인 실측) |
| GenUI 카드 | judge→act 결과를 stat 그리드·list·link 등으로 materialize |
| 카드 듣기 | spoken만 Supertonic TTS |
| 카드 닫기 / 음성 토글 / 테마 | 전부 실연결 |
| 직접 묻기(입력) + 푸시투토크 | `POST /api/ask` (수동, 항상 act) |

## 능동 개입 + Generative UI

- **judge**(로컬·고속): 발화가 잡담이면 무시, 질문·정보공백이면 act 트리거.
- **act**: `codex` 백엔드는 ChatGPT 구독 auth로 **웹 검색·브라우저·MCP 커넥터 내장** 활용 →
  `--output-schema`로 **구조화된 GenUI JSON** 생성. 모델이 내용에 맞는 레이아웃(통계 카드·목록·출처 링크)을 스스로 구성.
- **음성 선별**: 출처·URL·수치나열은 화면(blocks)에만, 사용자에게는 짧은 `spoken` 한 문장만 발화.

## 실행

```bash
# 데스크탑 앱 (Electron + Vite, 백엔드 자동 spawn)
pnpm install && pnpm dev

# 브라우저로만 UI 확인
pnpm dev:web        # http://localhost:5173 (백엔드 별도 실행 필요)
```

## 패키징 → 진짜 설치형 앱

```bash
pnpm dist    # release/Ghost-<ver>-arm64.dmg  (백엔드 번들 포함)
pnpm pack    # release/mac-arm64/Ghost.app    (언팩, 빠른 확인용)
```

빌드에 포함되는 것:
- **백엔드 번들**: `../local`(server.py·ghost_local·uv.lock)이 `Ghost.app/Contents/Resources/backend`로 들어감 (`.venv` 제외)
- **마이크/화면 권한 설명**: `Info.plist`의 `NSMicrophoneUsageDescription`·`NSScreenCaptureUsageDescription` → 패키징 앱에서 마이크 동작에 **필수**
- **entitlements**: audio-input, JIT, 라이브러리 검증 완화(번들 백엔드 네이티브 라이브러리)
- 아이콘 `build/icon.png` → `.icns` 임베드

### 설치 & 첫 실행
1. `Ghost-*.dmg` 열기 → `Ghost.app`을 Applications로 드래그
2. 첫 실행: ad-hoc 서명이라 Gatekeeper 경고 → **우클릭 → 열기**(또는 시스템 설정 → 개인정보 보호 및 보안 → "그래도 열기")
3. 창이 바로 뜨고, 백엔드는 백그라운드로 기동:
   - 첫 실행 시 번들 백엔드를 `~/Library/Application Support/Ghost/backend`로 복사 후 `uv run`으로 의존성 설치(수 분, 1회). 그동안 상태칩이 "백엔드 끊김" → 준비되면 "연결됨"
4. 듣기/푸시투토크 클릭 → **"Ghost가 마이크에 접근하려 합니다"** 프롬프트 → 허용 → 동작

### 외부 의존성(사용자 머신에 설치 필요)
- `uv`(Python 실행) · `ollama`(로컬 Gemma) · `codex`(Codex 백엔드, `codex login`) · `ffmpeg`
- 앱은 GUI라 셸 PATH를 안 물려받으므로 `/opt/homebrew/bin`·`~/.local/bin`·`/usr/local/bin`을 자동 탐색

> 완전 무의존 배포(타인 머신 즉시 실행)는 백엔드를 PyInstaller 사이드카로 동결 + Developer ID 서명·notarize 필요 — 다음 단계.

## 검증 (이 세션에서 실측)
- 질문 → 카드: Gemma 4 E4B 실답변 + 출처 + 신뢰도 + 듣기 ✅
- Codex 웹 검색: "비트코인 $73,829 + coingecko URL" 카드 ✅
- 백엔드 전환 로컬 ↔ Codex(ChatGPT auth) ✅ · 입력소스 마이크/시스템 토글 ✅
- 테마 light/dark ✅ · 상태 pill 실측 ✅ · 5개 엔드포인트 검증 ✅
- 패키징 `Ghost.app`(아이콘 임베드) 빌드 ✅

> 마이크/시스템 캡처는 Electron/실브라우저(권한)에서 동작. 헤드리스 미리보기에선 캡처 외 전부 검증.
