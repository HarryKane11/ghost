"""Ghost 엔드투엔드 데모 — 모의 회의를 실제 백엔드로 흘려보낸다."""

from __future__ import annotations

import base64
import json
import urllib.request

BASE = "http://localhost:8765"


def _post(path: str, body: dict):
    req = urllib.request.Request(
        BASE + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}
    )
    return urllib.request.urlopen(req, timeout=400)


def post_json(path: str, body: dict) -> dict:
    return json.loads(_post(path, body).read())


def stream(path: str, body: dict, on):
    resp = _post(path, body)
    buf = b""
    for chunk in resp:
        buf += chunk
        while b"\n\n" in buf:
            ev, buf = buf.split(b"\n\n", 1)
            event, data = "message", ""
            for line in ev.decode("utf-8", "ignore").split("\n"):
                if line.startswith("event:"):
                    event = line[6:].strip()
                elif line.startswith("data:"):
                    data += line[5:].strip()
            if data:
                try:
                    on(event, json.loads(data))
                except json.JSONDecodeError:
                    pass


MEETING = [
    "자 오늘은 우리 신제품 스마트 스피커 '고스트 미니' 출시 일정을 정하죠.",
    "근데 그 시장 작년 국내 규모가 대략 얼마였는지 기억나세요?",
    "출시는 다음 달 셋째 주로 하고, 김대리가 티저 영상 준비해주세요. 마감은 출시 2주 전까지요.",
]


def main() -> None:
    transcript: list[str] = []
    for u in MEETING:
        transcript.append(u)
        print(f"\n🗣  {u}")
        r = post_json("/api/route", {"text": u, "context": "\n".join(transcript[-8:-1])})
        kind = r.get("kind")
        print(f"   route → {kind}" + (f" · query: {r.get('query')}" if kind == "action" else ""))
        if kind == "action":
            print("   ▶ 액션 (회의 전체 맥락 전달):")

            def on(ev, d):
                if ev == "progress":
                    print("      …", d.get("text"))
                elif ev == "result":
                    sp = d["spec"]
                    print("      ✓ blocks:", [b.get("type") for b in sp.get("blocks", [])])
                    print("      ✓ spoken:", (sp.get("spoken") or "")[:90])
                    for b in sp.get("blocks", []):
                        if b.get("type") == "stat":
                            print(f"        · {b.get('label')}: {b.get('value')}")
                        if b.get("type") == "link":
                            print(f"        · 출처: {b.get('label')} {b.get('url')}")

            stream("/api/act/stream", {"query": r.get("query") or u, "context": "\n".join(transcript)}, on)
        elif kind == "chat":
            print("   💬", r.get("say"))

    print("\n📋 회의 종료 → 회의록 생성 (codex 손글씨 이미지 포함)…")

    def onm(ev, d):
        if ev == "progress":
            print("   …", d.get("text"))
        elif ev == "result":
            sp = d["spec"]
            print("   ✓ minutes blocks:", [b.get("type") for b in sp.get("blocks", [])])
            for b in sp.get("blocks", []):
                if b.get("type") == "list":
                    for it in b.get("items", []):
                        print("      -", it)
                if b.get("type") == "image":
                    open("/tmp/ghost_demo_minutes.png", "wb").write(
                        base64.b64decode(b["url"].split(",", 1)[1])
                    )
                    print("   🖼  손글씨 회의록 저장 → /tmp/ghost_demo_minutes.png")

    stream("/api/minutes/stream", {"transcript": "\n".join(transcript)}, onm)
    print("\n=== DEMO 완료 ===")


if __name__ == "__main__":
    main()
