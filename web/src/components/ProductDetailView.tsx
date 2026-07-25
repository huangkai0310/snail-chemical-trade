"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { LatestPriceResponse, OrderBookResponse } from "@/lib/types";
import { fetchLatestPrice, fetchOrderBook, fetchProductContracts } from "@/lib/api";
import { useFavorites } from "@/lib/use-favorites";
import { formatDeliveryPeriodDisplay, contractCode, sortDeliveryPeriods, productSymbol } from "@/lib/delivery-period";

interface Props {
  productId: string;
  productName: string;
  onSelect: (productId: string, deliveryPeriod: string) => void;
  onClose: () => void;
}

// 10 列：代码 | 交割期 | 现价 | 涨幅% | 涨跌 | 买价 | 卖价 | 买量 | 卖量 | ★
const GRID_COLS = "1fr 1fr 1fr 1fr 1fr 1fr 1fr 0.8fr 0.8fr 0.4fr";

function PeriodRow({
  productId,
  deliveryPeriod,
  onSelect,
  isFav,
  toggleFavorite,
}: {
  productId: string;
  deliveryPeriod: string;
  onSelect: (productId: string, deliveryPeriod: string) => void;
  isFav: (dp: string) => boolean;
  toggleFavorite: (key: string) => void;
}) {
  const { data: latestData } = useQuery<LatestPriceResponse>({
    queryKey: ["latestPrice", productId, deliveryPeriod],
    queryFn: () => fetchLatestPrice(productId, deliveryPeriod),
    staleTime: 5_000,
    refetchInterval: 10_000,
  });

  const { data: orderbook } = useQuery<OrderBookResponse>({
    queryKey: ["orderbook", productId, deliveryPeriod],
    queryFn: () => fetchOrderBook(productId, deliveryPeriod),
    staleTime: 3_000,
    refetchInterval: 5_000,
  });

  const latest = latestData?.latest ?? 0;
  const prevClose = latestData?.prev_settle ?? latestData?.prev_24h ?? latest;
  const changePct = prevClose > 0 ? ((latest - prevClose) / prevClose) * 100 : 0;
  const changeAmt = prevClose > 0 ? latest - prevClose : 0;
  const bidPrice = orderbook?.bid_depth?.[0]?.price ?? 0;
  const bidVolume = orderbook?.bid_depth?.[0]?.quantity ?? 0;
  const askPrice = orderbook?.ask_depth?.[0]?.price ?? 0;
  const askVolume = orderbook?.ask_depth?.[0]?.quantity ?? 0;
  const isCellUp = changePct >= 0;
  const isSpot = deliveryPeriod === "现货";
  const rowFav = isFav(deliveryPeriod);

  return (
    <div
      className={`group grid gap-1.5 px-3 py-2 text-[12px] border-b border-t-border/20 transition-all duration-150 cursor-pointer ${
        isSpot
          ? "bg-yellow-500/[0.04] hover:bg-yellow-500/[0.12]"
          : "hover:bg-blue-500/8"
      }`}
      style={{ gridTemplateColumns: GRID_COLS }}
      onClick={() => onSelect(productId, deliveryPeriod)}
    >
      <span className="font-mono font-semibold text-t-text">
        {contractCode(productId, deliveryPeriod)}
      </span>
      <span className={isSpot ? "text-yellow-500 font-medium" : "text-t-text-2"}>
        {formatDeliveryPeriodDisplay(deliveryPeriod)}
      </span>
      <span className={`text-right font-mono font-semibold ${latest > 0 ? (isCellUp ? "text-trade-up" : "text-trade-down") : "text-t-text-3"}`}>
        {latest > 0 ? latest.toFixed(1) : "-"}
      </span>
      <span className={`text-right font-mono ${latest > 0 ? (isCellUp ? "text-trade-up" : "text-trade-down") : "text-t-text-3"}`}>
        {latest > 0 ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%` : "-"}
      </span>
      <span className={`text-right font-mono ${latest > 0 ? (isCellUp ? "text-trade-up" : "text-trade-down") : "text-t-text-3"}`}>
        {latest > 0 ? `${changeAmt >= 0 ? "+" : ""}${changeAmt.toFixed(1)}` : "-"}
      </span>
      <span className={`text-right font-mono ${bidPrice > 0 ? "text-trade-up" : "text-t-text-3"}`}>
        {bidPrice > 0 ? bidPrice.toFixed(1) : "-"}
      </span>
      <span className={`text-right font-mono ${askPrice > 0 ? "text-trade-down" : "text-t-text-3"}`}>
        {askPrice > 0 ? askPrice.toFixed(1) : "-"}
      </span>
      <span className="text-right font-mono text-t-text">
        {bidVolume > 0 ? Math.floor(bidVolume) : "-"}
      </span>
      <span className="text-right font-mono text-t-text">
        {askVolume > 0 ? Math.floor(askVolume) : "-"}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          toggleFavorite(`${productId}:${deliveryPeriod}`);
        }}
        className={`flex items-center justify-end transition-colors ${
          rowFav
            ? "text-[#f59e0b]"
            : "text-t-text-3/40 hover:text-[#f59e0b]/80"
        }`}
        title={rowFav ? "取消自选" : "添加自选"}
      >
        <svg className="w-4 h-4" fill={rowFav ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      </button>
    </div>
  );
}

export default function ProductDetailView({ productId, productName, onSelect, onClose }: Props) {
  const contractsQuery = useQuery({
    queryKey: ["contracts", productId],
    queryFn: () => fetchProductContracts(productId),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const deliveryPeriods = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    const push = (dp: string) => {
      if (!dp || seen.has(dp)) return;
      seen.add(dp);
      list.push(dp);
    };
    push("现货");
    for (const c of contractsQuery.data ?? []) push(c.delivery_period);
    return sortDeliveryPeriods(list);
  }, [contractsQuery.data]);

  const { data: spotLatest } = useQuery<LatestPriceResponse>({
    queryKey: ["latestPrice", productId, "现货"],
    queryFn: () => fetchLatestPrice(productId, "现货"),
    staleTime: 5_000,
    refetchInterval: 10_000,
  });

  const { isFav, toggleFavorite } = useFavorites();
  const name = productName || productId;
  const fav = isFav(productId);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-t-card">
      <div className="flex items-center justify-between px-4 py-2 border-b border-t-border shrink-0 bg-t-card">
        <div className="flex items-center gap-3">
          <span className="text-sm font-mono font-bold text-trade-up">{productSymbol(productId)}</span>
          <span className="text-sm font-semibold text-t-text">{name}</span>
          <span className="text-[10px] text-t-text-3 bg-t-tertiary px-2 py-0.5 rounded">
            已建立合约 {deliveryPeriods.length}
          </span>
          {spotLatest?.latest ? (
            <span className={`text-sm font-mono font-bold ${(spotLatest.latest >= (spotLatest?.prev_24h ?? 0)) ? "text-trade-up" : "text-trade-down"}`}>
              ¥{spotLatest.latest.toFixed(1)}
            </span>
          ) : null}
        </div>
        <button
          onClick={onClose}
          className="px-2 py-1 text-[11px] text-t-text-3 hover:text-t-text border border-t-border rounded hover:bg-t-hover transition-colors"
        >
          返回交易
        </button>
      </div>

      <div
        className="grid gap-1.5 px-3 py-1.5 text-[12px] text-t-text-3 border-b border-t-border/50 shrink-0 bg-t-card"
        style={{ gridTemplateColumns: GRID_COLS }}
      >
        <span className="font-medium">代码</span>
        <span className="font-medium">交割期</span>
        <span className="text-right font-medium">现价</span>
        <span className="text-right font-medium">涨幅%</span>
        <span className="text-right font-medium">涨跌</span>
        <span className="text-right font-medium">买价</span>
        <span className="text-right font-medium">卖价</span>
        <span className="text-right font-medium">买量</span>
        <span className="text-right font-medium">卖量</span>
        <span className="text-right font-medium" />
      </div>

      <div className="flex-1 overflow-y-auto">
        {contractsQuery.isLoading ? (
          <div className="py-8 text-center text-xs text-t-text-3">加载合约…</div>
        ) : (
          deliveryPeriods.map((dp) => (
            <PeriodRow
              key={dp}
              productId={productId}
              deliveryPeriod={dp}
              onSelect={onSelect}
              isFav={fav}
              toggleFavorite={toggleFavorite}
            />
          ))
        )}
      </div>

      <div className="px-4 py-2 border-t border-t-border/50 bg-t-card text-[10px] text-t-text-3 text-center shrink-0">
        交割期由用户首次发盘建立 · 点击行进入交易 · 点击 ★ 添加自选
      </div>
    </div>
  );
}
