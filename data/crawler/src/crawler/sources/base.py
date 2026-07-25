"""数据源抽象。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

import pandas as pd


@dataclass(frozen=True)
class CollectRequest:
    product_id: str | None = None
    delivery_period: str = "现货"
    interval: str = "1d"
    limit: int = 120
    all_products: bool = False
    # csv_import 专用
    csv_path: str | None = None


class DataSource(ABC):
    name: str
    description: str

    @abstractmethod
    def collect(self, req: CollectRequest) -> tuple[pd.DataFrame, list[dict]]:
        """返回 (ohlcv_df, latest_snapshots)。ohlcv 可为空 DataFrame。"""
