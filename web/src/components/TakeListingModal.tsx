"use client";

import { useState, useEffect } from "react";
import type { Listing } from "@/lib/types";
import { formatNegotiableTerms, formatFreeStorage, formatSpecs, formatPartial } from "@/lib/format";
import { getSharePickState, validateMatchQuantity } from "@/lib/swap-lock";
import ModalUpdateNotice from "./ModalUpdateNotice";
import { confirmDialog } from "./ConfirmDialog";
import { TakeListingConfirmSheet } from "./PostingConfirmSheet";
import { formatBoardSerial } from "@/lib/format";
import ShareCountPicker from "./ShareCountPicker";

const LABEL_CLS = "text-gray-400 dark:text-t-text-3 shrink-0";
const VALUE_CLS = "text-gray-800 dark:text-t-text font-medium";

interface Props {
  listing: Listing | null;
  unit?: string;
  loading?: boolean;
  error?: string | null;
  opponentWithdrawn?: boolean;
  dataUpdated?: boolean;
  updateMessage?: string;
  onDismissUpdate?: () => void;
  onDismissWithdrawn?: () => void;
  onClose: () => void;
  onSubmit: (listingId: string, quantity: number) => void;
  onCounterOffer?: (listing: Listing) => void;
  onBack?: () => void;
}

export default function TakeListingModal({
  listing,
  unit = "吨",
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
}: Props) {
  const [shareCount, setShareCount] = useState("");
  const [touched, setTouched] = useState(false);

  const remaining = listing ? Math.floor(listing.quantity - listing.filled) : 0;
  const allowPartial = listing ? listing.allow_partial !== false : false;
  const configuredMin =
    allowPartial && listing?.min_quantity && listing.min_quantity > 0
      ? Math.floor(listing.min_quantity)
      : 0;
  const sharePick = getSharePickState(remaining, configuredMin, allowPartial);

  useEffect(() => {
    if (!listing) return;
    setTouched(false);
    setShareCount(sharePick.canPickShares ? String(sharePick.maxShares) : "");
  }, [listing?.id, sharePick.canPickShares, sharePick.maxShares, listing]);

  if (!listing) return null;

  const qtyNum = sharePick.canPickShares
    ? Math.floor(Number(shareCount) || 0) * sharePick.perShare
    : remaining;

  const validationError = (() => {
    if (sharePick.canPickShares) {
      const n = Math.floor(Number(shareCount));
      if (!shareCount || !Number.isFinite(n) || n <= 0) return "请选择摘盘份数";
      if (n > sharePick.maxShares) return `最多可摘 ${sharePick.maxShares} 份`;
      if (!Number.isInteger(Number(shareCount))) return "份数须为正整数";
    }
    return validateMatchQuantity(
      qtyNum,
      remaining,
      configuredMin > 0 ? configuredMin : remaining,
      allowPartial,
      remaining,
      "摘盘",
    );
  })();
  const isValid = !validationError && qtyNum > 0;
  const actionLabel = listing.side === "SELL" ? "买入摘盘" : "卖出摘盘";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!isValid) return;
    const ok = await confirmDialog({
      title: actionLabel,
      message: "确认摘盘？",
      content: (
        <TakeListingConfirmSheet
          listing={listing}
          serialLabel={formatBoardSerial("L", listing.serial_no, listing.created_at)}
          takeQuantity={qtyNum}
          takePrice={listing.price}
          unit={unit}
          shareCount={sharePick.canPickShares ? Math.floor(Number(shareCount)) : undefined}
          canPickShares={sharePick.canPickShares}
        />
      ),
      wide: true,
      variant: "warning",
      icon: "warning",
      confirmText: "确认摘盘",
      cancelText: "再想想",
    });
    if (!ok) return;
    onSubmit(listing.id, qtyNum);
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white dark:bg-t-panel rounded-xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-t-border">
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
          <div className="bg-gray-50 dark:bg-t-hover rounded-lg p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className={LABEL_CLS}>挂牌价格</span>
              <span className="font-mono font-bold text-gray-800 dark:text-t-text">
                ¥{listing.price.toLocaleString()}/吨
              </span>
            </div>
            <div className="flex justify-between">
              <span className={LABEL_CLS}>挂牌总量</span>
              <span className={`font-mono ${VALUE_CLS}`}>
                {listing.quantity.toLocaleString()} {unit}
              </span>
            </div>
            <div className="flex justify-between">
              <span className={LABEL_CLS}>剩余数量</span>
              <span className={`font-mono ${VALUE_CLS}`}>
                {remaining.toLocaleString()} {unit}
              </span>
            </div>
            <div className="flex justify-between">
              <span className={LABEL_CLS}>交割期</span>
              <span className={VALUE_CLS}>{listing.delivery_period || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className={LABEL_CLS}>交割地</span>
              <span className={VALUE_CLS}>{listing.delivery_location || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className={LABEL_CLS}>付款方式</span>
              <span className={VALUE_CLS}>{listing.payment_method || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className={LABEL_CLS}>交割方式</span>
              <span className={VALUE_CLS}>{listing.delivery_method || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className={LABEL_CLS}>免仓期</span>
              <span className={VALUE_CLS}>{formatFreeStorage(listing.free_storage_enabled, listing.free_storage_days)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className={LABEL_CLS}>规格</span>
              <span className={`${VALUE_CLS} text-right break-all`}>{formatSpecs(listing.specs)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className={LABEL_CLS}>数量方式</span>
              <span className={`${VALUE_CLS} text-right`}>{formatPartial(listing.allow_partial, listing.min_quantity, unit, listing.quantity)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className={LABEL_CLS}>可商谈条款</span>
              <span className={`${VALUE_CLS} text-right break-all`}>
                {listing.allow_counter_offer === false ? "不可商谈" : formatNegotiableTerms(listing.negotiable_terms)}
              </span>
            </div>
          </div>

          {sharePick.canPickShares ? (
            <ShareCountPicker
              label="摘盘份数"
              value={shareCount}
              maxShares={sharePick.maxShares}
              perShare={sharePick.perShare}
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
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-600 dark:text-t-text-2 mb-1.5">
                摘盘数量 ({unit})
                <span className="ml-2 text-xs font-normal text-orange-600 dark:text-orange-400">
                  {allowPartial ? "须全部摘盘，不可改" : "整单，不可改"}
                </span>
              </label>
              <input
                type="text"
                readOnly
                value={remaining > 0 ? String(remaining) : ""}
                className="w-full px-3 py-2.5 border border-gray-200 dark:border-t-border rounded-lg font-mono bg-gray-50 dark:bg-t-hover text-t-text cursor-not-allowed"
              />
            </div>
          )}

          {error && !(touched && validationError) && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          {isValid && (
            <div className="text-sm text-gray-600 dark:text-t-text-2">
              预计成交额：
              <span className="font-mono font-bold text-brand-600 dark:text-brand-400 ml-1">
                ¥{(qtyNum * listing.price).toLocaleString()}
              </span>
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
            {onCounterOffer && listing.user_id && !opponentWithdrawn && (
              listing.allow_counter_offer !== false ? (
                <button
                  type="button"
                  onClick={() => onCounterOffer(listing)}
                  title="发起商谈"
                  className="py-2.5 px-4 border border-amber-300 dark:border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10 rounded-lg text-sm font-medium transition-colors"
                >
                  商谈
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  title="该挂盘不允许商谈"
                  className="py-2.5 px-4 border border-gray-200 dark:border-t-border text-gray-300 dark:text-t-text-2/50 rounded-lg text-sm font-medium cursor-not-allowed"
                >
                  商谈
                </button>
              )
            )}
            <button
              type="submit"
              disabled={!isValid || loading || opponentWithdrawn}
              className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
            >
              {loading ? "成交中..." : "确认摘盘"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
