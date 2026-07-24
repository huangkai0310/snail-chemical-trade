"""波动率与行情摘要分析。"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from quant.indicators import enrich_indicators


def analyze(df: pd.DataFrame) -> dict[str, Any]:
    """生成结构化分析报告（价格、收益、波动率、动量信号）。"""
    if df.empty or len(df) < 3:
        raise ValueError("样本过少，至少需要 3 根 K 线")

    source_path = df.attrs.get("path")
    enriched = enrich_indicators(df)
    close = enriched["close"]
    last = enriched.iloc[-1]
    rets = enriched["return"].dropna()
    log_rets = enriched["log_return"].dropna()

    window = min(20, max(2, len(rets))) if len(rets) else 0
    recent = rets.tail(window) if window else rets
    rv = float(log_rets.tail(max(window, 2)).std() * np.sqrt(252)) if len(log_rets) >= 2 else None

    signals: list[str] = []
    if len(enriched) < 20:
        signals.append(f"样本仅 {len(enriched)} 根，动量/波动率信号参考性有限")
    if pd.notna(last.get("ma5")) and pd.notna(last.get("ma20")):
        if last["ma5"] > last["ma20"]:
            signals.append("短均线上穿/位于长均线上方（偏多）")
        elif last["ma5"] < last["ma20"]:
            signals.append("短均线下穿/位于长均线下方（偏空）")
    rsi_v = last.get("rsi14")
    if pd.notna(rsi_v):
        if rsi_v >= 70:
            signals.append("RSI 超买区")
        elif rsi_v <= 30:
            signals.append("RSI 超卖区")
        else:
            signals.append("RSI 中性区")

    bb_pos = None
    if pd.notna(last.get("bb_upper")) and pd.notna(last.get("bb_lower")):
        width = float(last["bb_upper"] - last["bb_lower"])
        if width > 0:
            bb_pos = float((last["close"] - last["bb_lower"]) / width)

    report = {
        "meta": {
            "rows": int(len(enriched)),
            "start": enriched["time"].iloc[0].isoformat(),
            "end": enriched["time"].iloc[-1].isoformat(),
            "product_id": str(enriched["product_id"].iloc[-1]) if "product_id" in enriched.columns else None,
            "interval": str(enriched["interval"].iloc[-1]) if "interval" in enriched.columns else None,
            "source": str(enriched["source"].iloc[-1]) if "source" in enriched.columns else None,
            "path": source_path,
        },
        "price": {
            "last": float(close.iloc[-1]),
            "open_first": float(enriched["open"].iloc[0]),
            "high": float(enriched["high"].max()),
            "low": float(enriched["low"].min()),
            "change_pct": float(close.iloc[-1] / close.iloc[0] - 1),
        },
        "returns": {
            "mean": float(recent.mean()) if len(recent) else None,
            "std": float(recent.std()) if len(recent) > 1 else 0.0,
            "skew": float(recent.skew()) if len(recent) > 2 else None,
            "win_rate": float((recent > 0).mean()) if len(recent) else None,
        },
        "volatility": {
            "realized_vol_ann": rv,
            "rv20_last": float(last["rv20"]) if pd.notna(last.get("rv20")) else None,
            "atr14_last": float(last["atr14"]) if pd.notna(last.get("atr14")) else None,
            "atr14_pct": float(last["atr14"] / last["close"]) if pd.notna(last.get("atr14")) and last["close"] else None,
        },
        "momentum": {
            "ma5": float(last["ma5"]) if pd.notna(last.get("ma5")) else None,
            "ma10": float(last["ma10"]) if pd.notna(last.get("ma10")) else None,
            "ma20": float(last["ma20"]) if pd.notna(last.get("ma20")) else None,
            "rsi14": float(rsi_v) if pd.notna(rsi_v) else None,
            "macd_hist": float(last["macd_hist"]) if pd.notna(last.get("macd_hist")) else None,
            "bollinger_position": bb_pos,
            "signals": signals,
        },
        "volume": {
            "last": float(last["volume"]) if "volume" in enriched.columns else None,
            "mean": float(enriched["volume"].tail(window or 1).mean()) if "volume" in enriched.columns else None,
        },
    }
    return report


def format_report_text(report: dict[str, Any]) -> str:
    p = report["price"]
    v = report["volatility"]
    m = report["momentum"]
    atr_line = "ATR14 n/a"
    if v.get("atr14_last") is not None:
        atr_line = f"ATR14 {v['atr14_last']:.2f}"
        if v.get("atr14_pct") is not None:
            atr_line += f" ({v['atr14_pct']*100:.2f}%)"
    lines = [
        f"品种 {report['meta'].get('product_id') or '-'} | 周期 {report['meta'].get('interval') or '-'} | 样本 {report['meta']['rows']}",
        f"区间 {report['meta']['start']} → {report['meta']['end']}",
        f"最新价 {p['last']:.2f}  区间涨跌 {p['change_pct']*100:.2f}%  高低 {p['low']:.2f}/{p['high']:.2f}",
        f"年化已实现波动率 {v['realized_vol_ann']*100:.2f}%" if v["realized_vol_ann"] is not None else "年化已实现波动率 n/a",
        atr_line,
        f"RSI14 {m['rsi14']:.1f}" if m["rsi14"] is not None else "RSI14 n/a",
        "信号: " + ("；".join(m["signals"]) if m["signals"] else "无"),
    ]
    return "\n".join(lines)
