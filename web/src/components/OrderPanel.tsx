"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchOrderBook } from "@/lib/api";
import type { DepthLevel } from "@/lib/types";

interface Props {
  productId: string;
}

/** 右侧盘口面板（五档买卖+最新价） */
export default function OrderPanel({ productId }: Props) {
  const query = useQuery({
    queryKey: ["orderbook", productId],
    queryFn: () => fetchOrderBook(productId),
    staleTime: 3_000,
    refetchInterval: 5_000,
  });

  const bidDepth: DepthLevel[] = useMemo(
    () => (query.data?.bid_depth ?? []).slice(0, 5),
    [query.data]
  );
  const askDepth: DepthLevel[] = useMemo(
    () => (query.data?.ask_depth ?? []).slice(0, 5),
    [query.data]
  );

  const bestBid = bidDepth[0]?.price ?? 0;
  const bestAsk = askDepth[0]?.price ?? 0;
  const spread = bestAsk && bestBid ? bestAsk - bestBid : 0;
  const maxCum = Math.max(
    bidDepth[0]?.cumulative ?? 0,
    askDepth[askDepth.length - 1]?.cumulative ?? 0,
    1
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 标题 */}
      <div className="px-3 py-2 border-b border-t-border shrink-0">
        <span className="text-xs font-semibold text-t-text-2">盘口</span>
      </div>

      {/* 盘口数据 */}
      <div className="flex-1 overflow-y-auto">
        {query.isLoading ? (
          <div className="py-4 text-center text-xs text-t-text-3">加载中...</div>
        ) : query.isError ? (
          <div className="py-4 text-center text-xs text-red-400">加载失败</div>
        ) : (
          <div className="flex flex-col h-full">
            <div className="grid grid-cols-4 gap-1 px-2 py-1 text-[10px] text-t-text-3 border-b border-t-border/30">
              <span>方向</span>
              <span className="text-right">价格</span>
              <span className="text-right">量</span>
              <span className="text-right">累计</span>
            </div>

            {/* 卖盘五档（绿） */}
            <div className="flex-1">
              {askDepth.slice(0, 5).reverse().map((level, i) => {
                const barW = (level.cumulative / maxCum) * 100;
                return (
                  <div
                    key={`ask-${i}`}
                    className="relative grid grid-cols-4 gap-1 px-2 py-0.5 text-[11px] hover:bg-t-hover/50"
                  >
                    <div
                      className="absolute right-0 top-0 bottom-0 bg-trade-down/10"
                      style={{ width: `${barW}%` }}
                    />
                    <span className="relative text-trade-down font-medium">卖</span>
                    <span className="relative text-right text-trade-down font-mono">
                      {level.price.toFixed(1)}
                    </span>
                    <span className="relative text-right font-mono text-t-text">
                      {Math.floor(level.quantity)}
                    </span>
                    <span className="relative text-right font-mono text-t-text-3 text-[10px]">
                      {Math.floor(level.cumulative)}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* 最新价 */}
            <div className="flex items-center justify-between px-3 py-2 border-y border-t-border bg-t-hover/30">
              <span className="text-xs text-t-text-3">最新</span>
              <span className={`text-sm font-bold font-mono ${bestBid >= bestAsk ? "text-trade-up" : "text-trade-down"}`}>
                ¥{bestBid || bestAsk || "-"}
              </span>
              <span className="text-[10px] text-t-text-3">
                价差 {spread > 0 ? spread.toFixed(1) : "-"}
              </span>
            </div>

            {/* 买盘五档（红） */}
            <div className="flex-1">
              {bidDepth.slice(0, 5).map((level, i) => {
                const barW = (level.cumulative / maxCum) * 100;
                return (
                  <div
                    key={`bid-${i}`}
                    className="relative grid grid-cols-4 gap-1 px-2 py-0.5 text-[11px] hover:bg-t-hover/50"
                  >
                    <div
                      className="absolute right-0 top-0 bottom-0 bg-trade-up/10"
                      style={{ width: `${barW}%` }}
                    />
                    <span className="relative text-trade-up font-medium">买</span>
                    <span className="relative text-right text-trade-up font-mono">
                      {level.price.toFixed(1)}
                    </span>
                    <span className="relative text-right font-mono text-t-text">
                      {Math.floor(level.quantity)}
                    </span>
                    <span className="relative text-right font-mono text-t-text-3 text-[10px]">
                      {Math.floor(level.cumulative)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
