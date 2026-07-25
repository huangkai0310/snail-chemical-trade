"""本地 warehouse 读写 + PostgreSQL 持久化。"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

import pandas as pd

from crawler.config import pg_config, warehouse_dir

if TYPE_CHECKING:
    from crawler.config import PGConfig

logger = logging.getLogger("crawler.store")

OHLCV_COLUMNS = [
    "time",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "turnover",
    "product_id",
    "delivery_period",
    "interval",
    "source",
]


# ── 本地 warehouse 文件读写 ──────────────────────────────────

def ohlcv_path(
    source: str,
    product_id: str,
    delivery_period: str,
    interval: str,
) -> Path:
    safe_period = delivery_period.replace("/", "_").replace("\\", "_")
    return (
        warehouse_dir()
        / "ohlcv"
        / source
        / product_id
        / safe_period
        / f"{interval}.csv"
    )


def write_ohlcv(df: pd.DataFrame, path: Path | None = None) -> Path:
    if df.empty:
        raise ValueError("没有可写入的 OHLCV 数据")
    missing = [c for c in OHLCV_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"OHLCV 缺少列: {missing}")

    out = path
    if out is None:
        row = df.iloc[0]
        out = ohlcv_path(
            str(row["source"]),
            str(row["product_id"]),
            str(row["delivery_period"]),
            str(row["interval"]),
        )

    out.parent.mkdir(parents=True, exist_ok=True)
    ordered = df[OHLCV_COLUMNS].copy()
    ordered["time"] = pd.to_datetime(ordered["time"], utc=True).dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    ordered = ordered.sort_values("time").drop_duplicates(subset=["time"], keep="last")
    ordered.to_csv(out, index=False)
    return out


def write_snapshot(source: str, rows: list[dict]) -> Path:
    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    path = warehouse_dir() / "snapshots" / source / f"latest_{day}.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    return path


# ── PostgreSQL 持久化 ────────────────────────────────────────

def _get_connection(config: PGConfig):
    import psycopg2
    conn = psycopg2.connect(
        host=config.host,
        port=config.port,
        user=config.user,
        password=config.password,
        dbname=config.database,
        sslmode=config.sslmode,
    )
    return conn


def write_ohlcv_to_pg(
    df: pd.DataFrame,
    config: PGConfig | None = None,
) -> int:
    """将 OHLCV DataFrame 写入 PostgreSQL ohlcv_bars 表。

    使用 INSERT ... ON CONFLICT DO NOTHING 跳过重复数据。
    返回实际插入的行数。
    """
    if df.empty:
        return 0

    missing = [c for c in OHLCV_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"OHLCV 缺少列: {missing}")

    cfg = config or pg_config()
    conn = _get_connection(cfg)
    try:
        with conn.cursor() as cur:
            # 构建批量插入
            sql = """
                INSERT INTO ohlcv_bars (time, open, high, low, close, volume, turnover,
                                        product_id, delivery_period, interval, source)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (product_id, delivery_period, interval, time, source)
                DO NOTHING
            """
            rows = []
            for _, row in df.iterrows():
                t = pd.to_datetime(row["time"], utc=True)
                rows.append((
                    t,
                    float(row["open"]),
                    float(row["high"]),
                    float(row["low"]),
                    float(row["close"]),
                    float(row["volume"]),
                    float(row["turnover"]),
                    str(row["product_id"]),
                    str(row["delivery_period"]),
                    str(row["interval"]),
                    str(row["source"]),
                ))

            # executemany 支持多列 %s，每次替换一行
            cur.executemany(sql, rows)
            inserted = cur.rowcount
            conn.commit()
            logger.info("ohlcv_bars 写入完成: inserted=%d, total=%d", inserted, len(rows))
            return inserted
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def write_snapshots_to_pg(
    source: str,
    rows: list[dict],
    config: PGConfig | None = None,
) -> int:
    """将快照列表写入 PostgreSQL snapshots 表。

    INSERT ... ON CONFLICT DO NOTHING，返回实际插入行数。
    """
    if not rows:
        return 0

    cfg = config or pg_config()
    conn = _get_connection(cfg)
    try:
        with conn.cursor() as cur:
            sql = """
                INSERT INTO snapshots (product_id, delivery_period, price, volume,
                                       turnover, change_percent, direction, source, snapshot_time)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (product_id, delivery_period, snapshot_time, source)
                DO NOTHING
            """
            values = []
            for row in rows:
                values.append((
                    str(row.get("product_id", "")),
                    str(row.get("delivery_period", "现货")),
                    float(row.get("price", 0)),
                    float(row.get("volume", 0)),
                    float(row.get("turnover", 0)),
                    float(row.get("change_percent", 0)),
                    str(row.get("direction", "")),
                    source,
                    datetime.now(timezone.utc),
                ))

            cur.executemany(sql, values)
            inserted = cur.rowcount
            conn.commit()
            logger.info("snapshots 写入完成: inserted=%d, total=%d", inserted, len(values))
            return inserted
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
