"""采集编排。"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from crawler.sources import CollectRequest, get_source
from crawler.store import write_ohlcv, write_ohlcv_to_pg, write_snapshot, write_snapshots_to_pg

logger = logging.getLogger("crawler.collect")


@dataclass
class CollectResult:
    source: str
    ohlcv_rows: int
    ohlcv_paths: list[Path]
    snapshot_path: Path | None
    snapshot_rows: int
    pg_ohlcv_inserted: int = 0
    pg_snapshots_inserted: int = 0


def run_collect(
    source_name: str,
    *,
    product_id: str | None = None,
    delivery_period: str = "现货",
    interval: str = "1d",
    limit: int = 120,
    all_products: bool = False,
    csv_path: str | None = None,
    pg_write: bool = True,
) -> CollectResult:
    """采集并落盘。

    Args:
        pg_write: 是否同步写入 PostgreSQL (默认 True，失败不影响本地 warehouse)
    """
    source = get_source(source_name)
    req = CollectRequest(
        product_id=product_id,
        delivery_period=delivery_period,
        interval=interval,
        limit=limit,
        all_products=all_products,
        csv_path=csv_path,
    )
    ohlcv, snaps = source.collect(req)

    # ── 本地 warehouse 落盘 ──
    paths: list[Path] = []
    if not ohlcv.empty:
        for (pid, period), group in ohlcv.groupby(["product_id", "delivery_period"], sort=False):
            paths.append(write_ohlcv(group.reset_index(drop=True)))

    snap_path = write_snapshot(source_name, snaps) if snaps else None

    # ── PostgreSQL 写入 (best-effort) ──
    pg_ohlcv = 0
    pg_snap = 0
    if pg_write:
        try:
            if not ohlcv.empty:
                pg_ohlcv = write_ohlcv_to_pg(ohlcv)
        except Exception:
            logger.warning("PostgreSQL OHLCV 写入失败 (本地 warehouse 已落盘)", exc_info=True)

        try:
            if snaps:
                pg_snap = write_snapshots_to_pg(source_name, snaps)
        except Exception:
            logger.warning("PostgreSQL 快照写入失败 (本地 warehouse 已落盘)", exc_info=True)

    return CollectResult(
        source=source_name,
        ohlcv_rows=0 if ohlcv.empty else len(ohlcv),
        ohlcv_paths=paths,
        snapshot_path=snap_path,
        snapshot_rows=len(snaps),
        pg_ohlcv_inserted=pg_ohlcv,
        pg_snapshots_inserted=pg_snap,
    )
