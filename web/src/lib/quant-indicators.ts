/**
 * 量化指标（与 data/quant Python 包口径对齐，供前端 /quant 使用）
 */
import type { PriceCandle } from "./types";

export interface QuantBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
  return: number | null;
  logReturn: number | null;
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  ma30: number | null;
  ema12: number | null;
  ema26: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  rsi14: number | null;
  bbMid: number | null;
  bbUpper: number | null;
  bbLower: number | null;
  rv20: number | null;
  atr14: number | null;
}

export interface QuantReport {
  rows: number;
  start: string | null;
  end: string | null;
  price: {
    last: number;
    openFirst: number;
    high: number;
    low: number;
    changePct: number;
  };
  returns: {
    mean: number | null;
    std: number | null;
    winRate: number | null;
  };
  volatility: {
    realizedVolAnn: number | null;
    rv20Last: number | null;
    atr14Last: number | null;
    atr14Pct: number | null;
  };
  momentum: {
    ma5: number | null;
    ma10: number | null;
    ma20: number | null;
    rsi14: number | null;
    macdHist: number | null;
    bollingerPosition: number | null;
    signals: string[];
  };
  volume: {
    last: number | null;
    mean: number | null;
  };
}

export interface ForecastPoint {
  step: number;
  close: number;
  changePctFromLast: number;
}

export interface EwmaForecast {
  method: string;
  span: number;
  horizon: number;
  muLogReturn: number;
  sigmaLogReturn: number;
  lastClose: number;
  path: ForecastPoint[];
  note: string;
}

function sma(values: number[], window: number, i: number): number | null {
  if (i + 1 < window) return null;
  let sum = 0;
  for (let j = i - window + 1; j <= i; j++) sum += values[j];
  return sum / window;
}

function emaSeries(values: number[], span: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length === 0) return out;
  const alpha = 2 / (span + 1);
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    prev = alpha * values[i] + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

function rsiSeries(closes: number[], window = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < window + 1) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= window; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) avgGain += d;
    else avgLoss -= d;
  }
  avgGain /= window;
  avgLoss /= window;
  const rs0 = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  out[window] = 100 - 100 / (1 + rs0);

  for (let i = window + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (window - 1) + gain) / window;
    avgLoss = (avgLoss * (window - 1) + loss) / window;
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
}

function atrSeries(highs: number[], lows: number[], closes: number[], window = 14): (number | null)[] {
  const tr: number[] = new Array(closes.length).fill(0);
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) {
      tr[i] = highs[i] - lows[i];
      continue;
    }
    tr[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
  }
  const out: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    out[i] = sma(tr, window, i);
  }
  return out;
}

/** 将平台 K 线 enrich 为指标序列 */
export function enrichCandles(candles: PriceCandle[]): QuantBar[] {
  if (!candles.length) return [];

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macdArr = closes.map((_, i) =>
    ema12[i] != null && ema26[i] != null ? (ema12[i] as number) - (ema26[i] as number) : null
  );
  // MACD signal：仅对有效 MACD 点做 EMA，再映射回原索引
  const macdForEma: number[] = [];
  const macdIndexMap: number[] = [];
  macdArr.forEach((v, i) => {
    if (v != null) {
      macdForEma.push(v);
      macdIndexMap.push(i);
    }
  });
  const macdSignalSparse = emaSeries(macdForEma, 9);
  const macdSignal: (number | null)[] = new Array(closes.length).fill(null);
  macdIndexMap.forEach((idx, j) => {
    macdSignal[idx] = macdSignalSparse[j];
  });

  const rsi = rsiSeries(closes, 14);
  const atr = atrSeries(highs, lows, closes, 14);

  const logRets: (number | null)[] = closes.map((c, i) =>
    i === 0 || c <= 0 || closes[i - 1] <= 0 ? null : Math.log(c / closes[i - 1])
  );

  return candles.map((c, i) => {
    const ma20 = sma(closes, 20, i);
    const std20 =
      i + 1 >= 20
        ? (() => {
            const slice = closes.slice(i - 19, i + 1);
            const mean = slice.reduce((a, b) => a + b, 0) / 20;
            const varSum = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / 20;
            return Math.sqrt(varSum);
          })()
        : null;

    let rv20: number | null = null;
    if (i + 1 >= 21) {
      const slice = logRets.slice(i - 19, i + 1).filter((x): x is number => x != null);
      if (slice.length >= 2) {
        const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
        const v = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / (slice.length - 1);
        rv20 = Math.sqrt(v) * Math.sqrt(252);
      }
    }

    return {
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      turnover: c.turnover,
      return: i === 0 || closes[i - 1] === 0 ? null : c.close / closes[i - 1] - 1,
      logReturn: logRets[i],
      ma5: sma(closes, 5, i),
      ma10: sma(closes, 10, i),
      ma20,
      ma30: sma(closes, 30, i),
      ema12: ema12[i],
      ema26: ema26[i],
      macd: macdArr[i],
      macdSignal: macdSignal[i],
      macdHist:
        macdArr[i] != null && macdSignal[i] != null
          ? (macdArr[i] as number) - (macdSignal[i] as number)
          : null,
      rsi14: rsi[i],
      bbMid: ma20,
      bbUpper: ma20 != null && std20 != null ? ma20 + 2 * std20 : null,
      bbLower: ma20 != null && std20 != null ? ma20 - 2 * std20 : null,
      rv20,
      atr14: atr[i],
    };
  });
}

export function buildQuantReport(bars: QuantBar[]): QuantReport | null {
  if (bars.length < 3) return null;
  const last = bars[bars.length - 1];
  const first = bars[0];
  const rets = bars.map((b) => b.return).filter((x): x is number => x != null);
  const logRets = bars.map((b) => b.logReturn).filter((x): x is number => x != null);
  const window = Math.min(20, Math.max(2, rets.length));
  const recent = rets.slice(-window);

  let realizedVolAnn: number | null = null;
  if (logRets.length >= 2) {
    const slice = logRets.slice(-Math.max(window, 2));
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const v = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / (slice.length - 1);
    realizedVolAnn = Math.sqrt(Math.max(v, 0)) * Math.sqrt(252);
  }

  const signals: string[] = [];
  if (bars.length < 20) {
    signals.push(`样本仅 ${bars.length} 根，动量/波动率信号参考性有限`);
  }
  if (last.ma5 != null && last.ma20 != null) {
    if (last.ma5 > last.ma20) signals.push("短均线位于长均线上方（偏多）");
    else if (last.ma5 < last.ma20) signals.push("短均线位于长均线下方（偏空）");
  }
  if (last.rsi14 != null) {
    if (last.rsi14 >= 70) signals.push("RSI 超买区");
    else if (last.rsi14 <= 30) signals.push("RSI 超卖区");
    else signals.push("RSI 中性区");
  }

  let bollingerPosition: number | null = null;
  if (last.bbUpper != null && last.bbLower != null) {
    const width = last.bbUpper - last.bbLower;
    if (width > 0) bollingerPosition = (last.close - last.bbLower) / width;
  }

  const vols = bars.map((b) => b.volume);
  const volWindow = vols.slice(-(window || 1));

  return {
    rows: bars.length,
    start: first.time,
    end: last.time,
    price: {
      last: last.close,
      openFirst: first.open,
      high: Math.max(...bars.map((b) => b.high)),
      low: Math.min(...bars.map((b) => b.low)),
      changePct: first.close !== 0 ? last.close / first.close - 1 : 0,
    },
    returns: {
      mean: recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null,
      std:
        recent.length > 1
          ? Math.sqrt(
              recent.reduce((a, b) => a + (b - recent.reduce((x, y) => x + y, 0) / recent.length) ** 2, 0) /
                (recent.length - 1)
            )
          : 0,
      winRate: recent.length ? recent.filter((r) => r > 0).length / recent.length : null,
    },
    volatility: {
      realizedVolAnn,
      rv20Last: last.rv20,
      atr14Last: last.atr14,
      atr14Pct: last.atr14 != null && last.close ? last.atr14 / last.close : null,
    },
    momentum: {
      ma5: last.ma5,
      ma10: last.ma10,
      ma20: last.ma20,
      rsi14: last.rsi14,
      macdHist: last.macdHist,
      bollingerPosition,
      signals,
    },
    volume: {
      last: last.volume,
      mean: volWindow.length ? volWindow.reduce((a, b) => a + b, 0) / volWindow.length : null,
    },
  };
}

export function ewmaForecast(bars: QuantBar[], horizon = 5, span = 10): EwmaForecast | null {
  if (bars.length < Math.max(span, 5) || horizon < 1) return null;
  const logRets = bars.map((b) => b.logReturn).filter((x): x is number => x != null);
  if (logRets.length < span) return null;

  const alpha = 2 / (span + 1);
  let mu = logRets[0];
  let varEwma = 0;
  for (let i = 1; i < logRets.length; i++) {
    const prevMu = mu;
    mu = alpha * logRets[i] + (1 - alpha) * mu;
    const diff = logRets[i] - prevMu;
    varEwma = (1 - alpha) * (varEwma + alpha * diff * diff);
  }
  const sigma = Math.sqrt(Math.max(varEwma, 0));
  const lastClose = bars[bars.length - 1].close;
  const path: ForecastPoint[] = [];
  let price = lastClose;
  for (let i = 1; i <= horizon; i++) {
    price *= Math.exp(mu);
    path.push({
      step: i,
      close: price,
      changePctFromLast: price / lastClose - 1,
    });
  }

  return {
    method: "ewma_log_return",
    span,
    horizon,
    muLogReturn: mu,
    sigmaLogReturn: sigma,
    lastClose,
    path,
    note: "仅供研究参考，非投资建议。",
  };
}
