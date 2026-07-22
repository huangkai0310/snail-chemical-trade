"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPriceHistory, fetchLatestPrice } from "@/lib/api";
import type { PriceCandle, LatestPriceResponse } from "@/lib/types";

interface Props {
  productId: string;
  productName: string;
}

const INTERVALS = [
  { key: "1m", label: "1分" },
  { key: "5m", label: "5分" },
  { key: "15m", label: "15分" },
  { key: "1h", label: "1时" },
  { key: "4h", label: "4时" },
  { key: "1d", label: "日" },
] as const;

/** 将ISO时间字符串格式化为短时间 */
function formatTime(iso: string, interval: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (interval === "1d") {
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  }
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function PriceChart({ productId, productName }: Props) {
  const [interval, setInterval] = useState<string>("1h");

  const priceQuery = useQuery<LatestPriceResponse>({
    queryKey: ["latestPrice", productId],
    queryFn: () => fetchLatestPrice(productId),
    staleTime: 10_000,
  });

  const historyQuery = useQuery<PriceCandle[]>({
    queryKey: ["priceHistory", productId, interval],
    queryFn: () => fetchPriceHistory(productId, interval, 60),
    staleTime: 30_000,
  });

  const candles = historyQuery.data ?? [];
  const latest = priceQuery.data;

  // 计算 SVG 坐标
  const w = 600;
  const h = 220;
  const padLeft = 50;
  const padRight = 10;
  const padTop = 10;
  const padBot = 30;
  const plotW = w - padLeft - padRight;
  const plotH = h - padTop - padBot;

  // 价格范围
  const allPrices = candles.flatMap((c) => [c.high, c.low]);
  if (latest) allPrices.push(latest.latest);
  const priceMin = allPrices.length > 0 ? Math.min(...allPrices) : 0;
  const priceMax = allPrices.length > 0 ? Math.max(...allPrices) : 1;
  const priceRange = priceMax - priceMin || 1;
  const pricePadding = priceRange * 0.1;
  const yMin = priceMin - pricePadding;
  const yScale = (p: number) => padTop + plotH * (1 - (p - yMin) / (priceRange + pricePadding * 2));

  // 成交量范围
  const maxVol = candles.length > 0 ? Math.max(...candles.map((c) => c.volume)) : 1;
  const volH = 30;
  const volScale = (v: number) => volH * (v / maxVol);

  // 价格线
  const linePath = candles
    .map((c, i) => {
      const x = padLeft + (plotW * i) / Math.max(candles.length - 1, 1);
      const y = yScale(c.close);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const isUp = latest ? latest.change_24h >= 0 : true;
  const lineColor = isUp ? "#ef4444" : "#22c55e";
  const areaColor = isUp ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.08)";

  // 面积填充
  const areaPath = linePath
    ? `${linePath} L${padLeft + plotW},${padTop + plotH} L${padLeft},${padTop + plotH} Z`
    : "";

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">{productName} 价格走势</h3>
          {latest && (
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className={`text-lg font-bold font-mono ${isUp ? "text-red-600" : "text-green-600"}`}>
                ¥{latest.latest.toLocaleString()}
              </span>
              <span className={`text-xs font-medium ${isUp ? "text-red-500" : "text-green-500"}`}>
                {isUp ? "+" : ""}{latest.change_24h.toLocaleString()}
                {" "}({latest.change_pct >= 0 ? "+" : ""}{latest.change_pct.toFixed(2)}%)
              </span>
              <span className="text-xs text-gray-400">
                今日量 {(latest.volume_today ?? latest.volume_24h).toLocaleString()}吨
              </span>
            </div>
          )}
        </div>
        <div className="flex gap-1">
          {INTERVALS.map((iv) => (
            <button
              key={iv.key}
              onClick={() => setInterval(iv.key)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                interval === iv.key
                  ? "bg-brand-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {iv.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-2">
        {historyQuery.isLoading ? (
          <div className="flex items-center justify-center h-[280px] text-sm text-gray-400">
            加载走势数据...
          </div>
        ) : historyQuery.isError ? (
          <div className="flex items-center justify-center h-[280px] text-sm text-red-400">
            走势数据加载失败
          </div>
        ) : candles.length === 0 ? (
          <div className="flex items-center justify-center h-[280px] text-sm text-gray-400">
            暂无成交数据
          </div>
        ) : (
          <svg viewBox={`0 0 ${w} ${h + volH + 5}`} className="w-full" style={{ maxHeight: 300 }}>
            {/* 网格线 */}
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
              const y = padTop + plotH * ratio;
              const price = yMin + (priceRange + pricePadding * 2) * (1 - ratio);
              return (
                <g key={ratio}>
                  <line x1={padLeft} y1={y} x2={w - padRight} y2={y} stroke="#f0f0f0" strokeWidth={1} />
                  <text x={padLeft - 5} y={y + 3} textAnchor="end" fontSize={9} fill="#999">
                    ¥{price.toFixed(0)}
                  </text>
                </g>
              );
            })}

            {/* 面积 */}
            {areaPath && <path d={areaPath} fill={areaColor} />}

            {/* 价格线 */}
            {linePath && (
              <path d={linePath} fill="none" stroke={lineColor} strokeWidth={2} strokeLinejoin="round" />
            )}

            {/* 成交量柱 */}
            {candles.map((c, i) => {
              const x = padLeft + (plotW * i) / Math.max(candles.length - 1, 1);
              const barW = Math.max(2, plotW / candles.length * 0.7);
              const volHVal = volScale(c.volume);
              const barY = h + 5;
              const barColor = c.close >= c.open ? "#ef4444" : "#22c55e";
              return (
                <rect
                  key={i}
                  x={x - barW / 2}
                  y={barY - volHVal}
                  width={barW}
                  height={volHVal}
                  fill={barColor}
                  opacity={0.4}
                  rx={0.5}
                />
              );
            })}

            {/* 时间轴标签 */}
            {candles.length > 0 && (
              <>
                <text x={padLeft} y={h + volH + 20} fontSize={9} fill="#999" textAnchor="start">
                  {formatTime(candles[0].time, interval)}
                </text>
                <text x={w - padRight} y={h + volH + 20} fontSize={9} fill="#999" textAnchor="end">
                  {formatTime(candles[candles.length - 1].time, interval)}
                </text>
              </>
            )}
          </svg>
        )}
      </div>
    </div>
  );
}
