import type { Listing } from "@/lib/types";

interface Props {
  listings: Listing[];
  side: "buy" | "sell";
}

export default function ListingTable({ listings, side }: Props) {
  const isBuy = side === "buy";
  const title = isBuy ? "买盘" : "卖盘";
  const colorClass = isBuy ? "text-red-600" : "text-green-600";
  const bgClass = isBuy ? "bg-red-50" : "bg-green-50";
  const borderClass = isBuy ? "border-red-200" : "border-green-200";
  const badgeBg = isBuy ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700";

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
              <tr className={`${bgClass} border-b ${borderClass}`}>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">价格</th>
                <th className="text-right px-4 py-2.5 font-medium text-gray-600">数量</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600 whitespace-nowrap">交割期</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600 hidden md:table-cell">交割地</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600 hidden lg:table-cell">企业名称</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {listings.map((listing) => (
                <tr
                  key={listing.id}
                  className="hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <span className={`font-mono font-bold ${colorClass}`}>
                      ¥{listing.price.toLocaleString()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-gray-700">
                    {listing.quantity.toLocaleString()} {listing.unit}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
                      {listing.deliveryPeriod}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden md:table-cell">
                    {listing.deliveryLocation}
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden lg:table-cell text-xs">
                    {listing.companyName}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
