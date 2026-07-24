"""趋势跟踪策略：双均线交叉（Golden Cross / Death Cross）。"""

from __future__ import annotations

from quant.engine.backtest import Bar, Direction, SignalType
from quant.strategies.base import Strategy


class TrendFollowingStrategy(Strategy):
    """双均线交叉策略。

    - 快速线上穿慢速线 → BUY（金叉）
    - 快速线下穿慢速线 → SELL（死叉）
    - 已有持仓时仅在反向信号操作

    Args:
        fast_period: 快速均线周期（默认 5）
        slow_period: 慢速均线周期（默认 20）
    """

    def __init__(
        self,
        fast_period: int = 5,
        slow_period: int = 10,
    ) -> None:
        super().__init__(name=f"MA({fast_period},{slow_period})趋势")
        self.fast_period = fast_period
        self.slow_period = slow_period
        self._prev_fast: float | None = None

    def on_init(self) -> None:
        super().on_init()
        self._prev_fast = None

    def on_bar(self, bar: Bar, position: Direction | None) -> SignalType:
        self._append_bar(bar)
        n = len(self.data)

        if n < self.slow_period:
            return SignalType.HOLD

        fast = self.data["close"].rolling(self.fast_period).mean().iloc[-1]
        slow = self.data["close"].rolling(self.slow_period).mean().iloc[-1]

        if self._prev_fast is None:
            self._prev_fast = fast
            return SignalType.HOLD

        prev_fast = self._prev_fast
        prev_slow = self.data["close"].rolling(self.slow_period).mean().iloc[-2] if n > self.slow_period else slow

        # 金叉：快上穿慢，且当前慢仓或空仓
        if prev_fast <= prev_slow and fast > slow:
            if position is None or position.direction.value == "short":
                self._prev_fast = fast
                return SignalType.BUY

        # 死叉：快下穿慢，且当前多头持仓
        if prev_fast >= prev_slow and fast < slow:
            if position is not None and position.direction.value == "long":
                self._prev_fast = fast
                return SignalType.SELL

        self._prev_fast = fast
        return SignalType.HOLD
