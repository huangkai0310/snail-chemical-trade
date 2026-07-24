"""从 warehouse 加载 OHLCV。"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from quant.config import DEFAULT_DELIVERY_PERIOD, warehouse_dir


def resolve_ohlcv_path(
    product_id: str,
    interval: str = "1d",
    *,
    source: str | None = None,
    delivery_period: str = DEFAULT_DELIVERY_PERIOD,
) -> Path:
    """定位 OHLCV 文件；未指定 source 时优先 platform，再 sample/csv。"""
    safe_period = delivery_period.replace("/", "_").replace("\\", "_")
    root = warehouse_dir() / "ohlcv"
    if source:
        path = root / source / product_id / safe_period / f"{interval}.csv"
        if not path.is_file():
            raise FileNotFoundError(f"找不到行情文件: {path}")
        return path

    preferred = ("platform", "csv", "sample")
    candidates: list[Path] = []
    if root.is_dir():
        for src_dir in root.iterdir():
            if not src_dir.is_dir():
                continue
            path = src_dir / product_id / safe_period / f"{interval}.csv"
            if path.is_file():
                candidates.append(path)

    if not candidates:
        raise FileNotFoundError(
            f"warehouse 中无 {product_id}/{delivery_period}/{interval}.csv，"
            f"请先运行: crawler collect -s sample -p {product_id} -i {interval}"
        )

    by_name = {p.parts[-4]: p for p in candidates}  # .../ohlcv/{source}/...
    for name in preferred:
        if name in by_name:
            return by_name[name]
    return sorted(candidates)[0]


def load_ohlcv(
    product_id: str,
    interval: str = "1d",
    *,
    source: str | None = None,
    delivery_period: str = DEFAULT_DELIVERY_PERIOD,
    path: str | Path | None = None,
) -> pd.DataFrame:
    file_path = Path(path) if path else resolve_ohlcv_path(
        product_id, interval, source=source, delivery_period=delivery_period
    )
    df = pd.read_csv(file_path)
    if "time" not in df.columns or "close" not in df.columns:
        raise ValueError(f"无效 OHLCV 文件: {file_path}")
    df["time"] = pd.to_datetime(df["time"], utc=True)
    for col in ("open", "high", "low", "close", "volume", "turnover"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["time", "close"]).sort_values("time").reset_index(drop=True)
    df.attrs["path"] = str(file_path)
    return df
