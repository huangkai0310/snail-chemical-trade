"""合成数据快速回测 — 不依赖数据库，验证引擎逻辑。

用法:
    cd data/quant
    python test_engine.py
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# ── 包根路径 ─────────────────────────────────────────────────
_SCRIPT_DIR = Path(__file__).resolve().parent
_QUANT_ROOT = _SCRIPT_DIR.parent.parent
_SRC = _QUANT_ROOT / "data"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

import numpy as np
import pandas as pd

from quant.engine import BacktestEngine, CostModel, Direction
from quant.strategies import (
    BollingerBandStrategy,
    BreakoutStrategy,
    TrendFollowingStrategy,
)


def generate_synthetic_data(n: int = 100, seed: int = 42) -> pd.DataFrame:
    """生成合成 OHLCV 数据（几何布朗运动 + 趋势）。"""
    rng = np.random.default_rng(seed)
    end = datetime(2026, 7, 24, 0, 0, 0, tzinfo=timezone.utc)
    times = [end - timedelta(days=n - i) for i in range(n)]

    rets = rng.normal(0.002, 0.015, size=n)  # 日收益率
    close = 6500.0 * np.cumprod(1 + rets)
    open_ = np.concatenate([[close[0]], close[:-1]])
    high = np.maximum(open_, close) * (1 + rng.uniform(0, 0.008, n))
    low = np.minimum(open_, close) * (1 - rng.uniform(0, 0.008, n))
    volume = rng.uniform(100, 500, n)

    return pd.DataFrame({
        "time": times,
        "open": open_,
        "high": high,
        "low": low,
        "close": close,
        "volume": volume,
        "turnover": close * volume,
        "product_id": "benzene",
        "delivery_period": "现货",
        "interval": "1d",
        "source": "sample",
    })


def run_test(strategy_name: str, strategy, df: pd.DataFrame) -> None:
    print(f"\n{'='*55}")
    print(f"  策略: {strategy_name}")
    print(f"{'='*55}")

    engine = BacktestEngine(
        initial_capital=1_000_000.0,
        cost_model=CostModel(commission_rate=0.0003, slippage_bps=2.0),
    )
    engine.set_strategy(strategy)
    engine.load_data(df)
    stats = engine.run()
    print(stats.summary())

    # 打印前 5 笔成交
    if stats.trades:
        print("最近 5 笔成交:")
        for t in stats.trades[-5:]:
            print(f"  {t.time.date()} {t.signal_type.value:4s}  qty={t.qty:.2f}  price={t.price:.2f}  pnl={t.pnl:+.2f}")


def main() -> None:
    print("=" * 60)
    print("  量化回测引擎 — 合成数据测试")
    print("=" * 60)
    print(f"  时间: {datetime.now().isoformat()}")
    print(f"  数据: 100 条合成 OHLCV（几何布朗运动）")

    df = generate_synthetic_data(n=100, seed=42)
    print(f"  范围: {df['time'].min().date()} ~ {df['time'].max().date()}")

    # 三个策略
    run_test("趋势策略 (MA5/MA10)", TrendFollowingStrategy(fast_period=5, slow_period=10), df)
    run_test("布林带策略 (10日,2σ)", BollingerBandStrategy(period=10, std_mult=2.0), df)
    run_test("突破策略 (5日高低点)", BreakoutStrategy(lookback=5), df)

    print("\n" + "=" * 60)
    print("  测试完成 ✓")
    print("=" * 60)


if __name__ == "__main__":
    main()
