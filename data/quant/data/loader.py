"""从 PostgreSQL 加载 OHLCV 数据。"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime
from typing import Iterator

import pandas as pd

try:
    import psycopg2
except ImportError:
    psycopg2 = None  # type: ignore


@dataclass
class DBConfig:
    host: str = "127.0.0.1"
    port: int = 5432
    user: str = "snailtrade"
    password: str = "snailtrade2024"
    database: str = "snailtrade"
    sslmode: str = "disable"

    @classmethod
    def from_env(cls) -> "DBConfig":
        db_url = os.environ.get("CHEMBRIDGE_DATABASE_URL")
        if db_url:
            return cls._parse_url(db_url)
        return cls(
            host=os.environ.get("CHEMBRIDGE_PG_HOST", "127.0.0.1"),
            port=int(os.environ.get("CHEMBRIDGE_PG_PORT", "5432")),
            user=os.environ.get("CHEMBRIDGE_PG_USER", "snailtrade"),
            password=os.environ.get("CHEMBRIDGE_PG_PASSWORD", "snailtrade2024"),
            database=os.environ.get("CHEMBRIDGE_PG_DATABASE", "snailtrade"),
            sslmode=os.environ.get("CHEMBRIDGE_PG_SSLMODE", "disable"),
        )

    @classmethod
    def _parse_url(cls, url: str) -> "DBConfig":
        from urllib.parse import parse_qs, urlparse

        p = urlparse(url)
        qs = parse_qs(p.query)
        return cls(
            host=p.hostname or "127.0.0.1",
            port=p.port or 5432,
            user=p.username or "snailtrade",
            password=p.password or "",
            database=p.path.lstrip("/") or "snailtrade",
            sslmode=qs.get("sslmode", ["disable"])[0],
        )

    def dsn(self) -> str:
        return (
            f"host={self.host} port={self.port} dbname={self.database} "
            f"user={self.user} password={self.password} sslmode={self.sslmode}"
        )


def load_ohlcv(
    product_id: str,
    interval: str = "1d",
    delivery_period: str = "现货",
    start_time: datetime | str | None = None,
    end_time: datetime | str | None = None,
    config: DBConfig | None = None,
) -> pd.DataFrame:
    """从 ohlcv_bars 表加载 K 线数据。

    Args:
        product_id: 品种 ID，如 "acetone"
        interval: K 线周期，如 "1d", "1h", "5m"
        delivery_period: 交割期，默认"现货"
        start_time: 起始时间（含）
        end_time: 结束时间（含）
        config: 数据库连接配置

    Returns:
        OHLCV DataFrame，按 time 升序排列。
        列: time, open, high, low, close, volume, turnover,
            product_id, delivery_period, interval, source
    """
    if psycopg2 is None:
        raise ImportError("请安装 psycopg2-binary: pip install psycopg2-binary")

    cfg = config or DBConfig.from_env()
    conn = psycopg2.connect(cfg.dsn())
    try:
        where = [
            "product_id = %s",
            "interval = %s",
            "delivery_period = %s",
        ]
        params: list = [product_id, interval, delivery_period]

        if start_time:
            where.append("time >= %s")
            params.append(str(start_time))
        if end_time:
            where.append("time <= %s")
            params.append(str(end_time))

        sql = f"""
            SELECT time, open, high, low, close, volume, turnover,
                   product_id, delivery_period, interval, source
            FROM ohlcv_bars
            WHERE {' AND '.join(where)}
            ORDER BY time ASC
        """
        df = pd.read_sql(sql, conn, params=params, parse_dates=["time"])
        return df
    finally:
        conn.close()


def load_multi(
    product_ids: list[str],
    interval: str = "1d",
    delivery_period: str = "现货",
    config: DBConfig | None = None,
) -> pd.DataFrame:
    """批量加载多个品种的 K 线数据。

    Returns:
        所有品种合并 DataFrame，按 (product_id, time) 升序。
    """
    if psycopg2 is None:
        raise ImportError("请安装 psycopg2-binary: pip install psycopg2-binary")

    if not product_ids:
        return pd.DataFrame()

    cfg = config or DBConfig.from_env()
    conn = psycopg2.connect(cfg.dsn())
    try:
        placeholders = ",".join(["%s"] * len(product_ids))
        sql = f"""
            SELECT time, open, high, low, close, volume, turnover,
                   product_id, delivery_period, interval, source
            FROM ohlcv_bars
            WHERE product_id IN ({placeholders})
              AND interval = %s
              AND delivery_period = %s
            ORDER BY product_id, time ASC
        """
        params = [*product_ids, interval, delivery_period]
        df = pd.read_sql(sql, conn, params=params, parse_dates=["time"])
        return df
    finally:
        conn.close()


def available_products(config: DBConfig | None = None) -> list[str]:
    """返回 ohlcv_bars 中所有已有数据的品种列表。"""
    if psycopg2 is None:
        raise ImportError("请安装 psycopg2-binary: pip install psycopg2-binary")

    cfg = config or DBConfig.from_env()
    conn = psycopg2.connect(cfg.dsn())
    try:
        df = pd.read_sql(
            "SELECT DISTINCT product_id FROM ohlcv_bars ORDER BY product_id",
            conn,
        )
        return df["product_id"].tolist()
    finally:
        conn.close()
