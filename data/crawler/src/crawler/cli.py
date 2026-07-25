"""crawler CLI。"""

from __future__ import annotations

import json
import sys

import click

from crawler.collect import run_collect
from crawler.config import INTERVALS, warehouse_dir
from crawler.sources import SOURCES


@click.group()
@click.version_option(package_name="crawler")
def main() -> None:
    """化工市场数据采集。"""


@main.command("list-sources")
def list_sources() -> None:
    """列出可用数据源。"""
    for name, src in sorted(SOURCES.items()):
        click.echo(f"{name:12}  {src.description}")


@main.command("collect")
@click.option("--source", "-s", default="platform", show_default=True, help="数据源")
@click.option("--product", "-p", "product_id", default=None, help="品种 ID，如 benzene")
@click.option("--all", "all_products", is_flag=True, help="采集全部活跃品种")
@click.option("--period", default="现货", show_default=True, help="交割期")
@click.option(
    "--interval",
    "-i",
    default="1d",
    show_default=True,
    type=click.Choice(INTERVALS, case_sensitive=True),
    help="K 线周期",
)
@click.option("--limit", "-n", default=120, show_default=True, help="K 线条数上限")
@click.option("--csv", "csv_path", default=None, help="csv 源的文件路径")
@click.option("--no-pg", "pg_write", is_flag=True, default=True, help="跳过 PostgreSQL 写入")
def collect_cmd(
    source: str,
    product_id: str | None,
    all_products: bool,
    period: str,
    interval: str,
    limit: int,
    csv_path: str | None,
    pg_write: bool,
) -> None:
    """采集行情并写入 data/warehouse + PostgreSQL。"""
    click.echo(f"warehouse = {warehouse_dir()}")
    try:
        result = run_collect(
            source,
            product_id=product_id,
            delivery_period=period,
            interval=interval,
            limit=limit,
            all_products=all_products,
            csv_path=csv_path,
            pg_write=pg_write,
        )
    except Exception as exc:  # noqa: BLE001 — CLI 统一出口
        click.echo(f"采集失败: {exc}", err=True)
        sys.exit(1)

    click.echo(
        json.dumps(
            {
                "source": result.source,
                "ohlcv_rows": result.ohlcv_rows,
                "ohlcv_files": [str(p) for p in result.ohlcv_paths],
                "snapshot_file": str(result.snapshot_path) if result.snapshot_path else None,
                "snapshot_rows": result.snapshot_rows,
                "pg_ohlcv_inserted": result.pg_ohlcv_inserted,
                "pg_snapshots_inserted": result.pg_snapshots_inserted,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
