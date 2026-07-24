"""预置策略包。"""

from quant.strategies.base import Strategy
from quant.strategies.trend import TrendFollowingStrategy
from quant.strategies.mean_reversion import BollingerBandStrategy
from quant.strategies.breakout import BreakoutStrategy

__all__ = [
    "Strategy",
    "TrendFollowingStrategy",
    "BollingerBandStrategy",
    "BreakoutStrategy",
]
