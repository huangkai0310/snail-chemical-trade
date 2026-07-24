"""均值回归策略：布林带策略。"""

from __future__ import annotations

from quant.engine.backtest import Bar, Direction, SignalType
from quant.strategies.base import Strategy


class BollingerBandStrategy(Strategy):
    """布林带均值回归策略。

    - 价格触及下轨 → BUY（超卖回归）
    - 价格触及上轨 → SELL（超买回归）

    Args:
        period: 布林带周期（默认 20）
        std_mult: 标准差倍数（默认 2.0）
    """

    def __init__(
        self,
        period: int = 10,
        std_mult: float = 2.0,
    ) -> None:
        super().__init__(name=f"布林带({period},{std_mult})")
        self.period = period
        self.std_mult = std_mult

    def on_bar(self, bar: Bar, position: Direction | None) -> SignalType:
        self._append_bar(bar)
        n = len(self.data)

        if n < self.period:
            return SignalType.HOLD

        closes = self.data["close"].rolling(self.period)
        mid = closes.mean()
        std = closes.std()

        upper = mid + self.std_mult * std
        lower = mid - self.std_mult * std

        price = bar.close
        lower_val = lower.iloc[-1]
        upper_val = upper.iloc[-1]

        # 触及下轨，空仓买入
        if price <= lower_val and (position is None or position.direction.value == "short"):
            return SignalType.BUY

        # 触及上轨，多仓卖出
        if price >= upper_val and position is not None and position.direction.value == "long":
            return SignalType.SELL

        return SignalType.HOLD
