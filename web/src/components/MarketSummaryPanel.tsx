"use client";

import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPriceHistory, fetchLatestPrice, fetchOrderBook, fetchMarketStatus } from "@/lib/api";
import TradePanel from "./TradePanel";
import type { DepthLevel, PriceCandle } from "@/lib/types";
import { formatDeliveryPeriodDisplay } from "@/lib/delivery-period";

interface Props {
  productId: string;
  productName?: string;
  deliveryPeriod?: string;
  unit?: string;
  onCollapse?: () => void;
}

/** 判断一个 candle 是否属于今天 */
function isTodayCandle(c: PriceCandle): boolean {
  const d = new Date(c.time);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
}

/** 期货指标定义 */
interface MarketIndicator {
  key: string;
  label: string;
  value: string;
  color?: string;
  tooltip: string;
}

/** 指标 Tooltip 说明 */
const INDICATOR_TOOLTIPS: Record<string, string> = {
  open: "今日开盘价：当日交易时段第一笔成交的价格，反映市场开盘时的供需状况。",
  high: "今日最高价：当日所有成交中的最高价格，代表市场在当日的最大买方意愿。",
  low: "今日最低价：当日所有成交中的最低价格，代表市场在当日的最大卖方压力。",
  avg: "均价（VWAP）：当日成交金额 \u00F7 成交量的加权均价，反映市场整体成交重心，常用于判断当前价格相对合理估值的高低。",
  volume: "成交量：当日累计成交的总吨数，量升价增为多头信号，量缩价跌为空头信号。",
  turnover: "成交额：当日累计成交的总金额（元），与成交量结合可观察市场参与热度。",
  yesterday: "昨日结算价：上一个工作日所有行情成交按成交量加权的均价（VWAP）。工作日按国务院放假安排：跳过法定节假日，调休上班日计入工作日。",
  spot: "现货价：该品种现货合约的最新成交价（交割期=现货），与当前所选交割期无关，是远期合约锚定的基准。",
};

const STATS_STALE_MS = 15_000;
const ORDERBOOK_STALE_MS = 3_000;
const ORDERBOOK_REFETCH_MS = 5_000;

/** 右侧盘口面板 \u2192 期货大盘指标 + 五档买卖 + 成交明细 */
export default function MarketSummaryPanel({ productId, productName, deliveryPeriod, unit = "吨", onCollapse }: Props) {
  const [tooltipKey, setTooltipKey] = useState<string | null>(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showTooltip = (key: string) => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    setTooltipKey(key);
    setTooltipVisible(true);
  };

  const hideTooltip = () => {
    hideTimerRef.current = setTimeout(() => {
      setTooltipVisible(false);
    }, 150);
  };

  // 日线数据（今/昨）
  const dailyQuery = useQuery<PriceCandle[]>({
    queryKey: ["priceHistory", productId, "1d", deliveryPeriod],
    queryFn: () => fetchPriceHistory(productId, "1d", 3, deliveryPeriod),
    staleTime: STATS_STALE_MS,
    refetchInterval: STATS_STALE_MS,
  });

  // 当前所选交割期的最新价（大号现价 / 昨结涨跌）
  const contractLatestQuery = useQuery({
    queryKey: ["latestPrice", productId, deliveryPeriod],
    queryFn: () => fetchLatestPrice(productId, deliveryPeriod),
    staleTime: 5_000,
    refetchInterval: 10_000,
  });

  // 品种现货价：固定交割期=现货，与盘面所选交割期无关（与品种详情头一致）
  const spotLatestQuery = useQuery({
    queryKey: ["latestPrice", productId, "现货"],
    queryFn: () => fetchLatestPrice(productId, "现货"),
    staleTime: 5_000,
    refetchInterval: 10_000,
  });

  // 订单簿
  const orderbookQuery = useQuery({
    queryKey: ["orderbook", productId, deliveryPeriod],
    queryFn: () => fetchOrderBook(productId, deliveryPeriod),
    staleTime: ORDERBOOK_STALE_MS,
    refetchInterval: ORDERBOOK_REFETCH_MS,
  });

  const marketStatusQuery = useQuery({
    queryKey: ["marketStatus"],
    queryFn: fetchMarketStatus,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
  const marketOpen = marketStatusQuery.data?.market_open !== false;
  const marketCloseReason = marketStatusQuery.data?.reason?.trim() || "";

  const candles = dailyQuery.data ?? [];
  const todayCandle = useMemo(() => candles.find(isTodayCandle), [candles]);
  const contractPrice = contractLatestQuery.data?.latest ?? 0;
  const spotPrice = spotLatestQuery.data?.latest ?? 0;
  const prevSettle =
    contractLatestQuery.data?.prev_settle ??
    contractLatestQuery.data?.prev_24h ??
    0;

  // 计算指标
  const indicators = useMemo<MarketIndicator[]>(() => {
    if (!todayCandle) return [];
    const tc = todayCandle;

    const avg = tc.volume > 0 ? tc.turnover / tc.volume : tc.close;

    return [
      { key: "open", label: "开盘", value: tc.open > 0 ? tc.open.toFixed(1) : "-", tooltip: INDICATOR_TOOLTIPS.open },
      { key: "high", label: "最高", value: tc.high > 0 ? tc.high.toFixed(1) : "-", color: "text-trade-up", tooltip: INDICATOR_TOOLTIPS.high },
      { key: "low", label: "最低", value: tc.low > 0 ? tc.low.toFixed(1) : "-", color: "text-trade-down", tooltip: INDICATOR_TOOLTIPS.low },
      { key: "avg", label: "均价", value: avg > 0 ? avg.toFixed(1) : "-", tooltip: INDICATOR_TOOLTIPS.avg },
      { key: "volume", label: "成交量", value: tc.volume > 0 ? `${Math.floor(tc.volume)}吨` : "-", tooltip: INDICATOR_TOOLTIPS.volume },
      { key: "turnover", label: "成交额", value: tc.turnover > 0 ? `${(tc.turnover / 10000).toFixed(1)}万` : "-", tooltip: INDICATOR_TOOLTIPS.turnover },
      { key: "yesterday", label: "昨结", value: prevSettle > 0 ? prevSettle.toFixed(1) : "-", tooltip: INDICATOR_TOOLTIPS.yesterday },
      { key: "spot", label: "现货价", value: spotPrice > 0 ? spotPrice.toFixed(1) : "-", color: "text-trade-up font-bold", tooltip: INDICATOR_TOOLTIPS.spot },
    ];
  }, [todayCandle, prevSettle, spotPrice]);

  // 订单簿深度
  const bidDepth: DepthLevel[] = useMemo(
    () => (orderbookQuery.data?.bid_depth ?? []).slice(0, 5),
    [orderbookQuery.data]
  );
  const askDepth: DepthLevel[] = useMemo(
    () => (orderbookQuery.data?.ask_depth ?? []).slice(0, 5),
    [orderbookQuery.data]
  );
  const maxCum = Math.max(
    bidDepth[0]?.cumulative ?? 0,
    askDepth[askDepth.length - 1]?.cumulative ?? 0,
    1
  );

  const isUp = contractPrice >= (prevSettle > 0 ? prevSettle : contractPrice);
  const activeTooltip = indicators.find(i => i.key === tooltipKey);

  return (
    <div className="h-full flex flex-col">
      {/* 标题 */}
      <div className="flex items-center justify-between px-3 h-9 border-b shrink-0 bg-t-panel"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <span className="text-xs font-semibold text-t-text">盘口</span>
        <div className="flex items-center gap-1.5">
          {deliveryPeriod && (
            <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${
              deliveryPeriod === "现货" ? "text-status-warning bg-status-warning-bg" : "text-status-info bg-status-info-bg"
            }`}>
              {formatDeliveryPeriodDisplay(deliveryPeriod)}
            </span>
          )}
          <span className="text-[11px] font-medium text-t-text">{productName || productId.toUpperCase()}</span>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
              marketOpen
                ? "text-emerald-600 bg-emerald-500/15 dark:text-emerald-400"
                : "text-red-600 bg-red-500/15 dark:text-red-400"
            }`}
            title={marketOpen ? "市场开市中" : marketCloseReason || "市场已闭市"}
          >
            {marketOpen ? "开市" : "闭市"}
          </span>
          {/* 收起盘口按钮 — 标题栏最右侧，与品种名用分隔线隔开 */}
          <button
            onClick={onCollapse}
            className="ml-1 w-6 h-6 flex items-center justify-center rounded-md bg-t-hover/80 text-t-text-2 hover:text-t-text hover:bg-t-hover transition-all"
            title="收起盘口"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 5l7 7-7 7M6 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* 内容区 — 三个子区域各自独立滚动 */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* 行情数据 — 固定高度，内容超出时独立滚动 */}
        <div className="overflow-y-auto shrink-0 border-b" style={{ borderColor: "var(--border-subtle)", maxHeight: "220px" }}>
          {dailyQuery.isLoading ? (
            <div className="py-2 text-center text-xs text-t-text-3">加载中...</div>
          ) : indicators.length === 0 ? (
            <div className="py-2 text-center text-xs text-t-text-3">暂无今日行情</div>
          ) : (
            <div className="relative">
              {/* 当前交割期最新价大号展示；现货价在下方指标格，固定取品种现货 */}
              <div className="px-3 pt-2 pb-1 text-center">
                <div className={`text-3xl font-bold font-mono ${isUp ? "text-trade-up-text" : "text-trade-down-text"}`}>
                  ¥{contractPrice > 0 ? contractPrice.toFixed(1) : "-"}
                </div>
                {indicators.find(i => i.key === "yesterday")?.value && (
                  <div className="flex items-center justify-center gap-2 mt-0.5">
                    <span className="text-[11px] text-t-text-3">
                      昨结 {indicators.find(i => i.key === "yesterday")?.value}
                    </span>
                    {contractPrice > 0 && prevSettle > 0 && (
                      <span className={`text-[11px] font-mono px-1 rounded ${isUp ? "text-trade-up-text bg-trade-up-bg" : "text-trade-down-text bg-trade-down-bg"}`}>
                        {isUp ? "+" : ""}{((contractPrice - prevSettle) / prevSettle * 100).toFixed(2)}%
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* 指标网格 */}
              <div className="grid grid-cols-3 gap-0.5 px-2 pb-1">
                {indicators.map((ind) => (
                  <div
                    key={ind.key}
                    className={`relative p-1 rounded transition-colors cursor-help ${
                      tooltipKey === ind.key && tooltipVisible
                        ? "bg-t-accent-bg ring-1 ring-t-accent-border"
                        : "hover:bg-t-hover"
                    }`}
                    onMouseEnter={() => showTooltip(ind.key)}
                    onMouseLeave={hideTooltip}
                  >
                    <div className="text-[11px] text-t-text-3 leading-tight">{ind.label}</div>
                    <div className={`text-[13px] font-mono font-semibold ${ind.color ?? "text-t-text"}`}>
                      {ind.value}
                    </div>
                  </div>
                ))}
              </div>

              {/* Tooltip 说明区域 */}
              <div
                className={`overflow-hidden transition-all duration-200 ${
                  tooltipVisible && activeTooltip ? "max-h-24 opacity-100 pb-1.5" : "max-h-0 opacity-0"
                }`}
              >
                <div className="mx-2 px-2 py-1.5 rounded border"
                  style={{ backgroundColor: "var(--bg-tertiary)", borderColor: "var(--border-color)" }}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`text-xs font-semibold ${activeTooltip?.color ?? "text-t-text"}`}>
                      {activeTooltip?.label}
                    </span>
                    <span className="text-[11px] text-t-text-3">{activeTooltip?.value}</span>
                  </div>
                  <div className="text-[11px] text-t-text-2 leading-relaxed">
                    {activeTooltip?.tooltip}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 五档盘口 — 固定高度，内容超出时独立滚动 */}
        <div className="overflow-y-auto shrink-0">
          {orderbookQuery.isLoading ? (
            <div className="py-2 text-center text-xs text-t-text-3">加载中...</div>
          ) : orderbookQuery.isError ? (
            <div className="py-2 text-center text-xs text-red-400">加载失败</div>
          ) : (
            <div className="flex flex-col">
              {/* 表头：方向 / 价格 / 量 / 累计；价格、量居中 */}
              <div className="grid grid-cols-4 gap-1 px-2 py-0.5 text-[11px] text-t-text-3 border-b"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                <span>方向</span>
                <span className="text-center">价格</span>
                <span className="text-center">量</span>
                <span className="text-right">累计</span>
              </div>

              {/* 卖盘五档（绿）：最优卖价靠下 */}
              {askDepth.slice(0, 5).reverse().map((level, i) => {
                const barW = maxCum > 0 ? (level.cumulative / maxCum) * 100 : 0;
                return (
                  <div
                    key={`ask-${i}`}
                    className="relative grid grid-cols-4 gap-1 px-2 py-0.5 text-xs hover:bg-t-hover"
                  >
                    <div className="absolute right-0 top-0 bottom-0 bg-t-tertiary" style={{ width: `${barW}%` }} />
                    <div className="absolute right-0 top-0 bottom-0 bg-trade-down-bg" style={{ width: `${barW}%`, opacity: 0.5 }} />
                    <span className="relative text-trade-down-text font-medium">卖</span>
                    <span className="relative text-center text-trade-down-text font-mono">{level.price.toFixed(1)}</span>
                    <span className="relative text-center font-mono text-t-text">{Math.floor(level.quantity)}</span>
                    <span className="relative text-right font-mono text-t-text-3 text-[11px]">{Math.floor(level.cumulative)}</span>
                  </div>
                );
              })}

              {/* 买盘五档（红）：最优买价靠上 */}
              {bidDepth.slice(0, 5).map((level, i) => {
                const barW = maxCum > 0 ? (level.cumulative / maxCum) * 100 : 0;
                return (
                  <div
                    key={`bid-${i}`}
                    className="relative grid grid-cols-4 gap-1 px-2 py-0.5 text-xs hover:bg-t-hover"
                  >
                    <div className="absolute right-0 top-0 bottom-0 bg-t-tertiary" style={{ width: `${barW}%` }} />
                    <div className="absolute right-0 top-0 bottom-0 bg-trade-up-bg" style={{ width: `${barW}%`, opacity: 0.5 }} />
                    <span className="relative text-trade-up-text font-medium">买</span>
                    <span className="relative text-center text-trade-up-text font-mono">{level.price.toFixed(1)}</span>
                    <span className="relative text-center font-mono text-t-text">{Math.floor(level.quantity)}</span>
                    <span className="relative text-right font-mono text-t-text-3 text-[11px]">{Math.floor(level.cumulative)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 成交明细 — 独立滚动 */}
        <div className="flex-1 min-h-0 overflow-y-auto border-t" style={{ borderColor: "var(--border-subtle)" }}>
          <TradePanel productId={productId} unit={unit} deliveryPeriod={deliveryPeriod} />
        </div>
      </div>
    </div>
  );
}
