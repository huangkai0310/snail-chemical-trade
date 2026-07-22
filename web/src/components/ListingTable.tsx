"use client";

import type { Listing } from "@/lib/types";

interface Props {
  listings: Listing[];
  side: "BUY" | "SELL";
  unit?: string;
  canTrade?: boolean;
  onTake?: (listing: Listing) => void;
}

export default function ListingTable({
  listings,
  side,
  unit = "吨",
  canTrade = false,
  onTake,
}: Props) {
  const isBuy = side === "BUY";
  const title = isBuy ? "买盘" : "卖盘";
  const colorClass = isBuy ? "text-red-600" : "text-green-600";
  const bgClass = isBuy ? "bg-red-50 dark:bg-red-500/5" : "bg-green-50 dark:bg-green-500/5";
  const badgeBg = isBuy ? "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400" : "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400";
  const takeLabel = isBuy ? "卖出" : "买入";

  if (listings.length === 0) {
    return (
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-3">
          <h3 className={`text-lg font-bold ${colorClass}`}>{title}</h3>
          <span className={`text-xs px-2 py-0.5 rounded-full ${badgeBg}`}>0 条</span>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
          暂无{title}信息
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-3">
        <h3 className={`text-lg font-bold ${colorClass}`}>{title}</h3>
        <span className={`text-xs px-2 py-0.5 rounded-full ${badgeBg}`}>
          {listings.length} 条
        </span>
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
              {listings.map((listing) => {
                const remaining = listing.quantity - listing.filled;
                return (
                  <tr key={listing.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <span className={`font-mono font-bold ${colorClass}`}>
                        ¥{listing.price.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700">
                      {remaining.toLocaleString()} {unit}
                      {listing.filled > 0 && (
                        <span className="block text-xs text-gray-400">
                          原 {listing.quantity.toLocaleString()}
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
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
