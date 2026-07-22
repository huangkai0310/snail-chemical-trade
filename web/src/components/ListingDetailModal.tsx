"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { Listing, SwapListing, Product } from "@/lib/types";
import { NEGOTIABLE_TERMS } from "@/lib/types";
import {
  getSwapLockState,
  SWAP_LOCK_BUY_TOOLTIP,
  SWAP_LOCK_SELL_TOOLTIP,
  swapStatusTooltip,
  swapStatusLabel,
  swapLockBuyDisabledReason,
  swapLockSellDisabledReason,
  swapBothDisabledReason,
  swapFlashDisabledReason,
  swapCounterOfferBuyDisabledReason,
  swapCounterOfferSellDisabledReason,
  swapCounterOfferBothDisabledReason,
} from "@/lib/swap-lock";
import type { SwapMatchLock } from "@/lib/api";
import { cancelSwapLock } from "@/lib/api";
import { Tooltip } from "./ui/Tooltip";
import ModalUpdateNotice from "./ModalUpdateNotice";
import { toast } from "./Toast";
import { formatBoardSerial } from "@/lib/format";
import { confirmDialog } from "./ConfirmDialog";
import { UnlockConfirmSheet } from "./PostingConfirmSheet";

interface DetailItem {
  label: string;
  value: string;
  colorCls?: string;
}

import { formatListingStatus } from "@/lib/listing-status";

function fmtDateTime(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${dd} ${hh}:${mm}:${ss}`;
}

/** 格式化可商谈条款为中文标签 */
function formatNegotiableTerms(terms?: string[] | null): string {
  if (!terms || terms.length === 0) return "不可商谈";
  const labels = terms.map(
    (t) => NEGOTIABLE_TERMS.find((n) => n.key === t)?.label ?? t
  );
  return labels.join("、");
}

/** 格式化免仓期 */
function formatFreeStorage(
  enabled?: boolean,
  days?: number | null
): string {
  if (enabled === false) return "不免仓";
  if (days && days > 0) return `免仓${days}天`;
  return "-";
}

/** 格式化规格 */
function formatSpecs(
  specs?: string | Record<string, unknown> | null
): string {
  if (!specs) return "-";
  if (typeof specs === "string") return specs;
  try {
    return JSON.stringify(specs);
  } catch {
    return "-";
  }
}

/** 信息行组件（用于普通挂牌详情的纵向展示） */
function InfoRow({ label, value, colorCls }: DetailItem) {
  return (
    <div className="flex items-start gap-2 py-1.5 px-3 border-b" style={{ borderColor: "var(--border-subtle)" }}>
      <span className="text-[11px] text-t-text-3 whitespace-nowrap shrink-0 min-w-[60px]">{label}</span>
      <span className={`text-[12px] flex-1 break-all ${colorCls ?? "text-t-text"}`}>{value}</span>
    </div>
  );
}

/** 信息行组件（用于换盘买卖并列对比的紧凑展示） */
function CompactRow({ label, value, colorCls }: DetailItem) {
  return (
    <div className="flex items-center gap-1.5 py-1 px-2 border-b" style={{ borderColor: "var(--border-subtle)" }}>
      <span className="text-[10px] text-t-text-3 whitespace-nowrap shrink-0 min-w-[44px]">{label}</span>
      <span className={`text-[11px] flex-1 break-all truncate ${colorCls ?? "text-t-text"}`} title={value}>{value}</span>
    </div>
  );
}

/** 信息区块标题 */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-1.5 text-[11px] font-semibold text-t-text-2 bg-t-tertiary border-b" style={{ borderColor: "var(--border-subtle)" }}>
      {children}
    </div>
  );
}

/** 交易操作按钮区域 */
function TradeActions({
  isMine,
  isDisabled,
  isBlocked,
  opponentWithdrawn,
  canTrade,
  // 挂牌操作
  onTake,
  onCounterOffer,
  onCancel,
  onEdit,
  myPendingCO,
  onEditCounterOffer,
  onCancelCounterOffer,
  // 换盘操作
  isSwap,
  onTakeSwapSell,
  onTakeSwapBuy,
  onTakeSwapBoth,
  onFlashMatch,
  onCancelSwap,
  onEditSwap,
  onCounterOfferSwap,
  mySwapPendingCO,
  onEditSwapCounterOffer,
  onCancelSwapCounterOffer,
  // 额外属性
  allowCounterOffer,
  allowSingleSide,
  singleSideMode,
  sellAllowCounterOffer,
  buyAllowCounterOffer,
  needsThirdParty,
  partialSingleSideLock,
  fullSingleSideLock,
  flashMode,
  onCancelMyLock,
  sellSideDone,
  buySideDone,
  sellRemain = 0,
  buyRemain = 0,
  lockBuyDisabled = null,
  lockSellDisabled = null,
  bothDisabled = null,
  flashDisabled = null,
  coBuyDisabled = null,
  coSellDisabled = null,
  coBothDisabled = null,
}: {
  isMine: boolean;
  isDisabled: boolean;
  isBlocked: boolean;
  opponentWithdrawn?: boolean;
  canTrade: boolean;
  onTake?: () => void;
  onCounterOffer?: () => void;
  onCancel?: () => void;
  onEdit?: () => void;
  myPendingCO?: boolean;
  onEditCounterOffer?: () => void;
  onCancelCounterOffer?: () => void;
  isSwap?: boolean;
  onTakeSwapSell?: () => void;
  onTakeSwapBuy?: () => void;
  onTakeSwapBoth?: () => void;
  onFlashMatch?: () => void;
  onCancelSwap?: () => void;
  onEditSwap?: () => void;
  // 换盘商谈（按方向）
  onCounterOfferSwap?: (mode: "sell" | "buy" | "both") => void;
  // 换盘商谈中状态
  mySwapPendingCO?: boolean;
  onEditSwapCounterOffer?: () => void;
  onCancelSwapCounterOffer?: () => void;
  // 额外属性
  allowCounterOffer?: boolean;
  allowSingleSide?: boolean;
  singleSideMode?: string;
  sellAllowCounterOffer?: boolean;
  buyAllowCounterOffer?: boolean;
  needsThirdParty?: boolean;
  partialSingleSideLock?: boolean;
  fullSingleSideLock?: boolean;
  flashMode?: "sell" | "buy" | null;
  onCancelMyLock?: () => void;
  sellSideDone?: boolean;
  buySideDone?: boolean;
  sellRemain?: number;
  buyRemain?: number;
  /** 不可用原因；有值则按钮置灰常驻 */
  lockBuyDisabled?: string | null;
  lockSellDisabled?: string | null;
  bothDisabled?: string | null;
  flashDisabled?: string | null;
  coBuyDisabled?: string | null;
  coSellDisabled?: string | null;
  coBothDisabled?: string | null;
}) {
  const cannotOperate = isDisabled || !!opponentWithdrawn;

  if (!canTrade) return null;

  if (isSwap) {
    const lockBtnCls =
      "w-full py-2 rounded-lg text-[12px] font-medium transition-colors";
    const lockBtnDisabledCls =
      `${lockBtnCls} bg-t-tertiary text-t-text-3 cursor-not-allowed opacity-60`;
    const coBtnCls =
      "flex-1 py-2 rounded-lg text-[12px] font-medium transition-colors";
    const coBtnDisabledCls =
      `${coBtnCls} border border-gray-200 dark:border-t-border text-gray-300 dark:text-t-text-2/50 cursor-not-allowed`;
    const coBtnActiveCls =
      `${coBtnCls} bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 hover:bg-amber-500/25`;

    return (
      <div className="border-t px-3 py-3 space-y-2" style={{ borderColor: "var(--border-color)" }}>
        {!isMine && !cannotOperate && !isBlocked && !mySwapPendingCO && (
          <>
            <div className="flex flex-col gap-2">
            <div className="flex gap-2 w-full">
              <div className="flex-1 min-w-0">
                <Tooltip content={lockBuyDisabled ?? SWAP_LOCK_BUY_TOOLTIP} triggerClassName="w-full">
                  <button
                    onClick={lockBuyDisabled ? undefined : onTakeSwapSell}
                    disabled={!!lockBuyDisabled}
                    title={lockBuyDisabled ?? SWAP_LOCK_BUY_TOOLTIP}
                    className={
                      lockBuyDisabled
                        ? lockBtnDisabledCls
                        : `${lockBtnCls} text-white bg-trade-up hover:opacity-90`
                    }
                  >
                    锁定·买
                  </button>
                </Tooltip>
              </div>
              <div className="flex-1 min-w-0">
                <Tooltip content={lockSellDisabled ?? SWAP_LOCK_SELL_TOOLTIP} triggerClassName="w-full">
                  <button
                    onClick={lockSellDisabled ? undefined : onTakeSwapBuy}
                    disabled={!!lockSellDisabled}
                    title={lockSellDisabled ?? SWAP_LOCK_SELL_TOOLTIP}
                    className={
                      lockSellDisabled
                        ? lockBtnDisabledCls
                        : `${lockBtnCls} text-white bg-trade-down hover:opacity-90`
                    }
                  >
                    锁定·卖
                  </button>
                </Tooltip>
              </div>
              <div className="flex-1 min-w-0">
                <button
                  onClick={bothDisabled ? undefined : onTakeSwapBoth}
                  disabled={!!bothDisabled}
                  title={bothDisabled ?? "同时接受买卖两侧"}
                  className={
                    bothDisabled
                      ? lockBtnDisabledCls
                      : `${lockBtnCls} text-white bg-blue-600 hover:bg-blue-700`
                  }
                >
                  ⇄ 双向摘盘
                </button>
              </div>
            </div>
            <button
              onClick={flashDisabled ? undefined : onFlashMatch}
              disabled={!!flashDisabled || !onFlashMatch}
              title={flashDisabled ?? "与已有单边锁定闪拼成交"}
              className={
                flashDisabled || !onFlashMatch
                  ? lockBtnDisabledCls
                  : `${lockBtnCls} text-white bg-amber-500 hover:bg-amber-600`
              }
            >
              闪拼{!flashDisabled && flashMode ? (flashMode === "buy" ? " — 卖出" : " — 买入") : ""}
            </button>
            </div>
            {onCancelMyLock && (
              <button
                onClick={onCancelMyLock}
                className="w-full py-2 rounded-lg text-[12px] font-medium bg-orange-500/15 text-orange-600 dark:text-orange-400 border border-orange-500/30 hover:bg-orange-500/25 transition-colors"
              >
                取消我的锁定
              </button>
            )}
            {/* 商谈入口：常驻，不可用置灰 */}
            {onCounterOfferSwap && (
              <div className="flex gap-2">
                <button
                  onClick={coBuyDisabled ? undefined : () => onCounterOfferSwap("sell")}
                  disabled={!!coBuyDisabled}
                  title={coBuyDisabled ?? "商谈卖出方条款"}
                  className={coBuyDisabled ? coBtnDisabledCls : coBtnActiveCls}
                >
                  商谈·买入
                </button>
                <button
                  onClick={coSellDisabled ? undefined : () => onCounterOfferSwap("buy")}
                  disabled={!!coSellDisabled}
                  title={coSellDisabled ?? "商谈买入方条款"}
                  className={coSellDisabled ? coBtnDisabledCls : coBtnActiveCls}
                >
                  商谈·卖出
                </button>
                <button
                  onClick={coBothDisabled ? undefined : () => onCounterOfferSwap("both")}
                  disabled={!!coBothDisabled}
                  title={coBothDisabled ?? "双边商谈"}
                  className={coBothDisabled ? coBtnDisabledCls : coBtnActiveCls}
                >
                  商谈·双向
                </button>
              </div>
            )}
          </>
        )}
        {/* #694: 商谈中时显示查看/修改/取消商谈按钮 */}
        {!isMine && !cannotOperate && !isBlocked && mySwapPendingCO && onEditSwapCounterOffer && (
          <div className="flex gap-2">
            <button
              onClick={onEditSwapCounterOffer}
              className="flex-1 py-1.5 rounded-lg text-[11px] font-medium bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30 hover:bg-blue-500/25 transition-colors"
            >
              查看/修改商谈
            </button>
            {onCancelSwapCounterOffer && (
              <button
                onClick={onCancelSwapCounterOffer}
                className="flex-1 py-1.5 rounded-lg text-[11px] font-medium bg-status-error-bg text-status-error border border-status-error/30 hover:bg-status-error hover:text-white transition-colors"
              >
                取消商谈
              </button>
            )}
          </div>
        )}
        {isMine && !isDisabled && (
          <div className="flex gap-2">
            {onEditSwap && (
              <button
                onClick={onEditSwap}
                className="flex-1 py-2 rounded-lg text-[12px] font-medium bg-violet-500/15 text-violet-600 dark:text-violet-400 border border-violet-500/30 hover:bg-violet-500/25 transition-colors"
              >
                编辑
              </button>
            )}
            <button
              onClick={onCancelSwap}
              className="flex-1 py-2 rounded-lg text-[12px] font-medium bg-status-error-bg text-status-error border border-status-error/30 hover:bg-status-error hover:text-white transition-colors"
            >
              撤盘
            </button>
          </div>
        )}
        {isMine && isDisabled && (
          <div className="text-center text-[11px] text-t-text-3 py-1">该换盘已不可操作</div>
        )}
        {!isMine && cannotOperate && !isBlocked && (
          <div className="text-center text-[11px] text-status-error py-1 font-medium">
            {opponentWithdrawn ? "对方已撤盘，无法继续操作" : "该换盘已不可操作"}
          </div>
        )}
        {!isMine && isBlocked && (
          <div className="text-center text-[11px] text-status-error py-1">已拉黑该用户，无法交易</div>
        )}
      </div>
    );
  }

  // 普通挂牌操作
  return (
    <div className="border-t px-3 py-3 space-y-2" style={{ borderColor: "var(--border-color)" }}>
      {!isMine && !cannotOperate && !isBlocked && (
        <div className="flex gap-2">
          {onTake && (
            <button
              onClick={onTake}
              className="flex-1 py-2 rounded-lg text-[12px] font-bold text-white bg-brand-600 hover:bg-brand-700 transition-colors"
            >
              摘盘成交
            </button>
          )}
          {onCounterOffer && (
            allowCounterOffer !== false ? (
              <button
                onClick={onCounterOffer}
                className="flex-1 py-2 rounded-lg text-[12px] font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-colors"
              >
                发起商谈
              </button>
            ) : (
              <button
                disabled
                title="该挂盘不允许商谈"
                className="flex-1 py-2 rounded-lg text-[12px] font-medium border border-gray-200 dark:border-t-border text-gray-300 dark:text-t-text-2/50 cursor-not-allowed"
              >
                发起商谈
              </button>
            )
          )}
        </div>
      )}
      {myPendingCO && !isMine && !cannotOperate && onEditCounterOffer && (
        <div className="flex gap-2">
          <button
            onClick={onEditCounterOffer}
            className="flex-1 py-1.5 rounded-lg text-[11px] font-medium bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-colors"
          >
            查看/修改商谈
          </button>
          {onCancelCounterOffer && (
            <button
              onClick={onCancelCounterOffer}
              className="flex-1 py-1.5 rounded-lg text-[11px] font-medium bg-status-error-bg text-status-error border border-status-error/30 hover:bg-status-error hover:text-white transition-colors"
            >
              取消商谈
            </button>
          )}
        </div>
      )}
      {isMine && !isDisabled && (
        <div className="flex gap-2">
          {onEdit && (
            <button
              onClick={onEdit}
              className="flex-1 py-2 rounded-lg text-[12px] font-medium bg-violet-500/15 text-violet-600 dark:text-violet-400 border border-violet-500/30 hover:bg-violet-500/25 transition-colors"
            >
              编辑
            </button>
          )}
          {onCancel && (
            <button
              onClick={onCancel}
              className="flex-1 py-2 rounded-lg text-[12px] font-medium bg-status-error-bg text-status-error border border-status-error/30 hover:bg-status-error hover:text-white transition-colors"
            >
              撤盘
            </button>
          )}
        </div>
      )}
      {isMine && isDisabled && (
        <div className="text-center text-[11px] text-t-text-3 py-1">该挂盘已不可操作</div>
      )}
      {!isMine && cannotOperate && !isBlocked && (
        <div className="text-center text-[11px] text-status-error py-1 font-medium">
          {opponentWithdrawn ? "对方已撤盘，无法继续操作" : "该挂盘已不可操作"}
        </div>
      )}
      {!isMine && isBlocked && (
        <div className="text-center text-[11px] text-status-error py-1">已拉黑该用户，无法交易</div>
      )}
    </div>
  );
}

interface Props {
  open: boolean;
  listing?: Listing | null;
  swap?: SwapListing | null;
  products?: Product[];
  currentUserId?: string;
  canTrade?: boolean;
  onClose: () => void;
  // 挂牌操作回调
  onTake?: (listing: Listing) => void;
  onCounterOffer?: (listing: Listing) => void;
  onCancel?: (listingId: string) => void;
  onEdit?: (listing: Listing) => void;
  // 商谈操作回调
  myPendingCO?: boolean;
  onEditCounterOffer?: (listing: Listing) => void;
  onCancelCounterOffer?: (listing: Listing) => void;
  // 换盘操作回调
  onTakeSwap?: (swap: SwapListing, mode: "sell" | "buy" | "both", flashMatch?: boolean) => void;
  onCancelSwap?: (swapId: string) => void;
  onEditSwap?: (swap: SwapListing) => void;
  // 换盘商谈回调
  onCounterOfferSwap?: (swap: SwapListing, mode: "sell" | "buy" | "both") => void;
  // 换盘商谈中状态
  mySwapPendingCO?: boolean;
  onEditSwapCounterOffer?: () => void;
  onCancelSwapCounterOffer?: () => void;
  mySwapLocks?: SwapMatchLock[];
  // #685 弹窗内实时更新提示
  detailUpdated?: boolean;
  detailUpdateMessage?: string;
  onDismissDetailUpdate?: () => void;
  detailWithdrawn?: boolean;
  onDismissDetailWithdrawn?: () => void;
}

export default function ListingDetailModal({
  open,
  listing,
  swap,
  products = [],
  currentUserId,
  canTrade = false,
  onClose,
  onTake,
  onCounterOffer,
  onCancel,
  onEdit,
  myPendingCO,
  onEditCounterOffer,
  onCancelCounterOffer,
  onTakeSwap,
  onCancelSwap,
  onEditSwap,
  onCounterOfferSwap,
  mySwapPendingCO,
  onEditSwapCounterOffer,
  onCancelSwapCounterOffer,
  mySwapLocks,
  detailUpdated,
  detailUpdateMessage,
  onDismissDetailUpdate,
  detailWithdrawn,
  onDismissDetailWithdrawn,
}: Props) {
  const queryClient = useQueryClient();
  if (!open) return null;

  const productName = (id: string) =>
    products.find((p) => p.id === id)?.name ?? id.toUpperCase();

  // 判断是否是自己的盘
  const isMine = listing
    ? !!currentUserId && listing.user_id === currentUserId
    : swap
      ? !!currentUserId && swap.user_id === currentUserId
      : false;

  const isBlocked = listing?.is_blocked || swap?.is_blocked || false;
  const isDisabled = listing
    ? listing.status === "FILLED" || listing.status === "CANCELLED" || listing.status === "EXPIRED"
    : swap
      ? swap.status !== "OPEN"
      : true;

  // 换盘第三方拼单判断

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      onClick={onClose}
    >
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* 弹窗主体 */}
      <div
        className="relative w-[520px] max-h-[85vh] overflow-y-auto rounded-xl shadow-2xl border"
        style={{
          backgroundColor: "var(--bg-panel)",
          borderColor: "var(--border-color)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 — sticky 冻结，滚动时始终可见 */}
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b backdrop-blur-md"
          style={{
            borderColor: "var(--border-color)",
            backgroundColor: "var(--bg-panel)",
          }}
        >
          <span className="text-sm font-semibold text-t-text">
            {listing ? "挂牌详情" : "换盘详情"}
          </span>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-t-hover text-t-text-3 hover:text-t-text transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <ModalUpdateNotice show={detailWithdrawn && !isMine} variant="withdrawn" onDismiss={onDismissDetailWithdrawn} />
        <ModalUpdateNotice show={detailUpdated && !detailWithdrawn} variant="updated" message={detailUpdateMessage} onDismiss={onDismissDetailUpdate} />

        {/* 内容区 */}
        {listing && (
          <ListingDetailContent
            listing={listing}
            productName={productName(listing.product_id)}
            isMine={isMine}
          />
        )}

        {swap && (
          <SwapDetailContent
            swap={swap}
            productName={productName}
            isMine={isMine}
            mySwapPendingCO={mySwapPendingCO}
          />
        )}

        {/* 交易操作入口 */}
        {listing && (
          <TradeActions
            isMine={isMine}
            isDisabled={isDisabled}
            isBlocked={isBlocked}
            opponentWithdrawn={detailWithdrawn}
            canTrade={canTrade}
            onTake={onTake ? () => { onTake(listing); } : undefined}
            onCounterOffer={onCounterOffer ? () => { onCounterOffer(listing); } : undefined}
            onCancel={onCancel ? () => { onCancel(listing.id); onClose(); } : undefined}
            onEdit={onEdit ? () => { onEdit(listing); } : undefined}
            myPendingCO={myPendingCO}
            onEditCounterOffer={onEditCounterOffer ? () => { onEditCounterOffer(listing); } : undefined}
            onCancelCounterOffer={onCancelCounterOffer ? () => { onCancelCounterOffer(listing); onClose(); } : undefined}
            allowCounterOffer={listing.allow_counter_offer !== false}
          />
        )}

        {swap && (() => {
          const lockState = getSwapLockState(swap);
          const myLocksOnSwap = mySwapLocks?.filter((l) => l.swap_id === swap.id) ?? [];
          return (
          <TradeActions
            isSwap
            isMine={isMine}
            isDisabled={isDisabled}
            isBlocked={isBlocked}
            opponentWithdrawn={detailWithdrawn}
            canTrade={canTrade}
            onTakeSwapSell={onTakeSwap ? () => { onTakeSwap(swap, "sell"); } : undefined}
            onTakeSwapBuy={onTakeSwap ? () => { onTakeSwap(swap, "buy"); } : undefined}
            onTakeSwapBoth={onTakeSwap ? () => { onTakeSwap(swap, "both"); } : undefined}
            onFlashMatch={
              onTakeSwap
                ? () => {
                    if (lockState.flashMode) onTakeSwap(swap, lockState.flashMode, true);
                  }
                : undefined
            }
            onCancelSwap={onCancelSwap ? () => { onCancelSwap(swap.id); onClose(); } : undefined}
            onEditSwap={onEditSwap ? () => { onEditSwap(swap); } : undefined}
            onCounterOfferSwap={onCounterOfferSwap ? (mode) => { onCounterOfferSwap(swap, mode); } : undefined}
            mySwapPendingCO={mySwapPendingCO}
            onEditSwapCounterOffer={onEditSwapCounterOffer}
            onCancelSwapCounterOffer={onCancelSwapCounterOffer}
            allowSingleSide={swap.allow_single_side !== false}
            singleSideMode={swap.single_side_mode || "both"}
            sellAllowCounterOffer={(swap.sell_allow_counter_offer ?? swap.allow_counter_offer) !== false}
            buyAllowCounterOffer={(swap.buy_allow_counter_offer ?? swap.allow_counter_offer) !== false}
            partialSingleSideLock={lockState.partialSingleSideLock}
            fullSingleSideLock={lockState.fullSingleSideLock}
            flashMode={lockState.flashMode}
            sellRemain={lockState.sellRemain}
            buyRemain={lockState.buyRemain}
            lockBuyDisabled={swapLockBuyDisabledReason(swap, lockState.sellRemain)}
            lockSellDisabled={swapLockSellDisabledReason(swap, lockState.buyRemain)}
            bothDisabled={swapBothDisabledReason(lockState.sellRemain, lockState.buyRemain)}
            flashDisabled={swapFlashDisabledReason(lockState)}
            coBuyDisabled={swapCounterOfferBuyDisabledReason(swap, lockState.sellRemain)}
            coSellDisabled={swapCounterOfferSellDisabledReason(swap, lockState.buyRemain)}
            coBothDisabled={swapCounterOfferBothDisabledReason(swap, lockState.sellRemain, lockState.buyRemain)}
            onCancelMyLock={
              myLocksOnSwap.length > 0
                ? async () => {
                    const locks = [...myLocksOnSwap];
                    const serialLabel = formatBoardSerial("S", swap.serial_no, swap.created_at);
                    const ok = await confirmDialog({
                      title: "确认解锁",
                      message: "确认解锁？",
                      content: (
                        <UnlockConfirmSheet
                          serialLabel={serialLabel}
                          locks={locks}
                          unit="吨"
                        />
                      ),
                      wide: true,
                      variant: "warning",
                      icon: "warning",
                      confirmText: "确认解锁",
                      cancelText: "再想想",
                    });
                    if (!ok) return;
                    try {
                      for (const lock of locks) {
                        await cancelSwapLock(lock.id);
                      }
                      toast("已取消锁定", "success");
                      queryClient.invalidateQueries({ queryKey: ["swapLocks", "mine"] });
                      queryClient.invalidateQueries({ queryKey: ["swaps"] });
                    } catch {
                      toast("取消锁定失败", "error");
                      queryClient.invalidateQueries({ queryKey: ["swapLocks", "mine"] });
                      queryClient.invalidateQueries({ queryKey: ["swaps"] });
                    }
                  }
                : undefined
            }
          />
          );
        })()}
      </div>
    </div>
  );
}

/** 普通挂牌详情内容 */
function ListingDetailContent({
  listing,
  productName,
  isMine,
}: {
  listing: Listing;
  productName: string;
  isMine: boolean;
}) {
  const remaining = Math.max(0, listing.quantity - listing.filled);
  const isBuy = listing.side === "BUY";
  const dirLabel = isBuy ? "买入" : "卖出";
  const dirColorCls = isBuy
    ? "text-trade-up-text bg-trade-up-bg"
    : "text-trade-down-text bg-trade-down-bg";

  return (
    <div>
      {/* 头部摘要 */}
      <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${dirColorCls}`}>
            {dirLabel}
          </span>
          {isMine && (
            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-status-warning-bg text-status-warning">
              我的
            </span>
          )}
          <span className="text-[11px] px-2 py-0.5 rounded font-medium"
            style={{
              color: listing.status === "CANCELLED" ? "var(--color-error)"
                : listing.status === "EXPIRED" ? "var(--color-warning, #d97706)"
                : listing.status === "FILLED" ? "var(--color-text-3)"
                : "var(--color-info)",
              backgroundColor: listing.status === "CANCELLED" ? "var(--color-error-bg)"
                : listing.status === "EXPIRED" ? "var(--color-warning-bg, rgba(245,158,11,0.15))"
                : listing.status === "FILLED" ? "var(--color-tertiary)"
                : "var(--color-info-bg)",
            }}
          >
            {formatListingStatus(listing.status, listing.filled)}
          </span>
        </div>
        <div className="flex items-baseline gap-3">
          <span className="text-lg font-semibold text-t-text">{productName}</span>
          <span className={`text-2xl font-mono font-bold ${isBuy ? "text-trade-up-text" : "text-trade-down-text"}`}>
            ¥{listing.price.toFixed(1)}
          </span>
          <span className="text-[11px] text-t-text-3">/吨</span>
        </div>
      </div>

      {/* 基本信息 */}
      <SectionTitle>基本信息</SectionTitle>
      <InfoRow label="发盘号" value={formatBoardSerial("L", listing.serial_no, listing.created_at)} />
      <InfoRow label="品种" value={productName} />
      <InfoRow label="方向" value={dirLabel} colorCls={isBuy ? "text-trade-up-text" : "text-trade-down-text"} />
      <InfoRow label="价格" value={`¥${listing.price.toFixed(1)}/吨`} />
      <InfoRow
        label="数量"
        value={`${Math.floor(listing.quantity)} 吨${listing.filled > 0 ? `（已成交 ${Math.floor(listing.filled)} 吨，剩余 ${Math.floor(remaining)} 吨）` : ""}`}
      />
      <InfoRow label="挂盘时间" value={fmtDateTime(listing.created_at)} />
      <InfoRow label="最后更新" value={fmtDateTime(listing.updated_at)} />

      {/* 交割条款 */}
      <SectionTitle>交割条款</SectionTitle>
      <InfoRow label="交割期" value={listing.delivery_period || "现货"} />
      <InfoRow label="交割地" value={listing.delivery_location || "-"} />
      <InfoRow
        label="付款方式"
        value={listing.payment_method || "-"}
        colorCls={listing.payment_method ? "text-brand-600 dark:text-brand-400" : undefined}
      />
      <InfoRow label="交割方式" value={listing.delivery_method || "-"} />
      <InfoRow label="免仓期" value={formatFreeStorage(listing.free_storage_enabled, listing.free_storage_days)} />
      <InfoRow label="规格" value={formatSpecs(listing.specs)} />

      {/* 交易设置 */}
      <SectionTitle>交易设置</SectionTitle>
      <InfoRow
        label="数量方式"
        value={listing.allow_partial !== false ? "按份数" : "整单"}
        colorCls={listing.allow_partial !== false ? "text-trade-down-text" : undefined}
      />
      {listing.allow_partial !== false && (
        <InfoRow
          label="每份 / 份数"
          value={(() => {
            const min = Math.floor(listing.min_quantity && listing.min_quantity > 0 ? listing.min_quantity : listing.quantity);
            const qty = Math.floor(listing.quantity);
            const shares = min > 0 && qty % min === 0 ? qty / min : null;
            return shares != null ? `每份 ${min} 吨 × ${shares} 份` : `每份 ${min} 吨`;
          })()}
        />
      )}
      <div className="flex items-start gap-2 py-1.5 px-3 border-b" style={{ borderColor: "var(--border-subtle)" }}>
        <span className="text-[11px] text-t-text-3 whitespace-nowrap shrink-0 min-w-[60px]">是否可商谈</span>
        <div className="flex-1">
          <Tooltip content="可商谈：允许对方就价格、数量、交割条件等条款进行协商。不可商谈：对方只能直接摘盘成交，无法发起商谈。">
            <span className={`text-[12px] cursor-help ${listing.allow_counter_offer !== false ? "text-brand-600 dark:text-brand-400" : "text-t-text-3"}`}>
              {listing.allow_counter_offer !== false ? "可商谈" : "不可商谈"}
            </span>
          </Tooltip>
        </div>
      </div>
      {listing.allow_counter_offer !== false && (
        <InfoRow label="可商谈条款" value={formatNegotiableTerms(listing.negotiable_terms)} />
      )}
    </div>
  );
}

/** 换盘详情内容 — 买卖左右并列对比 */
function SwapDetailContent({
  swap,
  productName,
  isMine,
  mySwapPendingCO,
}: {
  swap: SwapListing;
  productName: (id: string) => string;
  isMine: boolean;
  mySwapPendingCO?: boolean;
}) {
  const lockState = getSwapLockState(swap);
  const sellRemain = lockState.sellRemain;
  const buyRemain = lockState.buyRemain;

  const sellLeg: DetailItem[] = [
    { label: "品种", value: productName(swap.sell_product_id) },
    { label: "价格", value: `¥${swap.sell_price.toFixed(1)}`, colorCls: "text-trade-down-text" },
    { label: "数量", value: `${Math.floor(swap.sell_quantity)}${(swap.sell_filled ?? 0) > 0 ? `（剩${sellRemain}）` : ""}` },
    { label: "交割期", value: swap.sell_delivery_period || "现货" },
    { label: "交割地", value: swap.sell_delivery_location || "-" },
    { label: "付款", value: swap.sell_payment_method || "-", colorCls: swap.sell_payment_method ? "text-brand-600 dark:text-brand-400" : undefined },
    { label: "交割", value: swap.sell_delivery_method || "-" },
    { label: "免仓", value: formatFreeStorage(swap.sell_free_storage_enabled, swap.sell_free_storage_days) },
    { label: "规格", value: formatSpecs(swap.sell_specs) },
    { label: "数量方式", value: swap.sell_allow_partial !== false ? "按份数" : "整单", colorCls: swap.sell_allow_partial !== false ? "text-trade-down-text" : undefined },
    ...(swap.sell_allow_partial !== false ? [{
      label: "每份",
      value: (() => {
        const min = Math.floor(swap.sell_min_quantity && swap.sell_min_quantity > 0 ? swap.sell_min_quantity : swap.sell_quantity);
        const qty = Math.floor(swap.sell_quantity);
        const shares = min > 0 && qty % min === 0 ? qty / min : null;
        return shares != null ? `${min}×${shares}` : String(min);
      })(),
    }] : []),
  ];

  const buyLeg: DetailItem[] = [
    { label: "品种", value: productName(swap.buy_product_id) },
    { label: "价格", value: `¥${swap.buy_price.toFixed(1)}`, colorCls: "text-trade-up-text" },
    { label: "数量", value: `${Math.floor(swap.buy_quantity)}${(swap.buy_filled ?? 0) > 0 ? `（剩${buyRemain}）` : ""}` },
    { label: "交割期", value: swap.buy_delivery_period || "现货" },
    { label: "交割地", value: swap.buy_delivery_location || "-" },
    { label: "付款", value: swap.buy_payment_method || "-", colorCls: swap.buy_payment_method ? "text-brand-600 dark:text-brand-400" : undefined },
    { label: "交割", value: swap.buy_delivery_method || "-" },
    { label: "免仓", value: formatFreeStorage(swap.buy_free_storage_enabled, swap.buy_free_storage_days) },
    { label: "规格", value: formatSpecs(swap.buy_specs) },
    { label: "数量方式", value: swap.buy_allow_partial !== false ? "按份数" : "整单", colorCls: swap.buy_allow_partial !== false ? "text-trade-down-text" : undefined },
    ...(swap.buy_allow_partial !== false ? [{
      label: "每份",
      value: (() => {
        const min = Math.floor(swap.buy_min_quantity && swap.buy_min_quantity > 0 ? swap.buy_min_quantity : swap.buy_quantity);
        const qty = Math.floor(swap.buy_quantity);
        const shares = min > 0 && qty % min === 0 ? qty / min : null;
        return shares != null ? `${min}×${shares}` : String(min);
      })(),
    }] : []),
  ];

  return (
    <div>
      {/* 头部摘要 */}
      <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] px-2 py-0.5 rounded font-medium bg-blue-500/15 text-blue-600 dark:text-blue-400">
            换盘
          </span>
          {isMine && (
            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-status-warning-bg text-status-warning">
              我的
            </span>
          )}
          <Tooltip content={swapStatusTooltip(swap.status, lockState, !!mySwapPendingCO, swap.sell_filled ?? 0, swap.buy_filled ?? 0)}>
            <span
              className="text-[11px] px-2 py-0.5 rounded font-medium cursor-help"
              style={{
                color: mySwapPendingCO
                  ? "var(--color-brand)"
                  : swap.status === "CANCELLED" ? "var(--color-error)"
                  : swap.status === "EXPIRED" ? "var(--color-warning, #d97706)"
                  : swap.status === "MATCHED" ? "var(--color-text-3)"
                  : lockState.anySingleSideLock ? "#d97706"
                  : "var(--color-info)",
                backgroundColor: mySwapPendingCO
                  ? "var(--color-brand-bg, rgba(99,102,241,0.12))"
                  : swap.status === "CANCELLED" ? "var(--color-error-bg)"
                  : swap.status === "EXPIRED" ? "var(--color-warning-bg, rgba(245,158,11,0.15))"
                  : swap.status === "MATCHED" ? "var(--color-tertiary)"
                  : lockState.anySingleSideLock ? "rgba(245,158,11,0.15)"
                  : "var(--color-info-bg)",
              }}
            >
              {swapStatusLabel(swap.status, lockState, !!mySwapPendingCO, swap.sell_filled ?? 0, swap.buy_filled ?? 0)}
            </span>
          </Tooltip>
        </div>
        <div className="flex items-center gap-3 text-[12px] text-t-text-2">
          <span>卖出 <strong className="text-trade-down-text">{productName(swap.sell_product_id)}</strong></span>
          <span className="text-blue-500 font-bold">⇄</span>
          <span>买入 <strong className="text-trade-up-text">{productName(swap.buy_product_id)}</strong></span>
        </div>
      </div>

      {/* 基本信息 */}
      <SectionTitle>基本信息</SectionTitle>
      <InfoRow label="发盘号" value={formatBoardSerial("S", swap.serial_no, swap.created_at)} />
      <InfoRow label="挂盘时间" value={fmtDateTime(swap.created_at)} />
      <InfoRow label="最后更新" value={fmtDateTime(swap.updated_at)} />

      {/* 买卖左右并列对比 */}
      <div className="grid grid-cols-2 border-b" style={{ borderColor: "var(--border-subtle)" }}>
        {/* 卖出 */}
        <div className="border-r" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="px-2 py-1.5 text-[11px] font-semibold text-trade-down-text bg-trade-down-bg/50 border-b" style={{ borderColor: "var(--border-subtle)" }}>
            卖出
          </div>
          {sellLeg.map((item, i) => (
            <CompactRow key={`sell-${i}`} {...item} />
          ))}
        </div>
        {/* 买入 */}
        <div>
          <div className="px-2 py-1.5 text-[11px] font-semibold text-trade-up-text bg-trade-up-bg/50 border-b" style={{ borderColor: "var(--border-subtle)" }}>
            买入
          </div>
          {buyLeg.map((item, i) => (
            <CompactRow key={`buy-${i}`} {...item} />
          ))}
        </div>
      </div>

      {/* 商谈设置 — 卖出/买入各自独立 */}
      <SectionTitle>商谈设置</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <div className="px-3 py-2 bg-t-hover rounded-lg border border-t-border">
          <div className="text-[10px] text-trade-down font-medium mb-1">卖出</div>
          <div className="text-xs text-t-text-2">
            {swap.sell_allow_counter_offer ?? swap.allow_counter_offer ? (
              <Tooltip content="可商谈：允许对方就卖出方的价格、数量、交割条件等条款进行协商。">
                <span className="text-brand-600 dark:text-brand-400 cursor-help">可商谈</span>
              </Tooltip>
            ) : (
              <Tooltip content="不可商谈：对方只能直接摘盘成交卖出方，无法发起商谈。">
                <span className="text-t-text-3 cursor-help">不可商谈</span>
              </Tooltip>
            )}
            {swap.sell_allow_counter_offer ?? swap.allow_counter_offer ? (
              swap.sell_negotiable_terms && swap.sell_negotiable_terms.length > 0 && (
                <span className="text-t-text-3 ml-1">（{formatNegotiableTerms(swap.sell_negotiable_terms)}）</span>
              )
            ) : null}
          </div>
        </div>
        <div className="px-3 py-2 bg-t-hover rounded-lg border border-t-border">
          <div className="text-[10px] text-trade-up font-medium mb-1">买入</div>
          <div className="text-xs text-t-text-2">
            {swap.buy_allow_counter_offer ?? swap.allow_counter_offer ? (
              <Tooltip content="可商谈：允许对方就买入方的价格、数量、交割条件等条款进行协商。">
                <span className="text-brand-600 dark:text-brand-400 cursor-help">可商谈</span>
              </Tooltip>
            ) : (
              <Tooltip content="不可商谈：对方只能直接摘盘成交买入方，无法发起商谈。">
                <span className="text-t-text-3 cursor-help">不可商谈</span>
              </Tooltip>
            )}
            {swap.buy_allow_counter_offer ?? swap.allow_counter_offer ? (
              swap.buy_negotiable_terms && swap.buy_negotiable_terms.length > 0 && (
                <span className="text-t-text-3 ml-1">（{formatNegotiableTerms(swap.buy_negotiable_terms)}）</span>
              )
            ) : null}
          </div>
        </div>
      </div>
      {swap.remark && <InfoRow label="备注" value={swap.remark} />}
    </div>
  );
}
