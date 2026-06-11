"""실행 로그 모듈.

터미널 출력과 파일 로그를 함께 처리하는 단순 로거.
output/run_log_{YYYY-MM-DD_HHMMSS}.txt 형태로 로그를 저장한다.
"""

from __future__ import annotations

import os
from datetime import datetime


class RunLogger:
    """실행 로그를 터미널과 파일에 동시에 기록한다."""

    def __init__(self, output_dir: str):
        os.makedirs(output_dir, exist_ok=True)
        timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
        self.log_path = os.path.join(output_dir, f"run_log_{timestamp}.txt")
        self._buffer: list[str] = []

    def log(self, message: str = "") -> None:
        """메시지를 터미널에 출력하고 내부 버퍼에 쌓는다."""
        print(message)
        self._buffer.append(message)

    def flush(self) -> None:
        """버퍼 내용을 로그 파일에 기록한다."""
        try:
            with open(self.log_path, "w", encoding="utf-8") as f:
                f.write("\n".join(self._buffer) + "\n")
        except OSError as exc:
            # 로그 저장 실패가 전체 실행을 막지는 않도록 한다.
            print(f"[경고] 로그 파일 저장 실패: {exc}")
