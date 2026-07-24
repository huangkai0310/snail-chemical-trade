"""回测运行脚本 — 从 PostgreSQL 加载数据并运行策略回测。

用法:
    cd data/quant
    python run_backtest.py                          # 默认 acetone 日线 + 3 个策略
    python run_backtest.py --product benzene        # 指定品种
    python run_backtest.py --interval 1h            # 指定周期
    python run_backtest.py --capital 500000         # 指定初始资金
    python run_backtest.py --strategy trend         # 只跑趋势策略
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path

# ── 包根路径 ─────────────────────────────────────────────────
_SCRIPT_DIR = Path(__file__).resolve().parent
_QUANT_ROOT = _SCRIPT_DIR.parent.parent
_SRC = _QUANT_ROOT / "data"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from quant.data.loader import DBConfig, load_ohlcv
from quant.engine import BacktestEngine, CostModel
from quant.strategies import (
    BollingerBandStrategy,
    BreakoutStrategy,
    TrendFollowingStrategy,
)


STRATEGIES = {
    "trend": TrendFollowingStrategy,
    "bollinger": BollingerBandStrategy,
    "breakout": BreakoutStrategy,
    "all": None,  # 表示全部
}


def run_single(
    product_id: str,
    interval: str,
    strategy_cls,
    initial_capital: float,
) -> None:
    print(f"\n{'='*60}")
    print(f"  品种: {product_id}  周期: {interval}  策略: {strategy_cls.__name__}")
    print(f"{'='*60}")

    try:
        df = load_ohlcv(product_id, interval=interval)
    except Exception as e:
        print(f"  [ERROR] 数据加载失败: {e}")
        return

    if df.empty:
        print(f"  [WARN] 无 K 线数据，跳过")
        return

    print(f"  数据范围: {df['time'].min()} ~ {df['time'].max()}  共 {len(df)} 条")

    engine = BacktestEngine(
        initial_capital=initial_capital,
        cost_model=CostModel(commission_rate=0.0003, slippage_bps=1.0),
    )
    strategy = strategy_cls()
    engine.set_strategy(strategy)
    engine.load_data(df)

    print(f"  初始资金: {initial_capital:,.0f}")
    stats = engine.run()
    print(stats.summary())


def main() -> None:
    parser = argparse.ArgumentParser(description="量化策略回测")
    parser.add_argument("--product", "-p", default="acetone", help="品种 ID（默认 acetone）")
    parser.add_argument("--interval", "-i", default="1d", help="K 线周期（默认 1d）")
    parser.add_argument("--capital", "-c", type=float, default=1_000_000.0, help="初始资金（默认 100 万）")
    parser.add_argument(
        "--strategy", "-s",
        default="all",
        choices=list(STRATEGIES.keys()),
        help="策略: trend / bollinger / breakout / all（默认 all）"
    )
    args = parser.parse_args()

    print(f"[{datetime.now().isoformat()}] 量化回测启动")
    print(f"  数据库: {DBConfig.from_env().dsn()[:60]}...")

    selected = STRATEGIES[args.strategy]
    to_run = [selected] if selected else list(STRATEGIES.values())

    for cls in to_run:
        if cls is None:
            continue
        run_single(args.product, args.interval, cls, args.capital)


if __name__ == "__main__":
    main()
