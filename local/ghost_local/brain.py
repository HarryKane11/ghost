"""Brain — 능동 개입 엔진 + Generative UI 스펙 생성.

흐름:
  judge(utterance)  → 지금 액션이 필요한가? (경량·로컬 ollama, 상시)
  act(query)        → 필요 시 codex(web/browser/MCP) 또는 ollama가 수행 →
                      GenUI 스펙 {title, spoken, intent, blocks[]} 반환

백엔드 3종 (act용):
  ollama : Gemma 4 E4B 직접 (완전 로컬)
  codex  : Codex CLI ← ChatGPT 구독 auth (웹검색·브라우저·MCP 내장)
  openai : OpenAI API gpt-5.4-mini

음성 선별: spoken 필드만 TTS. 출처·URL·코드는 blocks로 화면에만.
"""

from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import tempfile
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

OLLAMA_URL = "http://localhost:11434"


def _is_token_race(stderr: str) -> bool:
    """동시 codex 호출이 ~/.codex/auth.json 토큰 갱신을 두고 경쟁할 때 나는 에러.
    드물게(토큰 만료 시점) 발생 → 짧게 뒤 재시도하면 갱신된 토큰으로 성공한다."""
    s = (stderr or "").lower()
    return ("refresh token" in s and "consumed" in s) or "already consumed" in s
JUDGE_MODEL = "gemma4:e4b"

ALLOWED_BLOCKS = (
    "사용 가능한 UI 컴포넌트(skill). 내용에 가장 맞는 것을 골라 자유롭게 조합한다:\n"
    "  · heading {text}  — 섹션 제목\n"
    "  · text {text}  — 문단\n"
    "  · stat {label, value}  — 큰 단일 수치\n"
    "  · chart {value:'bar'|'line'|'area'|'pie', label:제목, items:['라벨: 숫자', …]}  "
    "— 비교·점유율·순위는 bar/pie, 시간 추이는 line/area\n"
    "  · table {label?, items:['헤더1 | 헤더2 | 헤더3', '값1 | 값2 | 값3', …]}  — 첫 행=헤더, '|'로 구분\n"
    "  · list {items[]}  — 불릿 목록\n"
    "  · steps {items[]}  — 번호 절차\n"
    "  · callout {value:'info'|'warn'|'success'|'error', label?:제목, text:내용}  — 강조 박스\n"
    "  · badges {items[]}  — 태그 칩\n"
    "  · progress {label, value:'0~100'}  — 비율/진행 바\n"
    "  · keyvalue {items:['키: 값', …]}  — 키-값 정의\n"
    "  · timeline {items:['시점 | 사건', …]}  — 타임라인\n"
    "  · quote {text, label?:출처}  · link {label, url}  · image {url, label?}  · divider {}\n"
    "  ── 인터랙티브(정적 텍스트보다 우선해 적극 활용) ──\n"
    "  · accordion {label?, items:['제목 | 내용', …]}  — 길거나 선택적 상세는 접어서. 정보 밀도↓\n"
    "  · tabs {items:['탭명 | 내용', …]}  — 같은 주제의 여러 관점/항목을 탭으로\n"
    "  · checklist {items[]}  — 사용자가 체크할 수 있는 할 일/준비물/점검 목록\n"
    "  · actions {items:['버튼라벨 | 후속질의', …]}  — 다음에 물어볼 만한 후속 질문을 버튼으로. "
    "클릭하면 그 '후속질의'가 즉시 실행된다. 카드 끝에 2~4개 제안하면 대화가 이어진다\n"
    "  · code {text:코드, label?:언어}  — 코드/명령/설정은 반드시 이 블록으로(텍스트로 풀어쓰지 말 것)\n"
    "  · mermaid {text:mermaid 코드, label?:제목}  — 흐름·구조·관계·일정은 다이어그램으로. "
    "flowchart TD / sequenceDiagram / gantt / mindmap 문법의 코드만 text에 넣는다(설명·백틱 금지). "
    "프로세스 설명, 아키텍처, 의사결정 분기, 조직/관계도엔 글보다 이 블록이 낫다"
)

WORKLOAD_DECISION_RULES = (
    "## 업무량·인력 결정 원칙\n"
    "- 업무량, 운영 투입, 야간·휴일 대응, 추가 인력 필요성을 다룰 때는 고정된 휴일 수준 계획을 전제로 삼지 않는다.\n"
    "- 먼저 실제 업무량과 리스크 근거를 분리해 제시한다: 배치/인터페이스 수, 실행 주기, 예상 처리량, 장애 영향도, 운영 가능 시간, 미확정 항목.\n"
    "- 근거가 부족하면 결론을 확정하지 말고 '측정 필요'로 표시하고, 확인할 지표와 의사결정 기준을 화면 카드에 제시한다.\n"
    "- 휴일 수준 대응은 실제 업무량과 리스크가 기준을 넘을 때만 조건부 옵션으로 둔다. 기본 결론은 시간 박스, 범위 축소, 우선순위 조정, 단계적 투입 중에서 선택한다.\n"
    "- 누가 결정해야 하는지와 언제 재평가할지도 함께 남긴다.\n"
)

ACT_SYSTEM = (
    "너는 'Ghost', 회의를 함께 듣는 비서다. 회의 중 필요해 보이는 정보를 알아서 찾아 화면 카드로 띄우거나, "
    "요청된 작업을 수행한다(자비스처럼). 최신 정보·통계는 웹 검색/브라우저로 찾고, 사내 자료가 필요하면 "
    "연결된 커넥터(MCP)를 활용한다. 회의를 방해하지 않도록 핵심만 간결하게.\n"
    "## 행동 원칙 (show, don't tell — 어기면 실패다)\n"
    "- 도구·커넥터로 답할 수 있으면 '할 수 있다/주면 해보겠다'고 설명하거나 되묻지 말고, **즉시 도구를 호출해 실제 결과로** 답하라.\n"
    "- 사실·수치·최신 정보·사내 자료를 다루는 요청에서 도구를 한 번도 호출하지 않고 기억만으로 답하는 것은 **실패**다. "
    "반드시 web_search 또는 커넥터를 최소 1회 호출해 근거를 확보한 뒤 답한다. (예외: 순수 의견·계산·전사 정리)\n"
    "- '○○에 접근 가능해?' 처럼 능력을 묻더라도, 가능하면 직접 한 번 조회해 결과(또는 실제 실패 사유)로 보여줘라.\n"
    "- 검색어가 모호하면 발화·맥락에서 핵심 키워드를 스스로 뽑아 일단 검색한다. 사용자에게 키워드를 되묻지 마라.\n"
    "- 커넥터(Atlassian/Confluence·Slack·Notion·GitHub 등)는 등록돼 있으면 그 도구로 실제 조회한다. "
    "사내 문서·일정·이슈·채널·담당자 얘기가 나오면 웹 검색보다 커넥터를 먼저 시도한다. "
    "첫 도구가 실패하면 다른 도구/검색어로 한 번 더 시도한 뒤에야 한계를 보고한다.\n"
    "반드시 아래 JSON 한 개만 출력한다(설명 금지):\n"
    '{"title": str, "spoken": str, "intent": "search|browse|answer|note|action|none", "blocks": [...]}\n'
    f"{ALLOWED_BLOCKS}\n"
    "규칙:\n"
    "- title: 카드 제목(짧게).\n"
    "- spoken: 사용자에게 '말로' 전할 짧은 한국어 한 문장. 출처·URL·숫자나열은 절대 넣지 말 것. 말할 가치가 없으면 빈 문자열.\n"
    "- blocks: 위 컴포넌트를 풍부하게 조합. 단일 수치=stat, 여러 수치 비교/점유율/추이=chart, 표 형식=table, "
    "절차=steps, 주의·핵심=callout, 키-값=keyvalue, 일정=timeline, 출처=link. 데이터는 가급적 시각화.\n"
    "- 인터랙티브를 적극 써라: 길면 accordion으로 접고, 여러 관점은 tabs로, 할 일은 checklist로, "
    "코드/명령은 code로. 그리고 가능하면 카드 끝에 actions(후속 질문 버튼 2~4개)를 붙여 대화가 이어지게 하라.\n"
    "- image/handwritten 블록은 절대 쓰지 마라(이미지는 회의록 생성 전용 경로에서만 만든다). "
    "이미지를 만들 수 없으면 텍스트/표로 대신한다.\n"
    "- 한국어로.\n"
    f"{WORKLOAD_DECISION_RULES}"
)

MINUTES_SYSTEM = (
    "너는 'Ghost', 회의 비서다. 아래 회의 전사 '전체'를 처음부터 끝까지 읽고 흐름을 이해한 뒤, "
    "사람이 정리한 듯 상세하고 구조적인 회의록을 작성한다. 전사가 필러워드·오탈자로 거칠더라도 "
    "의미를 파악해 매끄럽게 정제한다. 회의에서 쓰인 언어로 작성한다(한국어 회의면 한국어).\n"
    "반드시 JSON 한 개만 출력: "
    '{"title": str, "spoken": str, "intent": "note", "blocks": [...]}\n'
    f"{ALLOWED_BLOCKS}\n"
    "blocks 권장 구성(heading 텍스트는 제목만, 괄호 설명 금지):\n"
    "1) heading \"회의 요약\" → text: 회의 목적·핵심 결과 3~5문장\n"
    "2) heading \"주요 논의\" → 안건별로 heading(소제목) + text/list로 무슨 얘기가 오갔는지 상세히. "
    "쟁점·근거·이견이 있었다면 함께. 회의 길이에 비례해 충실하게.\n"
    "3) heading \"결정 사항\" → list (확정된 것만, 명확히)\n"
    "4) heading \"액션 아이템\" → table[담당 | 할 일 | 기한] 또는 list (담당·기한 있으면 반드시 포함)\n"
    "5) (있으면) heading \"미해결·후속\" → list\n"
    "6) 마지막에 actions 블록 — 회의록을 '실행'으로 잇는 후속 버튼 2~4개. 연결된 커넥터가 있으면 그걸 쓰는 "
    "구체 작업으로 제안한다. 예: ['Slack에 공유 | 방금 회의록 핵심을 적절한 Slack 채널에 공유해줘', "
    "'후속 메일 초안 | 이 회의의 결정·액션아이템으로 참석자 공유 메일 초안을 작성해줘', "
    "'액션아이템 티켓 생성 | 액션아이템들을 이슈 트래커에 티켓으로 만들어줘']\n"
    "원칙: 전사에 실제로 있는 내용만. 없는 걸 지어내지 말 것. 고유명사는 [회의 배경]을 참고해 정확히 표기.\n"
    "spoken: \"회의록 정리했어요\" 정도의 짧은 한마디.\n"
    f"{WORKLOAD_DECISION_RULES}"
)

MINUTES_TS_SYSTEM = (
    "너는 'Ghost', 회의 비서다. 아래 전사는 각 줄이 [mm:ss] 또는 [hh:mm:ss] 타임스탬프로 시작하는 "
    "'음성 파일' 전사다. 전체를 처음부터 끝까지 읽고 흐름을 이해한 뒤, 사람이 정리한 듯 상세하고 "
    "구조적인 회의록을 작성한다. 전사가 거칠어도 의미를 파악해 매끄럽게 정제한다. 전사에 쓰인 언어로 작성.\n"
    "줄에 [화자N] 라벨이 있으면 화자 분리가 된 전사다 — 발언·결정·액션아이템의 주체를 화자 기준으로 "
    "구분해 정리하고, 맥락상 이름을 알 수 있으면 '화자1(김OO)'처럼 병기한다(추측 단정 금지).\n"
    "★ 가장 중요: 회의록의 각 항목(요약 문장·논의 불릿·결정·액션) 끝에 그 내용이 '근거한' 음성 구간의 "
    "타임스탬프를 반드시 [mm:ss] 형식으로 붙인다. 예: '가격 정책을 월 3.9만원으로 확정 [12:34]'. "
    "여러 구간을 참고했으면 가장 핵심 구간 1개만. 타임스탬프는 전사에 실제로 나온 시각만 쓴다(지어내지 말 것).\n"
    "반드시 JSON 한 개만 출력: "
    '{"title": str, "spoken": str, "intent": "note", "blocks": [...]}\n'
    f"{ALLOWED_BLOCKS}\n"
    "blocks 권장 구성(heading 텍스트는 제목만):\n"
    "1) heading \"회의 요약\" → text: 핵심 결과 3~5문장 (각 문장 끝 [mm:ss])\n"
    "2) heading \"주요 논의\" → 안건별 heading(소제목) + list. 각 불릿 끝에 [mm:ss].\n"
    "3) heading \"결정 사항\" → list (각 항목 끝 [mm:ss])\n"
    "4) heading \"액션 아이템\" → table[담당 | 할 일 | 기한] 또는 list (가능하면 [mm:ss])\n"
    "5) (있으면) heading \"미해결·후속\" → list (각 항목 끝 [mm:ss])\n"
    "원칙: 전사에 실제로 있는 내용만. spoken: \"회의록 정리했어요\" 정도의 짧은 한마디(타임스탬프 없이).\n"
    "image/handwritten 블록은 쓰지 마라.\n"
    f"{WORKLOAD_DECISION_RULES}"
)

MINUTES_IMG_PROMPT = (
    "너는 회의 비서다. $imagegen (내장 이미지 생성, gpt-image-2)으로, 아래 회의를 "
    "손그림 스케치노트(sketchnote) 스타일의 가로형 인포그래픽으로 정리한 이미지를 만들어 "
    "정확히 다음 경로에 저장해: {path}\n\n"
    "스타일 (화이트보드에 손으로 그린 비주얼 회의록):\n"
    "- 가로형 와이드, 깨끗한 흰 배경, 검은 손글씨 + 포인트 색(주황·청록·연두)로 강조.\n"
    "- 맨 위 가운데: 둥근 박스/말풍선 안에 회의 제목, 우측에 날짜(달력 느낌).\n"
    "- 본문은 2~3열로 섹션을 나눠 배치. 각 섹션 = 손글씨 소제목 + 작은 아이콘/두들 + 불릿/체크박스.\n"
    "- 회의 내용에 맞춰 섹션을 구성(예: 일정·타임라인은 화살표 위 마일스톤, 핵심 논의/목표, "
    "역할·조직, 결정·합의는 체크박스 ✓, 리스크·후속 액션은 포스트잇 메모 느낌).\n"
    "- 화살표·밑줄·하이라이트·포스트잇 같은 손그림 요소로 시각적으로 정리. 빽빽하지 않게 여백 있게.\n"
    "- 회의에서 쓰인 언어로(한국어 회의면 한국어 손글씨). 핵심만 간결하게, 읽기 쉬운 또렷한 손글씨.\n"
    "저장만 하고 마지막엔 '완료'라고만 답해.\n\n[회의 전사]\n{transcript}"
)

PROACTIVE_SYSTEM = (
    "너는 'Ghost', 회의를 함께 듣는 비서다. 지금까지의 회의 흐름을 보고, 참석자에게 지금 도움이 될 "
    "한 가지를 스스로 만들어 띄운다: 관련 정보 정리, 미니 보고서, 논의 구조화, 비교표, 체크리스트, "
    "용어 정리 등 회의에 실질적으로 보탬이 되는 것. 최신 정보가 필요하면 웹을 쓴다.\n"
    "반드시 JSON 스펙(ACT와 동일 형식)으로 출력. spoken은 빈 문자열(무음). 회의 언어로. "
    "지금 굳이 만들 게 없으면 blocks를 비운다.\n"
    f"{WORKLOAD_DECISION_RULES}"
)

JUDGE_SYSTEM = (
    "너는 회의를 함께 듣는 비서 'Ghost'의 라우터다. 회의 대화를 들으며, 부르지 않아도 카드를 띄우는 게 "
    "'정말로' 도움이 되는 드문 순간만 포착한다. 회의의 기본 정리는 5분마다 자동 다이제스트가 따로 한다 — "
    "그러니 너는 **지금 즉시, 부르지 않았는데도 끼어들 만큼 가치 있는 순간**에만 action을 낸다.\n"
    '반드시 JSON만 출력: {"kind": "chat"|"action"|"none", "query": str, "say": str, "confidence": 0.0~1.0}\n'
    "- action (능동 개입, 보수적으로): 아래처럼 즉시 개입이 분명히 유익할 때만.\n"
    "  · 그룹에 명시적으로 던져졌으나 아무도 답 못 한 사실/수치 질문 ('작년 매출이 얼마였지?')\n"
    "  · 회의 진행을 막는 모르는 용어·약어가 나와 즉시 설명이 필요할 때\n"
    "  · 직전 카드/답변을 가리키며 다시 요청('그거 더 자세히/쉽게/비교해줘') → action\n"
    "  query: 수행할 구체적 작업을 한 문장으로(지시대명사 풀어서).\n"
    "  say: 시작 전 건넬 짧은 한마디.\n"
    "- chat: 비서에게 직접 말 거는 경우(인사·호명·'들려?'). say에 1~2문장.\n"
    "- none: 그 외 전부(일반 진행·논의·잡담·혼잣말). 기본값은 none이다.\n"
    "confidence: 부르지 않았는데도 지금 카드를 띄우는 게 도움될 확신도. 애매하면 0.3 이하. "
    "단순 진술·의견·논의는 0.1 이하. 진짜 명백한 미해결 질문만 0.8 이상.\n"
    "원칙: 의심스러우면 none. 과잉 개입은 회의를 방해한다. 다이제스트가 5분마다 정리하니 너는 인색하게."
)

CHAT_SYSTEM = (
    "너는 'Ghost', 사용자의 말을 상시 듣는 친근한 음성 비서다(자비스 같은). "
    "사용자가 너에게 직접 말을 걸었다. 한국어로 자연스럽고 짧게(1~2문장) 대화하듯 답한다. "
    "출처·URL·목록 없이, 말로 전할 내용만. 네가 상시 듣고 있으며 무엇이든 찾아줄 수 있음을 자연스럽게 드러내도 좋다."
)


@dataclass
class BrainConfig:
    backend: str = "codex"
    local_model: str = "gemma4:e4b"
    codex_model: Optional[str] = None
    cloud_model: str = "gpt-5.4-mini"
    reasoning_effort: str = "low"
    lang: str = "ko"  # 응답 언어 (ko|en|zh)


LANG_NAME = {"ko": "한국어", "en": "English", "zh": "中文(简体)"}


def _lang_line(cfg: "BrainConfig") -> str:
    return f"\n[출력 언어] 모든 텍스트(title·spoken·blocks·say)를 반드시 {LANG_NAME.get(cfg.lang, '한국어')}로 작성한다."


# codex exec에 노출되는 커넥터(MCP) 이름 캐시 — 매 턴 `codex mcp list` 호출을 피한다.
_MCP_CACHE: dict = {"t": 0.0, "names": []}


def _mcp_names(ttl: float = 300.0) -> list:
    """[mcp_servers]에 등록된 커넥터 이름 목록(TTL 캐시). 실패 시 빈 리스트."""
    now = time.time()
    if now - _MCP_CACHE["t"] > ttl:
        names: list = []
        try:
            r = subprocess.run(["codex", "mcp", "list"], capture_output=True, text=True, timeout=8)
            for raw in r.stdout.splitlines():
                s = raw.strip()
                if not s or s.lower().startswith("name"):
                    continue
                names.append(s.split()[0])
        except Exception:  # noqa: BLE001
            pass
        _MCP_CACHE.update(t=now, names=names)
    return _MCP_CACHE["names"]


def _tools_line(cfg: "BrainConfig") -> str:
    """codex 턴 프롬프트에 주입할 '지금 실제로 쓸 수 있는 도구' 인벤토리.

    모델이 도구 존재를 모르고 텍스트로만 답하는 문제를 줄인다 — 이름을 명시하면
    '커넥터로 조회하라'는 지시가 실행 가능한 구체 지시가 된다.
    """
    if cfg.backend != "codex":
        return ""
    conns = [n for n in _mcp_names() if n and n != "node_repl"]
    conn_txt = ", ".join(conns) if conns else "(등록된 커넥터 없음)"
    return (
        "\n[지금 이 턴에서 실제 호출 가능한 도구]\n"
        f"- web_search: 실시간 웹 검색\n- shell: 명령 실행(계산·파일·코드)\n- 커넥터(MCP): {conn_txt}\n"
        "사실 확인이 필요한 요청이면 답하기 전에 위 도구를 실제로 호출한다."
    )


# ── 유틸 ────────────────────────────────────────────────────────────────────
def _extract_json(text: str) -> Optional[dict]:
    """모델 출력에서 첫 번째 균형 잡힌 JSON 객체를 추출.

    문자열 리터럴 내부의 중괄호/이스케이프를 인식한다 — 응답에 코드 조각
    (`"code": "if (x) { ... }"`)이 있어도 brace 매칭이 어긋나지 않는다.
    """
    if not text:
        return None
    start = text.find("{")
    while start != -1:
        depth = 0
        in_str = False
        esc = False
        for i in range(start, len(text)):
            c = text[i]
            if in_str:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    in_str = False
                continue
            if c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start : i + 1])
                    except json.JSONDecodeError:
                        break
        start = text.find("{", start + 1)
    return None


def _ollama_json(system: str, user: str, model: str = JUDGE_MODEL, timeout: int = 60) -> Optional[dict]:
    payload = json.dumps({
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "stream": False,
        "format": "json",
        "options": {"temperature": 0.3},
    }).encode()
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/chat", data=payload, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            content = json.loads(resp.read())["message"]["content"]
        return _extract_json(content)
    except Exception:
        return None


def _ollama_text(system: str, user: str, model: str = JUDGE_MODEL, timeout: int = 60) -> str:
    payload = json.dumps({
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "stream": False,
        "options": {"temperature": 0.6},
    }).encode()
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/chat", data=payload, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())["message"]["content"].strip()
    except Exception:
        return ""


# ── codex / openai 경량 호출 (라우팅·대화용) ────────────────────────────────
def _codex_text(system: str, user: str, model: Optional[str] = None, timeout: int = 60) -> str:
    """codex로 짧은 텍스트 1개 생성 (웹검색 없이 빠르게).

    1순위: 상시 mcp-server 세션(프로세스 스폰 비용·토큰 레이스 제거, 호출당 ~1.3s↓ 실측).
    실패/비활성 시 기존 exec 경로로 자동 폴백.
    """
    from ghost_local import codex_session
    fast = codex_session.text(f"{system}\n\n{user}", model=model or "gpt-5.4-mini", timeout=float(timeout))
    if fast:
        return fast
    with tempfile.NamedTemporaryFile("r", suffix=".txt", delete=False) as f:
        out_path = Path(f.name)
    cmd = ["codex", "exec", "--skip-git-repo-check",
           "-c", 'model_reasoning_effort="low"',
           "-c", "mcp_servers={}",  # 분류·대화엔 도구 불필요 → 커넥터 로딩 생략(빠름)
           "--output-last-message", str(out_path)]
    # 분류는 가벼운 모델로 (없으면 codex 기본값). 답변 모델과 분리.
    cmd += ["-m", model or "gpt-5.4-mini"]
    cmd.append(f"{system}\n\n{user}")

    def _once() -> tuple[str, str]:
        p = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=timeout)
        out = out_path.read_text(encoding="utf-8") if out_path.exists() else ""
        return out, (p.stderr or "")

    try:
        raw, err = _once()
        # 토큰 레이스("refresh token already consumed")는 동시 codex 호출 시 드물게 발생 →
        # 잠깐 뒤 재시도하면 갱신된 토큰으로 성공. 동시 호출이 겹쳐도 한꺼번에 재충돌하지 않게
        # 지터를 섞은 백오프로 최대 2회. (직렬화 락 대신 retry로 처리해 병목 제거.)
        attempt = 0
        while not raw.strip() and _is_token_race(err) and attempt < 2:
            import random
            time.sleep(0.8 * (attempt + 1) + random.uniform(0, 0.6))
            raw, err = _once()
            attempt += 1
    except Exception:
        raw = ""
    finally:
        out_path.unlink(missing_ok=True)
    return raw.strip()


def _codex_json(system: str, user: str, model: Optional[str] = None, timeout: int = 60) -> Optional[dict]:
    """codex로 JSON 1개 생성."""
    return _extract_json(_codex_text(system, user + "\n\n반드시 JSON 한 개만 출력(설명 금지).", model, timeout))


def _openai_text(system: str, user: str, model: str = "gpt-5.4-mini", timeout: int = 60) -> str:
    try:
        from openai import OpenAI
        client = OpenAI()
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        )
        return (resp.choices[0].message.content or "").strip()
    except Exception:
        return ""


def _openai_json(system: str, user: str, model: str = "gpt-5.4-mini", timeout: int = 60) -> Optional[dict]:
    try:
        from openai import OpenAI
        client = OpenAI()
        resp = client.chat.completions.create(
            model=model, response_format={"type": "json_object"},
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        )
        return _extract_json(resp.choices[0].message.content or "")
    except Exception:
        return None


def _brain_json(system: str, user: str, cfg: "BrainConfig", timeout: int = 60) -> Optional[dict]:
    """설정된 백엔드로 JSON 분류. ollama 의존 제거(codex/openai 사용 가능)."""
    if cfg.backend == "ollama":
        return _ollama_json(system, user, model=cfg.local_model, timeout=timeout)
    if cfg.backend == "openai":
        return _openai_json(system, user, model=cfg.cloud_model, timeout=timeout)
    return _codex_json(system, user, model=None, timeout=timeout)  # 분류는 경량 모델 고정


def _ollama_text_stream(system: str, user: str, model: str = JUDGE_MODEL, timeout: int = 60):
    """Ollama 토큰 스트리밍 — message.content 델타를 하나씩 yield."""
    payload = json.dumps({
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "stream": True,
        "options": {"temperature": 0.3},
    }).encode()
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/chat", data=payload, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        for raw in resp:  # newline-delimited JSON
            line = raw.decode("utf-8").strip()
            if not line:
                continue
            try:
                o = json.loads(line)
            except json.JSONDecodeError:
                continue
            ch = (o.get("message") or {}).get("content")
            if ch:
                yield ch
            if o.get("done"):
                break


def _openai_text_stream(system: str, user: str, model: str = "gpt-5.4-mini", timeout: int = 60):
    """OpenAI 토큰 스트리밍 — delta.content를 하나씩 yield."""
    from openai import OpenAI
    client = OpenAI()
    stream = client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        stream=True,
    )
    for chunk in stream:
        try:
            ch = chunk.choices[0].delta.content
        except (IndexError, AttributeError):
            ch = None
        if ch:
            yield ch


def _brain_text_stream(system: str, user: str, cfg: "BrainConfig", timeout: int = 60):
    """설정된 백엔드로 토큰 스트리밍.

    · ollama / openai → 진짜 토큰 델타.
    · codex → exec가 토큰 델타를 내보내지 않으므로(item 단위만) 통짜 결과를 1청크로 yield(우아한 강등).
    """
    if cfg.backend == "ollama":
        yield from _ollama_text_stream(system, user, model=cfg.local_model, timeout=timeout)
        return
    if cfg.backend == "openai":
        yield from _openai_text_stream(system, user, model=cfg.cloud_model, timeout=timeout)
        return
    out = _codex_text(system, user, model=None, timeout=timeout)
    if out:
        yield out


def _brain_text(system: str, user: str, cfg: "BrainConfig", timeout: int = 60) -> str:
    if cfg.backend == "ollama":
        return _ollama_text(system, user, model=cfg.local_model, timeout=timeout)
    if cfg.backend == "openai":
        return _openai_text(system, user, model=cfg.cloud_model, timeout=timeout)
    return _codex_text(system, user, model=None, timeout=timeout)  # 대화는 경량 모델


# ── 라우팅 (chat / research / none) ─────────────────────────────────────────
import re as _re

# 검색/조회/작업을 강하게 시사하는 신호 → action (모델 없이 즉시)
_ACTION_RE = _re.compile(
    r"(\?|？"
    # 의문사 — 대체로 질문이라 단독으로도 action
    r"|무엇|무슨|뭣|뭔|어디|언제|누구|누가|얼마|며칠|몇|왜|어떻|어떤|어느|어찌"
    # '뭐'는 추임새와 겹치므로 질문/회상 어미가 붙을 때만 (뭐야/뭐였지/뭐더라/뭐랬…)
    r"|뭐\s*(야|예요|에요|냐|니|지|였|랬|더라|ㄴ지)"
    # 회상·간접물음 어미 (문장 끝 신호). 동사 과거(먹었지)는 제외, 명사 회상 '였지'만.
    r"|였지|이었지|더라|던가|던데|ㄹ까|을까|ㄹ래|는지|ㄴ지|은지|나요|까요|ㄴ가요|은가요"
    # 검색/작업 동사
    r"|찾아|검색|알려|조회|확인|정리|요약|번역|계산|만들|그려|뽑아|리서치|비교|분석|추천|예약|보내|작성|기억"
    # 영어
    r"|search|find|look ?up|google|what|where|when|who|how|why|which)",
    _re.IGNORECASE,
)
# 잡담/추임새 신호 → none
_FILLER = {"음", "어", "아", "그", "네", "응", "예", "오케이", "ok", "오케", "흠", "자",
           "그래", "그렇지", "맞아", "좋아", "알겠어", "알겠습니다", "ㅋㅋ", "ㅋㅋㅋ", "하하", "헐"}


def _heuristic_judge(utterance: str) -> Optional[dict]:
    """모델 없이 '명백한 none'만 즉시 거른다. 그 외(action 후보 포함)는 None→LLM이 confidence 채점.

    능동 개입은 보수적이어야 하므로(문턱 상향), action 신호가 있어도 휴리스틱이 단정하지 않고
    LLM judge로 넘겨 confidence를 받는다. 클라이언트가 그 confidence로 게이트한다.
    """
    t = (utterance or "").strip()
    if len(t) < 3:
        return {"kind": "none", "query": t, "say": "", "confidence": 0.0}
    # 추임새/짧은 잡담 — 액션 신호 없으면 확실한 none
    if t in _FILLER or (len(t) <= 6 and not _ACTION_RE.search(t)):
        return {"kind": "none", "query": t, "say": "", "confidence": 0.0}
    return None  # action 후보 포함 전부 LLM로 → confidence 채점


def _clamp01(v: Any, default: float = 0.5) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(1.0, f))


def judge(utterance: str, context: str = "", cfg: Optional["BrainConfig"] = None) -> dict:
    """발화를 chat/action/none + confidence(0~1)로 분류.

    명백한 none은 휴리스틱(0초). 그 외는 LLM이 보수적으로 채점 — 클라이언트가 confidence로 게이트한다.
    """
    cfg = cfg or BrainConfig()
    h = _heuristic_judge(utterance)
    if h is not None:
        return h
    user = (f"[최근 맥락]\n{context}\n\n" if context else "") + f"[방금 발화]\n{utterance}"
    out = _brain_json(JUDGE_SYSTEM + _lang_line(cfg), user, cfg, timeout=60) or {}
    kind = out.get("kind")
    if kind == "research":  # 구버전 호환
        kind = "action"
    if kind not in ("chat", "action", "none"):
        kind = "action" if utterance.strip().endswith("?") else "none"
    conf = _clamp01(out.get("confidence"), default=(0.6 if kind == "action" else 0.0))
    if kind != "action":
        conf = min(conf, 0.2)  # action이 아니면 개입 confidence는 낮게 고정
    return {
        "kind": kind,
        "query": (out.get("query") or utterance).strip(),
        "say": (out.get("say") or out.get("reply") or "").strip(),
        "confidence": conf,
    }


def index_connector(name: str, cfg: Optional["BrainConfig"] = None, timeout: int = 240) -> str:
    """codex가 해당 커넥터(MCP)로 지형을 열거하게 한다: 채널/페이지/스페이스 목록과 각 역할.

    결과 요약 텍스트를 반환(store에 저장 → 모든 회의 컨텍스트에 주입). codex 백엔드 전용.
    """
    cfg = cfg or BrainConfig()
    if cfg.backend != "codex":
        return ""
    with tempfile.NamedTemporaryFile("r", suffix=".txt", delete=False) as f:
        out_path = Path(f.name)
    prompt = (
        f"'{name}' 커넥터(연결된 MCP 도구)를 사용해, 이 워크스페이스의 지형을 한 번 조사해 정리해줘.\n"
        "- 주요 채널/페이지/스페이스/문서의 '목록'과 각각이 '무슨 용도'인지 한 줄씩.\n"
        "- 회의 중 정보를 어디서 찾으면 되는지 빠르게 파악할 수 있는 인덱스가 목적이야.\n"
        "- 너무 길지 않게 핵심만(최대 30줄). 실제 도구로 조회해서 사실만. 한국어 불릿으로."
    )
    cmd = [
        "codex", "exec", "--skip-git-repo-check",
        "-c", f'model_reasoning_effort="{cfg.reasoning_effort}"',
        "--output-last-message", str(out_path),
    ]
    if cfg.codex_model:
        cmd += ["-m", cfg.codex_model]
    cmd.append(prompt)
    try:
        subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=timeout)
        raw = out_path.read_text(encoding="utf-8") if out_path.exists() else ""
    except Exception:  # noqa: BLE001
        raw = ""
    finally:
        out_path.unlink(missing_ok=True)
    return raw.strip()


def translate(text: str, target_name: str, cfg: Optional["BrainConfig"] = None) -> str:
    """한 문장을 target 언어로 번역(인터뷰 모드용). 설정된 백엔드의 경량 텍스트 경로 사용."""
    text = (text or "").strip()
    if not text:
        return ""
    cfg = cfg or BrainConfig()
    sys = (f"Translate the user's text into {target_name}. "
           "Output ONLY the translation — no quotes, no notes, no original text.")
    return _brain_text(sys, text, cfg, timeout=30).strip()


def translate_stream(text: str, target_name: str, cfg: Optional["BrainConfig"] = None):
    """번역을 토큰 단위로 스트리밍(인터뷰 모드). ollama/openai는 진짜 델타, codex는 통짜 1청크."""
    text = (text or "").strip()
    if not text:
        return
    cfg = cfg or BrainConfig()
    sys = (f"Translate the user's text into {target_name}. "
           "Output ONLY the translation — no quotes, no notes, no original text.")
    yield from _brain_text_stream(sys, text, cfg, timeout=30)


def chat_reply(utterance: str, context: str = "", cfg: Optional["BrainConfig"] = None) -> dict:
    """직접 말 걸기에 대한 빠른 대화 응답. 설정된 백엔드 사용. GenUI 스펙으로 반환."""
    cfg = cfg or BrainConfig()
    user = (f"[최근 대화]\n{context}\n\n" if context else "") + f"[사용자]\n{utterance}"
    reply = _brain_text(CHAT_SYSTEM + _lang_line(cfg), user, cfg, timeout=60) or "네, 듣고 있어요. 무엇을 도와드릴까요?"
    return {
        "title": "Ghost",
        "spoken": reply,
        "intent": "answer",
        "blocks": [{"type": "text", "text": reply}],
    }


# ── 액션 수행 → GenUI 스펙 ──────────────────────────────────────────────────
def _normalize_spec(spec: Optional[dict], fallback_text: str) -> dict:
    if not isinstance(spec, dict):
        spec = {}
    # 모델이 spoken만 채우고 blocks를 비웠으면 spoken을 본문 블록으로 사용
    fallback = (spec.get("spoken") or "").strip() or fallback_text
    blocks = spec.get("blocks")
    if not isinstance(blocks, list) or not blocks:
        blocks = [{"type": "text", "text": fallback}]
    clean = []
    for b in blocks:
        if isinstance(b, dict) and isinstance(b.get("type"), str):
            clean.append(b)
    if not clean:
        clean = [{"type": "text", "text": fallback}]
    return {
        "title": (spec.get("title") or "Ghost").strip()[:80],
        "spoken": (spec.get("spoken") or "").strip(),
        "intent": spec.get("intent", "answer"),
        "blocks": clean,
    }


def _act_ollama(query: str, context: str, cfg: BrainConfig, system: str = ACT_SYSTEM) -> dict:
    user = (f"[맥락]\n{context}\n\n" if context else "") + f"[요청]\n{query}"
    spec = _ollama_json(system, user, model=cfg.local_model, timeout=120)
    return _normalize_spec(spec, fallback_text=query)


_GENUI_SCHEMA_PATH = Path(__file__).resolve().parent.parent / "genui_schema.json"


def _act_codex(query: str, context: str, cfg: BrainConfig, system: str = ACT_SYSTEM) -> dict:
    with tempfile.NamedTemporaryFile("r", suffix=".json", delete=False) as f:
        out_path = Path(f.name)
    cmd = [
        "codex", "exec", "--skip-git-repo-check",
        "-s", "workspace-write",  # 도구(shell·임시파일)가 실제로 동작하게 — 기본 read-only면 행동이 위축된다
        "-c", "tools.web_search=true",  # 웹검색·브라우저·MCP 커넥터 내장 활용
        "--output-last-message", str(out_path),
        "-c", f'model_reasoning_effort="{cfg.reasoning_effort}"',
    ]
    if _GENUI_SCHEMA_PATH.exists():
        cmd += ["--output-schema", str(_GENUI_SCHEMA_PATH)]
    if cfg.codex_model:
        cmd += ["-m", cfg.codex_model]
    prompt = f"{system}{_tools_line(cfg)}\n\n[맥락]\n{context}\n\n[요청]\n{query}"
    cmd.append(prompt)
    subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=240,
                   cwd=tempfile.gettempdir())
    raw = out_path.read_text(encoding="utf-8") if out_path.exists() else ""
    out_path.unlink(missing_ok=True)
    fallback = raw.strip() if (raw and not raw.lstrip().startswith("{")) else query
    return _normalize_spec(_extract_json(raw), fallback_text=fallback)


def _act_openai(query: str, context: str, cfg: BrainConfig, system: str = ACT_SYSTEM) -> dict:
    from openai import OpenAI

    client = OpenAI()
    resp = client.chat.completions.create(
        model=cfg.cloud_model,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": (f"[맥락]\n{context}\n\n" if context else "") + f"[요청]\n{query}"},
        ],
    )
    return _normalize_spec(_extract_json(resp.choices[0].message.content or ""), fallback_text=query)


def act(query: str, context: str = "", cfg: Optional[BrainConfig] = None, system: str = ACT_SYSTEM) -> dict:
    """비스트리밍 턴 실행. 어댑터 레지스트리 경유(opencode/hermes 포함 모든 백엔드 지원)."""
    cfg = cfg or BrainConfig()
    from ghost_local.adapters import get_adapter  # 지연 import(순환 회피)
    return get_adapter(cfg.backend).run(query, context, cfg, system)


# ── 진행 상황 라벨링 (codex --json 이벤트 → 사람이 읽는 한 줄) ─────────────────
# 커넥터(MCP server) 한글 표시명. 없으면 server 이름 그대로 사용.
_CONNECTOR_KO = {
    "node_repl": "코드·브라우저",
    "browser": "브라우저",
    "slack": "Slack",
    "github": "GitHub",
    "hugging-face": "Hugging Face",
    "atlassian": "Atlassian",
    "atlassian-rovo": "Atlassian",
    "confluence": "Confluence",
    "jira": "Jira",
    "documents": "문서",
    "spreadsheets": "스프레드시트",
    "presentations": "프레젠테이션",
    "notion": "Notion",
    "google-drive": "Google Drive",
    "gmail": "Gmail",
    "linear": "Linear",
}


def _short(s: str, n: int = 52) -> str:
    """진행 표시용으로 한 줄로 줄인다."""
    s = " ".join(str(s).split())
    return s if len(s) <= n else s[: n - 1] + "…"


def _mcp_label(item: dict) -> str:
    """mcp_tool_call 이벤트 → 'Hugging Face · bert 모델 검색' 같은 구체 라벨."""
    server = item.get("server") or ""
    tool = item.get("tool") or ""
    args = item.get("arguments") if isinstance(item.get("arguments"), dict) else {}
    name = _CONNECTOR_KO.get(server, server or "커넥터")
    # codex MCP 호출은 보통 arguments.title에 사람이 읽는 요약을 담는다.
    hint = (
        args.get("title") or args.get("summary") or args.get("description")
        or args.get("query") or args.get("q") or args.get("search")
        or args.get("name") or args.get("channel") or args.get("path")
        or args.get("url") or args.get("repo")
    )
    if hint:
        return f"{name} · {_short(hint)}"
    if tool and tool not in ("js", "python", "run"):
        return f"{name} · {tool}"
    return f"{name} 사용 중…"


def _friendly_error(msg: str) -> str:
    """codex turn 실패 메시지를 사용자용 안내로 변환."""
    m = (msg or "").lower()
    if any(k in m for k in ("refresh", "sign in", "log out", "logout", "401", "unauthorized", "token")):
        return "Codex 로그인이 만료됐어요. 터미널에서 `codex login`으로 다시 로그인한 뒤 시도해 주세요."
    return f"작업을 완료하지 못했어요: {msg}"


def _command_full(item: dict) -> str:
    """command_execution / local_shell_call의 전체 명령 문자열(자르지 않음)."""
    cmd = item.get("command")
    if isinstance(cmd, list):
        cmd = " ".join(str(c) for c in cmd)
    if not cmd:
        args = item.get("arguments") if isinstance(item.get("arguments"), dict) else {}
        cmd = args.get("command") or args.get("cmd") or ""
    return str(cmd or "").strip()


def _command_label(item: dict) -> str:
    """command_execution / local_shell_call → '실행: <명령>'."""
    cmd = _command_full(item)
    return f"실행: {_short(cmd)}" if cmd else "명령 실행 중…"


def act_stream(query: str, context: str = "", cfg: Optional[BrainConfig] = None, system: str = ACT_SYSTEM):
    """스트리밍 턴 실행 디스패처 — 어댑터 레지스트리 경유. yield ("progress",…) / ("result", spec)."""
    cfg = cfg or BrainConfig()
    from ghost_local.adapters import get_adapter  # 지연 import(순환 회피)
    yield from get_adapter(cfg.backend).run_stream(query, context, cfg, system)


def codex_act_stream(query: str, context: str = "", cfg: Optional[BrainConfig] = None, system: str = ACT_SYSTEM):
    """Codex 전용 스트리밍 구현 — --json 이벤트(웹검색·도구호출)를 실시간 진행으로 흘린다.

    CodexAdapter가 이 함수를 래핑한다. (act_stream에서 분리해 어댑터 재귀를 끊는다.)
    """
    cfg = cfg or BrainConfig()

    cmd = [
        "codex", "exec", "--json", "--skip-git-repo-check",
        "-s", "workspace-write",  # 도구(shell·임시파일)가 실제로 동작하게
        "-c", "tools.web_search=true",
        "-c", f'model_reasoning_effort="{cfg.reasoning_effort}"',
    ]
    if _GENUI_SCHEMA_PATH.exists():
        cmd += ["--output-schema", str(_GENUI_SCHEMA_PATH)]
    if cfg.codex_model:
        cmd += ["-m", cfg.codex_model]
    cmd.append(f"{system}{_tools_line(cfg)}{_lang_line(cfg)}\n\n[맥락]\n{context}\n\n[요청]\n{query}")

    proc = subprocess.Popen(
        cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL, text=True, bufsize=1, cwd=tempfile.gettempdir(),
    )
    final_text = ""
    error_msg: Optional[str] = None
    seen: set[str] = set()

    def emit(text: str, kind: Optional[str] = None, id: Optional[str] = None,
             full: Optional[str] = None, status: Optional[str] = None):
        """진행 이벤트를 객체로 방출. 명령은 id+status로, 그 외는 text로 중복 제거."""
        key = f"{id}:{status}" if id else text
        if not text or key in seen:
            return None
        seen.add(key)
        p: dict = {"text": text}
        if kind:
            p["kind"] = kind
        if id:
            p["id"] = id
        if full:
            p["full"] = full
        if status:
            p["status"] = status
        return ("progress", p)

    try:
        for line in proc.stdout or []:
            line = line.strip()
            if not line or not line.startswith("{"):
                continue
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            etype = e.get("type")
            item = e.get("item", {}) if isinstance(e.get("item"), dict) else {}
            it = item.get("type")
            if etype in ("error", "turn.failed", "stream.error"):
                error_msg = e.get("message") or (e.get("error") or {}).get("message") or "작업 실패"
                continue
            if etype == "turn.completed":
                # 이 앱이 쓴 토큰을 누적(사용량 대시보드용). 실패해도 무시.
                try:
                    from ghost_local import usage
                    usage.record_codex(cfg.codex_model, e.get("usage") or {})
                except Exception:  # noqa: BLE001
                    pass
                continue
            if etype not in ("item.started", "item.completed"):
                continue

            out = None
            if it == "mcp_tool_call":
                # 인자(title/query 등)는 시작 시점에 이미 있다 → started에서 구체 라벨.
                if etype == "item.started":
                    out = emit(_mcp_label(item))
                elif item.get("status") == "failed":
                    out = emit(f"{_mcp_label(item)} — 실패, 다른 방법 시도")
            elif it == "web_search":
                # query는 completed에서 채워진다.
                if etype == "item.completed":
                    q = item.get("query") or (item.get("action") or {}).get("query") or ""
                    out = emit(f"웹 검색: {_short(q)}" if q else "웹 검색 중…")
            elif it in ("command_execution", "local_shell_call"):
                full = _command_full(item)
                if etype == "item.started":
                    out = emit(_command_label(item), kind="command", id=item.get("id"), full=full, status="running")
                elif etype == "item.completed":
                    st = "failed" if item.get("status") == "failed" else "done"
                    out = emit(_command_label(item), kind="command", id=item.get("id"), full=full, status=st)
            elif it == "file_search":
                if etype == "item.started":
                    out = emit("파일 검색 중…")
            elif it == "reasoning":
                # 추론 요약 텍스트가 있으면 그대로(짧게) 보여준다.
                if etype == "item.completed":
                    txt = item.get("text") or item.get("summary") or ""
                    out = emit(f"💭 {_short(txt)}" if txt else "생각하는 중…")
            elif it == "agent_message" and etype == "item.completed":
                txt = (item.get("text") or "").strip()
                final_text = txt or final_text
                # 최종 결과는 JSON(스키마) → 자연어 중간 멘트만 진행으로 노출.
                if txt and not txt.lstrip().startswith("{"):
                    out = emit(_short(txt, 64))
            if out:
                yield out
        proc.wait(timeout=240)
    except Exception as ex:  # noqa: BLE001 — 타임아웃 등은 우아하게 강등(예외 전파 금지)
        error_msg = error_msg or str(ex)
    finally:
        if proc.poll() is None:
            proc.kill()

    spec = _extract_json(final_text)
    if spec is None and error_msg:
        # turn 실패(예: codex 로그인 만료) → 질문을 echo하지 말고 솔직히 알린다.
        yield ("result", {
            "title": "응답 실패",
            "spoken": "",
            "intent": "none",
            "blocks": [{"type": "callout", "value": "error", "text": _friendly_error(error_msg)}],
        })
        return
    # JSON이 없으면 모델이 실제로 한 말(final_text)을 본문으로. 그것도 없으면 질문.
    fallback = final_text.strip() if (final_text and not final_text.lstrip().startswith("{")) else query
    yield ("result", _normalize_spec(spec, fallback_text=fallback))


def _spec_has_content(spec: Optional[dict]) -> bool:
    """회의록/카드 spec에 '진짜 내용'이 있는지 — 빈 blocks나 에러 callout뿐이면 False."""
    if not isinstance(spec, dict):
        return False
    blocks = spec.get("blocks")
    if not isinstance(blocks, list) or not blocks:
        return False
    return not all(
        isinstance(b, dict) and b.get("type") == "callout" and b.get("value") in ("error", "warn")
        for b in blocks
    )


def minutes_stream(transcript: str, cfg: Optional[BrainConfig] = None, context: str = "",
                   system: Optional[str] = None, with_image: bool = True):
    """회의록 생성: AI 백엔드가 전사 전체를 이해해 상세 회의록 JSON을 만든다.

    system: 회의록 시스템 프롬프트(기본 MINUTES_SYSTEM, 음성파일은 MINUTES_TS_SYSTEM 전달).
    with_image: codex 손글씨 스케치노트 첨부 여부(음성파일 모드는 False 권장)."""
    cfg = cfg or BrainConfig()
    system = system or MINUTES_SYSTEM
    ctx_block = (f"[회의 배경(사용자 제공) — 고유명사·맥락 참고]\n{context}\n\n" if context.strip() else "")
    user_input = f"{ctx_block}[회의 전사 전체]\n{transcript}"
    query = "아래 회의 전사를 처음부터 끝까지 이해한 뒤, 주제별로 상세 회의록을 작성해줘."

    # 1) 구조화 회의록 — act_stream을 그대로 흘려보내 codex의 중간 과정(웹검색·커넥터·명령)이
    #    카드에 실시간 표시된다. (이전엔 블로킹 act()라 '정리 중…' 한 줄만 보였다.)
    yield ("progress", "회의록 정리 중…")
    spec: Optional[dict] = None
    for kind, payload in act_stream(query, user_input, cfg, system):
        if kind == "progress":
            yield ("progress", payload)
        elif kind == "result":
            spec = payload
    if not _spec_has_content(spec):
        # 일시 오류(토큰 레이스·타임아웃 등)로 빈 회의록이 나오면 한 번 재시도 — 빈 minutes.json 저장 방지.
        yield ("progress", "회의록이 비어 다시 정리 중…")
        retry: Optional[dict] = None
        for kind, payload in act_stream(query, user_input, cfg, system):
            if kind == "progress":
                yield ("progress", payload)
            elif kind == "result":
                retry = payload
        if _spec_has_content(retry):
            spec = retry
    spec = spec if isinstance(spec, dict) else {}
    spec["title"] = spec.get("title") or "회의록"
    yield ("result", spec)  # ← 텍스트 회의록 먼저 표시(클라이언트 타임아웃 해제)

    if not with_image or cfg.backend != "codex" or not _spec_has_content(spec):
        return

    # 2) 손글씨 이미지(느림·불안정)는 best-effort로 뒤에 붙여 두 번째 result로 갱신.
    yield ("progress", "손글씨 회의록 그리는 중…")
    img_path = os.path.join(tempfile.gettempdir(), f"ghost_minutes_{os.getpid()}_{abs(hash(transcript)) % 100000}.png")
    try:
        if os.path.exists(img_path):
            os.unlink(img_path)
        img_prompt = MINUTES_IMG_PROMPT.format(path=img_path, transcript=transcript)
        # 기본 샌드박스(read-only)는 PNG를 쓸 수 없어 이미지가 조용히 사라졌다 →
        # workspace-write + tmp cwd로 실제 저장이 가능하게 한다.
        subprocess.run(
            ["codex", "exec", "--skip-git-repo-check", "-s", "workspace-write",
             "-c", 'model_reasoning_effort="medium"', img_prompt],
            stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=240,
            cwd=tempfile.gettempdir(),
        )
        if os.path.exists(img_path) and os.path.getsize(img_path) > 1000:
            data = base64.b64encode(open(img_path, "rb").read()).decode()
            spec.setdefault("blocks", [])
            spec["blocks"].append({"type": "heading", "text": "손글씨 정리"})
            spec["blocks"].append({"type": "image", "url": f"data:image/png;base64,{data}", "label": "Ghost 손글씨 회의록"})
            yield ("result", spec)  # ← 이미지 포함해 카드 갱신
        else:
            yield ("progress", "손글씨 이미지는 이번엔 만들지 못했어요(회의록은 완료)")
    except Exception:  # noqa: BLE001
        pass  # 이미지는 부가 기능 — 실패해도 텍스트 회의록은 이미 전달됨
