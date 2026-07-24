"""策略回测（与前端 quant-backtest 口径对齐：收盘信号、次日开盘成交、仅多头）。"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from quant.indicators import enrich_indicators


STRATEGIES = {
    "dual_ma": "双均线交叉",
    "rsi_reversion": "RSI 均值回归",
    "macd_cross": "MACD 零轴交叉",
    "buy_hold": "买入持有（基准）",
}


def _target_positions(df: pd.DataFrame, strategy: str, params: dict[str, float]) -> np.ndarray:
    n = len(df)
    out = np.zeros(n, dtype=int)
    close = df["close"].to_numpy(dtype=float)

    if strategy == "buy_hold":
        out[:] = 1
        return out

    if strategy == "dual_ma":
        fast = int(params.get("fast", 5))
        slow = int(params.get("slow", 20))
        ma_f = pd.Series(close).rolling(fast, min_periods=fast).mean().to_numpy()
        ma_s = pd.Series(close).rolling(slow, min_periods=slow).mean().to_numpy()
        pos = 0
        for i in range(n):
            if not np.isnan(ma_f[i]) and not np.isnan(ma_s[i]):
                if ma_f[i] > ma_s[i]:
                    pos = 1
                elif ma_f[i] < ma_s[i]:
                    pos = 0
            out[i] = pos
        return out

    if strategy == "rsi_reversion":
        period = int(params.get("period", 14))
        oversold = float(params.get("oversold", 30))
        overbought = float(params.get("overbought", 70))
        delta = pd.Series(close).diff()
        gain = delta.clip(lower=0).ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
        loss = (-delta.clip(upper=0)).ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
        rs = gain / loss.replace(0, np.nan)
        rsi = (100 - (100 / (1 + rs))).to_numpy()
        pos = 0
        for i in range(n):
            if not np.isnan(rsi[i]):
                if rsi[i] <= oversold:
                    pos = 1
                elif rsi[i] >= overbought:
                    pos = 0
            out[i] = pos
        return out

    # macd_cross
    hist = df["macd_hist"].to_numpy(dtype=float) if "macd_hist" in df.columns else np.full(n, np.nan)
    pos = 0
    for i in range(n):
        if i > 0 and not np.isnan(hist[i]) and not np.isnan(hist[i - 1]):
            if hist[i - 1] <= 0 < hist[i]:
                pos = 1
            elif hist[i - 1] >= 0 > hist[i]:
                pos = 0
        out[i] = pos
    return out


def run_backtest(
    ohlcv: pd.DataFrame,
    *,
    strategy: str = "dual_ma",
    params: dict[str, float] | None = None,
    fee_bps: float = 5.0,
    initial_capital: float = 1_000_000.0,
) -> dict[str, Any]:
    if strategy not in STRATEGIES:
        raise ValueError(f"未知策略 {strategy!r}，可选: {', '.join(STRATEGIES)}")
    if len(ohlcv) < 10:
        raise ValueError("样本过少，至少需要 10 根 K 线")

    params = dict(params or {})
    df = enrich_indicators(ohlcv)
    targets = _target_positions(df, strategy, params)
    position = np.zeros(len(df), dtype=int)
    position[1:] = targets[:-1]

    fee = fee_bps / 10000.0
    cash = initial_capital
    shares = 0.0
    entry_price = 0.0
    entry_i = 0
    trades: list[dict[str, Any]] = []
    equity: list[float] = []
    bar_rets: list[float] = []

    opens = df["open"].to_numpy(dtype=float)
    closes = df["close"].to_numpy(dtype=float)
    times = df["time"]

    for i in range(len(df)):
        want = int(position[i])
        have = 1 if shares > 0 else 0
        if want != have:
            if want == 1 and have == 0:
                px = opens[i] * (1 + fee)
                shares = cash / px
                cash = 0.0
                entry_price = px
                entry_i = i
            elif want == 0 and have == 1:
                px = opens[i] * (1 - fee)
                cash = shares * px
                trades.append(
                    {
                        "entry_time": str(times.iloc[entry_i]),
                        "exit_time": str(times.iloc[i]),
                        "entry_price": entry_price,
                        "exit_price": px,
                        "return_pct": px / entry_price - 1,
                        "bars_held": i - entry_i,
                    }
                )
                shares = 0.0

        eq = cash + shares * closes[i]
        if equity:
            prev = equity[-1]
            bar_rets.append(eq / prev - 1 if prev > 0 else 0.0)
        equity.append(eq)

    if shares > 0:
        px = closes[-1] * (1 - fee)
        trades.append(
            {
                "entry_time": str(times.iloc[entry_i]),
                "exit_time": str(times.iloc[-1]),
                "entry_price": entry_price,
                "exit_price": px,
                "return_pct": px / entry_price - 1,
                "bars_held": len(df) - 1 - entry_i,
            }
        )

    eq_arr = np.array(equity, dtype=float)
    total_return = eq_arr[-1] / initial_capital - 1
    buy_hold = closes[-1] * (1 - fee) / (opens[0] * (1 + fee)) - 1

    peak = np.maximum.accumulate(eq_arr)
    max_dd = float(np.max((peak - eq_arr) / np.where(peak > 0, peak, 1.0)))

    sharpe = None
    if len(bar_rets) >= 2:
        r = np.array(bar_rets)
        std = float(r.std(ddof=1))
        if std > 0:
            sharpe = float(r.mean() / std * np.sqrt(252))

    wins = [t for t in trades if t["return_pct"] > 0]
    losses = [t for t in trades if t["return_pct"] <= 0]
    gp = sum(t["return_pct"] for t in wins)
    gl = abs(sum(t["return_pct"] for t in losses))

    return {
        "strategy": strategy,
        "strategy_name": STRATEGIES[strategy],
        "params": params,
        "metrics": {
            "total_return": total_return,
            "buy_hold_return": buy_hold,
            "excess_return": total_return - buy_hold,
            "max_drawdown": max_dd,
            "sharpe": sharpe,
            "win_rate": (len(wins) / len(trades)) if trades else None,
            "trade_count": len(trades),
            "avg_trade_return": (sum(t["return_pct"] for t in trades) / len(trades)) if trades else None,
            "profit_factor": (gp / gl) if gl > 0 else (None if gp > 0 else 0.0),
            "bars": len(df),
            "fee_bps": fee_bps,
        },
        "trades": trades,
        "equity_end": float(eq_arr[-1]),
        "note": "研究回测：信号收盘确认、次日开盘成交；费率开平各收。非投资建议。",
    }
