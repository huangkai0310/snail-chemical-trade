"use client";

import type { EwmaForecast, QuantReport } from "@/lib/quant-indicators";

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(digits)}%`;
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "up" | "down" | "muted";
}) {
  const color =
    tone === "up"
      ? "text-trade-up"
      : tone === "down"
        ? "text-trade-down"
        : tone === "muted"
          ? "text-t-text-3"
          : "text-t-text";
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-t-text-3 mb-0.5">{label}</div>
      <div className={`text-sm font-medium tabular-nums ${color}`} title={hint}>
        {value}
      </div>
    </div>
  );
}

interface Props {
  report: QuantReport | null;
  forecast: EwmaForecast | null;
  loading?: boolean;
  emptyHint?: string;
}

export default function QuantAnalysisPanel({ report, forecast, loading, emptyHint }: Props) {
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-t-text-3 bg-t-panel border border-t-border rounded">
        分析计算中…
      </div>
    );
  }

  if (!report) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-t-text-3 bg-t-panel border border-t-border rounded px-4 text-center">
        {emptyHint || "暂无足够行情样本，请切换周期或品种"}
      </div>
    );
  }

  const chgTone = report.price.changePct > 0 ? "up" : report.price.changePct < 0 ? "down" : undefined;

  return (
    <div className="h-full overflow-y-auto bg-t-panel border border-t-border rounded text-t-text">
      <div className="px-3 py-2 border-b border-t-border flex items-center justify-between">
        <span className="text-xs font-medium">量化摘要</span>
        <span className="text-[10px] text-t-text-3">样本 {report.rows}</span>
      </div>

      <section className="px-3 py-2.5 border-b border-t-border">
        <div className="text-[10px] text-t-text-3 mb-2">价格</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <Metric label="最新" value={fmt(report.price.last)} />
          <Metric label="区间涨跌" value={fmtPct(report.price.changePct)} tone={chgTone} />
          <Metric label="最高" value={fmt(report.price.high)} />
          <Metric label="最低" value={fmt(report.price.low)} />
        </div>
      </section>

      <section className="px-3 py-2.5 border-b border-t-border">
        <div className="text-[10px] text-t-text-3 mb-2">波动率</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <Metric
            label="年化已实现波动"
            value={fmtPct(report.volatility.realizedVolAnn)}
            hint="近窗对数收益年化标准差"
          />
          <Metric label="RV20" value={fmtPct(report.volatility.rv20Last)} />
          <Metric label="ATR14" value={fmt(report.volatility.atr14Last)} />
          <Metric label="ATR%" value={fmtPct(report.volatility.atr14Pct)} />
        </div>
      </section>

      <section className="px-3 py-2.5 border-b border-t-border">
        <div className="text-[10px] text-t-text-3 mb-2">动量</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <Metric label="MA5" value={fmt(report.momentum.ma5)} />
          <Metric label="MA20" value={fmt(report.momentum.ma20)} />
          <Metric label="RSI14" value={fmt(report.momentum.rsi14, 1)} />
          <Metric label="MACD柱" value={fmt(report.momentum.macdHist)} />
          <Metric
            label="布林位置"
            value={
              report.momentum.bollingerPosition == null
                ? "—"
                : report.momentum.bollingerPosition.toFixed(2)
            }
            hint="0=下轨，1=上轨"
          />
          <Metric label="胜率(近窗)" value={fmtPct(report.returns.winRate, 1)} />
        </div>
        {report.momentum.signals.length > 0 && (
          <ul className="mt-2 space-y-1">
            {report.momentum.signals.map((s) => (
              <li key={s} className="text-[11px] text-t-text-2 leading-snug">
                · {s}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="px-3 py-2.5">
        <div className="text-[10px] text-t-text-3 mb-2">EWMA 预测（研究用）</div>
        {!forecast ? (
          <div className="text-[11px] text-t-text-3">样本不足，无法外推</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 mb-2">
              <Metric label="μ(对数收益)" value={fmt(forecast.muLogReturn, 5)} />
              <Metric label="σ" value={fmt(forecast.sigmaLogReturn, 5)} />
            </div>
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-t-text-3 text-left">
                  <th className="font-normal py-0.5">步</th>
                  <th className="font-normal py-0.5 text-right">预测价</th>
                  <th className="font-normal py-0.5 text-right">相对涨跌</th>
                </tr>
              </thead>
              <tbody>
                {forecast.path.map((p) => (
                  <tr key={p.step} className="border-t border-t-border/60">
                    <td className="py-1 tabular-nums text-t-text-2">+{p.step}</td>
                    <td className="py-1 tabular-nums text-right">{fmt(p.close)}</td>
                    <td
                      className={`py-1 tabular-nums text-right ${
                        p.changePctFromLast > 0
                          ? "text-trade-up"
                          : p.changePctFromLast < 0
                            ? "text-trade-down"
                            : ""
                      }`}
                    >
                      {fmtPct(p.changePctFromLast)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[10px] text-t-text-3 leading-relaxed">{forecast.note}</p>
          </>
        )}
      </section>
    </div>
  );
}
