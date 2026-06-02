"""STT 벤치마크 — Qwen3-ASR 0.6B vs Whisper large-v3 (한국어 CER)."""

from __future__ import annotations

import re
import time

import mlx_whisper

from ghost_local import stt, tts

WHISPER_REPO = "mlx-community/whisper-large-v3-mlx"

SENTENCES = [
    "이번 분기 매출은 작년 대비 약 이십삼 퍼센트 증가했습니다",
    "다음 주 화요일까지 김민수 대리가 보고서를 제출하기로 했습니다",
    "HBM과 GPU 수요가 늘면서 엔비디아 실적이 크게 좋아졌어요",
    "회의록을 정리해서 노션에 업로드하고 슬랙으로 공유해 주세요",
    "그 시장의 연평균 성장률이 십팔 점 오 퍼센트로 추정됩니다",
    "API 응답이 느려서 캐싱 레이어를 추가하기로 결정했습니다",
]


def norm(s: str) -> str:
    return re.sub(r"[\s.,!?·…]", "", s).lower()


def cer(ref: str, hyp: str) -> float:
    r, h = norm(ref), norm(hyp)
    if not r:
        return 0.0
    # Levenshtein
    dp = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, dp[0] = dp[0], i
        for j in range(1, len(h) + 1):
            cur = dp[j]
            dp[j] = min(dp[j] + 1, dp[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
            prev = cur
    return dp[len(h)] / len(r)


def whisper_tx(path: str) -> str:
    r = mlx_whisper.transcribe(path, path_or_hf_repo=WHISPER_REPO, language="ko")
    return (r.get("text") or "").strip()


def main() -> None:
    rows = []
    q_total = w_total = 0.0
    qt = wt = 0.0
    print("오디오 생성 + 전사 중...\n")
    for i, sent in enumerate(SENTENCES, 1):
        wav = f"/tmp/bench_{i}.wav"
        tts.speak(sent, out_path=wav)

        t = time.time(); q = stt.transcribe(wav); qt += time.time() - t
        t = time.time(); w = whisper_tx(wav); wt += time.time() - t

        qc, wc = cer(sent, q), cer(sent, w)
        q_total += qc; w_total += wc
        rows.append((sent, q, qc, w, wc))
        print(f"[{i}] 정답: {sent}")
        print(f"    Qwen0.6B (CER {qc*100:4.1f}%): {q}")
        print(f"    Whisper  (CER {wc*100:4.1f}%): {w}\n")

    n = len(SENTENCES)
    print("=" * 60)
    print(f"평균 CER  | Qwen3-ASR 0.6B: {q_total/n*100:5.2f}%   Whisper large-v3: {w_total/n*100:5.2f}%")
    print(f"총 전사시간| Qwen3-ASR 0.6B: {qt:5.1f}s     Whisper large-v3: {wt:5.1f}s")
    print("=" * 60)


if __name__ == "__main__":
    main()
