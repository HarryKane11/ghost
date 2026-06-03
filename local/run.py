"""PyInstaller 진입점 — 프리즈된 단일 실행 백엔드.

데스크탑 앱이 이 실행 파일을 직접 띄운다(사용자 PC에 Python/uv 불필요).
uvicorn을 코드로 구동. 포트는 GHOST_PORT(기본 8765)."""

import os

import uvicorn

from server import app


def main() -> None:
    port = int(os.environ.get("GHOST_PORT", "8765"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
