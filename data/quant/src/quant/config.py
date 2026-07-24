"""路径配置。"""

from __future__ import annotations

import os
from pathlib import Path


def repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def warehouse_dir() -> Path:
    override = os.environ.get("CHEMBRIDGE_WAREHOUSE")
    if override:
        return Path(override).expanduser().resolve()
    return (repo_root() / "data" / "warehouse").resolve()


DEFAULT_DELIVERY_PERIOD = "现货"
