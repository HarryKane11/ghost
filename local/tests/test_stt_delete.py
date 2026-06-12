"""stt.delete_model 테스트 — 모델 캐시 삭제(이슈 #20)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ghost_local import stt  # noqa: E402


@pytest.fixture()
def fake_cache(tmp_path, monkeypatch):
    """HF 캐시를 임시 폴더로 돌리고 모델 하나를 받아둔 것처럼 꾸민다."""
    def _dir(repo: str) -> Path:
        return tmp_path / ("models--" + repo.replace("/", "--"))

    monkeypatch.setattr(stt, "_hf_cache_dir", _dir)
    repo = "mlx-community/Qwen3-ASR-1.7B-bf16"
    d = _dir(repo) / "snapshots" / "abc"
    d.mkdir(parents=True)
    (d / "model.safetensors").write_bytes(b"x" * 1024)
    return repo


def test_delete_removes_cache_and_reports_freed_bytes(fake_cache, monkeypatch):
    # Given: 캐시에 받아둔 모델
    repo = fake_cache
    assert stt._dir_size(stt._hf_cache_dir(repo)) == 1024
    # When: 삭제
    out = stt.delete_model(repo)
    # Then: 디렉터리가 사라지고 회수 용량이 보고된다
    assert out == {"ok": True, "deleted": True, "freed_bytes": 1024}
    assert not stt._hf_cache_dir(repo).exists()


def test_delete_missing_model_is_noop(fake_cache):
    # Given: 받은 적 없는 모델
    # When: 삭제 요청
    out = stt.delete_model("mlx-community/whisper-large-v3-mlx")
    # Then: 에러 없이 no-op
    assert out == {"ok": True, "deleted": False, "freed_bytes": 0}


def test_delete_rejects_empty_id(fake_cache):
    assert stt.delete_model("")["ok"] is False
    assert stt.delete_model("  ")["ok"] is False


def test_delete_rejects_model_while_downloading(fake_cache, monkeypatch):
    # Given: 해당 repo가 다운로드 중
    repo = fake_cache
    monkeypatch.setitem(stt._DL, "state", "downloading")
    monkeypatch.setitem(stt._DL, "repo", repo)
    # When/Then: 삭제 거부, 파일은 그대로
    out = stt.delete_model(repo)
    assert out["ok"] is False and out["error"] == "downloading"
    assert stt._hf_cache_dir(repo).exists()


def test_delete_other_model_while_downloading_is_allowed(fake_cache, monkeypatch):
    # Given: 다른 repo가 다운로드 중
    repo = fake_cache
    monkeypatch.setitem(stt._DL, "state", "downloading")
    monkeypatch.setitem(stt._DL, "repo", "mlx-community/parakeet-tdt-0.6b-v3")
    # When/Then: 받는 중이 아닌 모델은 삭제 가능
    assert stt.delete_model(repo)["ok"] is True
    assert not stt._hf_cache_dir(repo).exists()


def test_delete_active_model_resets_download_state(fake_cache, monkeypatch):
    # Given: 삭제 대상이 활성 모델이고 이전 다운로드가 done 상태
    repo = fake_cache
    monkeypatch.setitem(stt._active, "model", repo)
    monkeypatch.setitem(stt._DL, "state", "done")
    # When: 삭제
    assert stt.delete_model(repo)["ok"] is True
    # Then: 다운로드 상태가 idle로 돌아가 UI가 '미다운로드'로 표시된다
    assert stt._DL["state"] == "idle"


def test_hf_cache_dir_fallback_respects_env(tmp_path, monkeypatch):
    """huggingface_hub 미설치 fallback이 HF_HUB_CACHE·HF_HOME을 존중하는지.

    이전엔 fallback이 무조건 ~/.cache를 가리켜, 테스트·커스텀 캐시 환경에서
    실제 사용자 캐시를 잘못 삭제할 수 있었다.
    """
    import builtins
    real_import = builtins.__import__

    def _no_hf(name, *a, **k):
        if name.startswith("huggingface_hub"):
            raise ImportError(name)
        return real_import(name, *a, **k)

    monkeypatch.setattr(builtins, "__import__", _no_hf)
    # Given: HF_HUB_CACHE가 설정된 환경
    monkeypatch.setenv("HF_HUB_CACHE", str(tmp_path / "custom-cache"))
    monkeypatch.delenv("HF_HOME", raising=False)
    # When/Then: fallback이 env 경로를 쓴다
    assert stt._hf_cache_dir("a/b") == tmp_path / "custom-cache" / "models--a--b"
    # Given: HF_HOME만 설정된 환경
    monkeypatch.delenv("HF_HUB_CACHE")
    monkeypatch.setenv("HF_HOME", str(tmp_path / "hf-home"))
    # When/Then: HF_HOME/hub을 쓴다
    assert stt._hf_cache_dir("a/b") == tmp_path / "hf-home" / "hub" / "models--a--b"


def test_delete_resolves_repo_alias(tmp_path, monkeypatch):
    # Given: id와 repo가 다른 모델(whisperx-large-v3 → Systran/faster-whisper-large-v3)
    def _dir(repo: str) -> Path:
        return tmp_path / ("models--" + repo.replace("/", "--"))
    monkeypatch.setattr(stt, "_hf_cache_dir", _dir)
    real = _dir("Systran/faster-whisper-large-v3")
    real.mkdir(parents=True)
    (real / "f.bin").write_bytes(b"x" * 10)
    # When: 모델 id로 삭제
    out = stt.delete_model("whisperx-large-v3")
    # Then: 실제 repo 캐시가 지워진다
    assert out["ok"] is True and out["deleted"] is True
    assert not real.exists()
