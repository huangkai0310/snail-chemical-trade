"""量化回测引擎。

核心概念：
- Signal: 策略在某个时间点产生的交易信号（买入/卖出/持有）
- Position: 持仓（direction: long/short/flat, qty, entry_price, entry_time）
- Trade: 实际成交记录（包含滑点、手续费模拟）
- Bar: OHLCV 行情数据
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Protocol

import pandas as pd

if TYPE_CHECKING:
    from quant.strategies.base import Strategy


class Direction(Enum):
    LONG = "long"    # 做多
    SHORT = "short"  # 做空
    FLAT = "flat"    # 空仓


class SignalType(Enum):
    BUY = "buy"    # 买入开多 / 买入平空
    SELL = "sell"  # 卖出平多 / 卖出开空
    HOLD = "hold"  # 持有不动


@dataclass
class Bar:
    """单根 K 线。"""
    time: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float
    turnover: float = 0.0
    product_id: str = ""
    delivery_period: str = "现货"
    interval: str = "1d"
    source: str = ""

    @classmethod
    def from_row(cls, row: pd.Series) -> "Bar":
        return cls(
            time=row["time"] if isinstance(row["time"], datetime) else pd.to_datetime(row["time"]).to_pydatetime(),
            open=float(row["open"]),
            high=float(row["high"]),
            low=float(row["low"]),
            close=float(row["close"]),
            volume=float(row["volume"]),
            turnover=float(row.get("turnover", 0)),
            product_id=str(row.get("product_id", "")),
            delivery_period=str(row.get("delivery_period", "现货")),
            interval=str(row.get("interval", "1d")),
            source=str(row.get("source", "")),
        )


@dataclass
class Trade:
    """成交记录。"""
    time: datetime
    direction: Direction       # 本次操作的方向
    qty: float                 # 成交数量
    price: float               # 成交价格（含滑点）
    commission: float = 0.0    # 手续费
    pnl: float = 0.0           # 平仓盈亏（仅平仓时填写）
    signal_type: SignalType = SignalType.HOLD

    @property
    def value(self) -> float:
        return self.qty * self.price


@dataclass
class Position:
    """当前持仓。"""
    direction: Direction
    qty: float
    entry_price: float
    entry_time: datetime
    product_id: str = ""
    unrealized_pnl: float = 0.0  # 浮动盈亏（按最新价计算）

    def update_unrealized(self, current_price: float, direction: Direction) -> None:
        if self.direction == direction:
            self.unrealized_pnl = (current_price - self.entry_price) * self.qty
        else:
            self.unrealized_pnl = 0.0


@dataclass
class BarFeed:
    """K 线数据流，按时间顺序迭代。"""
    bars: list[Bar] = field(default_factory=list)
    _idx: int = 0

    def __len__(self) -> int:
        return len(self.bars)

    def __iter__(self):
        self._idx = 0
        return self

    def __next__(self) -> Bar:
        if self._idx >= len(self.bars):
            raise StopIteration
        bar = self.bars[self._idx]
        self._idx += 1
        return bar

    def current(self) -> Bar | None:
        if self._idx <= 0 or self._idx > len(self.bars):
            return None
        return self.bars[self._idx - 1]

    def peek(self, n: int = 1) -> Bar | None:
        idx = self._idx + n - 1
        if idx < 0 or idx >= len(self.bars):
            return None
        return self.bars[idx]

    @classmethod
    def from_dataframe(cls, df: pd.DataFrame) -> "BarFeed":
        bars = [Bar.from_row(row) for _, row in df.iterrows()]
        return cls(bars=bars)


# ─── 手续费与滑点模型 ─────────────────────────────────────────

@dataclass
class CostModel:
    """交易成本模型。"""
    commission_rate: float = 0.0003   # 手续费率（万分之3）
    slippage_bps: float = 1.0          # 滑点（基点，默认 1bp = 0.01%）
    commission_min: float = 5.0        # 每笔最低手续费

    def apply_slippage(self, price: float, direction: Direction, signal: SignalType) -> float:
        """对价格施加滑点。买入↑，卖出↓。"""
        if signal == SignalType.BUY:
            return price * (1 + self.slippage_bps / 10000)
        elif signal == SignalType.SELL:
            return price * (1 - self.slippage_bps / 10000)
        return price

    def calc_commission(self, value: float) -> float:
        c = value * self.commission_rate
        return max(c, self.commission_min)


# ─── 回测引擎 ─────────────────────────────────────────────────

@dataclass
class BacktestStats:
    """回测统计指标。"""
    total_trades: int = 0
    winning_trades: int = 0
    losing_trades: int = 0
    total_pnl: float = 0.0
    total_commission: float = 0.0
    max_drawdown: float = 0.0
    max_drawdown_pct: float = 0.0
    sharpe_ratio: float = 0.0
    win_rate: float = 0.0
    avg_win: float = 0.0
    avg_loss: float = 0.0
    profit_factor: float = 0.0
    annualized_return: float = 0.0
    annualized_volatility: float = 0.0
    trades: list[Trade] = field(default_factory=list)
    equity_curve: list[tuple[datetime, float]] = field(default_factory=list)

    def finalize(self, initial_capital: float, risk_free_rate: float = 0.03) -> None:
        if not self.trades:
            return

        if self.winning_trades > 0:
            self.win_rate = self.winning_trades / self.total_trades
        if self.avg_loss != 0:
            self.profit_factor = abs(self.avg_win / self.avg_loss)

        if self.equity_curve:
            equity = pd.Series([e[1] for e in self.equity_curve])
            # 最大回撤
            peak = equity.cummax()
            drawdown = (equity - peak) / peak * 100
            self.max_drawdown_pct = abs(drawdown.min())

            # 年化收益率
            returns = equity.pct_change().dropna()
            if len(returns) > 1:
                self.annualized_return = returns.mean() * 252
                self.annualized_volatility = returns.std() * (252 ** 0.5)
                # 夏普比率
                excess = self.annualized_return - risk_free_rate
                if self.annualized_volatility > 0:
                    self.sharpe_ratio = excess / self.annualized_volatility

    def summary(self) -> str:
        return f"""=== 回测统计 ===
交易次数: {self.total_trades}  盈利: {self.winning_trades}  亏损: {self.losing_trades}
胜率: {self.win_rate:.1%}
平均盈利: {self.avg_win:.2f}  平均亏损: {self.avg_loss:.2f}
盈亏比: {self.profit_factor:.2f}
总盈亏: {self.total_pnl:.2f}  总手续费: {self.total_commission:.2f}
最大回撤: {self.max_drawdown_pct:.1f}%
年化收益: {self.annualized_return:.1%}
年化波动: {self.annualized_volatility:.1%}
夏普比率: {self.sharpe_ratio:.2f}
"""


class BacktestEngine:
    """回测引擎。

    运行流程：
    1. 初始化（设置初始资金、手续费模型）
    2. 注册策略
    3. load_data 加载 K 线
    4. run 运行回测
    5. get_stats 获取统计结果
    """

    def __init__(
        self,
        initial_capital: float = 1_000_000.0,
        cost_model: CostModel | None = None,
    ) -> None:
        self.initial_capital = initial_capital
        self.cost_model = cost_model or CostModel()
        self.strategy: Strategy | None = None
        self.stats = BacktestStats()
        self._feed: BarFeed | None = None
        self._position: Position | None = None
        self._cash: float = initial_capital
        self._equity: float = initial_capital
        self._closed_trades: list[Trade] = []
        self._pnl_list: list[float] = []
        self._peak_equity: float = initial_capital

    def set_strategy(self, strategy: "Strategy") -> None:
        self.strategy = strategy

    def load_data(self, df: pd.DataFrame) -> None:
        self._feed = BarFeed.from_dataframe(df)

    def run(self) -> BacktestStats:
        if self._feed is None:
            raise ValueError("请先 load_data 加载 K 线数据")
        if self.strategy is None:
            raise ValueError("请先 set_strategy 注册策略")

        self.strategy.on_init()

        for bar in self._feed:
            self._tick(bar)

        self.strategy.on_finish()
        self._finalize_stats()
        return self.stats

    def _tick(self, bar: Bar) -> None:
        # 更新浮动盈亏
        if self._position:
            self._position.update_unrealized(bar.close, Direction.LONG)
            current_value = self._cash + (
                self._position.qty * bar.close
                if self._position.direction == Direction.LONG
                else self._position.qty * (self._position.entry_price * 2 - bar.close)
            )
        else:
            current_value = self._cash

        self._equity = current_value
        if self._equity > self._peak_equity:
            self._peak_equity = self._equity
        self.stats.equity_curve.append((bar.time, self._equity))

        # 策略产生信号
        signal = self.strategy.on_bar(bar, self._position)

        if signal == SignalType.BUY:
            self._buy(bar)
        elif signal == SignalType.SELL:
            self._sell(bar)

    def _buy(self, bar: Bar) -> None:
        # 可用资金买入（按当前价全仓买入）
        price = self.cost_model.apply_slippage(bar.close, Direction.LONG, SignalType.BUY)
        qty = self._cash / price * 0.95  # 预留手续费
        if qty <= 0:
            return

        commission = self.cost_model.calc_commission(qty * price)
        self._cash -= qty * price + commission
        self.stats.total_commission += commission

        if self._position and self._position.direction == Direction.SHORT:
            # 平空仓
            pnl = (self._position.entry_price - price) * self._position.qty
            self.stats.total_pnl += pnl
            self._pnl_list.append(pnl)
            self.stats.trades.append(Trade(
                time=bar.time, direction=Direction.LONG, qty=qty, price=price,
                commission=commission, pnl=pnl, signal_type=SignalType.BUY,
            ))
            self._position = None
        else:
            self._position = Position(
                direction=Direction.LONG, qty=qty, entry_price=price,
                entry_time=bar.time, product_id=bar.product_id,
            )

        self.stats.total_trades += 1

    def _sell(self, bar: Bar) -> None:
        if not self._position:
            return

        price = self.cost_model.apply_slippage(bar.close, Direction.FLAT, SignalType.SELL)
        qty = self._position.qty
        commission = self.cost_model.calc_commission(qty * price)
        self._cash += qty * price - commission
        self.stats.total_commission += commission

        if self._position.direction == Direction.LONG:
            pnl = (price - self._position.entry_price) * qty
            self.stats.total_pnl += pnl
            self._pnl_list.append(pnl)
        else:
            # 平空仓
            pnl = (self._position.entry_price - price) * qty
            self.stats.total_pnl += pnl
            self._pnl_list.append(pnl)

        self.stats.trades.append(Trade(
            time=bar.time, direction=Direction.FLAT, qty=qty, price=price,
            commission=commission, pnl=pnl, signal_type=SignalType.SELL,
        ))
        self._position = None
        self.stats.total_trades += 1

    def _finalize_stats(self) -> None:
        wins = [p for p in self._pnl_list if p > 0]
        losses = [p for p in self._pnl_list if p < 0]
        self.stats.winning_trades = len(wins)
        self.stats.losing_trades = len(losses)
        if wins:
            self.stats.avg_win = sum(wins) / len(wins)
        if losses:
            self.stats.avg_loss = sum(losses) / len(losses)
        self.stats.finalize(self.initial_capital)
