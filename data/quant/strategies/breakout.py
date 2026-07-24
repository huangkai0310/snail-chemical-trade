"""突破策略：N 日高低点突破。"""

from __future__ import annotations

from quant.engine.backtest import Bar, Direction, SignalType
from quant.strategies.base import Strategy


class BreakoutStrategy(Strategy):
    """N 日高点/低点突破策略。

    - 价格突破 N 日高点 → BUY（趋势启动）
    - 价格跌破 N 日低点 → SELL（趋势结束/反转）

    Args:
        lookback: 回溯周期（默认 20）
    """

    def __init__(self, lookback: int = 5) -> None:
        super().__init__(name=f"突破({lookback})")
        self.lookback = lookback

    def on_bar(self, bar: Bar, position: Direction | None) -> SignalType:
        self._append_bar(bar)
        n = len(self.data)

        if n < self.lookback:
            return SignalType.HOLD

        recent = self.data.tail(self.lookback)
        highest = recent["high"].max()
        lowest = recent["low"].min()

        price = bar.close
        prev_close = self.data["close"].iloc[-2] if n > 1 else price

        # 突破高点，空仓做多
        if price > highest and prev_close <= highest and (position is None or position.direction.value == "short"):
            return SignalType.BUY

        # 跌破低点，多仓卖出
        if price < lowest and prev_close >= lowest and position is not None and position.direction.value == "long":
            return SignalType.SELL

        return SignalType.HOLD
