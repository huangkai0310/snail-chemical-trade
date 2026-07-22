"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchOrderBook } from "@/lib/api";
import type { DepthLevel } from "@/lib/types";

interface Props {
  productId: string;
}

export default function OrderBookDepth({ productId }: Props) {
  const query = useQuery({
    queryKey: ["orderbook", productId],
    queryFn: () => fetchOrderBook(productId),
    staleTime: 5_000,
  });

  const bidDepth: DepthLevel[] = query.data?.bid_depth ?? [];
  const askDepth: DepthLevel[] = query.data?.ask_depth ?? [];

  // 最大累计量用于条形宽度
  const maxCum = Math.max(
    bidDepth.length > 0 ? bidDepth[0]?.cumulative ?? 0 : 0,
    askDepth.length > 0 ? askDepth[askDepth.length - 1]?.cumulative ?? 0 : 0,
  ) || 1;

  // 最优买卖价
  const bestBid = bidDepth.length > 0 ? bidDepth[0].price : 0;
  const bestAsk = askDepth.length > 0 ? askDepth[0].price : 0;
  const spread = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0;
  const spreadPct = bestAsk > 0 && bestBid > 0 ? (spread / bestAsk) * 100 : 0;

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-700">订单簿深度</h3>
      </div>

      {query.isLoading ? (
        <div className="py-8 text-center text-sm text-gray-400">加载中...</div>
      ) : query.isError ? (
        <div className="py-8 text-center text-sm text-red-400">加载失败</div>
      ) : bidDepth.length === 0 && askDepth.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-400">暂无挂单</div>
      ) : (
        <div className="p-2">
          {/* 表头 */}
          <div className="grid grid-cols-3 gap-1 px-2 py-1 text-xs text-gray-400">
            <span className="text-left">价格</span>
            <span className="text-right">总量(吨)</span>
            <span className="text-right">累计(吨)</span>
          </div>

          {/* 卖盘（倒序显示，最优卖价在底部） */}
          <div className="space-y-0.5">
            {askDepth.slice(0, 10).reverse().map((level, i) => {
              const barWidth = (level.cumulative / maxCum) * 100;
              return (
                <div
                  key={`ask-${i}`}
                  className="relative grid grid-cols-3 gap-1 px-2 py-0.5 text-xs hover:bg-gray-50 rounded"
                >
                  <div
                    className="absolute right-0 top-0 bottom-0 bg-green-50 dark:bg-green-500/10 rounded"
                    style={{ width: `${barWidth}%` }}
                  />
                  <span className="relative text-green-600 font-mono font-medium">
                    ¥{level.price.toLocaleString()}
                  </span>
                  <span className="relative text-right font-mono text-gray-700">
                    {level.quantity.toLocaleString()}
                  </span>
                  <span className="relative text-right font-mono text-gray-500">
                    {level.cumulative.toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>

          {/* 价差 */}
          <div className="flex items-center justify-between px-2 py-1.5 my-1 border-y border-gray-100">
            <span className="text-xs text-gray-400">
              价差 ¥{spread.toLocaleString()} ({spreadPct.toFixed(2)}%)
            </span>
            <span className="text-xs text-gray-400">
              买{bidDepth.length}档 / 卖{askDepth.length}档
            </span>
          </div>

          {/* 买盘（正序，最优买价在顶部） */}
          <div className="space-y-0.5">
            {bidDepth.slice(0, 10).map((level, i) => {
              const barWidth = (level.cumulative / maxCum) * 100;
              return (
                <div
                  key={`bid-${i}`}
                  className="relative grid grid-cols-3 gap-1 px-2 py-0.5 text-xs hover:bg-gray-50 rounded"
                >
                  <div
                    className="absolute right-0 top-0 bottom-0 bg-red-50 dark:bg-red-500/10 rounded"
                    style={{ width: `${barWidth}%` }}
                  />
                  <span className="relative text-red-600 font-mono font-medium">
                    ¥{level.price.toLocaleString()}
                  </span>
                  <span className="relative text-right font-mono text-gray-700">
                    {level.quantity.toLocaleString()}
                  </span>
                  <span className="relative text-right font-mono text-gray-500">
                    {level.cumulative.toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
