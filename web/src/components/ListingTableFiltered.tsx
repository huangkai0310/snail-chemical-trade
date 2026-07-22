"use client";

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchListingsPaged } from "@/lib/api";
import type { Listing } from "@/lib/types";

interface Props {
  productId: string;
  side: "BUY" | "SELL";
  unit?: string;
  canTrade?: boolean;
  onTake?: (listing: Listing) => void;
}

export default function ListingTableFiltered({
  productId,
  side,
  unit = "吨",
  canTrade = false,
  onTake,
}: Props) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [deliveryPeriod, setDeliveryPeriod] = useState("");

  // 当 productId 或 side 变化时重置分页
  useEffect(() => {
    setPage(1);
    setDeliveryPeriod("");
  }, [productId, side]);

  const query = useQuery({
    queryKey: ["listingsFiltered", productId, side, page, pageSize, deliveryPeriod],
    queryFn: () =>
      fetchListingsPaged({
        productId,
        side,
        page,
        pageSize,
        deliveryPeriod: deliveryPeriod || undefined,
      }),
    staleTime: 10_000,
    enabled: canTrade,
  });

  const listings = query.data?.data ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = query.data?.total_page ?? 1;

  const isBuy = side === "BUY";
  const title = isBuy ? "买盘" : "卖盘";
  const colorClass = isBuy ? "text-red-600" : "text-green-600";
  const bgClass = isBuy ? "bg-red-50 dark:bg-red-500/5" : "bg-green-50 dark:bg-green-500/5";
  const badgeBg = isBuy ? "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400" : "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400";
  const takeLabel = isBuy ? "卖出" : "买入";

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["listingsFiltered", productId, side] });
  };

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <h3 className={`text-lg font-bold ${colorClass}`}>{title}</h3>
          <span className={`text-xs px-2 py-0.5 rounded-full ${badgeBg}`}>
            共 {total} 条
          </span>
        </div>
        <input
          type="text"
          placeholder="筛选交割期"
          value={deliveryPeriod}
          onChange={(e) => {
            setDeliveryPeriod(e.target.value);
            setPage(1);
          }}
          className="px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-400 w-28"
        />
      </div>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={`${bgClass} border-b`}>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">价格</th>
                <th className="text-right px-4 py-2.5 font-medium text-gray-600">数量</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600 whitespace-nowrap">交割期</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600 hidden md:table-cell">交割地</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600 hidden lg:table-cell">状态</th>
                {canTrade && (
                  <th className="text-center px-4 py-2.5 font-medium text-gray-600">操作</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {query.isLoading ? (
                <tr>
                  <td colSpan={canTrade ? 6 : 5} className="px-4 py-8 text-center text-gray-400">
                    加载中...
                  </td>
                </tr>
              ) : query.isError ? (
                <tr>
                  <td colSpan={canTrade ? 6 : 5} className="px-4 py-8 text-center text-red-400">
                    加载失败
                  </td>
                </tr>
              ) : listings.length === 0 ? (
                <tr>
                  <td colSpan={canTrade ? 6 : 5} className="px-4 py-8 text-center text-gray-400">
                    暂无{title}信息
                  </td>
                </tr>
              ) : (
                listings.map((listing) => {
                  const remaining = listing.quantity - listing.filled;
                  return (
                    <tr key={listing.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <span className={`font-mono font-bold ${colorClass}`}>
                          ¥{listing.price.toFixed(1)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-gray-700">
                        {Math.floor(remaining)} {unit}
                        {listing.filled > 0 && (
                          <span className="block text-xs text-gray-400">
                            原 {Math.floor(listing.quantity)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400">
                          {listing.delivery_period || "-"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 hidden md:table-cell">
                        {listing.delivery_location || "-"}
                      </td>
                      <td className="px-4 py-3 text-gray-400 hidden lg:table-cell text-xs">
                        {listing.status === "OPEN"
                          ? "挂盘中"
                          : listing.status === "PARTIAL"
                            ? "部分成交"
                            : listing.status}
                      </td>
                      {canTrade && (
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => onTake?.(listing)}
                            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                              isBuy
                                ? "bg-green-600 hover:bg-green-700 text-white"
                                : "bg-red-600 hover:bg-red-700 text-white"
                            }`}
                          >
                            {takeLabel}
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 text-xs text-gray-500">
            <span>
              第 {page}/{totalPages} 页
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition-colors"
              >
                上一页
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition-colors"
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
