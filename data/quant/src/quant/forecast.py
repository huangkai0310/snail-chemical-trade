"""简单价格预测（EWMA 收益外推，非生产级 ML）。"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from quant.indicators import add_returns


def ewma_forecast(df: pd.DataFrame, horizon: int = 5, span: int = 10) -> dict[str, Any]:
    """用对数收益的 EWMA 均值外推未来 close 路径。"""
    if horizon < 1:
        raise ValueError("horizon 须 >= 1")
    if len(df) < max(span, 5):
        raise ValueError("样本不足以做预测")

    enriched = add_returns(df)
    log_rets = enriched["log_return"].dropna()
    mu = float(log_rets.ewm(span=span, adjust=False).mean().iloc[-1])
    sigma = float(log_rets.ewm(span=span, adjust=False).std().iloc[-1])
    last_close = float(enriched["close"].iloc[-1])
    last_time = enriched["time"].iloc[-1]

    # 推算步长
    if len(enriched) >= 2:
        delta = enriched["time"].iloc[-1] - enriched["time"].iloc[-2]
    else:
        delta = pd.Timedelta(days=1)

    path = []
    price = last_close
    t = last_time
    for i in range(1, horizon + 1):
        t = t + delta
        price = price * float(np.exp(mu))
        path.append(
            {
                "step": i,
                "time": t.isoformat(),
                "close": price,
                "change_pct_from_last": price / last_close - 1,
            }
        )

    return {
        "method": "ewma_log_return",
        "span": span,
        "horizon": horizon,
        "mu_log_return": mu,
        "sigma_log_return": sigma,
        "last_close": last_close,
        "path": path,
        "note": "仅供研究参考，非投资建议；后续可替换为多因子/ML 模型。",
    }
