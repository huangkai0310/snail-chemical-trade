"use client";

import type { TradeRecord } from "@/lib/types";

interface Props {
  trades: TradeRecord[];
  unit?: string;
  loading?: boolean;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}`;
}

export default function TradeFeed({ trades, unit = "吨", loading }: Props) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-700">最近成交</h3>
        <span className="text-xs text-gray-400">{trades.length} 笔</span>
      </div>

      {loading ? (
        <div className="p-6 text-center text-sm text-gray-400">加载中...</div>
      ) : trades.length === 0 ? (
        <div className="p-6 text-center text-sm text-gray-400">暂无成交记录</div>
      ) : (
        <div className="overflow-x-auto max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-gray-500">时间</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500 hidden sm:table-cell">交割期</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500 hidden md:table-cell">交割仓库</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500">单价</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500">数量</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 hidden sm:table-cell">成交额</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {trades.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-500 text-xs whitespace-nowrap">
                    {formatDateTime(t.traded_at)}
                  </td>
                  <td className="px-4 py-2 text-gray-500 text-xs whitespace-nowrap hidden sm:table-cell">
                    {t.delivery_period || "-"}
                  </td>
                  <td className="px-4 py-2 text-gray-500 text-xs hidden md:table-cell">
                    {t.delivery_location || "-"}
                  </td>
                  <td className="px-4 py-2 text-right font-mono font-medium text-gray-800 whitespace-nowrap">
                    ¥{t.price.toLocaleString()}/{unit}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-gray-600 whitespace-nowrap">
                    {t.quantity.toLocaleString()} {unit}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-brand-600 hidden sm:table-cell">
                    ¥{t.amount.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
