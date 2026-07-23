"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import WatchList from "@/components/WatchList";
import TradingViewChart from "@/components/TradingViewChart";
import MarketSummaryPanel from "@/components/MarketSummaryPanel";
import ListingPanel from "@/components/ListingPanel";
import ProductTabs from "@/components/ProductTabs";
import CreateListingModal, { type CreateListingFormData } from "@/components/CreateListingModal";
import EditListingModal, { type EditListingFormData } from "@/components/EditListingModal";
import CreateSwapModal from "@/components/CreateSwapModal";
import EditSwapModal from "@/components/EditSwapModal";
import TakeListingModal from "@/components/TakeListingModal";
import TakeSwapModal from "@/components/TakeSwapModal";
import CounterOfferModal from "@/components/CounterOfferModal";
import ErrorBoundary from "@/components/ErrorBoundary";
import { toast } from "@/components/Toast";
import { useAuthStore } from "@/lib/auth-store";
import {
  fetchProducts,
  fetchPriceHistory,
  createListing,
  updateListing,
  takeListing,
  matchSwap,
  createSwap,
  updateSwap,
  createCounterOffer,
  updateCounterOffer,
  fetchSentPendingCounterOffers,
  fetchReceivedPendingCounterOffers,
  fetchMySwapLocks,
  ApiError,
} from "@/lib/api";
import type { CreateSwapParams, UpdateSwapParams } from "@/lib/api";
import { useTradeWS } from "@/lib/use-trade-ws";
import type { CounterOfferNotification } from "@/lib/use-trade-ws";
import type { Listing, WSTrade, PriceCandle, SwapListing, CounterOffer } from "@/lib/types";
import type { CandlestickData, HistogramData, LineData } from "lightweight-charts";
import { useRouter } from "next/navigation";
import { findListingInCache, findSwapInCache, entityChanged, isListingWithdrawn, isSwapWithdrawn, wasListingActive, wasSwapActive } from "@/lib/query-cache-helpers";
import { describeEntityUpdate, hasEditorialEntityUpdate } from "@/lib/entity-change-summary";
import { findPairedSwapCounterOffer } from "@/lib/swap-counter-offer";
import { shouldSuppressListingToast, suppressOwnListingToast } from "@/lib/listing-toast-suppress";
import { persistTradingView } from "@/components/PreferencesSync";

/** 从 PriceCandle[] 生成 Lightweight Charts K线数据 */
function toCandlestickData(candles: PriceCandle[]): CandlestickData[] {
  return candles.map((c) => ({
    time: Math.floor(new Date(c.time).getTime() / 1000) as any,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
}

/** 从 PriceCandle[] 生成成交量数据 */
function toVolumeData(candles: PriceCandle[]): HistogramData[] {
  return candles.map((c) => {
    const isUp = c.close >= c.open;
    return {
      time: Math.floor(new Date(c.time).getTime() / 1000) as any,
      value: c.volume,
      color: isUp ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)",
    };
  });
}

/** 从 PriceCandle[] 生成成交额数据 */
function toTurnoverData(candles: PriceCandle[]): LineData[] {
  return candles.map((c) => ({
    time: Math.floor(new Date(c.time).getTime() / 1000) as any,
    value: c.turnover,
  }));
}

/** 计算简单移动平均 */
function calcMA(data: CandlestickData[], period: number): LineData[] {
  const result: LineData[] = [];
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i].close;
    if (i >= period) sum -= data[i - period].close;
    if (i >= period - 1) {
      result.push({ time: data[i].time, value: sum / period });
    }
  }
  return result;
}

// 记住用户在交易大厅的界面状态（品种/市场类型/交割期），刷新后自动恢复；并同步到账号
const TRADING_VIEW_KEY = "trading_view";
type TradingView = { productId?: string; marketType?: string; deliveryPeriod?: string };
function loadTradingView(): TradingView {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(TRADING_VIEW_KEY);
    return raw ? (JSON.parse(raw) as TradingView) : {};
  } catch {
    return {};
  }
}
function saveTradingView(patch: TradingView) {
  persistTradingView(patch);
}

export default function TradingPage() {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuthStore();
  const { user } = useAuthStore();
  const router = useRouter();

  // 品种选择 — 先用默认值，挂载后再从 localStorage 恢复（避免 SSR/export 用默认值覆盖记忆）
  const [productId, setProductId] = useState("benzene");
  const [deliveryPeriod, setDeliveryPeriod] = useState<string>("现货");
  const [marketType, setMarketType] = useState<"all" | "spot" | "forward">("all");
  const tradingViewHydrated = useRef(false);
  // 左侧品种面板折叠
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // 四区域独立隐藏控制
  const [chartVisible, setChartVisible] = useState(true);
  const [marketPanelVisible, setMarketPanelVisible] = useState(true);
  const [listingPanelVisible, setListingPanelVisible] = useState(true);

  // 弹窗状态
  const [modalOpen, setModalOpen] = useState(false);
  const [swapModalOpen, setSwapModalOpen] = useState(false);
  const [initialSide, setInitialSide] = useState<"BUY" | "SELL">("BUY");
  const [takeTarget, setTakeTarget] = useState<Listing | null>(null);
  const [swapTarget, setSwapTarget] = useState<{
    swap: SwapListing;
    mode: "sell" | "buy" | "both";
    flashMatch?: boolean;
  } | null>(null);
  const [takeError, setTakeError] = useState<string | null>(null);
  const [swapTakeError, setSwapTakeError] = useState<string | null>(null);
  const [tradeToast, setTradeToast] = useState<string | null>(null);
  const [chartInterval, setChartInterval] = useState("30m");

  // 页内 tradeToast 与全局 Toast 一致：约 5 秒自动消失
  useEffect(() => {
    if (!tradeToast) return;
    const t = setTimeout(() => setTradeToast(null), 5000);
    return () => clearTimeout(t);
  }, [tradeToast]);

  // 议价弹窗
  const [counterOfferTarget, setCounterOfferTarget] = useState<{
    listing?: Listing;
    swap?: SwapListing;
    swapMode?: "sell" | "buy" | "both";
    /** 闪拼入口带入：数量锁定不可改 */
    fixedQuantity?: number;
    fromFlashMatch?: boolean;
  } | null>(null);
  const [counterOfferError, setCounterOfferError] = useState<string | null>(null);
  const [dualCOLoading, setDualCOLoading] = useState(false);

  // 编辑已有商谈
  const [editCounterOfferTarget, setEditCounterOfferTarget] = useState<{
    listing?: Listing;
    swap?: SwapListing;
    co: CounterOffer;
    pairedCo?: CounterOffer | null;
  } | null>(null);

  // 编辑挂牌
  const [editListingTarget, setEditListingTarget] = useState<Listing | null>(null);

  // 编辑换盘
  const [editSwapTarget, setEditSwapTarget] = useState<SwapListing | null>(null);

  // 详情弹窗是否打开（由 ListingPanel 上报，用于操作弹窗显示"返回详情"按钮）
  const [detailOpen, setDetailOpen] = useState(false);
  /** 下级点「返回」时递增 → ListingPanel 恢复详情 */
  const [detailRestoreToken, setDetailRestoreToken] = useState(0);
  /** 下级点关闭 / 操作成功时递增 → ListingPanel 销毁详情栈 */
  const [detailDismissToken, setDetailDismissToken] = useState(0);

  // #685 弹窗内实时更新：操作弹窗数据更新提示
  const [modalUpdated, setModalUpdated] = useState(false);
  const [modalUpdateMessage, setModalUpdateMessage] = useState<string | null>(null);
  const [modalWithdrawn, setModalWithdrawn] = useState({
    take: false,
    swap: false,
    counterOffer: false,
    editCounterOffer: false,
  });

  const dismissModalUpdate = useCallback(() => {
    setModalUpdated(false);
    setModalUpdateMessage(null);
  }, []);

  const clearModalHints = useCallback(() => {
    setModalUpdated(false);
    setModalUpdateMessage(null);
    setModalWithdrawn({ take: false, swap: false, counterOffer: false, editCounterOffer: false });
  }, []);

  /** 返回上一级详情（仅「返回」按钮调用） */
  const restoreDetail = useCallback(() => {
    setDetailRestoreToken((t) => t + 1);
  }, []);

  /** 关闭整条弹窗栈含详情（X / 提交成功） */
  const dismissDetailStack = useCallback(() => {
    setDetailDismissToken((t) => t + 1);
  }, []);

  const modalSyncRef = useRef({
    takeTarget,
    swapTarget,
    counterOfferTarget,
    editCounterOfferTarget,
    editListingTarget,
    editSwapTarget,
  });
  modalSyncRef.current = {
    takeTarget,
    swapTarget,
    counterOfferTarget,
    editCounterOfferTarget,
    editListingTarget,
    editSwapTarget,
  };
  // 摘盘请求进行中：禁止把「缓存里暂时找不到挂牌」误判成对方撤盘
  const takeInFlightRef = useRef(false);

  const syncOpenModalsFromCache = useCallback(() => {
    const snap = modalSyncRef.current;
    let updated = false;
    let updateMessage: string | null = null;
    const withdrawn = { take: false, swap: false, counterOffer: false, editCounterOffer: false };

    if (snap.takeTarget) {
      const found = findListingInCache(queryClient, snap.takeTarget.id);
      if (!found && wasListingActive(snap.takeTarget)) {
        // 自己摘盘请求进行中时列表可能瞬时不同步，不能当成对方撤盘
        if (!takeInFlightRef.current) {
          withdrawn.take = true;
        }
      } else if (found) {
        if (isListingWithdrawn(found)) {
          setTakeTarget(found);
          withdrawn.take = true;
        } else if (entityChanged(snap.takeTarget, found)) {
          if (hasEditorialEntityUpdate(snap.takeTarget, found)) {
            updateMessage = describeEntityUpdate(snap.takeTarget, found);
            updated = true;
          }
          setTakeTarget(found);
        }
      }
    }

    if (snap.counterOfferTarget?.listing) {
      const found = findListingInCache(queryClient, snap.counterOfferTarget.listing.id);
      if (!found && wasListingActive(snap.counterOfferTarget.listing)) {
        withdrawn.counterOffer = true;
      } else if (found) {
        if (isListingWithdrawn(found)) {
          setCounterOfferTarget({ ...snap.counterOfferTarget, listing: found });
          withdrawn.counterOffer = true;
        } else if (entityChanged(snap.counterOfferTarget.listing, found)) {
          if (hasEditorialEntityUpdate(snap.counterOfferTarget.listing, found)) {
            updateMessage = describeEntityUpdate(snap.counterOfferTarget.listing, found);
            updated = true;
          }
          setCounterOfferTarget({ ...snap.counterOfferTarget, listing: found });
        }
      }
    }

    if (snap.editCounterOfferTarget?.listing) {
      const found = findListingInCache(queryClient, snap.editCounterOfferTarget.listing.id);
      if (!found && wasListingActive(snap.editCounterOfferTarget.listing)) {
        withdrawn.editCounterOffer = true;
      } else if (found) {
        if (isListingWithdrawn(found)) {
          setEditCounterOfferTarget({ ...snap.editCounterOfferTarget, listing: found });
          withdrawn.editCounterOffer = true;
        } else if (entityChanged(snap.editCounterOfferTarget.listing, found)) {
          if (hasEditorialEntityUpdate(snap.editCounterOfferTarget.listing, found)) {
            updateMessage = describeEntityUpdate(snap.editCounterOfferTarget.listing, found);
            updated = true;
          }
          setEditCounterOfferTarget({ ...snap.editCounterOfferTarget, listing: found });
        }
      }
    }

    if (snap.editListingTarget) {
      const found = findListingInCache(queryClient, snap.editListingTarget.id);
      if (found && entityChanged(snap.editListingTarget, found)) {
        // 自己在编辑弹窗里改盘：只静默同步，绝不提示「对方已修改」
        setEditListingTarget(found);
      }
    }

    if (snap.swapTarget?.swap) {
      const found = findSwapInCache(queryClient, snap.swapTarget.swap.id);
      if (!found && wasSwapActive(snap.swapTarget.swap)) {
        withdrawn.swap = true;
      } else if (found) {
        if (isSwapWithdrawn(found)) {
          setSwapTarget({ ...snap.swapTarget, swap: found });
          withdrawn.swap = true;
        } else if (entityChanged(snap.swapTarget.swap, found)) {
          if (hasEditorialEntityUpdate(snap.swapTarget.swap, found)) {
            updateMessage = describeEntityUpdate(snap.swapTarget.swap, found);
            updated = true;
          }
          setSwapTarget({ ...snap.swapTarget, swap: found });
        }
      }
    }

    if (snap.counterOfferTarget?.swap) {
      const found = findSwapInCache(queryClient, snap.counterOfferTarget.swap.id);
      if (!found && wasSwapActive(snap.counterOfferTarget.swap)) {
        withdrawn.counterOffer = true;
      } else if (found) {
        if (isSwapWithdrawn(found)) {
          setCounterOfferTarget({ ...snap.counterOfferTarget, swap: found });
          withdrawn.counterOffer = true;
        } else if (entityChanged(snap.counterOfferTarget.swap, found)) {
          if (hasEditorialEntityUpdate(snap.counterOfferTarget.swap, found)) {
            updateMessage = describeEntityUpdate(snap.counterOfferTarget.swap, found);
            updated = true;
          }
          setCounterOfferTarget({ ...snap.counterOfferTarget, swap: found });
        }
      }
    }

    if (snap.editCounterOfferTarget?.swap) {
      const found = findSwapInCache(queryClient, snap.editCounterOfferTarget.swap.id);
      if (!found && wasSwapActive(snap.editCounterOfferTarget.swap)) {
        withdrawn.editCounterOffer = true;
      } else if (found) {
        if (isSwapWithdrawn(found)) {
          setEditCounterOfferTarget({ ...snap.editCounterOfferTarget, swap: found });
          withdrawn.editCounterOffer = true;
        } else if (entityChanged(snap.editCounterOfferTarget.swap, found)) {
          if (hasEditorialEntityUpdate(snap.editCounterOfferTarget.swap, found)) {
            updateMessage = describeEntityUpdate(snap.editCounterOfferTarget.swap, found);
            updated = true;
          }
          setEditCounterOfferTarget({ ...snap.editCounterOfferTarget, swap: found });
        }
      }
    }

    if (snap.editSwapTarget) {
      const found = findSwapInCache(queryClient, snap.editSwapTarget.id);
      if (found && entityChanged(snap.editSwapTarget, found)) {
        // 自己在编辑换盘：只静默同步，绝不提示「对方已修改」
        setEditSwapTarget(found);
      }
    }

    if (withdrawn.take || withdrawn.swap || withdrawn.counterOffer || withdrawn.editCounterOffer) {
      setModalWithdrawn((prev) => ({
        take: prev.take || withdrawn.take,
        swap: prev.swap || withdrawn.swap,
        counterOffer: prev.counterOffer || withdrawn.counterOffer,
        editCounterOffer: prev.editCounterOffer || withdrawn.editCounterOffer,
      }));
      setModalUpdated(false);
      setModalUpdateMessage(null);
    } else if (updated) {
      setModalUpdated(true);
      if (updateMessage) setModalUpdateMessage(updateMessage);
    }
  }, [queryClient]);

  // 当 listings/swaps 缓存更新时，同步所有打开的操作弹窗
  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      const key = event.query.queryKey;
      if (key[0] !== "listingsFiltered" && key[0] !== "swaps") return;
      if (event.type === "updated" || event.type === "added") {
        syncOpenModalsFromCache();
      }
    });
    return () => unsubscribe();
  }, [queryClient, syncOpenModalsFromCache]);

  // 未登录跳转
  useEffect(() => {
    if (!isAuthenticated) router.push("/");
  }, [isAuthenticated, router]);

  // 挂载后恢复交易大厅记忆；账号偏好拉取后再次应用
  useEffect(() => {
    const skipSave = { current: true };
    const apply = () => {
      const saved = loadTradingView();
      if (saved.productId) setProductId(saved.productId);
      if (saved.deliveryPeriod !== undefined) {
        setDeliveryPeriod(saved.deliveryPeriod.trim() ? saved.deliveryPeriod : "现货");
      }
      if (saved.marketType === "all" || saved.marketType === "spot" || saved.marketType === "forward") {
        setMarketType(saved.marketType);
      }
      skipSave.current = true;
      tradingViewHydrated.current = true;
    };
    apply();
    window.addEventListener("trading-view-changed", apply);
    return () => window.removeEventListener("trading-view-changed", apply);
  }, []);

  // 记住用户在交易大厅的界面状态（品种/市场类型/交割期）
  useEffect(() => {
    if (!tradingViewHydrated.current) return;
    saveTradingView({
      productId,
      marketType,
      deliveryPeriod: deliveryPeriod ?? "",
    });
  }, [productId, marketType, deliveryPeriod]);

  const productsQuery = useQuery({
    queryKey: ["products"],
    queryFn: fetchProducts,
    staleTime: 5 * 60 * 1000,
    enabled: isAuthenticated,
  });

  // 查询当前用户发出的 PENDING 商谈（用于判断某挂牌是否已有待回复商谈）
  const pendingCounterOffersQuery = useQuery({
    queryKey: ["counterOffers", "sent", "pending"],
    queryFn: fetchSentPendingCounterOffers,
    staleTime: 0,
    enabled: isAuthenticated,
    refetchInterval: 10_000,
  });

  // 查询当前用户收到的 PENDING 商谈（别人对我挂盘发起的商谈）
  const receivedPendingCounterOffersQuery = useQuery({
    queryKey: ["counterOffers", "received", "pending"],
    queryFn: fetchReceivedPendingCounterOffers,
    staleTime: 0,
    enabled: isAuthenticated,
    refetchInterval: 10_000,
  });

  const mySwapLocksQuery = useQuery({
    queryKey: ["swapLocks", "mine"],
    queryFn: fetchMySwapLocks,
    staleTime: 0,
    enabled: isAuthenticated,
    refetchInterval: 10_000,
  });

  // 合并发出的 + 收到的 PENDING 商谈
  const allPendingCounterOffers = useMemo(() => {
    const sent = pendingCounterOffersQuery.data ?? [];
    const received = receivedPendingCounterOffersQuery.data ?? [];
    // 去重（同一条商谈不会同时出现在 sent 和 received 中，但安全起见）
    const seen = new Set<string>();
    const merged: typeof sent = [];
    for (const co of [...sent, ...received]) {
      if (!seen.has(co.id)) {
        seen.add(co.id);
        merged.push(co);
      }
    }
    return merged;
  }, [pendingCounterOffersQuery.data, receivedPendingCounterOffersQuery.data]);

  const historyQuery = useQuery<PriceCandle[]>({
    queryKey: ["priceHistory", productId, chartInterval, deliveryPeriod],
    queryFn: () => fetchPriceHistory(productId, chartInterval, 200, deliveryPeriod),
    staleTime: 30_000,
    enabled: isAuthenticated,
  });

  const invalidateTrading = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["listingsFiltered"] });
    queryClient.invalidateQueries({ queryKey: ["swaps"] });
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey;
        return (
          (key[0] === "trades" && key[1] === productId) ||
          (key[0] === "orderbook" && key[1] === productId) ||
          (key[0] === "latestPrice" && key[1] === productId) ||
          (key[0] === "priceHistory" && key[1] === productId)
        );
      },
    });
  }, [queryClient, productId]);

  const handleWSTrade = useCallback(
    (trade: WSTrade) => {
      // 双方换盘私人成交无市场参考意义，不刷新 K 线/盘口最新价
      if (trade.source === "swap_private") return;
      if (trade.product_id === productId) {
        invalidateTrading();
        setTradeToast(`成交 ¥${trade.price.toFixed(1)} × ${Math.floor(trade.quantity)}吨`);
      }
    },
    [productId, invalidateTrading]
  );

  // 其他用户发盘增删改时，实时刷新本用户的发盘列表
  // 后端对所有 listing/swap 的 create/update/cancel 都广播 new_listing 事件
  const handleWSNewListing = useCallback(
    async (ev: { product_id: string }) => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["listingsFiltered"] }),
        queryClient.refetchQueries({ queryKey: ["swaps"] }),
      ]);
      syncOpenModalsFromCache();
      queryClient.invalidateQueries({ queryKey: ["myListings"] });

      if (ev.product_id === productId) {
        invalidateTrading();
        // 自己主动操作（发盘/锁单/解锁/摘盘等）触发的回声：只刷新列表，不弹「发盘有更新」
        if (shouldSuppressListingToast()) return;
        setTradeToast("发盘有更新，请查看最新列表");
      }
    },
    [productId, invalidateTrading, queryClient, syncOpenModalsFromCache]
  );

  // WebSocket — 仅刷新数据，Toast 和通知写入由 GlobalNotificationListener 统一处理
  // 乐观更新：对方接受/拒绝/撤销商谈时，立即从 pending 缓存中移除，UI 即时反映
  useTradeWS({
    onTrade: handleWSTrade,
    onNewListing: handleWSNewListing,
    onCounterOfferReceived: () => {
      queryClient.invalidateQueries({ queryKey: ["counterOffers"] });
    },
    onCounterOfferAccepted: (data) => {
      // 对方接受了商谈 → 该商谈已成交，从 pending 列表中移除
      if (data?.id) {
        queryClient.setQueryData<CounterOffer[]>(["counterOffers", "sent", "pending"], (old) =>
          (old ?? []).filter((co) => co.id !== data.id)
        );
        queryClient.setQueryData<CounterOffer[]>(["counterOffers", "received", "pending"], (old) =>
          (old ?? []).filter((co) => co.id !== data.id)
        );
      }
      queryClient.invalidateQueries({ queryKey: ["counterOffers"] });
      invalidateTrading();
    },
    onCounterOfferRejected: (data) => {
      // 对方拒绝了商谈 → 从 pending 列表中移除
      if (data?.id) {
        queryClient.setQueryData<CounterOffer[]>(["counterOffers", "sent", "pending"], (old) =>
          (old ?? []).filter((co) => co.id !== data.id)
        );
        queryClient.setQueryData<CounterOffer[]>(["counterOffers", "received", "pending"], (old) =>
          (old ?? []).filter((co) => co.id !== data.id)
        );
      }
      queryClient.invalidateQueries({ queryKey: ["counterOffers"] });
    },
    onCounterOfferCancelled: (data) => {
      // 商谈被撤销（对方撤盘或成交导致自动撤销）→ 从 pending 列表中移除
      if (data?.id) {
        queryClient.setQueryData<CounterOffer[]>(["counterOffers", "sent", "pending"], (old) =>
          (old ?? []).filter((co) => co.id !== data.id)
        );
        queryClient.setQueryData<CounterOffer[]>(["counterOffers", "received", "pending"], (old) =>
          (old ?? []).filter((co) => co.id !== data.id)
        );
      }
      queryClient.invalidateQueries({ queryKey: ["counterOffers"] });
    },
    onCounterOfferPartialAccepted: (data) => {
      // 对方部分接受了商谈 → 状态变为 PARTIAL_ACCEPTED，从 pending 列表中移除
      if (data?.id) {
        queryClient.setQueryData<CounterOffer[]>(["counterOffers", "sent", "pending"], (old) =>
          (old ?? []).filter((co) => co.id !== data.id)
        );
        queryClient.setQueryData<CounterOffer[]>(["counterOffers", "received", "pending"], (old) =>
          (old ?? []).filter((co) => co.id !== data.id)
        );
      }
      queryClient.invalidateQueries({ queryKey: ["counterOffers"] });
    },
    onCounterOfferConfirmRejected: (data) => {
      // 发起方二次确认拒绝了部分接受 → 商谈撤销，从 pending 列表中移除
      if (data?.id) {
        queryClient.setQueryData<CounterOffer[]>(["counterOffers", "sent", "pending"], (old) =>
          (old ?? []).filter((co) => co.id !== data.id)
        );
        queryClient.setQueryData<CounterOffer[]>(["counterOffers", "received", "pending"], (old) =>
          (old ?? []).filter((co) => co.id !== data.id)
        );
      }
      queryClient.invalidateQueries({ queryKey: ["counterOffers"] });
    },
    onCounterOfferUpdated: () => {
      queryClient.invalidateQueries({ queryKey: ["counterOffers"] });
    },
    onSwapLockReceived: () => {
      queryClient.invalidateQueries({ queryKey: ["swapLocks", "mine"] });
      invalidateTrading();
    },
    onSwapLockCancelled: () => {
      queryClient.invalidateQueries({ queryKey: ["swapLocks", "mine"] });
      invalidateTrading();
    },
  });

  const createMutation = useMutation({
    mutationFn: createListing,
    onMutate: () => {
      suppressOwnListingToast();
    },
    onSuccess: (res) => {
      invalidateTrading();
      toast(res.listing?.status === "SCHEDULED" ? "已预约发布" : "发盘成功", "success");
      if ((res.trades?.length ?? 0) > 0) {
        setTradeToast(`您的挂盘已匹配对手盘，自动成交 ${res.trades.length} 笔`);
      }
    },
  });

  const swapMutation = useMutation({
    mutationFn: createSwap,
    onMutate: () => {
      suppressOwnListingToast();
    },
    onSuccess: (res) => {
      invalidateTrading();
      // 确保换盘列表立即刷新（invalidate 可能因 staleTime 延迟）
      queryClient.refetchQueries({ queryKey: ["swaps"] });
      queryClient.refetchQueries({ queryKey: ["listingsFiltered"] });
      const scheduled = res?.swap?.status === "SCHEDULED";
      setTradeToast(scheduled ? "换盘已预约，到开始时间后自动发布" : "换盘发布成功！等待对手方接受");
    },
  });

  // 摘盘：不在 onMutate 里乐观删列表（会触发 sync → 误显「对方已撤盘」）
  const takeMutation = useMutation({
    mutationFn: ({ id, quantity }: { id: string; quantity: number }) =>
      takeListing(id, quantity),
    onMutate: () => {
      takeInFlightRef.current = true;
    },
    onSuccess: (res) => {
      takeInFlightRef.current = false;
      setTakeTarget(null);
      setTakeError(null);
      setModalWithdrawn((s) => ({ ...s, take: false }));
      dismissDetailStack();
      toast("摘盘成功！", "success");
      if ((res.trades?.length ?? 0) > 0) {
        invalidateTrading();
      } else {
        queryClient.invalidateQueries({ queryKey: ["listingsFiltered"] });
        queryClient.invalidateQueries({ queryKey: ["orderbook", productId] });
      }
    },
    onError: (err) => {
      takeInFlightRef.current = false;
      // 失败时清除误判的「对方已撤盘」，只展示真实错误（如保证金不足）
      setModalWithdrawn((s) => ({ ...s, take: false }));
      const msg = err instanceof ApiError ? err.message : "摘盘失败";
      setTakeError(msg);
    },
  });

  const matchMutation = useMutation({
    mutationFn: ({
      id,
      quantity,
      mode,
      lockMatchId,
      sellQty,
      buyQty,
    }: {
      id: string;
      quantity: number;
      mode: "sell" | "buy" | "both";
      lockMatchId?: string;
      sellQty?: number;
      buyQty?: number;
    }) => matchSwap(id, quantity, mode, lockMatchId, sellQty, buyQty),
    onSuccess: (res) => {
      setSwapTarget(null);
      setSwapTakeError(null);
      dismissDetailStack();
      toast(res.message || "换盘成功", "success");
      queryClient.invalidateQueries({ queryKey: ["swaps"] });
      queryClient.invalidateQueries({ queryKey: ["listingsFiltered"] });
      queryClient.invalidateQueries({ queryKey: ["swapLocks", "mine"] });
      // 仅市场成交刷新 K 线/最新价；纯锁定与双方换盘均不算
      if (res.market_price) {
        invalidateTrading();
      }
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "匹配失败";
      setSwapTakeError(msg);
      toast(msg, "error");
    },
  });

  const products = productsQuery.data ?? [];
  const selectedProduct = useMemo(
    () => products.find((p) => p.id === productId),
    [products, productId]
  );
  const candles = historyQuery.data ?? [];

  const candleData = useMemo(() => toCandlestickData(candles), [candles]);
  const volData = useMemo(() => toVolumeData(candles), [candles]);
  const turnoverData = useMemo(() => toTurnoverData(candles), [candles]);
  const ma5Data = useMemo(() => calcMA(candleData, 5), [candleData]);
  const ma10Data = useMemo(() => calcMA(candleData, 10), [candleData]);
  const ma20Data = useMemo(() => calcMA(candleData, 20), [candleData]);
  const ma30Data = useMemo(() => calcMA(candleData, 30), [candleData]);

  const handleCreate = (data: CreateListingFormData) => {
    createMutation.mutate({
      product_id: data.product_id,
      side: data.side,
      price: Number(data.price),
      quantity: Number(data.quantity),
      delivery_period: data.delivery_period,
      delivery_location: data.delivery_location,
      delivery_method: data.delivery_method || undefined,
      payment_method: data.payment_method || undefined,
      specs: data.specs || undefined,
      allow_partial: data.allow_partial,
      allow_counter_offer: data.allow_counter_offer,
      negotiable_terms: data.negotiable_terms,
      free_storage_enabled: data.free_storage_enabled,
      free_storage_days: data.free_storage_enabled && data.free_storage_days ? Number(data.free_storage_days) : undefined,
      min_quantity: data.allow_partial && data.min_quantity ? Number(data.min_quantity) : 0,
      expires_at: data.expires_at ? new Date(data.expires_at).toISOString() : undefined,
      starts_at: data.starts_at ? new Date(data.starts_at).toISOString() : undefined,
    });
  };

  // 编辑挂牌 mutation
  const updateListingMutation = useMutation({
    mutationFn: ({ id, params }: { id: string; params: Parameters<typeof updateListing>[1] }) =>
      updateListing(id, params),
    onMutate: () => {
      suppressOwnListingToast();
    },
    onSuccess: () => {
      setEditListingTarget(null);
      dismissDetailStack();
      toast("挂盘已更新", "success");
      queryClient.invalidateQueries({ queryKey: ["listingsFiltered"] });
      queryClient.invalidateQueries({ queryKey: ["myListings"] });
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "编辑挂盘失败";
      toast(msg, "error");
    },
  });

  const handleEditListing = (data: EditListingFormData) => {
    if (!editListingTarget) return;
    updateListingMutation.mutate({
      id: editListingTarget.id,
      params: {
        price: Number(data.price),
        quantity: Number(data.quantity),
        min_quantity: data.allow_partial && data.min_quantity ? Number(data.min_quantity) : 0,
        delivery_period: data.delivery_period || undefined,
        delivery_location: data.delivery_location || undefined,
        payment_method: data.payment_method || undefined,
        delivery_method: data.delivery_method || undefined,
        specs: data.specs || undefined,
        allow_partial: data.allow_partial,
        allow_counter_offer: data.allow_counter_offer,
        negotiable_terms: data.negotiable_terms,
        free_storage_enabled: data.free_storage_enabled,
        free_storage_days: data.free_storage_enabled && data.free_storage_days ? Number(data.free_storage_days) : undefined,
        expires_at: data.expires_at ? new Date(data.expires_at).toISOString() : undefined,
        starts_at: data.starts_at !== undefined
          ? (data.starts_at ? new Date(data.starts_at).toISOString() : "")
          : undefined,
      },
    });
  };

  // 编辑换盘 mutation
  const updateSwapMutation = useMutation({
    mutationFn: ({ id, params }: { id: string; params: UpdateSwapParams }) =>
      updateSwap(id, params),
    onMutate: () => {
      suppressOwnListingToast();
    },
    onSuccess: () => {
      setEditSwapTarget(null);
      dismissDetailStack();
      toast("换盘已更新", "success");
      queryClient.invalidateQueries({ queryKey: ["swaps"] });
      queryClient.refetchQueries({ queryKey: ["swaps"] });
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "编辑换盘失败";
      toast(msg, "error");
    },
  });

  const handleEditSwap = (id: string, data: UpdateSwapParams) => {
    updateSwapMutation.mutate({ id, params: data });
  };

  const handleTake = (listingId: string, quantity: number) => {
    setTakeError(null);
    setModalWithdrawn((s) => ({ ...s, take: false }));
    takeMutation.mutate({ id: listingId, quantity });
  };

  const handleMatchSwap = (
    swapId: string,
    quantity: number,
    mode: "sell" | "buy" | "both",
    lockMatchId?: string,
    sellQty?: number,
    buyQty?: number,
  ) => {
    setSwapTakeError(null);
    matchMutation.mutate({ id: swapId, quantity, mode, lockMatchId, sellQty, buyQty });
  };

  // 议价 mutation
  const counterOfferMutation = useMutation({
    mutationFn: createCounterOffer,
    onSuccess: async (resp) => {
      setCounterOfferTarget(null);
      setCounterOfferError(null);
      setTakeTarget(null);
      setSwapTarget(null);
      dismissDetailStack();
      toast("商谈已发出，等待对方回复", "success");
      if (resp?.warning) {
        toast(resp.warning, "info");
      }
      // 乐观更新：直接将新创建的商谈插入 sent pending 缓存，让挂盘状态立即变为"商谈中"
      if (resp?.data) {
        queryClient.setQueryData<CounterOffer[]>(["counterOffers", "sent", "pending"], (old) => {
          const existing = old ?? [];
          // 避免重复插入
          if (existing.some((co) => co.id === resp.data.id)) return existing;
          return [...existing, resp.data];
        });
      }
      // 同时强制刷新商谈列表（确保数据一致性）
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["counterOffers", "sent", "pending"] }),
        queryClient.refetchQueries({ queryKey: ["counterOffers", "received", "pending"] }),
      ]);
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "发起商谈失败";
      setCounterOfferError(msg);
      toast(msg, "error");
    },
  });

  const handleCounterOffer = (params: {
    ref_type: "listing" | "swap";
    ref_id: string;
    mode?: "sell" | "buy" | "both";
    offer_price: number;
    offer_quantity: number;
    offer_delivery_period?: string;
    offer_delivery_location?: string;
    offer_payment_method?: string;
    offer_delivery_method?: string;
    offer_free_storage_enabled?: boolean;
    offer_free_storage_days?: number | null;
    offer_specs?: string;
  }) => {
    setCounterOfferError(null);
    counterOfferMutation.mutate(params);
  };

  const handleCounterOfferDual = async (offers: Parameters<typeof handleCounterOffer>[0][]) => {
    setCounterOfferError(null);
    setDualCOLoading(true);
    try {
      const results = await Promise.all(offers.map((offer) => createCounterOffer(offer)));
      setCounterOfferTarget(null);
      setCounterOfferError(null);
      setTakeTarget(null);
      setSwapTarget(null);
      dismissDetailStack();
      toast(
        offers.length > 1 ? "卖盘、买盘商谈已分别发出" : "商谈已发出，等待对方回复",
        "success"
      );
      for (const resp of results) {
        if (resp?.warning) toast(resp.warning, "info");
        if (resp?.data) {
          queryClient.setQueryData<CounterOffer[]>(["counterOffers", "sent", "pending"], (old) => {
            const existing = old ?? [];
            if (existing.some((co) => co.id === resp.data.id)) return existing;
            return [...existing, resp.data];
          });
        }
      }
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["counterOffers", "sent", "pending"] }),
        queryClient.refetchQueries({ queryKey: ["counterOffers", "received", "pending"] }),
      ]);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "发起商谈失败";
      setCounterOfferError(msg);
      toast(msg, "error");
    } finally {
      setDualCOLoading(false);
    }
  };

  // 更新已有商谈 mutation
  const updateCounterOfferMutation = useMutation({
    mutationFn: ({ id, params }: { id: string; params: Parameters<typeof updateCounterOffer>[1] }) =>
      updateCounterOffer(id, params),
    onSuccess: () => {
      setEditCounterOfferTarget(null);
      setCounterOfferError(null);
      toast("商谈已更新，对方将收到修改通知", "success");
      // 刷新 PENDING 商谈列表（用 refetchQueries 强制发起网络请求）
      queryClient.refetchQueries({ queryKey: ["counterOffers", "sent", "pending"] });
      queryClient.refetchQueries({ queryKey: ["counterOffers", "received", "pending"] });
      queryClient.invalidateQueries({ queryKey: ["counterOffers"] });
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "更新商谈失败";
      setCounterOfferError(msg);
      toast(msg, "error");
    },
  });

  const handleUpdateCounterOffer = (counterOfferId: string, params: {
    offer_price: number;
    offer_quantity: number;
    offer_delivery_period?: string;
    offer_delivery_location?: string;
    offer_payment_method?: string;
    offer_delivery_method?: string;
    offer_free_storage_enabled?: boolean;
    offer_free_storage_days?: number | null;
    offer_specs?: string;
  }) => {
    setCounterOfferError(null);
    updateCounterOfferMutation.mutate({ id: counterOfferId, params });
  };

  // 撤销已有商谈
  const handleCancelCounterOffer = (counterOfferId: string) => {
    import("@/lib/api").then(({ cancelCounterOffer }) => {
      cancelCounterOffer(counterOfferId).then(() => {
        setEditCounterOfferTarget(null);
        toast("商谈已撤销", "info");
        // 乐观更新：从 sent/received pending 缓存中移除该商谈
        queryClient.setQueryData<CounterOffer[]>(["counterOffers", "sent", "pending"], (old) => (old ?? []).filter((co) => co.id !== counterOfferId));
        queryClient.setQueryData<CounterOffer[]>(["counterOffers", "received", "pending"], (old) => (old ?? []).filter((co) => co.id !== counterOfferId));
        queryClient.invalidateQueries({ queryKey: ["counterOffers"] });
      }).catch(() => {
        toast("撤销商谈失败", "error");
      });
    });
  };

  const unit = selectedProduct?.unit ?? "吨";

  // K线周期：全部9个周期，用户可自定义显示/隐藏
  const ALL_INTERVALS = [
    { key: "30m", label: "30分" },
    { key: "1h", label: "1时" },
    { key: "2h", label: "2时" },
    { key: "4h", label: "4时" },
    { key: "1d", label: "日线" },
    { key: "1w", label: "周线" },
    { key: "1M", label: "月线" },
    { key: "1q", label: "季度线" },
    { key: "1y", label: "年线" },
  ] as const;

  // 用户自定义可见周期（默认显示前5个）
  const [visibleIntervalKeys, setVisibleIntervalKeys] = useState<string[]>(["30m", "1h", "2h", "4h", "1d"]);

  // 下拉菜单状态
  const [moreOpen, setMoreOpen] = useState(false);
  const [listingDropdown, setListingDropdown] = useState(false);

  // 主栏可见的周期
  const visibleIntervals = ALL_INTERVALS.filter(i => visibleIntervalKeys.includes(i.key));
  // 当前周期是否在"更多"中
  const isMoreInterval = !visibleIntervalKeys.includes(chartInterval);
  const moreLabel = isMoreInterval
    ? ALL_INTERVALS.find(i => i.key === chartInterval)?.label ?? "更多"
    : "更多";

  const toggleIntervalVisibility = (key: string) => {
    setVisibleIntervalKeys(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  if (!isAuthenticated) {
    return (
      <main className="flex items-center justify-center h-[calc(100vh-2.75rem)] bg-t-bg text-t-text-2">
        请先登录后访问交易大厅
      </main>
    );
  }

  // 弹窗栈：仅展示最上层；打开下级时关闭（隐藏）上级，点「返回」再恢复
  // 优先级（高→低）：编辑商谈 > 发起商谈 > 摘盘/锁定 > 编辑挂盘/换盘 > 发布买/卖/换
  const showEditCounterOfferModal = !!editCounterOfferTarget;
  const showCounterOfferModal =
    !!counterOfferTarget &&
    !!(counterOfferTarget.swap || counterOfferTarget.listing) &&
    !showEditCounterOfferModal;
  const showTakeModal =
    !!takeTarget && !showCounterOfferModal && !showEditCounterOfferModal;
  const showSwapTakeModal =
    !!swapTarget && !showCounterOfferModal && !showEditCounterOfferModal;
  const showEditListingModal =
    !!editListingTarget &&
    !showCounterOfferModal &&
    !showEditCounterOfferModal &&
    !showTakeModal &&
    !showSwapTakeModal;
  const showEditSwapModal =
    !!editSwapTarget &&
    !showCounterOfferModal &&
    !showEditCounterOfferModal &&
    !showTakeModal &&
    !showSwapTakeModal;
  const showCreateListingModal =
    modalOpen &&
    !showCounterOfferModal &&
    !showEditCounterOfferModal &&
    !showTakeModal &&
    !showSwapTakeModal &&
    !showEditListingModal &&
    !showEditSwapModal;
  const showCreateSwapModal =
    swapModalOpen &&
    !showCounterOfferModal &&
    !showEditCounterOfferModal &&
    !showTakeModal &&
    !showSwapTakeModal &&
    !showEditListingModal &&
    !showEditSwapModal &&
    !showCreateListingModal;
  // 任意操作弹窗状态存在时即隐藏详情（用原始 state，避免 show* 条件导致漏判）
  const childModalOpen =
    !!takeTarget ||
    !!swapTarget ||
    !!counterOfferTarget ||
    !!editCounterOfferTarget ||
    !!editListingTarget ||
    !!editSwapTarget ||
    modalOpen ||
    swapModalOpen;

  const clearOpModals = () => {
    setTakeTarget(null);
    setSwapTarget(null);
    setCounterOfferTarget(null);
    setEditCounterOfferTarget(null);
    setEditListingTarget(null);
    setEditSwapTarget(null);
    setTakeError(null);
    setSwapTakeError(null);
    setCounterOfferError(null);
    clearModalHints();
  };

  return (
    <ErrorBoundary>
    <main className="flex flex-col h-[calc(100vh-2.75rem)] overflow-hidden bg-t-bg">
      {/* ===== 第1层：品种标签（已隐藏） ===== */}
      {/*
      <ProductTabs
        products={products}
        activeId={productId}
        onSelect={(id) => { setProductId(id); setDeliveryPeriod(undefined); }}
      />
      */}

      {/* ===== 第2层：周期 + 操作 ===== */}
      <div className="flex items-center h-10 px-3 border-b shrink-0 gap-0"
        style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--bg-secondary)" }}
      >
        {/* 弹性空间 */}
        <div className="flex-1 min-w-2" />

        {/* K线周期选择器 */}
        <div className="flex items-center shrink-0">
          <div className="flex items-center gap-0.5 rounded p-0.5" style={{ backgroundColor: "var(--bg-primary)" }}>
            {visibleIntervals.map((iv) => (
              <button
                key={iv.key}
                onClick={() => { setChartInterval(iv.key); setMoreOpen(false); }}
                className={`px-2.5 py-1 text-[12px] rounded transition-colors ${
                  chartInterval === iv.key
                    ? "bg-t-accent text-white font-medium shadow-sm"
                    : "text-t-text-3 hover:text-t-text"
                }`}
              >
                {iv.label}
              </button>
            ))}
          </div>
          {/* 更多▼ */}
          <div className="relative ml-0.5">
            <button
              onClick={() => setMoreOpen(v => !v)}
              className={`px-2.5 py-1 text-[12px] rounded transition-colors shrink-0 flex items-center gap-1 ${
                isMoreInterval
                  ? "bg-t-accent text-white font-medium shadow-sm"
                  : "text-t-text-3 hover:text-t-text hover:bg-t-hover/40"
              }`}
            >
              {moreLabel}
              <svg className={`w-3 h-3 transition-transform ${moreOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {moreOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMoreOpen(false)} />
                <div className="absolute top-full right-0 mt-1 z-40 bg-t-panel border border-t-border rounded-md shadow-lg py-1 min-w-[120px]"
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  <div className="px-2 py-1 text-[10px] text-t-text-3 border-b" style={{ borderColor: "var(--border-subtle)" }}>周期选择</div>
                  {ALL_INTERVALS.map((iv) => {
                    const checked = visibleIntervalKeys.includes(iv.key);
                    return (
                      <button
                        key={iv.key}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleIntervalVisibility(iv.key);
                        }}
                        className={`w-full text-left px-3 py-1.5 text-[12px] transition-colors whitespace-nowrap flex items-center gap-2 ${
                          chartInterval === iv.key
                            ? "bg-t-accent/10 text-t-accent font-medium"
                            : "text-t-text-2 hover:bg-t-hover/50"
                        }`}
                      >
                        <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${checked ? "bg-t-accent border-t-accent" : "border-t-border hover:border-t-text-3"}`} style={{ borderColor: checked ? undefined : "var(--border-color)" }}>
                          {checked && (
                            <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                          )}
                        </span>
                        <span onClick={(e) => { e.stopPropagation(); setChartInterval(iv.key); setMoreOpen(false); }} className="flex-1">{iv.label}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* 发盘/换盘 下拉菜单 */}
        <div className="relative ml-3">
          <button
            onClick={() => setListingDropdown(v => !v)}
            className="px-3 py-1 text-[13px] bg-t-accent hover:bg-t-accent-hover text-white rounded font-medium transition-colors shrink-0 flex items-center gap-1"
          >
            ＋ 发盘
            <svg className={`w-3 h-3 transition-transform ${listingDropdown ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {listingDropdown && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setListingDropdown(false)} />
              <div className="absolute top-full right-0 mt-1 z-40 bg-t-panel border border-t-border rounded-md shadow-lg py-1 min-w-[100px]"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                <button
                  onClick={() => {
                    clearOpModals();
                    setSwapModalOpen(false);
                    setInitialSide("BUY");
                    setModalOpen(true);
                    setListingDropdown(false);
                  }}
                  className="w-full text-center px-4 py-2 text-[16px] text-red-600 hover:bg-red-50 transition-colors font-bold"
                >
                  买
                </button>
                <button
                  onClick={() => {
                    clearOpModals();
                    setSwapModalOpen(false);
                    setInitialSide("SELL");
                    setModalOpen(true);
                    setListingDropdown(false);
                  }}
                  className="w-full text-center px-4 py-2 text-[16px] text-green-600 hover:bg-green-50 transition-colors font-bold"
                >
                  卖
                </button>
                <div className="border-t my-1" style={{ borderColor: "var(--border-subtle)" }} />
                <button
                  onClick={() => {
                    clearOpModals();
                    setModalOpen(false);
                    setSwapModalOpen(true);
                    setListingDropdown(false);
                  }}
                  className="w-full text-center px-4 py-2 text-[16px] text-blue-600 hover:bg-blue-50 transition-colors font-bold"
                >
                  换
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ===== Toast 提示（约 5 秒自动消失） ===== */}
      {tradeToast && (
        <div className="relative mx-3 mt-1 px-8 py-1.5 rounded text-[11px] text-center animate-pulse shrink-0 border"
          style={{ backgroundColor: "var(--color-success-bg)", borderColor: "var(--color-success)", color: "var(--color-success-text)" }}
        >
          {tradeToast}
          <button
            type="button"
            onClick={() => setTradeToast(null)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded opacity-70 hover:opacity-100"
            aria-label="关闭提示"
            title="关闭"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
      {(createMutation.isError || takeMutation.isError) && (
        <div className="relative mx-3 mt-1 px-8 py-1.5 rounded text-[11px] text-center shrink-0 border"
          style={{ backgroundColor: "var(--color-error-bg)", borderColor: "var(--color-error)", color: "var(--color-error)" }}
        >
          {(createMutation.error as ApiError)?.message ||
            (takeMutation.error as ApiError)?.message ||
            "操作失败"}
          <button
            type="button"
            onClick={() => {
              createMutation.reset();
              takeMutation.reset();
            }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded opacity-70 hover:opacity-100"
            aria-label="关闭提示"
            title="关闭"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* ===== 主区域 ===== */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* WatchList 侧边栏 */}
        <aside
          className={`relative flex flex-col border-r shrink-0 overflow-hidden transition-all duration-300 group/sidebar
            ${sidebarOpen ? "w-[220px]" : "w-0 border-r-0"}`}
          style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--bg-secondary)" }}
        >
          {sidebarOpen && (
            <>
              <WatchList
                products={products}
                selectedId={productId}
                selectedDeliveryPeriod={deliveryPeriod}
                onSelect={(id, dp) => {
                  setProductId(id);
                  setDeliveryPeriod(dp?.trim() ? dp : "现货");
                }}
                onCollapse={() => setSidebarOpen(false)}
              />
            </>
          )}
        </aside>

        {/* 侧边栏收起后的展开按钮 */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="shrink-0 w-7 flex items-center justify-center border-r bg-t-panel text-t-text-2 hover:text-t-text hover:bg-t-hover transition-all"
            style={{ borderColor: "var(--border-subtle)" }}
            title="展开品种栏"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M6 5l7 7-7 7" />
            </svg>
          </button>
        )}

        {/* 主内容 */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* K线 + 盘口 — K线隐藏后只保留盘口（固定高度），挂盘填满剩余空间 */}
          <div className={`flex overflow-hidden p-1.5 gap-1.5 ${chartVisible ? "min-h-0 flex-1" : "shrink-0 h-[320px]"}`}
          >
            {/* K线图 — 主体区域 */}
            {chartVisible ? (
              <div className="relative flex-1 min-w-0 overflow-hidden bg-t-panel rounded-lg shadow-panel flex flex-col group/chart">
                {/* K线标题栏：品种名 + 周期 + 收起按钮 */}
                <div className="flex items-center h-9 px-3 border-b shrink-0"
                  style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--bg-secondary)" }}
                >
                  <span className="text-sm font-semibold text-t-text">{selectedProduct?.name ?? productId}</span>
                  <span className="mx-2 text-t-text-3">·</span>
                  <span className="text-xs text-t-text-2">
                    {ALL_INTERVALS.find(i => i.key === chartInterval)?.label ?? chartInterval}
                  </span>
                  {/* 交割期标签：现货交割=黄色，其他=蓝色 */}
                  {deliveryPeriod && (
                    <>
                      <span className="mx-2 text-t-text-3">·</span>
                      <span className={`text-xs font-medium ${
                        deliveryPeriod === "现货" || deliveryPeriod.trim() === ""
                          ? "text-status-warning"
                          : "text-status-info"
                      }`}>
                        {deliveryPeriod}
                      </span>
                    </>
                  )}
              {/* 收起K线按钮 */}
              <button
                onClick={() => setChartVisible(false)}
                className="ml-auto w-6 h-6 flex items-center justify-center rounded-md bg-t-hover/80 text-t-text-2 hover:text-t-text hover:bg-t-hover transition-all"
                title="收起K线图"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7M5 21l7-7 7 7" />
                </svg>
              </button>
                </div>
                <div className="flex-1 min-h-0">
                  <TradingViewChart
                    productId={productId}
                    productName={selectedProduct?.name ?? ""}
                    data={candleData}
                    volumeData={volData}
                    turnoverData={turnoverData}
                    ma5Data={ma5Data}
                    ma10Data={ma10Data}
                    ma20Data={ma20Data}
                    ma30Data={ma30Data}
                    chartType={chartInterval === "time" ? "line" : "candle"}
                    loading={historyQuery.isLoading}
                  />
                </div>
              </div>
            ) : (
              /* K线收起后的展开按钮 */
              <button
                onClick={() => setChartVisible(true)}
                className="shrink-0 w-9 flex flex-col items-center justify-center gap-2 bg-t-panel rounded-lg shadow-panel text-t-text-2 hover:text-t-text hover:bg-t-hover transition-all py-2 h-full"
                title="展开K线图"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7M19 3l-7 7-7-7" />
                </svg>
                <span className="text-[10px] text-t-text-3" style={{ writingMode: "vertical-rl", letterSpacing: "0.1em" }}>展开K线</span>
              </button>
            )}

            {/* 盘口 */}
            {marketPanelVisible ? (
              <div className="relative w-[300px] shrink-0 flex flex-col overflow-y-auto group/market">
                <div className="flex-1 bg-t-panel rounded-lg shadow-panel flex flex-col">
                  <MarketSummaryPanel
                    productId={productId}
                    productName={selectedProduct?.name || productId}
                    deliveryPeriod={deliveryPeriod}
                    unit={unit}
                    onCollapse={() => setMarketPanelVisible(false)}
                  />
                </div>
              </div>
            ) : (
              /* 盘口收起后的展开按钮 */
              <button
                onClick={() => setMarketPanelVisible(true)}
                className="shrink-0 w-9 flex flex-col items-center justify-center gap-2 bg-t-panel rounded-lg shadow-panel text-t-text-2 hover:text-t-text hover:bg-t-hover transition-all py-2 h-full"
                title="展开盘口"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M6 5l7 7-7 7" />
                </svg>
                <span className="text-[10px] text-t-text-3" style={{ writingMode: "vertical-rl", letterSpacing: "0.1em" }}>展开盘口</span>
              </button>
            )}
          </div>

          {/* ===== 挂盘（全宽） ===== */}
          {listingPanelVisible ? (
            <div
              className={`relative px-1.5 pb-1.5 group/listing ${chartVisible ? "shrink-0" : "flex-1 min-h-0"}`}
              style={chartVisible ? { height: "38vh" } : undefined}
            >
              <ListingPanel
                productId={productId}
                products={products.map(p => ({ id: p.id, name: p.name }))}
                unit={unit}
                canTrade={true}
                currentUserId={user?.id}
                defaultDeliveryPeriod={deliveryPeriod}
                marketType={marketType}
                onTake={(listing) => {
                  setModalOpen(false);
                  setSwapModalOpen(false);
                  setCounterOfferTarget(null);
                  setEditCounterOfferTarget(null);
                  setEditListingTarget(null);
                  setEditSwapTarget(null);
                  setSwapTarget(null);
                  setTakeTarget(listing);
                }}
                onTakeSwap={(swap, mode, flashMatch) => {
                  setModalOpen(false);
                  setSwapModalOpen(false);
                  setCounterOfferTarget(null);
                  setEditCounterOfferTarget(null);
                  setEditListingTarget(null);
                  setEditSwapTarget(null);
                  setTakeTarget(null);
                  setSwapTarget({ swap, mode, flashMatch });
                }}
                onCounterOffer={(listing) => {
                  setModalOpen(false);
                  setSwapModalOpen(false);
                  setTakeTarget(null);
                  setSwapTarget(null);
                  setEditCounterOfferTarget(null);
                  setEditListingTarget(null);
                  setEditSwapTarget(null);
                  setCounterOfferTarget({ listing });
                }}
                onCounterOfferSwap={(swap, mode) => {
                  setModalOpen(false);
                  setSwapModalOpen(false);
                  setTakeTarget(null);
                  setSwapTarget(null);
                  setEditCounterOfferTarget(null);
                  setEditListingTarget(null);
                  setEditSwapTarget(null);
                  setCounterOfferTarget({ swap, swapMode: mode });
                }}
                pendingCounterOffers={allPendingCounterOffers}
                mySwapLocks={mySwapLocksQuery.data ?? []}
                onEditCounterOffer={(listing, co) => {
                  setModalOpen(false);
                  setSwapModalOpen(false);
                  setTakeTarget(null);
                  setSwapTarget(null);
                  setCounterOfferTarget(null);
                  setEditListingTarget(null);
                  setEditSwapTarget(null);
                  setEditCounterOfferTarget({ listing, co });
                }}
                onEditCounterOfferSwap={(swap, co) => {
                  const pairedCo = findPairedSwapCounterOffer(co, allPendingCounterOffers ?? []);
                  setModalOpen(false);
                  setSwapModalOpen(false);
                  setTakeTarget(null);
                  setSwapTarget(null);
                  setCounterOfferTarget(null);
                  setEditListingTarget(null);
                  setEditSwapTarget(null);
                  setEditCounterOfferTarget({ swap, co, pairedCo });
                }}
                onEditListing={(listing) => {
                  setModalOpen(false);
                  setSwapModalOpen(false);
                  setTakeTarget(null);
                  setSwapTarget(null);
                  setCounterOfferTarget(null);
                  setEditCounterOfferTarget(null);
                  setEditSwapTarget(null);
                  setEditListingTarget(listing);
                }}
                onEditSwap={(swap) => {
                  setModalOpen(false);
                  setSwapModalOpen(false);
                  setTakeTarget(null);
                  setSwapTarget(null);
                  setCounterOfferTarget(null);
                  setEditCounterOfferTarget(null);
                  setEditListingTarget(null);
                  setEditSwapTarget(swap);
                }}
                onDeliveryPeriodChange={(dp) => setDeliveryPeriod(dp?.trim() ? dp : "现货")}
                onCollapse={() => setListingPanelVisible(false)}
                onDetailOpenChange={setDetailOpen}
                detailHidden={childModalOpen}
                detailRestoreToken={detailRestoreToken}
                detailDismissToken={detailDismissToken}
              />
            </div>
          ) : (
            /* 挂盘收起后的展开按钮 */
            <div className="px-1.5 pb-1.5 shrink-0">
              <button
                onClick={() => setListingPanelVisible(true)}
                className="w-full h-7 flex items-center justify-center bg-t-panel rounded-lg shadow-panel text-t-text-2 hover:text-t-text hover:bg-t-hover transition-all text-[11px] gap-1"
                title="展开挂盘列表"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7M19 3l-7 7-7-7" />
                </svg>
                展开挂盘
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ===== 弹窗 ===== */}
      <CreateListingModal
        open={showCreateListingModal}
        products={products}
        loading={createMutation.isPending}
        initialSide={initialSide}
        defaultProductId={productId}
        marketType={marketType}
        onClose={() => {
          setModalOpen(false);
          dismissDetailStack();
        }}
        onSubmit={handleCreate}
      />

      {showEditListingModal && (
      <EditListingModal
        open
        listing={editListingTarget}
        product={selectedProduct}
        loading={updateListingMutation.isPending}
        dataUpdated={false}
        updateMessage={undefined}
        onDismissUpdate={dismissModalUpdate}
        onClose={() => {
          setEditListingTarget(null);
          clearModalHints();
          dismissDetailStack();
        }}
        onSubmit={handleEditListing}
        onBack={detailOpen ? () => {
          setEditListingTarget(null);
          clearModalHints();
          restoreDetail();
        } : undefined}
      />
      )}

      {showEditSwapModal && (
      <EditSwapModal
        open
        swap={editSwapTarget}
        products={products}
        loading={updateSwapMutation.isPending}
        dataUpdated={false}
        updateMessage={undefined}
        onDismissUpdate={dismissModalUpdate}
        onClose={() => {
          setEditSwapTarget(null);
          clearModalHints();
          dismissDetailStack();
        }}
        onSubmit={handleEditSwap}
        onBack={detailOpen ? () => {
          setEditSwapTarget(null);
          clearModalHints();
          restoreDetail();
        } : undefined}
      />
      )}

      <CreateSwapModal
        open={showCreateSwapModal}
        products={products}
        defaultProductId={productId}
        loading={swapMutation.isPending}
        onClose={() => {
          setSwapModalOpen(false);
          dismissDetailStack();
        }}
        onSubmit={(data: CreateSwapParams) => swapMutation.mutate(data)}
      />

      {showTakeModal && takeTarget && (
      <TakeListingModal
        listing={takeTarget}
        unit={unit}
        loading={takeMutation.isPending}
        error={takeError}
        opponentWithdrawn={modalWithdrawn.take}
        dataUpdated={modalUpdated && !!takeTarget && !modalWithdrawn.take}
        updateMessage={modalUpdateMessage ?? undefined}
        onDismissUpdate={dismissModalUpdate}
        onDismissWithdrawn={() => setModalWithdrawn((s) => ({ ...s, take: false }))}
        onClose={() => {
          setTakeTarget(null);
          setTakeError(null);
          clearModalHints();
          dismissDetailStack();
        }}
        onSubmit={handleTake}
        onCounterOffer={(listing) => {
          // 保留 takeTarget；上级摘盘因 showTakeModal=false 关闭，返回商谈时再恢复摘盘
          setCounterOfferTarget({ listing });
        }}
        onBack={() => {
          setTakeTarget(null);
          setTakeError(null);
          clearModalHints();
          if (detailOpen) restoreDetail();
        }}
      />
      )}

      {showSwapTakeModal && swapTarget && (
      <TakeSwapModal
        swap={swapTarget.swap}
        mode={swapTarget.mode}
        unit={unit}
        products={products}
        loading={matchMutation.isPending}
        error={swapTakeError}
        flashMatch={swapTarget?.flashMatch}
        opponentWithdrawn={modalWithdrawn.swap}
        dataUpdated={modalUpdated && !!swapTarget && !modalWithdrawn.swap}
        updateMessage={modalUpdateMessage ?? undefined}
        onDismissUpdate={dismissModalUpdate}
        onDismissWithdrawn={() => setModalWithdrawn((s) => ({ ...s, swap: false }))}
        onClose={() => {
          setSwapTarget(null);
          setSwapTakeError(null);
          clearModalHints();
          dismissDetailStack();
        }}
        onSubmit={handleMatchSwap}
        onCounterOffer={(swap, mode, opts) => {
          setCounterOfferTarget({
            swap,
            swapMode: mode,
            fixedQuantity: opts?.fixedQuantity,
            fromFlashMatch: !!opts?.fixedQuantity,
          });
        }}
        onBack={() => {
          setSwapTarget(null);
          setSwapTakeError(null);
          clearModalHints();
          if (detailOpen) restoreDetail();
        }}
      />
      )}

      {/* 议价弹窗 — 条件渲染 + key 确保每次打开都是全新挂载，useState 正确初始化 */}
      {showCounterOfferModal && counterOfferTarget && (
        <CounterOfferModal
          key={`${counterOfferTarget.swap?.id ?? counterOfferTarget.listing?.id ?? "co"}-${counterOfferTarget.swapMode ?? ""}-${counterOfferTarget.fixedQuantity ?? ""}`}
          listing={counterOfferTarget.listing ?? null}
          swap={counterOfferTarget.swap ?? null}
          swapMode={counterOfferTarget.swapMode}
          fixedQuantity={counterOfferTarget.fixedQuantity}
          quantityLocked={!!counterOfferTarget.fromFlashMatch}
          unit={unit}
          loading={counterOfferMutation.isPending || dualCOLoading}
          error={counterOfferError}
          dataUpdated={modalUpdated && !!counterOfferTarget && !modalWithdrawn.counterOffer}
          updateMessage={modalUpdateMessage ?? undefined}
          opponentWithdrawn={modalWithdrawn.counterOffer}
          onDismissUpdate={dismissModalUpdate}
          onDismissWithdrawn={() => setModalWithdrawn((s) => ({ ...s, counterOffer: false }))}
          onClose={() => {
            setCounterOfferTarget(null);
            setCounterOfferError(null);
            setTakeTarget(null);
            setSwapTarget(null);
            clearModalHints();
            dismissDetailStack();
          }}
          onSubmit={handleCounterOffer}
          onSubmitDual={handleCounterOfferDual}
          onBack={
            detailOpen || takeTarget || swapTarget
              ? () => {
                  setCounterOfferTarget(null);
                  setCounterOfferError(null);
                  clearModalHints();
                  // 有摘盘/锁定上级则只回到该层；否则回到详情
                  if (!takeTarget && !swapTarget && detailOpen) restoreDetail();
                }
              : undefined
          }
        />
      )}

      {/* 编辑已有商谈弹窗 */}
      {showEditCounterOfferModal && editCounterOfferTarget && (
        <CounterOfferModal
          listing={editCounterOfferTarget.listing ?? null}
          swap={editCounterOfferTarget.swap ?? null}
          editCounterOffer={editCounterOfferTarget.co}
          editPairedCounterOffer={editCounterOfferTarget.pairedCo ?? null}
          unit={unit}
          loading={updateCounterOfferMutation.isPending}
          error={counterOfferError}
          dataUpdated={modalUpdated && !!editCounterOfferTarget && !modalWithdrawn.editCounterOffer}
          updateMessage={modalUpdateMessage ?? undefined}
          opponentWithdrawn={modalWithdrawn.editCounterOffer}
          onDismissUpdate={dismissModalUpdate}
          onDismissWithdrawn={() => setModalWithdrawn((s) => ({ ...s, editCounterOffer: false }))}
          onClose={() => {
            setEditCounterOfferTarget(null);
            setCounterOfferError(null);
            clearModalHints();
            dismissDetailStack();
          }}
          onSubmit={() => {}}
          onUpdate={handleUpdateCounterOffer}
          onBack={detailOpen ? () => {
            setEditCounterOfferTarget(null);
            setCounterOfferError(null);
            clearModalHints();
            restoreDetail();
          } : undefined}
        />
      )}
    </main>
    </ErrorBoundary>
  );
}
