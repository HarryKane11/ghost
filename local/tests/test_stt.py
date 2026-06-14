"""stt 모델 캐시 관리 테스트."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ghost_local import stt  # noqa: E402


def test_delete_model_removes_hf_cache(tmp_path, monkeypatch):
    def cache_dir(repo: str) -> Path:
        return tmp_path / ("models--" + repo.replace("/", "--"))

    monkeypatch.setattr(stt, "_hf_cache_dir", cache_dir)
    target = cache_dir("mlx-community/Qwen3-ASR-1.7B-bf16")
    (target / "snapshots" / "abc").mkdir(parents=True)
    (target / "snapshots" / "abc" / "model.safetensors").write_bytes(b"1234")

    result = stt.delete_model("mlx-community/Qwen3-ASR-1.7B-bf16")

    assert result["ok"] is True
    assert result["repo"] == "mlx-community/Qwen3-ASR-1.7B-bf16"
    assert result["deleted"] == 4
    assert not target.exists()


def test_delete_model_is_idempotent(tmp_path, monkeypatch):
    monkeypatch.setattr(stt, "_hf_cache_dir", lambda repo: tmp_path / repo.replace("/", "--"))

    result = stt.delete_model("mlx-community/parakeet-tdt-0.6b-v3")

    assert result["ok"] is True
    assert result["deleted"] == 0
    assert result["present"] is False
