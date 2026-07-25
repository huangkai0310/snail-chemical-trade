"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Product, LatestPriceResponse, OrderBookResponse } from "@/lib/types";
import { fetchLatestPrice, fetchOrderBook, fetchProductContracts } from "@/lib/api";
import {
  formatDeliveryPeriodDisplay,
  contractCode,
  sortDeliveryPeriods,
  productSymbol,
} from "@/lib/delivery-period";

interface Props {
  open: boolean;
  product: Product;
  onClose: () => void;
  onSelect: (productId: string, deliveryPeriod: string) => void;
  onToggleFav: (key: string) => void;
  isFav: (deliveryPeriod: string) => boolean;
}

function PeriodRow({
  product,
  deliveryPeriod,
  onSelect,
  onToggleFav,
  isFav,
}: {
  product: Product;
  deliveryPeriod: string;
  onSelect: (productId: string, deliveryPeriod: string) => void;
  onToggleFav: (key: string) => void;
  isFav: (deliveryPeriod: string) => boolean;
}) {
  const { data: latestData } = useQuery<LatestPriceResponse>({
    queryKey: ["latestPrice", product.id, deliveryPeriod],
    queryFn: () => fetchLatestPrice(product.id, deliveryPeriod),
    staleTime: 5_000,
    refetchInterval: 10_000,
  });

  const { data: orderbook } = useQuery<OrderBookResponse>({
    queryKey: ["orderbook", product.id, deliveryPeriod],
    queryFn: () => fetchOrderBook(product.id, deliveryPeriod),
    staleTime: 3_000,
    refetchInterval: 5_000,
  });

  const latest = latestData?.latest ?? 0;
  const prevClose = latestData?.prev_settle ?? latestData?.prev_24h ?? latest;
  const changePct = prevClose > 0 ? ((latest - prevClose) / prevClose) * 100 : 0;
  const changeAmt = prevClose > 0 ? latest - prevClose : 0;
  const changeSpeed = prevClose > 0 ? (changeAmt / prevClose * 100) / 1440 : 0;
  const bidPrice = orderbook?.bid_depth?.[0]?.price ?? 0;
  const bidVolume = orderbook?.bid_depth?.[0]?.quantity ?? 0;
  const askPrice = orderbook?.ask_depth?.[0]?.price ?? 0;
  const askVolume = orderbook?.ask_depth?.[0]?.quantity ?? 0;
  const isCellUp = changePct >= 0;
  const isSpot = deliveryPeriod === "现货";
  const fav = isFav(deliveryPeriod);
  const key = `${product.id}:${deliveryPeriod}`;

  return (
    <div
      className={`flex items-center gap-1 px-4 py-2.5 text-[13px] border-b border-t-border/20 transition-colors cursor-pointer ${
        isSpot
          ? "bg-yellow-500/[0.06] hover:bg-yellow-500/[0.12]"
          : "hover:bg-t-accent/15"
      }`}
      onClick={() => onSelect(product.id, deliveryPeriod)}
    >
      <span className="w-20 shrink-0 font-mono font-semibold text-[13px] text-t-text text-center">
        {contractCode(product.id, deliveryPeriod, product.name_en)}
      </span>
      <span className={`flex-1 text-[13px] text-center ${isSpot ? "text-yellow-500 font-bold" : "text-t-text font-medium"}`}>
        {formatDeliveryPeriodDisplay(deliveryPeriod)}
      </span>
      <span className={`w-16 text-center font-mono font-semibold ${latest > 0 ? (isCellUp ? "text-trade-up" : "text-trade-down") : "text-t-text-3"}`}>
        {latest > 0 ? latest.toFixed(1) : "-"}
      </span>
      <span className={`w-14 text-center font-mono ${latest > 0 ? (isCellUp ? "text-trade-up" : "text-trade-down") : "text-t-text-3"}`}>
        {latest > 0 ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%` : "-"}
      </span>
      <span className={`w-14 text-center font-mono ${latest > 0 ? (isCellUp ? "text-trade-up" : "text-trade-down") : "text-t-text-3"}`}>
        {latest > 0 ? `${changeAmt >= 0 ? "+" : ""}${changeAmt.toFixed(1)}` : "-"}
      </span>
      <span className="w-14 text-center font-mono text-t-text-2">
        {latest > 0 ? `${changeSpeed >= 0 ? "+" : ""}${(changeSpeed * 10000).toFixed(2)}‱` : "-"}
      </span>
      <span className={`w-16 text-center font-mono ${bidPrice > 0 ? "text-trade-up" : "text-t-text-3"}`}>
        {bidPrice > 0 ? bidPrice.toFixed(1) : "-"}
      </span>
      <span className={`w-16 text-center font-mono ${askPrice > 0 ? "text-trade-down" : "text-t-text-3"}`}>
        {askPrice > 0 ? askPrice.toFixed(1) : "-"}
      </span>
      <span className="w-14 text-center font-mono text-t-text">
        {bidVolume > 0 ? Math.floor(bidVolume) : "-"}
      </span>
      <span className="w-14 text-center font-mono text-t-text">
        {askVolume > 0 ? Math.floor(askVolume) : "-"}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleFav(key);
        }}
        className={`w-6 shrink-0 flex items-center justify-center transition-colors ${fav ? "text-yellow-500" : "text-t-text-3/30 hover:text-yellow-500"}`}
        title={fav ? "取消自选" : "添加自选"}
      >
        <svg className="w-4 h-4" fill={fav ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      </button>
    </div>
  );
}

export default function ProductDetailModal({
  open, product, onClose, onSelect, onToggleFav, isFav,
}: Props) {
  const contractsQuery = useQuery({
    queryKey: ["contracts", product.id],
    queryFn: () => fetchProductContracts(product.id),
    staleTime: 15_000,
    enabled: open,
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
    queryKey: ["latestPrice", product.id, "现货"],
    queryFn: () => fetchLatestPrice(product.id, "现货"),
    staleTime: 5_000,
    refetchInterval: 10_000,
    enabled: open,
  });

  if (!open) return null;

  const sym = productSymbol(product.id, product.name_en);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 bg-t-panel rounded-xl shadow-2xl border border-t-border w-[95vw] max-w-[960px] max-h-[90vh] flex flex-col overflow-hidden"
        style={{ minWidth: "900px" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-t-border shrink-0 bg-t-card">
          <div className="flex items-center gap-3">
            <span className="text-sm font-mono font-bold text-trade-up">{sym}</span>
            <span className="text-sm font-semibold text-t-text">{product.name}</span>
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
            className="p-1.5 rounded-lg hover:bg-t-hover transition-colors text-t-text-3 hover:text-t-text"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-1 px-4 py-2 text-[12px] text-t-text-2 border-b border-t-border/50 shrink-0 bg-t-card font-semibold">
          <span className="w-20 shrink-0 text-center">代码</span>
          <span className="flex-1 text-center">交割期</span>
          <span className="w-16 text-center">现价</span>
          <span className="w-14 text-center">涨幅</span>
          <span className="w-14 text-center">涨跌</span>
          <span className="w-14 text-center">涨速</span>
          <span className="w-16 text-center">买价</span>
          <span className="w-16 text-center">卖价</span>
          <span className="w-14 text-center">买量</span>
          <span className="w-14 text-center">卖量</span>
          <span className="w-6 shrink-0" />
        </div>

        <div className="flex-1 overflow-y-auto">
          {contractsQuery.isLoading ? (
            <div className="py-8 text-center text-xs text-t-text-3">加载合约…</div>
          ) : (
            deliveryPeriods.map((dp) => (
              <PeriodRow
                key={dp}
                product={product}
                deliveryPeriod={dp}
                onSelect={onSelect}
                onToggleFav={onToggleFav}
                isFav={isFav}
              />
            ))
          )}
        </div>

        <div className="px-4 py-2 border-t border-t-border/50 text-[10px] text-t-text-3 text-center shrink-0">
          交割期由用户首次发盘建立 · 点击行进入交易 · 点击 ★ 添加自选
        </div>
      </div>
    </div>
  );
}
