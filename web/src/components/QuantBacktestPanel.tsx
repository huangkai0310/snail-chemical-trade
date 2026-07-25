"use client";

import { useMemo, useState } from "react";
import type { QuantBar } from "@/lib/quant-indicators";
import {
  STRATEGY_CATALOG,
  runBacktest,
  type BacktestResult,
  type StrategyId,
} from "@/lib/quant-backtest";

function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(digits)}%`;
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

function tone(n: number | null | undefined): string {
  if (n == null || n === 0) return "text-t-text";
  return n > 0 ? "text-trade-up" : "text-trade-down";
}

function EquitySparkline({ result }: { result: BacktestResult }) {
  const pts = result.equity;
  if (pts.length < 2) return null;
  const vals = pts.map((p) => p.equity);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const w = 280;
  const h = 64;
  const span = max - min || 1;
  const d = vals
    .map((v, i) => {
      const x = (i / (vals.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = vals[vals.length - 1];
  const first = vals[0];
  const up = last >= first;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16" preserveAspectRatio="none">
      <path
        d={d}
        fill="none"
        stroke={up ? "var(--color-up, #ef4444)" : "var(--color-down, #22c55e)"}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

interface Props {
  bars: QuantBar[];
}

export default function QuantBacktestPanel({ bars }: Props) {
  const [strategyId, setStrategyId] = useState<StrategyId>("dual_ma");
  const [feeBps, setFeeBps] = useState(5);
  const [params, setParams] = useState<Record<string, number>>({});

  const meta = STRATEGY_CATALOG.find((s) => s.id === strategyId)!;

  const mergedParams = useMemo(() => {
    const base: Record<string, number> = {};
    for (const p of meta.params) base[p.key] = params[p.key] ?? p.default;
    return base;
  }, [meta, params]);

  const result = useMemo(() => {
    if (bars.length < 10) return null;
    return runBacktest(bars, {
      strategyId,
      params: mergedParams,
      feeBps,
    });
  }, [bars, strategyId, mergedParams, feeBps]);

  return (
    <div className="h-full overflow-y-auto bg-t-panel border border-t-border rounded text-t-text">
      <div className="px-3 py-2 border-b border-t-border">
        <div className="text-xs font-medium mb-0.5">策略回测</div>
        <div className="text-[10px] text-t-text-3">研究工具 · 不做自动下单</div>
      </div>

      <section className="px-3 py-2.5 border-b border-t-border space-y-2">
        <label className="block text-[10px] text-t-text-3">策略模板</label>
        <select
          value={strategyId}
          onChange={(e) => {
            setStrategyId(e.target.value as StrategyId);
            setParams({});
          }}
          className="w-full text-xs px-2 py-1.5 rounded border bg-t-input outline-none focus:border-t-accent"
          style={{ borderColor: "var(--border-color)" }}
        >
          {STRATEGY_CATALOG.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-t-text-2 leading-snug">{meta.description}</p>

        {meta.params.length > 0 && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            {meta.params.map((p) => (
              <label key={p.key} className="text-[10px] text-t-text-3">
                {p.label}
                <input
                  type="number"
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  value={mergedParams[p.key]}
                  onChange={(e) =>
                    setParams((prev) => ({
                      ...prev,
                      [p.key]: Number(e.target.value),
                    }))
                  }
                  className="mt-0.5 w-full text-xs px-2 py-1 rounded border bg-t-input text-t-text outline-none focus:border-t-accent tabular-nums"
                  style={{ borderColor: "var(--border-color)" }}
                />
              </label>
            ))}
          </div>
        )}

        <label className="block text-[10px] text-t-text-3 pt-1">
          单边费率 (bps)
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={feeBps}
            onChange={(e) => setFeeBps(Number(e.target.value) || 0)}
            className="mt-0.5 w-full text-xs px-2 py-1 rounded border bg-t-input text-t-text outline-none focus:border-t-accent tabular-nums"
            style={{ borderColor: "var(--border-color)" }}
          />
        </label>
      </section>

      {!result ? (
        <div className="px-3 py-8 text-center text-[11px] text-t-text-3">
          至少需要约 10 根 K 线才能回测。可切换日线/小时线或更换品种。
        </div>
      ) : (
        <>
          <section className="px-3 py-2.5 border-b border-t-border">
            <div className="text-[10px] text-t-text-3 mb-1">净值曲线</div>
            <EquitySparkline result={result} />
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-2">
              <div>
                <div className="text-[10px] text-t-text-3">策略收益</div>
                <div className={`text-sm font-medium tabular-nums ${tone(result.metrics.totalReturn)}`}>
                  {fmtPct(result.metrics.totalReturn)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-t-text-3">买入持有</div>
                <div className={`text-sm font-medium tabular-nums ${tone(result.metrics.buyHoldReturn)}`}>
                  {fmtPct(result.metrics.buyHoldReturn)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-t-text-3">超额</div>
                <div className={`text-sm font-medium tabular-nums ${tone(result.metrics.excessReturn)}`}>
                  {fmtPct(result.metrics.excessReturn)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-t-text-3">最大回撤</div>
                <div className="text-sm font-medium tabular-nums text-t-text">
                  {fmtPct(-result.metrics.maxDrawdown)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-t-text-3">夏普（年化）</div>
                <div className="text-sm font-medium tabular-nums">{fmtNum(result.metrics.sharpe)}</div>
              </div>
              <div>
                <div className="text-[10px] text-t-text-3">胜率</div>
                <div className="text-sm font-medium tabular-nums">{fmtPct(result.metrics.winRate, 1)}</div>
              </div>
              <div>
                <div className="text-[10px] text-t-text-3">交易次数</div>
                <div className="text-sm font-medium tabular-nums">{result.metrics.tradeCount}</div>
              </div>
              <div>
                <div className="text-[10px] text-t-text-3">盈亏因子</div>
                <div className="text-sm font-medium tabular-nums">{fmtNum(result.metrics.profitFactor)}</div>
              </div>
            </div>
          </section>

          <section className="px-3 py-2.5">
            <div className="text-[10px] text-t-text-3 mb-1.5">
              成交明细（最近 {Math.min(8, result.trades.length)} 笔）
            </div>
            {result.trades.length === 0 ? (
              <div className="text-[11px] text-t-text-3">区间内无开平仓</div>
            ) : (
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-t-text-3 text-left">
                    <th className="font-normal py-0.5">入场</th>
                    <th className="font-normal py-0.5 text-right">收益</th>
                  </tr>
                </thead>
                <tbody>
                  {[...result.trades].slice(-8).reverse().map((t, i) => (
                    <tr key={`${t.entryTime}-${i}`} className="border-t border-t-border/60">
                      <td className="py-1 text-t-text-2 tabular-nums">
                        {t.entryTime.slice(0, 10)}
                        <span className="text-t-text-3"> → </span>
                        {t.exitTime.slice(0, 10)}
                      </td>
                      <td className={`py-1 text-right tabular-nums ${tone(t.returnPct)}`}>
                        {fmtPct(t.returnPct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-2 text-[10px] text-t-text-3 leading-relaxed">{result.note}</p>
          </section>
        </>
      )}
    </div>
  );
}
