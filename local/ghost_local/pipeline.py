"""엔드투엔드 로컬 파이프라인 (CLI 데모).

오디오 → STT(Qwen3-ASR) → Brain.act(GenUI 스펙) → TTS(Supertonic, spoken만)
"""

from __future__ import annotations

import argparse
import json
import time

from ghost_local import brain, stt, tts


def run(audio_path: str, backend: str = "ollama", speak: bool = True) -> dict:
    t = {}
    cfg = brain.BrainConfig(backend=backend)

    t0 = time.time()
    transcript = stt.transcribe(audio_path)
    t["stt_s"] = round(time.time() - t0, 2)

    t0 = time.time()
    verdict = brain.judge(transcript)
    t["judge_s"] = round(time.time() - t0, 2)

    spec = None
    if verdict["act"]:
        t0 = time.time()
        spec = brain.act(verdict["query"], "", cfg)
        t["act_s"] = round(time.time() - t0, 2)
        if speak and spec.get("spoken"):
            tts.speak(spec["spoken"], out_path="/tmp/ghost_answer.wav")

    return {"transcript": transcript, "verdict": verdict, "spec": spec, "timings": t}


def main() -> None:
    ap = argparse.ArgumentParser(description="Ghost 로컬 파이프라인 데모")
    ap.add_argument("audio")
    ap.add_argument("--backend", default="ollama", choices=["ollama", "codex", "openai"])
    ap.add_argument("--no-speak", action="store_true")
    args = ap.parse_args()
    r = run(args.audio, backend=args.backend, speak=not args.no_speak)
    print("─" * 56)
    print(f"🎙  전사 : {r['transcript']}")
    print(f"⚖️  판단 : act={r['verdict']['act']}  query={r['verdict']['query']}")
    if r["spec"]:
        print(f"👻 spoken: {r['spec']['spoken']}")
        print(f"🧩 blocks: {json.dumps(r['spec']['blocks'], ensure_ascii=False)[:300]}…")
    print(f"⏱  {r['timings']}")
    print("─" * 56)


if __name__ == "__main__":
    main()
