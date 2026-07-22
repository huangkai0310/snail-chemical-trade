"use client";

import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Product, SwapListing } from "@/lib/types";
import { formatNegotiableTerms, formatFreeStorage, formatSpecs, formatPartial, formatBoardSerial } from "@/lib/format";
import {
  getMatchQuantityBounds,
  getFlashQuantityBounds,
  getSharePickState,
  validateMatchQuantity,
  validateDualMatchQuantity,
  swapLockSideDisplay,
  type DualMatchQuantityBounds,
} from "@/lib/swap-lock";
import { fetchPendingSwapLocks, fetchProducts } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import ModalUpdateNotice from "./ModalUpdateNotice";
import { confirmDialog } from "./ConfirmDialog";
import { TakeSwapConfirmSheet } from "./PostingConfirmSheet";
import ShareCountPicker from "./ShareCountPicker";

const LABEL_CLS = "text-gray-400 dark:text-t-text-3 shrink-0";
const VALUE_CLS = "text-gray-800 dark:text-t-text font-medium text-right";

interface Props {
  swap: SwapListing | null;
  mode: "sell" | "buy" | "both" | null;
  unit?: string;
  /** 品种列表，用于确认单显示中文名 */
  products?: Product[] | { id: string; name: string }[];
  loading?: boolean;
  error?: string | null;
  opponentWithdrawn?: boolean;
  dataUpdated?: boolean;
  updateMessage?: string;
  onDismissUpdate?: () => void;
  onDismissWithdrawn?: () => void;
  onClose: () => void;
  onSubmit: (
    swapId: string,
    quantity: number,
    mode: "sell" | "buy" | "both",
    lockMatchId?: string,
    sellQty?: number,
    buyQty?: number,
  ) => void;
  onCounterOffer?: (
    swap: SwapListing,
    mode: "sell" | "buy" | "both",
    opts?: { fixedQuantity: number; lockMatchId?: string },
  ) => void;
  onBack?: () => void;
  /** 闪拼：选择单边锁定配对，数量固定 */
  flashMatch?: boolean;
}

function fmtPeriod(p?: string | null) {
  if (!p || p.trim() === "") return "现货";
  return p;
}

function fmtLockTime(iso: string) {
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  } catch {
    return iso;
  }
}

/** 匿名短编号：取 UUID 末 4 位，便于同数量多笔区分 */
function shortLockRef(id: string): string {
  const hex = id.replace(/-/g, "");
  return hex.slice(-4).toUpperCase() || "----";
}

export default function TakeSwapModal({
  swap,
  mode,
  unit = "吨",
  products: productsProp,
  loading,
  error,
  opponentWithdrawn,
  dataUpdated,
  updateMessage,
  onDismissUpdate,
  onDismissWithdrawn,
  onClose,
  onSubmit,
  onCounterOffer,
  onBack,
  flashMatch = false,
}: Props) {
  const myUserId = useAuthStore((s) => s.user?.id ?? null);
  const [quantity, setQuantity] = useState("");
  const [shareCount, setShareCount] = useState("");
  const [sellQtyStr, setSellQtyStr] = useState("");
  const [buyQtyStr, setBuyQtyStr] = useState("");
  const [sellShareCount, setSellShareCount] = useState("");
  const [buyShareCount, setBuyShareCount] = useState("");
  const [touched, setTouched] = useState(false);
  const [selectedLockId, setSelectedLockId] = useState<string | null>(null);

  const pendingLocksQuery = useQuery({
    queryKey: ["swapPendingLocks", swap?.id, mode],
    queryFn: () => fetchPendingSwapLocks(swap!.id, mode as "sell" | "buy"),
    enabled: flashMatch && !!swap?.id && !!mode && mode !== "both",
  });

  const productsQuery = useQuery({
    queryKey: ["products"],
    queryFn: fetchProducts,
    enabled: !productsProp?.length,
    staleTime: 60_000,
  });
  const productName = useMemo(() => {
    const list = productsProp?.length ? productsProp : productsQuery.data ?? [];
    const map = new Map(list.map((p) => [p.id, p.name]));
    return (id: string) => map.get(id) || id;
  }, [productsProp, productsQuery.data]);
  const pendingLocks = pendingLocksQuery.data ?? [];
  const selectedLock = pendingLocks.find((l) => l.id === selectedLockId) ?? null;

  const matchBounds =
    swap && mode
      ? flashMatch && selectedLock && mode !== "both"
        ? getFlashQuantityBounds(swap, mode, selectedLock.matched_qty)
        : getMatchQuantityBounds(swap, mode)
      : null;

  useEffect(() => {
    if (!flashMatch) return;
    if (pendingLocks.length === 1) {
      setSelectedLockId(pendingLocks[0].id);
    } else if (pendingLocks.length > 1 && !pendingLocks.some((l) => l.id === selectedLockId)) {
      setSelectedLockId(null);
    }
  }, [flashMatch, pendingLocks, selectedLockId]);

  useEffect(() => {
    if (flashMatch && selectedLock) {
      const defaultQty = Math.floor(selectedLock.matched_qty);
      setQuantity(defaultQty > 0 ? String(defaultQty) : "");
      setShareCount("");
      setTouched(false);
      return;
    }
    if (!matchBounds) return;
    if (mode === "both" && !flashMatch) {
      const dual = matchBounds as DualMatchQuantityBounds;
      const sellPick = getSharePickState(dual.sellRemain, dual.sellMinQty, dual.sellAllowPartial);
      const buyPick = getSharePickState(dual.buyRemain, dual.buyMinQty, dual.buyAllowPartial);
      if (sellPick.canPickShares) {
        setSellShareCount(String(sellPick.maxShares));
        setSellQtyStr("");
      } else {
        setSellShareCount("");
        setSellQtyStr(dual.sellMax > 0 ? String(dual.sellMax) : "");
      }
      if (buyPick.canPickShares) {
        setBuyShareCount(String(buyPick.maxShares));
        setBuyQtyStr("");
      } else {
        setBuyShareCount("");
        setBuyQtyStr(dual.buyMax > 0 ? String(dual.buyMax) : "");
      }
      setQuantity("");
      setShareCount("");
      setTouched(false);
      return;
    }
    if (flashMatch) return;
    const pick = getSharePickState(matchBounds.remain, matchBounds.minQty, matchBounds.allowPartial);
    if (pick.canPickShares) {
      setShareCount(String(pick.maxShares));
      setQuantity("");
    } else {
      setShareCount("");
      setQuantity(matchBounds.max > 0 ? String(matchBounds.max) : "");
    }
    setSellQtyStr("");
    setBuyQtyStr("");
    setSellShareCount("");
    setBuyShareCount("");
    setTouched(false);
  }, [swap?.id, mode, flashMatch, swap?.sell_filled, swap?.buy_filled, selectedLock?.id, selectedLock?.matched_qty, matchBounds?.max]);

  if (!swap || !mode) return null;

  const dualBounds = mode === "both" && !flashMatch ? (matchBounds as DualMatchQuantityBounds) : null;
  const isDualMode = !!dualBounds;

  const singleSharePick =
    !flashMatch && !isDualMode && matchBounds
      ? getSharePickState(matchBounds.remain, matchBounds.minQty, matchBounds.allowPartial)
      : { canPickShares: false, perShare: 0, maxShares: 0 };

  const sellSharePick = dualBounds
    ? getSharePickState(dualBounds.sellRemain, dualBounds.sellMinQty, dualBounds.sellAllowPartial)
    : { canPickShares: false, perShare: 0, maxShares: 0 };
  const buySharePick = dualBounds
    ? getSharePickState(dualBounds.buyRemain, dualBounds.buyMinQty, dualBounds.buyAllowPartial)
    : { canPickShares: false, perShare: 0, maxShares: 0 };

  const qtyNum = flashMatch
    ? Math.floor(Number(quantity))
    : singleSharePick.canPickShares
      ? Math.floor(Number(shareCount) || 0) * singleSharePick.perShare
      : Math.floor(Number(quantity));

  const sellQtyNum = sellSharePick.canPickShares
    ? Math.floor(Number(sellShareCount) || 0) * sellSharePick.perShare
    : Math.floor(Number(sellQtyStr));
  const buyQtyNum = buySharePick.canPickShares
    ? Math.floor(Number(buyShareCount) || 0) * buySharePick.perShare
    : Math.floor(Number(buyQtyStr));

  const actionLabel = flashMatch
    ? mode === "sell"
      ? "闪拼 — 完成双向成交（买入）"
      : "闪拼 — 完成双向成交（卖出）"
    : mode === "sell"
      ? "锁定 — 买入（对方卖盘）"
      : mode === "buy"
        ? "锁定 — 卖出（对方买盘）"
        : "双向摘盘（最终成交）";

  const validateLabel = flashMatch ? "闪拼" : mode === "both" ? "成交" : "锁定";

  const validationError = (() => {
    if (flashMatch) {
      if (pendingLocksQuery.isLoading) return null;
      if (pendingLocks.length === 0) return "暂无可拼单的单边锁定";
      if (!selectedLockId || !selectedLock) return "请选择要拼单的单边锁定";
      if (!quantity) return null;
      const lockQty = Math.floor(selectedLock.matched_qty);
      if (qtyNum !== lockQty) return `闪拼数量须为所选锁定量 ${lockQty}`;
      return null;
    }
    if (isDualMode && dualBounds) {
      if (sellSharePick.canPickShares) {
        const n = Math.floor(Number(sellShareCount));
        if (!sellShareCount || n <= 0) return "请选择卖出份数";
        if (n > sellSharePick.maxShares) return `卖出最多 ${sellSharePick.maxShares} 份`;
      }
      if (buySharePick.canPickShares) {
        const n = Math.floor(Number(buyShareCount));
        if (!buyShareCount || n <= 0) return "请选择买入份数";
        if (n > buySharePick.maxShares) return `买入最多 ${buySharePick.maxShares} 份`;
      }
      if (!sellSharePick.canPickShares && !sellQtyStr && !buySharePick.canPickShares && !buyQtyStr) return null;
      if (sellSharePick.canPickShares && !sellShareCount && buySharePick.canPickShares && !buyShareCount) return null;
      return validateDualMatchQuantity(sellQtyNum, buyQtyNum, dualBounds, validateLabel);
    }
    if (!matchBounds) return null;
    if (singleSharePick.canPickShares) {
      const n = Math.floor(Number(shareCount));
      if (!shareCount || n <= 0) return "请选择份数";
      if (n > singleSharePick.maxShares) return `最多 ${singleSharePick.maxShares} 份`;
    } else if (!quantity) {
      return null;
    }
    return validateMatchQuantity(
      qtyNum,
      matchBounds.remain,
      matchBounds.minQty,
      matchBounds.allowPartial,
      matchBounds.max,
      validateLabel
    );
  })();

  const isValid = flashMatch
    ? !!selectedLockId && pendingLocks.length > 0 && !pendingLocksQuery.isLoading && !validationError && qtyNum > 0
    : isDualMode
      ? !validationError && sellQtyNum > 0 && buyQtyNum > 0 && !!dualBounds
      : !validationError && qtyNum > 0 && !!matchBounds && qtyNum <= matchBounds.max;

  // both 模式下两侧数量是否不一致
  const isDualMismatch = isDualMode && sellQtyNum > 0 && buyQtyNum > 0 && sellQtyNum !== buyQtyNum;
  const extraLockSide = isDualMismatch
    ? sellQtyNum > buyQtyNum ? "卖出" : "买入"
    : null;
  const extraLockQty = isDualMismatch
    ? Math.abs(sellQtyNum - buyQtyNum)
    : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!isValid || !mode) return;

    const confirmTitle = flashMatch
      ? "确认闪拼"
      : mode === "both"
        ? "确认换盘成交"
        : "确认锁单";
    const sheetMode = flashMatch ? ("flash" as const) : mode;
    const ok = await confirmDialog({
      title: confirmTitle,
      message: "请核对换盘操作",
      content: (
        <TakeSwapConfirmSheet
          swap={swap}
          sellProductName={productName(swap.sell_product_id)}
          buyProductName={productName(swap.buy_product_id)}
          serialLabel={formatBoardSerial("S", swap.serial_no, swap.created_at)}
          mode={sheetMode}
          unit={unit}
          sellQty={isDualMode ? sellQtyNum : undefined}
          buyQty={isDualMode ? buyQtyNum : undefined}
          quantity={!isDualMode ? qtyNum : undefined}
          shareCount={
            !flashMatch && !isDualMode && singleSharePick.canPickShares
              ? Math.floor(Number(shareCount))
              : undefined
          }
          canPickShares={!flashMatch && !isDualMode && singleSharePick.canPickShares}
          lockSide={
            flashMatch && selectedLock
              ? swapLockSideDisplay(selectedLock.match_side)
              : undefined
          }
          lockQty={flashMatch && selectedLock ? Math.floor(selectedLock.matched_qty) : undefined}
          lockRef={
            flashMatch && selectedLock ? shortLockRef(selectedLock.id) : undefined
          }
        />
      ),
      wide: true,
      variant: "warning",
      icon: "warning",
      confirmText: flashMatch ? "确认闪拼" : mode === "both" ? "确认成交" : "确认锁定",
      cancelText: "再想想",
    });
    if (!ok) return;

    if (isDualMode) {
      onSubmit(
        swap.id,
        Math.min(sellQtyNum, buyQtyNum),
        mode,
        undefined,
        sellQtyNum,
        buyQtyNum,
      );
    } else {
      onSubmit(
        swap.id,
        qtyNum,
        mode,
        flashMatch ? selectedLockId ?? undefined : undefined
      );
    }
  };

  const showSellLeg = mode === "sell" || mode === "both";
  const showBuyLeg = mode === "buy" || mode === "both";
  const legSellRemain = Math.floor((swap.sell_quantity ?? 0) - (swap.sell_filled ?? 0));
  const legBuyRemain = Math.floor((swap.buy_quantity ?? 0) - (swap.buy_filled ?? 0));

  const bounds = matchBounds;
  const effectiveMaxQty = bounds?.max ?? 0;
  const effectiveAllowPartial = bounds?.allowPartial ?? true;
  const mustTakeAll = bounds?.mustTakeAll ?? !effectiveAllowPartial;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white dark:bg-t-panel rounded-xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-t-border sticky top-0 bg-white dark:bg-t-panel z-10">
          <div className="flex items-center gap-2">
            {onBack && (
              <button
                onClick={onBack}
                className="flex items-center gap-1 text-sm text-t-text-3 hover:text-t-text transition-colors"
                title="返回"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                返回
              </button>
            )}
            <h2 className="text-lg font-bold text-gray-800 dark:text-t-text">{actionLabel}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-t-text text-xl leading-none p-1"
          >
            ✕
          </button>
        </div>

        <ModalUpdateNotice show={opponentWithdrawn} variant="withdrawn" onDismiss={onDismissWithdrawn} />
        <ModalUpdateNotice show={dataUpdated && !opponentWithdrawn} variant="updated" message={updateMessage} onDismiss={onDismissUpdate} />

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {flashMatch && (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-gray-700 dark:text-t-text">
                  选择要拼单的锁定
                </p>
                {pendingLocks.length > 0 && (
                  <span className="text-[11px] text-t-text-3 tabular-nums">
                    共 {pendingLocks.length} 笔
                  </span>
                )}
              </div>
              {pendingLocksQuery.isLoading ? (
                <p className="text-xs text-t-text-3">加载锁定列表...</p>
              ) : pendingLocks.length === 0 ? (
                <p className="text-xs text-red-600 dark:text-red-400">暂无可拼单的单边锁定</p>
              ) : (
                <div
                  className="rounded-lg border border-t-border overflow-hidden max-h-56 overflow-y-auto divide-y divide-t-border"
                  role="radiogroup"
                  aria-label="待拼单锁定"
                >
                  {pendingLocks.map((lock, idx) => {
                    const sideLabel = lock.match_side === "sell" ? "锁定·卖" : "锁定·买";
                    const sideCls =
                      lock.match_side === "sell"
                        ? "bg-trade-down-bg text-trade-down-text"
                        : "bg-trade-up-bg text-trade-up-text";
                    const selected = selectedLockId === lock.id;
                    const isMine = !!myUserId && lock.acceptor_id === myUserId;
                    const qty = Math.floor(lock.matched_qty);
                    const title = isMine ? "我的锁定" : `锁定 ${shortLockRef(lock.id)}`;
                    return (
                      <button
                        key={lock.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setSelectedLockId(lock.id)}
                        className={`w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors ${
                          selected
                            ? "bg-amber-500/12 dark:bg-amber-500/15"
                            : "bg-t-panel hover:bg-t-hover"
                        }`}
                      >
                        <span
                          className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                            selected
                              ? "border-amber-500 bg-amber-500"
                              : "border-t-text-3/40"
                          }`}
                          aria-hidden
                        >
                          {selected && (
                            <span className="w-1.5 h-1.5 rounded-full bg-white" />
                          )}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-base font-semibold text-t-text tabular-nums">
                              {qty.toLocaleString()}
                              <span className="text-xs font-normal text-t-text-3 ml-0.5">{unit}</span>
                            </span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${sideCls}`}>
                              {sideLabel}
                            </span>
                            {isMine && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-status-warning-bg text-status-warning">
                                我的
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-[11px] text-t-text-3 flex items-center gap-1.5 flex-wrap">
                            <span>{title}</span>
                            <span className="opacity-40">·</span>
                            <span>第 {idx + 1} 笔</span>
                            <span className="opacity-40">·</span>
                            <span className="tabular-nums">{fmtLockTime(lock.matched_at)}</span>
                          </div>
                        </div>
                        {selected && (
                          <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 shrink-0">
                            已选
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              <p className="text-xs text-amber-600 dark:text-amber-400">
                闪拼数量以所选锁定量为准；列表匿名展示，可用短编号与时间区分多笔锁定。
              </p>
            </div>
          )}

          <div className="space-y-2">
            {showSellLeg && (
              <div className="bg-green-50 dark:bg-green-500/10 border border-green-100 dark:border-green-500/30 rounded-lg p-3 text-sm">
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-600 dark:text-blue-400 font-medium">卖</span>
                  {mode === "sell" && !effectiveAllowPartial && (
                    <span className="text-xs text-orange-600 dark:text-orange-400">整单</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                  <div className="flex justify-between gap-1">
                    <span className={LABEL_CLS}>价格</span>
                    <span className="font-mono font-bold text-green-700 dark:text-green-400">¥{swap.sell_price.toLocaleString()}/{unit}</span>
                  </div>
                  <div className="flex justify-between gap-1">
                    <span className={LABEL_CLS}>数量</span>
                    <span className={`font-mono ${VALUE_CLS}`}>
                      {legSellRemain} {unit}
                      {(swap.sell_filled ?? 0) > 0 && (
                        <span className="text-gray-400 dark:text-t-text-2 ml-0.5">/{Math.floor(swap.sell_quantity)}</span>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between gap-1">
                    <span className={LABEL_CLS}>交割期</span>
                    <span className={VALUE_CLS}>{fmtPeriod(swap.sell_delivery_period)}</span>
                  </div>
                  <div className="flex justify-between gap-1">
                    <span className={LABEL_CLS}>交割地</span>
                    <span className={VALUE_CLS}>{swap.sell_delivery_location || "-"}</span>
                  </div>
                  <div className="flex justify-between gap-1">
                    <span className={LABEL_CLS}>付款方式</span>
                    <span className={VALUE_CLS}>{swap.sell_payment_method || "-"}</span>
                  </div>
                  <div className="flex justify-between gap-1">
                    <span className={LABEL_CLS}>交割方式</span>
                    <span className={VALUE_CLS}>{swap.sell_delivery_method || "-"}</span>
                  </div>
                  <div className="flex justify-between gap-1">
                    <span className={LABEL_CLS}>免仓期</span>
                    <span className={VALUE_CLS}>{formatFreeStorage(swap.sell_free_storage_enabled, swap.sell_free_storage_days)}</span>
                  </div>
                  <div className="flex justify-between gap-1">
                    <span className={LABEL_CLS}>拆单</span>
                    <span className={VALUE_CLS}>{formatPartial(swap.sell_allow_partial, swap.sell_min_quantity, unit, swap.sell_quantity)}</span>
                  </div>
                  <div className="col-span-2 flex justify-between gap-2">
                    <span className={LABEL_CLS}>规格</span>
                    <span className={`${VALUE_CLS} break-all`}>{formatSpecs(swap.sell_specs)}</span>
                  </div>
                  <div className="col-span-2 flex justify-between gap-2">
                    <span className={LABEL_CLS}>可商谈条款</span>
                    <span className={`${VALUE_CLS} break-all`}>{swap.sell_allow_counter_offer === false ? "不可商谈" : formatNegotiableTerms(swap.sell_negotiable_terms)}</span>
                  </div>
                </div>
              </div>
            )}
            {showBuyLeg && (
              <div className="bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/30 rounded-lg p-3 text-sm">
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-600 dark:text-blue-400 font-medium">买</span>
                  {mode === "buy" && !effectiveAllowPartial && (
                    <span className="text-xs text-orange-600 dark:text-orange-400">整单</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                  <div className="flex justify-between gap-1">
                    <span className={LABEL_CLS}>价格</span>
                    <span className="font-mono font-bold text-red-700 dark:text-red-400">¥{swap.buy_price.toLocaleString()}/{unit}</span>
                  </div>
                  <div className="flex justify-between gap-1">
                    <span className={LABEL_CLS}>数量</span>
                    <span className={`font-mono ${VALUE_CLS}`}>
                      {legBuyRemain} {unit}
                      {(swap.buy_filled ?? 0) > 0 && (
                        <span className="text-gray-400 dark:text-t-text-2 ml-0.5">/{Math.floor(swap.buy_quantity)}</span>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between gap-1">
                    <span className={LABEL_CLS}>交割期</span>
                    <span className={VALUE_CLS}>{fmtPeriod(swap.buy_delivery_period)}</span>
                  </div>
                  <div className="flex justify-between gap-1">
                    <span className={LABEL_CLS}>交割地</span>
                    <span className={VALUE_CLS}>{swap.buy_delivery_location || "-"}</span>
                  </div>
                  <div className="flex justify-between gap-1">
                    <span className={LABEL_CLS}>付款方式</span>
                    <span className={VALUE_CLS}>{swap.buy_payment_method || "-"}</span>
                  </div>
                  <div className="flex justify-between gap-1">
                    <span className={LABEL_CLS}>交割方式</span>
                    <span className={VALUE_CLS}>{swap.buy_delivery_method || "-"}</span>
                  </div>
                  <div className="flex justify-between gap-1">
                    <span className={LABEL_CLS}>免仓期</span>
                    <span className={VALUE_CLS}>{formatFreeStorage(swap.buy_free_storage_enabled, swap.buy_free_storage_days)}</span>
                  </div>
                  <div className="flex justify-between gap-1">
                    <span className={LABEL_CLS}>拆单</span>
                    <span className={VALUE_CLS}>{formatPartial(swap.buy_allow_partial, swap.buy_min_quantity, unit, swap.buy_quantity)}</span>
                  </div>
                  <div className="col-span-2 flex justify-between gap-2">
                    <span className={LABEL_CLS}>规格</span>
                    <span className={`${VALUE_CLS} break-all`}>{formatSpecs(swap.buy_specs)}</span>
                  </div>
                  <div className="col-span-2 flex justify-between gap-2">
                    <span className={LABEL_CLS}>可商谈条款</span>
                    <span className={`${VALUE_CLS} break-all`}>{swap.buy_allow_counter_offer === false ? "不可商谈" : formatNegotiableTerms(swap.buy_negotiable_terms)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {isDualMode && dualBounds ? (
            <div className="space-y-3">
              {sellSharePick.canPickShares ? (
                <ShareCountPicker
                  label="卖出份数"
                  value={sellShareCount}
                  maxShares={sellSharePick.maxShares}
                  perShare={sellSharePick.perShare}
                  unit={unit}
                  error={touched && validationError && validationError.includes("卖") ? validationError : null}
                  disabled={loading}
                  onChange={(v) => {
                    setSellShareCount(v);
                    setTouched(false);
                  }}
                  onBlur={() => setTouched(true)}
                />
              ) : (
                <div>
                  <label className="flex items-center justify-between text-sm font-medium text-gray-600 dark:text-t-text-2 mb-1.5">
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/15 text-green-600 dark:text-green-400 font-medium">卖</span>
                      卖出数量 ({unit})
                    </span>
                    <span className="text-xs text-orange-600 dark:text-orange-400 font-normal">
                      {dualBounds.sellAllowPartial ? "须全部，不可改" : "整单，不可改"}
                    </span>
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={sellQtyStr}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-t-border rounded-lg font-mono bg-gray-50 dark:bg-t-hover text-t-text cursor-not-allowed"
                    disabled={loading}
                  />
                </div>
              )}
              {buySharePick.canPickShares ? (
                <ShareCountPicker
                  label="买入份数"
                  value={buyShareCount}
                  maxShares={buySharePick.maxShares}
                  perShare={buySharePick.perShare}
                  unit={unit}
                  error={touched && validationError && validationError.includes("买") ? validationError : null}
                  disabled={loading}
                  onChange={(v) => {
                    setBuyShareCount(v);
                    setTouched(false);
                  }}
                  onBlur={() => setTouched(true)}
                />
              ) : (
                <div>
                  <label className="flex items-center justify-between text-sm font-medium text-gray-600 dark:text-t-text-2 mb-1.5">
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/15 text-red-600 dark:text-red-400 font-medium">买</span>
                      买入数量 ({unit})
                    </span>
                    <span className="text-xs text-orange-600 dark:text-orange-400 font-normal">
                      {dualBounds.buyAllowPartial ? "须全部，不可改" : "整单，不可改"}
                    </span>
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={buyQtyStr}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-t-border rounded-lg font-mono bg-gray-50 dark:bg-t-hover text-t-text cursor-not-allowed"
                    disabled={loading}
                  />
                </div>
              )}
              {isDualMismatch && (
                <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg px-3 py-2">
                  两侧数量不一致：按较小量 {Math.min(sellQtyNum, buyQtyNum)} {unit} 成交，多出的 <span className="font-bold">{extraLockSide}</span> {extraLockQty} {unit} 将创建单边锁定，等待第三方拼盘。
                </div>
              )}
              {(touched || error) && validationError && !sellSharePick.canPickShares && !buySharePick.canPickShares && (
                <p className="text-sm text-red-600 dark:text-red-400">{validationError}</p>
              )}
              {(touched || error) && validationError && (sellSharePick.canPickShares || buySharePick.canPickShares) &&
                !validationError.includes("卖") && !validationError.includes("买") && (
                <p className="text-sm text-red-600 dark:text-red-400">{validationError}</p>
              )}
              {error && !validationError && (
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              )}
            </div>
          ) : flashMatch || !singleSharePick.canPickShares ? (
          <div>
            <label className="flex items-center justify-between text-sm font-medium text-gray-600 dark:text-t-text-2 mb-1.5">
              <span>{flashMatch ? "闪拼数量" : "成交数量"} ({unit})</span>
              {flashMatch ? (
                <span className="text-xs text-amber-600 dark:text-amber-400 font-normal">
                  闪拼数量不可修改
                </span>
              ) : mustTakeAll ? (
                <span className="text-xs text-orange-600 dark:text-orange-400 font-normal">
                  须全部锁定 {effectiveMaxQty}
                </span>
              ) : (
                <span className="text-xs text-orange-600 dark:text-orange-400 font-normal">整单，不可改</span>
              )}
            </label>
            <input
              type="text"
              readOnly
              value={quantity}
              className="w-full px-3 py-2.5 border border-gray-200 dark:border-t-border rounded-lg font-mono bg-gray-50 dark:bg-t-hover text-t-text cursor-not-allowed"
              disabled={loading || (flashMatch && pendingLocksQuery.isLoading)}
            />
            {flashMatch ? (
              <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                闪拼数量不可修改
                {selectedLock
                  ? `，将按所选锁定量 ${Math.floor(selectedLock.matched_qty)} ${unit} 成交。`
                  : "。"}
              </p>
            ) : null}
            {(touched || error) && validationError && (
              <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">{validationError}</p>
            )}
            {error && !validationError && (
              <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">{error}</p>
            )}
          </div>
          ) : (
            <ShareCountPicker
              label={mode === "sell" || mode === "buy" ? "锁定份数" : "成交份数"}
              value={shareCount}
              maxShares={singleSharePick.maxShares}
              perShare={singleSharePick.perShare}
              unit={unit}
              error={(touched || !!error) ? validationError : null}
              disabled={loading}
              autoFocus
              onChange={(v) => {
                setShareCount(v);
                setTouched(false);
              }}
              onBlur={() => setTouched(true)}
            />
          )}

          {isValid && (isDualMode ? (sellQtyNum > 0 && buyQtyNum > 0) : qtyNum > 0) && (
            <div className="text-xs text-gray-500 dark:text-t-text-2 bg-gray-50 dark:bg-t-hover rounded px-3 py-2 space-y-1">
              {showSellLeg && (
                <div className="flex justify-between">
                  <span>卖盘成交额</span>
                  <span className="font-mono font-medium text-green-700 dark:text-green-400">
                    ¥{((isDualMode ? sellQtyNum : qtyNum) * swap.sell_price).toLocaleString()}
                  </span>
                </div>
              )}
              {showBuyLeg && (
                <div className="flex justify-between">
                  <span>买盘成交额</span>
                  <span className="font-mono font-medium text-red-700 dark:text-red-400">
                    ¥{((isDualMode ? buyQtyNum : qtyNum) * swap.buy_price).toLocaleString()}
                  </span>
                </div>
              )}
              {isDualMismatch && (
                <div className="flex justify-between text-amber-600 dark:text-amber-400">
                  <span>单边锁定量（{extraLockSide}）</span>
                  <span className="font-mono font-medium">{extraLockQty} {unit}</span>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3 pt-2 items-center">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 border border-gray-200 dark:border-t-border rounded-lg text-gray-600 dark:text-t-text-2 hover:bg-gray-50 dark:hover:bg-t-hover transition-colors"
            >
              取消
            </button>
            {onCounterOffer && !flashMatch && swap.user_id && mode && !opponentWithdrawn && (
              (() => {
                const canCO = mode === "sell"
                  ? (swap.sell_allow_counter_offer ?? swap.allow_counter_offer) !== false
                  : mode === "buy"
                    ? (swap.buy_allow_counter_offer ?? swap.allow_counter_offer) !== false
                    : (swap.sell_allow_counter_offer ?? swap.allow_counter_offer) !== false
                      || (swap.buy_allow_counter_offer ?? swap.allow_counter_offer) !== false;
                if (!canCO) {
                  return (
                    <button
                      type="button"
                      disabled
                      title="该换盘不允许商谈"
                      className="py-2.5 px-4 border border-gray-200 dark:border-t-border text-gray-300 dark:text-t-text-2/50 rounded-lg text-sm font-medium cursor-not-allowed"
                    >
                      商谈
                    </button>
                  );
                }
                return (
                  <button
                    type="button"
                    onClick={() => onCounterOffer(swap, mode)}
                    title="发起商谈"
                    className="py-2.5 px-4 border border-amber-300 dark:border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10 rounded-lg text-sm font-medium transition-colors"
                  >
                    商谈
                  </button>
                );
              })()
            )}
            <button
              type="submit"
              disabled={!isValid || loading || opponentWithdrawn}
              className={`flex-1 py-2.5 disabled:opacity-50 text-white font-medium rounded-lg transition-colors ${
                flashMatch ? "bg-amber-500 hover:bg-amber-600" : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {loading ? "处理中..." : flashMatch ? "确认闪拼" : mode === "both" ? "确认成交" : "确认锁定"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
