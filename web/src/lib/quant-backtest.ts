/**
 * 用户侧策略回测引擎（研究用，非自动交易）
 * 规则：信号在当根收盘确认，下一根开盘成交；仅做多/空仓（贴合现货挂摘）。
 */
import type { QuantBar } from "./quant-indicators";

export type StrategyId = "dual_ma" | "rsi_reversion" | "macd_cross" | "buy_hold";

export interface StrategyMeta {
  id: StrategyId;
  name: string;
  description: string;
  params: { key: string; label: string; default: number; min: number; max: number; step: number }[];
}

export const STRATEGY_CATALOG: StrategyMeta[] = [
  {
    id: "dual_ma",
    name: "双均线交叉",
    description: "快线上穿慢线开多，下穿平仓。",
    params: [
      { key: "fast", label: "快线", default: 5, min: 2, max: 60, step: 1 },
      { key: "slow", label: "慢线", default: 20, min: 5, max: 120, step: 1 },
    ],
  },
  {
    id: "rsi_reversion",
    name: "RSI 均值回归",
    description: "RSI 低于超卖线开多，高于超买线平仓。",
    params: [
      { key: "period", label: "周期", default: 14, min: 5, max: 40, step: 1 },
      { key: "oversold", label: "超卖", default: 30, min: 10, max: 40, step: 1 },
      { key: "overbought", label: "超买", default: 70, min: 60, max: 90, step: 1 },
    ],
  },
  {
    id: "macd_cross",
    name: "MACD 零轴交叉",
    description: "MACD 柱由负转正开多，由正转负平仓。",
    params: [],
  },
  {
    id: "buy_hold",
    name: "买入持有（基准）",
    description: "首根可交易开盘买入并持有至结束。",
    params: [],
  },
];

export interface BacktestTrade {
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  returnPct: number;
  barsHeld: number;
}

export interface EquityPoint {
  time: string;
  equity: number;
  price: number;
  position: 0 | 1;
}

export interface BacktestMetrics {
  totalReturn: number;
  buyHoldReturn: number;
  excessReturn: number;
  maxDrawdown: number;
  sharpe: number | null;
  winRate: number | null;
  tradeCount: number;
  avgTradeReturn: number | null;
  profitFactor: number | null;
  bars: number;
  feeBps: number;
}

export interface BacktestResult {
  strategyId: StrategyId;
  params: Record<string, number>;
  metrics: BacktestMetrics;
  equity: EquityPoint[];
  trades: BacktestTrade[];
  note: string;
}

export interface BacktestOptions {
  strategyId: StrategyId;
  params?: Record<string, number>;
  /** 单边费率（基点），开平各收一次 */
  feeBps?: number;
  initialCapital?: number;
}

function smaAt(closes: number[], window: number, i: number): number | null {
  if (i + 1 < window) return null;
  let s = 0;
  for (let j = i - window + 1; j <= i; j++) s += closes[j];
  return s / window;
}

function rsiAt(closes: number[], period: number, i: number): number | null {
  if (i < period) return null;
  let gain = 0;
  let loss = 0;
  for (let j = i - period + 1; j <= i; j++) {
    const d = closes[j] - closes[j - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  const avgGain = gain / period;
  const avgLoss = loss / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** 生成目标仓位序列（0/1），基于当根收盘信息；实际成交延后一根 */
function targetPositions(
  bars: QuantBar[],
  strategyId: StrategyId,
  params: Record<string, number>
): (0 | 1)[] {
  const n = bars.length;
  const closes = bars.map((b) => b.close);
  const out: (0 | 1)[] = new Array(n).fill(0);

  if (strategyId === "buy_hold") {
    for (let i = 0; i < n; i++) out[i] = 1;
    return out;
  }

  if (strategyId === "dual_ma") {
    const fast = Math.max(2, Math.floor(params.fast ?? 5));
    const slow = Math.max(fast + 1, Math.floor(params.slow ?? 20));
    let pos: 0 | 1 = 0;
    for (let i = 0; i < n; i++) {
      const f = smaAt(closes, fast, i);
      const s = smaAt(closes, slow, i);
      if (f != null && s != null) {
        if (f > s) pos = 1;
        else if (f < s) pos = 0;
      }
      out[i] = pos;
    }
    return out;
  }

  if (strategyId === "rsi_reversion") {
    const period = Math.max(5, Math.floor(params.period ?? 14));
    const oversold = params.oversold ?? 30;
    const overbought = params.overbought ?? 70;
    let pos: 0 | 1 = 0;
    for (let i = 0; i < n; i++) {
      const r = rsiAt(closes, period, i);
      if (r != null) {
        if (r <= oversold) pos = 1;
        else if (r >= overbought) pos = 0;
      }
      out[i] = pos;
    }
    return out;
  }

  // macd_cross：用已 enrich 的 macdHist
  let pos: 0 | 1 = 0;
  for (let i = 0; i < n; i++) {
    const h = bars[i].macdHist;
    const prev = i > 0 ? bars[i - 1].macdHist : null;
    if (h != null && prev != null) {
      if (prev <= 0 && h > 0) pos = 1;
      else if (prev >= 0 && h < 0) pos = 0;
    }
    out[i] = pos;
  }
  return out;
}

function maxDrawdown(equity: number[]): number {
  let peak = equity[0] ?? 1;
  let maxDd = 0;
  for (const e of equity) {
    if (e > peak) peak = e;
    if (peak > 0) {
      const dd = (peak - e) / peak;
      if (dd > maxDd) maxDd = dd;
    }
  }
  return maxDd;
}

function sharpeFromReturns(rets: number[], periodsPerYear = 252): number | null {
  if (rets.length < 2) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v =
    rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  const std = Math.sqrt(Math.max(v, 0));
  if (std === 0) return null;
  return (mean / std) * Math.sqrt(periodsPerYear);
}

export function runBacktest(bars: QuantBar[], options: BacktestOptions): BacktestResult | null {
  if (bars.length < 10) return null;

  const strategyId = options.strategyId;
  const meta = STRATEGY_CATALOG.find((s) => s.id === strategyId);
  const params: Record<string, number> = {};
  for (const p of meta?.params ?? []) {
    params[p.key] = options.params?.[p.key] ?? p.default;
  }
  Object.assign(params, options.params ?? {});

  const feeBps = options.feeBps ?? 5;
  const fee = feeBps / 10000;
  const capital0 = options.initialCapital ?? 1_000_000;

  const targets = targetPositions(bars, strategyId, params);
  // 下一根开盘执行：position[i] = targets[i-1]
  const position: (0 | 1)[] = new Array(bars.length).fill(0);
  for (let i = 1; i < bars.length; i++) {
    position[i] = targets[i - 1];
  }

  let cash = capital0;
  let shares = 0;
  let entryPrice = 0;
  let entryIdx = 0;
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];
  const barReturns: number[] = [];

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const want = position[i];
    const have: 0 | 1 = shares > 0 ? 1 : 0;

    if (want !== have) {
      if (want === 1 && have === 0) {
        // 开多：用开盘价
        const px = bar.open * (1 + fee);
        shares = cash / px;
        cash = 0;
        entryPrice = px;
        entryIdx = i;
      } else if (want === 0 && have === 1) {
        const px = bar.open * (1 - fee);
        cash = shares * px;
        trades.push({
          entryTime: bars[entryIdx].time,
          exitTime: bar.time,
          entryPrice,
          exitPrice: px,
          returnPct: px / entryPrice - 1,
          barsHeld: i - entryIdx,
        });
        shares = 0;
        entryPrice = 0;
      }
    }

    const equity = cash + shares * bar.close;
    equityCurve.push({
      time: bar.time,
      equity,
      price: bar.close,
      position: shares > 0 ? 1 : 0,
    });

    if (i > 0) {
      const prev = equityCurve[i - 1].equity;
      barReturns.push(prev > 0 ? equity / prev - 1 : 0);
    }
  }

  // 若仍持仓，按最后收盘平仓计入统计（不强制成交，仅评估）
  if (shares > 0) {
    const last = bars[bars.length - 1];
    const px = last.close * (1 - fee);
    trades.push({
      entryTime: bars[entryIdx].time,
      exitTime: last.time,
      entryPrice,
      exitPrice: px,
      returnPct: px / entryPrice - 1,
      barsHeld: bars.length - 1 - entryIdx,
    });
  }

  const equityEnd = equityCurve[equityCurve.length - 1]?.equity ?? capital0;
  const totalReturn = equityEnd / capital0 - 1;
  const buyHoldReturn =
    bars[0].open > 0
      ? (bars[bars.length - 1].close * (1 - fee)) / (bars[0].open * (1 + fee)) - 1
      : 0;

  const wins = trades.filter((t) => t.returnPct > 0);
  const losses = trades.filter((t) => t.returnPct <= 0);
  const grossProfit = wins.reduce((a, t) => a + t.returnPct, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.returnPct, 0));

  const metrics: BacktestMetrics = {
    totalReturn,
    buyHoldReturn,
    excessReturn: totalReturn - buyHoldReturn,
    maxDrawdown: maxDrawdown(equityCurve.map((e) => e.equity)),
    sharpe: sharpeFromReturns(barReturns),
    winRate: trades.length ? wins.length / trades.length : null,
    tradeCount: trades.length,
    avgTradeReturn: trades.length
      ? trades.reduce((a, t) => a + t.returnPct, 0) / trades.length
      : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : 0,
    bars: bars.length,
    feeBps,
  };

  return {
    strategyId,
    params,
    metrics,
    equity: equityCurve,
    trades,
    note: "研究回测：信号收盘确认、次日开盘成交；费率开平各收。非投资建议，不构成自动下单。",
  };
}
