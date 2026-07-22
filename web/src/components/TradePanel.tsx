"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchTrades } from "@/lib/api";
import type { TradeRecord } from "@/lib/types";

interface Props {
  productId: string;
  unit?: string;
  /** 交割期过滤 */
  deliveryPeriod?: string;
  /** 现货/远期纸货过滤："all" | "spot" | "forward" */
  marketType?: "all" | "spot" | "forward";
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 判断成交记录是否为现货 */
function isSpotTrade(t: TradeRecord): boolean {
  const dp = t.delivery_period || "";
  return dp.trim() === "" || dp === "现货";
}

/** 右侧成交明细（按时间倒序，最新在上） */
export default function TradePanel({ productId, unit = "吨", marketType = "all", deliveryPeriod }: Props) {
  const query = useQuery({
    queryKey: ["trades", productId, deliveryPeriod],
    queryFn: () => fetchTrades(productId, 50, deliveryPeriod),
    staleTime: 5_000,
    refetchInterval: 5_000,
  });

  // 按交易时间降序排列（最新的在前面），并根据 marketType 过滤
  const sortedTrades = useMemo(() => {
    const raw = query.data ?? [];
    let filtered = raw;
    if (marketType === "spot") filtered = filtered.filter(isSpotTrade);
    if (marketType === "forward") filtered = filtered.filter((t) => !isSpotTrade(t));
    return [...filtered].sort((a, b) => new Date(b.traded_at).getTime() - new Date(a.traded_at).getTime());
  }, [query.data, marketType]);

  // 价格颜色基于前一笔成交价格判断（降序排列，每笔与后一笔比较）

  return (
    <div className="flex flex-col">
      {/* 标题 */}
      <div className="px-3 h-9 border-b border-t-border shrink-0 flex items-center justify-between bg-t-panel">
        <span className="text-xs font-semibold text-t-text-2">成交明细</span>
        <span className="text-[10px] text-t-text-3">{sortedTrades.length} 笔</span>
      </div>

      {/* 明细列表 */}
      <div>
        {query.isLoading ? (
          <div className="py-4 text-center text-xs text-t-text-3">加载中...</div>
        ) : query.isError ? (
          <div className="py-4 text-center text-xs text-red-400">加载失败</div>
        ) : sortedTrades.length === 0 ? (
          <div className="py-4 text-center text-xs text-t-text-3">暂无成交</div>
        ) : (
          <div className="divide-y divide-t-border/30">
            {/* 表头 */}
            <div className="grid grid-cols-[1.8fr_1fr_0.8fr] gap-1 px-2 py-1 text-[10px] text-t-text-3 sticky top-0 bg-t-card z-10">
              <span>时间</span>
              <span className="text-center">价格</span>
              <span className="text-right">数量</span>
            </div>
            {sortedTrades.slice(0, 50).map((t, idx) => {
              // 涨跌颜色：与上一笔（更早的成交）价格比较
              const prevPrice = sortedTrades[idx + 1]?.price ?? 0;
              const isUp = prevPrice > 0 ? t.price >= prevPrice : true;
              return (
                <div
                  key={t.id}
                  className="grid grid-cols-[1.8fr_1fr_0.8fr] gap-1 px-2 py-0.5 text-[11px] hover:bg-t-hover/50 items-center"
                >
                  <span className="text-t-text-3 font-mono text-[10px] whitespace-nowrap">
                    {formatTime(t.traded_at)}
                  </span>
                  <span
                    className={`text-center font-mono ${
                      isUp ? "text-trade-up" : "text-trade-down"
                    }`}
                  >
                    {t.price.toFixed(1)}
                  </span>
                  <span className="text-right font-mono text-t-text">
                    {Math.floor(t.quantity)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
