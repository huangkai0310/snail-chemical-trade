"""路径与 API 配置。"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def repo_root() -> Path:
    """data/crawler/src/crawler/config.py → 仓库根。"""
    return Path(__file__).resolve().parents[4]


def warehouse_dir() -> Path:
    override = os.environ.get("CHEMBRIDGE_WAREHOUSE")
    if override:
        return Path(override).expanduser().resolve()
    return (repo_root() / "data" / "warehouse").resolve()


def api_base() -> str:
    return os.environ.get("CHEMBRIDGE_API_BASE", "https://api.snailchemical.com").rstrip("/")


# ── PostgreSQL 连接配置 ─────────────────────────────────────
@dataclass(frozen=True)
class PGConfig:
    host: str
    port: int
    user: str
    password: str
    database: str
    sslmode: str = "disable"


def pg_config() -> PGConfig:
    """从环境变量读取 PostgreSQL 连接参数。

    环境变量 (兼容 Go 后端 DATABASE_URL 中的参数命名):
        CHEMBRIDGE_PG_HOST     (默认 127.0.0.1)
        CHEMBRIDGE_PG_PORT     (默认 5432)
        CHEMBRIDGE_PG_USER     (默认 snailtrade)
        CHEMBRIDGE_PG_PASSWORD (默认 snailtrade2024)
        CHEMBRIDGE_PG_DATABASE (默认 snailtrade)
        CHEMBRIDGE_PG_SSLMODE  (默认 disable)

    也可通过 CHEMBRIDGE_DATABASE_URL 一次性配置:
        postgres://user:pass@host:port/db?sslmode=disable
    """
    db_url = os.environ.get("CHEMBRIDGE_DATABASE_URL")
    if db_url:
        return _parse_db_url(db_url)
    return PGConfig(
        host=os.environ.get("CHEMBRIDGE_PG_HOST", "127.0.0.1"),
        port=int(os.environ.get("CHEMBRIDGE_PG_PORT", "5432")),
        user=os.environ.get("CHEMBRIDGE_PG_USER", "snailtrade"),
        password=os.environ.get("CHEMBRIDGE_PG_PASSWORD", "snailtrade2024"),
        database=os.environ.get("CHEMBRIDGE_PG_DATABASE", "snailtrade"),
        sslmode=os.environ.get("CHEMBRIDGE_PG_SSLMODE", "disable"),
    )


def _parse_db_url(url: str) -> PGConfig:
    """解析 postgres://user:pass@host:port/db?sslmode=... 格式的 URL。"""
    from urllib.parse import parse_qs, urlparse

    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    return PGConfig(
        host=parsed.hostname or "127.0.0.1",
        port=parsed.port or 5432,
        user=parsed.username or "snailtrade",
        password=parsed.password or "",
        database=parsed.path.lstrip("/") or "snailtrade",
        sslmode=qs.get("sslmode", ["disable"])[0],
    )


# 前端 interval 键 → 与交易页一致
INTERVALS = ("1m", "5m", "15m", "30m", "1h", "2h", "4h", "1d", "1w", "1M")
DEFAULT_DELIVERY_PERIOD = "现货"
