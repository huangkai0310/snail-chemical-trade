"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CandlestickData, HistogramData, LineData } from "lightweight-charts";
import TradingViewChart from "@/components/TradingViewChart";
import QuantAnalysisPanel from "@/components/QuantAnalysisPanel";
import QuantBacktestPanel from "@/components/QuantBacktestPanel";
import ErrorBoundary from "@/components/ErrorBoundary";
import { fetchProducts, fetchPriceHistory } from "@/lib/api";
import type { PriceCandle, Product, DataSource } from "@/lib/types";
import DataSourceSelector from "@/components/DataSourceSelector";
import {
  buildQuantReport,
  enrichCandles,
  ewmaForecast,
} from "@/lib/quant-indicators";

const INTERVALS: { key: string; label: string; limit: number }[] = [
  { key: "30m", label: "30分", limit: 120 },
  { key: "1h", label: "1小时", limit: 168 },
  { key: "4h", label: "4小时", limit: 120 },
  { key: "1d", label: "日线", limit: 120 },
  { key: "1w", label: "周线", limit: 104 },
];

function toCandles(data: PriceCandle[]): CandlestickData[] {
  return data.map((c) => ({
    time: Math.floor(new Date(c.time).getTime() / 1000) as CandlestickData["time"],
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
}

function toVolume(data: PriceCandle[]): HistogramData[] {
  return data.map((c) => ({
    time: Math.floor(new Date(c.time).getTime() / 1000) as HistogramData["time"],
    value: c.volume,
    color: c.close >= c.open ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)",
  }));
}

function maLine(
  candles: CandlestickData[],
  values: (number | null)[]
): LineData[] {
  const out: LineData[] = [];
  for (let i = 0; i < candles.length; i++) {
    const v = values[i];
    if (v == null) continue;
    out.push({ time: candles[i].time, value: v });
  }
  return out;
}

function formatRange(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function QuantPage() {
  const [productId, setProductId] = useState<string>("");
  const [interval, setInterval] = useState("1d");
  const [deliveryPeriod, setDeliveryPeriod] = useState("现货");
  const [sideTab, setSideTab] = useState<"analysis" | "backtest">("analysis");
  const [dataSource, setDataSource] = useState<DataSource>("exchange");

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: fetchProducts,
    staleTime: 60_000,
  });

  const activeProducts = useMemo(
    () => (products as Product[]).filter((p) => p.active !== false),
    [products]
  );

  const selectedId = productId || activeProducts[0]?.id || "";
  const selectedProduct = activeProducts.find((p) => p.id === selectedId);
  const intervalMeta = INTERVALS.find((i) => i.key === interval) ?? INTERVALS[3];

  const { data: candles = [], isFetching } = useQuery({
    queryKey: ["quant-price-history", selectedId, interval, deliveryPeriod, intervalMeta.limit, dataSource],
    queryFn: () =>
      fetchPriceHistory(selectedId, interval, intervalMeta.limit, deliveryPeriod, dataSource),
    enabled: !!selectedId,
    staleTime: 30_000,
  });

  const bars = useMemo(() => enrichCandles(candles), [candles]);
  const report = useMemo(() => buildQuantReport(bars), [bars]);
  const forecast = useMemo(() => ewmaForecast(bars, 5, 10), [bars]);

  const chartCandles = useMemo(() => toCandles(candles), [candles]);
  const volumeData = useMemo(() => toVolume(candles), [candles]);
  const ma5Data = useMemo(
    () => maLine(chartCandles, bars.map((b) => b.ma5)),
    [chartCandles, bars]
  );
  const ma10Data = useMemo(
    () => maLine(chartCandles, bars.map((b) => b.ma10)),
    [chartCandles, bars]
  );
  const ma20Data = useMemo(
    () => maLine(chartCandles, bars.map((b) => b.ma20)),
    [chartCandles, bars]
  );
  const ma30Data = useMemo(
    () => maLine(chartCandles, bars.map((b) => b.ma30)),
    [chartCandles, bars]
  );

  return (
    <div className="min-h-[calc(100vh-2.75rem)] bg-t-bg flex flex-col">
      {/* 工具条 */}
      <div className="shrink-0 border-b border-t-border bg-t-panel px-3 py-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-t-text mr-1">量化分析</span>
        <DataSourceSelector value={dataSource} onChange={setDataSource} />
        <select
          value={selectedId}
          onChange={(e) => setProductId(e.target.value)}
          className="text-xs px-2 py-1 rounded border bg-t-input text-t-text outline-none focus:border-t-accent"
          style={{ borderColor: "var(--border-color)" }}
        >
          {activeProducts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <input
          value={deliveryPeriod}
          onChange={(e) => setDeliveryPeriod(e.target.value || "现货")}
          placeholder="交割期"
          className="w-24 text-xs px-2 py-1 rounded border bg-t-input text-t-text outline-none focus:border-t-accent"
          style={{ borderColor: "var(--border-color)" }}
          title="交割期，默认现货"
        />

        <div className="flex items-center gap-0.5 rounded border overflow-hidden" style={{ borderColor: "var(--border-color)" }}>
          {INTERVALS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setInterval(item.key)}
              className={`px-2 py-1 text-[11px] transition-colors ${
                interval === item.key
                  ? "bg-t-hover text-t-text font-medium"
                  : "text-t-text-2 hover:text-t-text hover:bg-t-hover/60"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-0.5 rounded border overflow-hidden ml-1" style={{ borderColor: "var(--border-color)" }}>
          {(
            [
              { key: "analysis" as const, label: "行情分析" },
              { key: "backtest" as const, label: "策略回测" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setSideTab(tab.key)}
              className={`px-2.5 py-1 text-[11px] transition-colors ${
                sideTab === tab.key
                  ? "bg-t-hover text-t-text font-medium"
                  : "text-t-text-2 hover:text-t-text hover:bg-t-hover/60"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <span className="text-[10px] text-t-text-3 ml-auto hidden sm:inline">
          {report
            ? `${formatRange(report.start)} → ${formatRange(report.end)} · ${report.rows} 根`
            : isFetching
              ? "加载中…"
              : "无数据"}
        </span>
      </div>

      {/* 主区：图 + 摘要/回测 */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-2 p-2">
        <div className="min-h-[360px] lg:min-h-0 border border-t-border rounded overflow-hidden bg-t-tertiary">
          <ErrorBoundary>
            <TradingViewChart
              productId={selectedId}
              productName={selectedProduct?.name || selectedId}
              data={chartCandles}
              volumeData={volumeData}
              ma5Data={ma5Data}
              ma10Data={ma10Data}
              ma20Data={ma20Data}
              ma30Data={ma30Data}
              chartType="candle"
              loading={isFetching && candles.length === 0}
            />
          </ErrorBoundary>
        </div>

        <div className="min-h-[320px] lg:min-h-0">
          {sideTab === "analysis" ? (
            <QuantAnalysisPanel
              report={report}
              forecast={forecast}
              loading={isFetching && !report}
              emptyHint={
                selectedId
                  ? "该合约暂无足够成交 K 线。可换日线/小时线，或先在交易大厅产生成交。"
                  : "请选择品种"
              }
            />
          ) : (
            <QuantBacktestPanel bars={bars} />
          )}
        </div>
      </div>

      {/* 指标表（最近条） */}
      <div className="shrink-0 border-t border-t-border bg-t-panel px-2 py-2 max-h-48 overflow-auto">
        <div className="text-[10px] text-t-text-3 mb-1 px-1">近期指标</div>
        <table className="w-full text-[11px] table-auto">
          <thead>
            <tr className="text-t-text-3 text-center">
              <th className="px-1 py-1 font-normal whitespace-nowrap">时间</th>
              <th className="px-1 py-1 font-normal">收盘</th>
              <th className="px-1 py-1 font-normal">MA5</th>
              <th className="px-1 py-1 font-normal">MA20</th>
              <th className="px-1 py-1 font-normal">RSI</th>
              <th className="px-1 py-1 font-normal">MACD柱</th>
              <th className="px-1 py-1 font-normal">RV20</th>
              <th className="px-1 py-1 font-normal">ATR</th>
            </tr>
          </thead>
          <tbody>
            {[...bars].slice(-12).reverse().map((b) => (
              <tr key={b.time} className="text-center border-t border-t-border/50 text-t-text-2">
                <td className="px-1 py-1 whitespace-nowrap tabular-nums">
                  {formatRange(b.time)}
                </td>
                <td className="px-1 py-1 tabular-nums text-t-text">{b.close.toFixed(2)}</td>
                <td className="px-1 py-1 tabular-nums">{b.ma5?.toFixed(2) ?? "—"}</td>
                <td className="px-1 py-1 tabular-nums">{b.ma20?.toFixed(2) ?? "—"}</td>
                <td className="px-1 py-1 tabular-nums">{b.rsi14?.toFixed(1) ?? "—"}</td>
                <td className="px-1 py-1 tabular-nums">{b.macdHist?.toFixed(2) ?? "—"}</td>
                <td className="px-1 py-1 tabular-nums">
                  {b.rv20 != null ? `${(b.rv20 * 100).toFixed(1)}%` : "—"}
                </td>
                <td className="px-1 py-1 tabular-nums">{b.atr14?.toFixed(2) ?? "—"}</td>
              </tr>
            ))}
            {bars.length === 0 && (
              <tr>
                <td colSpan={8} className="py-4 text-center text-t-text-3">
                  暂无数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
