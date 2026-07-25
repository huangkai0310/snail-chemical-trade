"""从 ChemBridge 公开 API 采集平台成交衍生行情。"""

from __future__ import annotations

from datetime import datetime, timezone

import httpx
import pandas as pd

from crawler.config import DEFAULT_DELIVERY_PERIOD, api_base
from crawler.sources.base import CollectRequest, DataSource


class PlatformSource(DataSource):
    name = "platform"
    description = "禾合平台公开行情（成交 OHLCV + 最新价）"

    def __init__(self, base_url: str | None = None, timeout: float = 30.0) -> None:
        self.base_url = (base_url or api_base()).rstrip("/")
        self.timeout = timeout

    def _get(self, path: str, params: dict | None = None) -> dict | list:
        url = f"{self.base_url}{path}"
        with httpx.Client(timeout=self.timeout) as client:
            resp = client.get(url, params=params)
            resp.raise_for_status()
            return resp.json()

    def list_products(self) -> list[dict]:
        raw = self._get("/api/v1/products")
        if isinstance(raw, dict):
            data = raw.get("data", raw.get("products", []))
        else:
            data = raw
        return [p for p in data if p.get("active", True)]

    def fetch_price_history(
        self,
        product_id: str,
        interval: str,
        limit: int,
        delivery_period: str,
    ) -> pd.DataFrame:
        raw = self._get(
            "/api/v1/trades/price-history",
            params={
                "product_id": product_id,
                "interval": interval,
                "limit": limit,
                "delivery_period": delivery_period,
            },
        )
        candles = raw.get("data", []) if isinstance(raw, dict) else raw
        if not candles:
            return pd.DataFrame()

        rows = []
        for c in candles:
            rows.append(
                {
                    "time": c["time"],
                    "open": float(c["open"]),
                    "high": float(c["high"]),
                    "low": float(c["low"]),
                    "close": float(c["close"]),
                    "volume": float(c.get("volume") or 0),
                    "turnover": float(c.get("turnover") or 0),
                    "product_id": product_id,
                    "delivery_period": delivery_period,
                    "interval": interval,
                    "source": self.name,
                }
            )
        return pd.DataFrame(rows)

    def fetch_latest(self, product_id: str, delivery_period: str) -> dict:
        raw = self._get(
            "/api/v1/trades/latest-price",
            params={"product_id": product_id, "delivery_period": delivery_period},
        )
        data = raw.get("data", raw) if isinstance(raw, dict) else raw
        return {
            "source": self.name,
            "product_id": product_id,
            "delivery_period": delivery_period,
            "collected_at": datetime.now(timezone.utc).isoformat(),
            **(data if isinstance(data, dict) else {"raw": data}),
        }

    def collect(self, req: CollectRequest) -> tuple[pd.DataFrame, list[dict]]:
        period = req.delivery_period or DEFAULT_DELIVERY_PERIOD
        products = self.list_products()
        if not req.all_products:
            if not req.product_id:
                raise ValueError("请指定 --product，或使用 --all")
            products = [p for p in products if p.get("id") == req.product_id]
            if not products:
                # 品种列表可能不全时仍允许按 ID 拉取
                products = [{"id": req.product_id}]

        frames: list[pd.DataFrame] = []
        snaps: list[dict] = []
        for p in products:
            pid = p["id"]
            df = self.fetch_price_history(pid, req.interval, req.limit, period)
            if not df.empty:
                frames.append(df)
            try:
                snaps.append(self.fetch_latest(pid, period))
            except httpx.HTTPError:
                continue

        ohlcv = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
        return ohlcv, snaps
