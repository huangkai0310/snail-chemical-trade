"""技术指标与波动率。"""

from __future__ import annotations

import numpy as np
import pandas as pd


def add_returns(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["return"] = out["close"].pct_change()
    out["log_return"] = np.log(out["close"]).diff()
    return out


def sma(series: pd.Series, window: int) -> pd.Series:
    return series.rolling(window, min_periods=window).mean()


def ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False).mean()


def rsi(series: pd.Series, window: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / window, min_periods=window, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / window, min_periods=window, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def bollinger(series: pd.Series, window: int = 20, num_std: float = 2.0) -> pd.DataFrame:
    mid = sma(series, window)
    std = series.rolling(window, min_periods=window).std()
    return pd.DataFrame(
        {
            "bb_mid": mid,
            "bb_upper": mid + num_std * std,
            "bb_lower": mid - num_std * std,
        }
    )


def realized_volatility(log_return: pd.Series, window: int = 20, periods_per_year: int = 252) -> pd.Series:
    """滚动已实现波动率（年化）。"""
    return log_return.rolling(window, min_periods=window).std() * np.sqrt(periods_per_year)


def atr(df: pd.DataFrame, window: int = 14) -> pd.Series:
    high, low, close = df["high"], df["low"], df["close"]
    prev_close = close.shift(1)
    tr = pd.concat(
        [
            (high - low),
            (high - prev_close).abs(),
            (low - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return tr.rolling(window, min_periods=window).mean()


def enrich_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """在 OHLCV 上附加常用指标列。"""
    out = add_returns(df)
    out["ma5"] = sma(out["close"], 5)
    out["ma10"] = sma(out["close"], 10)
    out["ma20"] = sma(out["close"], 20)
    out["ema12"] = ema(out["close"], 12)
    out["ema26"] = ema(out["close"], 26)
    out["macd"] = out["ema12"] - out["ema26"]
    out["macd_signal"] = ema(out["macd"], 9)
    out["macd_hist"] = out["macd"] - out["macd_signal"]
    out["rsi14"] = rsi(out["close"], 14)
    bb = bollinger(out["close"], 20, 2.0)
    out = pd.concat([out, bb], axis=1)
    out["rv20"] = realized_volatility(out["log_return"], 20)
    out["atr14"] = atr(out, 14)
    return out
