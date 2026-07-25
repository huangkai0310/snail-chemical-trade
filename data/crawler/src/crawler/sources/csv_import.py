"""从外部 CSV 导入现货/期货报价（卓创/隆众等手工导出的过渡方案）。"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from crawler.config import DEFAULT_DELIVERY_PERIOD
from crawler.sources.base import CollectRequest, DataSource

# 兼容常见列名
_COLUMN_ALIASES = {
    "time": ["time", "date", "datetime", "日期", "时间"],
    "open": ["open", "开盘", "开盘价"],
    "high": ["high", "最高", "最高价"],
    "low": ["low", "最低", "最低价"],
    "close": ["close", "收盘", "收盘价", "price", "价格", "报价"],
    "volume": ["volume", "成交量", "数量", "qty"],
    "turnover": ["turnover", "成交额", "金额"],
}


def _resolve_columns(df: pd.DataFrame) -> pd.DataFrame:
    lower_map = {c.lower().strip(): c for c in df.columns}
    renamed: dict[str, str] = {}
    for canonical, aliases in _COLUMN_ALIASES.items():
        for alias in aliases:
            key = alias.lower()
            if key in lower_map:
                renamed[lower_map[key]] = canonical
                break
    out = df.rename(columns=renamed)
    if "close" not in out.columns:
        raise ValueError("CSV 至少需要收盘价/价格列（close / price / 报价）")
    if "time" not in out.columns:
        raise ValueError("CSV 至少需要时间列（time / date / 日期）")
    for col in ("open", "high", "low"):
        if col not in out.columns:
            out[col] = out["close"]
    if "volume" not in out.columns:
        out["volume"] = 0.0
    if "turnover" not in out.columns:
        out["turnover"] = out["close"].astype(float) * out["volume"].astype(float)
    return out


class CsvImportSource(DataSource):
    name = "csv"
    description = "导入外部 CSV 报价（卓创/隆众等导出文件）"

    def collect(self, req: CollectRequest) -> tuple[pd.DataFrame, list[dict]]:
        if not req.csv_path:
            raise ValueError("csv 源需要 --csv path/to/file.csv")
        path = Path(req.csv_path)
        if not path.is_file():
            raise FileNotFoundError(f"找不到 CSV: {path}")

        raw = pd.read_csv(path)
        df = _resolve_columns(raw)
        product_id = req.product_id or "imported"
        period = req.delivery_period or DEFAULT_DELIVERY_PERIOD

        out = pd.DataFrame(
            {
                "time": pd.to_datetime(df["time"], utc=True, errors="coerce"),
                "open": df["open"].astype(float),
                "high": df["high"].astype(float),
                "low": df["low"].astype(float),
                "close": df["close"].astype(float),
                "volume": df["volume"].astype(float),
                "turnover": df["turnover"].astype(float),
                "product_id": product_id,
                "delivery_period": period,
                "interval": req.interval,
                "source": self.name,
            }
        ).dropna(subset=["time"])

        if out.empty:
            raise ValueError("CSV 解析后无有效行")

        last = out.iloc[-1]
        snap = {
            "source": self.name,
            "product_id": product_id,
            "delivery_period": period,
            "collected_at": pd.Timestamp.utcnow().isoformat(),
            "latest": float(last["close"]),
            "volume_today": float(last["volume"]),
            "from_file": str(path),
        }
        return out, [snap]
