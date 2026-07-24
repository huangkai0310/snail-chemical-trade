"""策略基类。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

import pandas as pd

if TYPE_CHECKING:
    from quant.engine.backtest import Bar, Direction, SignalType, Position


class Strategy(ABC):
    """策略基类。

    使用方式：
    1. 继承 Strategy
    2. 实现 on_bar() 返回 SignalType
    3. 可选覆盖 on_init() / on_finish()
    4. 策略内可维护 self.data（历史 DataFrame）和 self.position

    推荐：K 线到达时，用 self.data 追加 bar 计算指标，
    再决定 SignalType。self.data 在 on_init 时应初始化为空 DataFrame。
    """

    def __init__(self, name: str = "Strategy") -> None:
        self.name = name
        self.data: pd.DataFrame = pd.DataFrame()
        self.position: Position | None = None

    def on_init(self) -> None:
        """回测开始前调用，可初始化数据结构和计算指标。"""
        self.data = pd.DataFrame()

    @abstractmethod
    def on_bar(self, bar: "Bar", position: "Position | None") -> "SignalType":
        """每根 K 线到达时调用。

        Args:
            bar: 当前 K 线
            position: 当前持仓（None 表示空仓）

        Returns:
            SignalType.BUY  → 买入/开多
            SignalType.SELL → 卖出/平仓
            SignalType.HOLD → 不操作
        """
        ...

    def on_finish(self) -> None:
        """回测结束时调用，可做清理或输出。"""
        pass

    def _append_bar(self, bar: "Bar") -> None:
        """将 bar 追加到 self.data，供指标计算使用。"""
        row = pd.DataFrame([{
            "time": bar.time,
            "open": bar.open,
            "high": bar.high,
            "low": bar.low,
            "close": bar.close,
            "volume": bar.volume,
        }])
        self.data = pd.concat([self.data, row], ignore_index=True)

    @property
    def close_series(self) -> pd.Series:
        return self.data["close"]

    @property
    def volume_series(self) -> pd.Series:
        return self.data["volume"]
