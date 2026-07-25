"""离线样例源：生成合成 OHLCV，便于无网/无成交时调试量化。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from crawler.config import DEFAULT_DELIVERY_PERIOD
from crawler.sources.base import CollectRequest, DataSource


class SampleSource(DataSource):
    name = "sample"
    description = "合成样例行情（本地调试用，非真实市场）"

    def collect(self, req: CollectRequest) -> tuple[pd.DataFrame, list[dict]]:
        product_id = req.product_id or "benzene"
        period = req.delivery_period or DEFAULT_DELIVERY_PERIOD
        n = max(req.limit, 30)
        rng = np.random.default_rng(abs(hash(product_id)) % (2**32))

        end = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        if req.interval.endswith("d") or req.interval in ("1w", "1M"):
            step = timedelta(days=1)
        elif req.interval.endswith("h"):
            hours = int(req.interval[:-1]) if req.interval[:-1].isdigit() else 1
            step = timedelta(hours=hours)
        else:
            step = timedelta(hours=1)

        times = [end - step * (n - i) for i in range(n)]
        # 几何布朗近似
        rets = rng.normal(0.0005, 0.012, size=n)
        close = 6500 * np.cumprod(1 + rets)
        open_ = np.concatenate([[close[0]], close[:-1]])
        high = np.maximum(open_, close) * (1 + rng.uniform(0, 0.006, n))
        low = np.minimum(open_, close) * (1 - rng.uniform(0, 0.006, n))
        volume = rng.uniform(50, 400, n)
        turnover = close * volume

        df = pd.DataFrame(
            {
                "time": times,
                "open": open_,
                "high": high,
                "low": low,
                "close": close,
                "volume": volume,
                "turnover": turnover,
                "product_id": product_id,
                "delivery_period": period,
                "interval": req.interval,
                "source": self.name,
            }
        )
        snap = {
            "source": self.name,
            "product_id": product_id,
            "delivery_period": period,
            "collected_at": datetime.now(timezone.utc).isoformat(),
            "latest": float(close[-1]),
            "prev_settle": float(close[-2]) if n > 1 else float(close[-1]),
            "volume_today": float(volume[-1]),
        }
        return df, [snap]
