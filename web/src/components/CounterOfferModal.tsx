"use client";

import { useState, useEffect, useMemo } from "react";
import type { Listing, SwapListing, CounterOffer } from "@/lib/types";
import { DEFAULT_NEGOTIABLE_TERMS, sanitizeNegotiableTerms } from "@/lib/types";
import { DELIVERY_METHOD_OPTIONS } from "@/components/CreateListingModal";
import Combobox from "@/components/ui/Combobox";
import { sanitizeText, isSafeInput } from "@/lib/validate";
import { formatFreeStorage, formatNegotiableTerms, formatPartial, formatSpecs, formatBoardSerial } from "@/lib/format";
import ModalUpdateNotice from "./ModalUpdateNotice";
import CounterOfferDualLegForm, { type DualLegSubmitParams } from "./CounterOfferDualLegForm";
import { optionalOfferField, optionalOfferFreeStorage } from "@/lib/swap-counter-offer";
import { confirmDialog } from "./ConfirmDialog";
import { CounterOfferConfirmSheet } from "./PostingConfirmSheet";
import { getSharePickState, shareCountFromQty } from "@/lib/swap-lock";

const LABEL_CLS = "text-t-text-3 shrink-0";
const VALUE_CLS = "text-t-text font-medium text-right";

export type CounterOfferSubmitParams = {
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
};

/** 付款方式预设选项 */
const PAYMENT_METHOD_OPTIONS = ["先款后货", "先货后款", "预付10%保证金，交货前付全款", "货到付款", "款到发货"];

/** 合并两组条款数组，去重 */
function mergeTerms(a?: string[], b?: string[]): string[] {
  const set = new Set<string>();
  if (a) a.forEach((t) => set.add(t));
  if (b) b.forEach((t) => set.add(t));
  return Array.from(set);
}

function validateQuantity(
  qty: number,
  remain: number,
  allowPartial: boolean,
  minQty: number | undefined,
  unit: string
): string | null {
  if (Number.isNaN(qty) || qty <= 0) return "商谈数量必须大于 0";
  if (qty > remain) return `商谈数量不能超过剩余数量 ${remain}`;
  if (!allowPartial && qty !== remain) return `整单成交，须全部 ${remain} ${unit}`;
  if (allowPartial && minQty && minQty > 0) {
    const min = Math.floor(minQty);
    if (qty !== remain || remain >= min * 2) {
      if (qty < min) return `数量不能低于最小成交量 ${min} ${unit}`;
      if (qty % min !== 0) return `数量须为每份 ${min} ${unit} 的整数倍`;
    }
  }
  return null;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className={LABEL_CLS}>{label}</span>
      <span className={`${VALUE_CLS} break-all`}>{value}</span>
    </div>
  );
}

interface Props {
  /** 挂牌（ref_type=listing 时有效） */
  listing?: Listing | null;
  /** 换盘（ref_type=swap 时有效） */
  swap?: SwapListing | null;
  /** 换盘模式（仅 swap 时有效） */
  swapMode?: "sell" | "buy" | "both";
  /** 闪拼等入口预置数量 */
  fixedQuantity?: number;
  /** 数量锁定不可改（闪拼入口） */
  quantityLocked?: boolean;
  /** 编辑模式：传入已有的 PENDING 商谈记录 */
  editCounterOffer?: CounterOffer | null;
  /** 编辑双向换盘商谈时的配对记录（卖/买另一条） */
  editPairedCounterOffer?: CounterOffer | null;
  unit?: string;
  loading?: boolean;
  error?: string | null;
  opponentWithdrawn?: boolean;
  dataUpdated?: boolean;
  updateMessage?: string;
  onDismissUpdate?: () => void;
  onDismissWithdrawn?: () => void;
  onClose: () => void;
  onSubmit: (params: CounterOfferSubmitParams) => void;
  /** 双向换盘：分别提交卖盘/买盘商谈 */
  onSubmitDual?: (offers: CounterOfferSubmitParams[]) => void;
  /** 编辑模式提交回调（不新建商谈，只更新已有商谈） */
  onUpdate?: (counterOfferId: string, params: {
    offer_price: number;
    offer_quantity: number;
    offer_delivery_period?: string;
    offer_delivery_location?: string;
    offer_payment_method?: string;
    offer_delivery_method?: string;
    offer_free_storage_enabled?: boolean;
    offer_free_storage_days?: number | null;
    offer_specs?: string;
  }) => void;
  /** 返回详情弹窗（仅从详情弹窗打开时显示） */
  onBack?: () => void;
}

/** 将规格（可能为对象或字符串）转为可编辑的字符串 */
function specsToString(s?: string | Record<string, unknown> | null): string {
  if (!s) return "";
  if (typeof s === "string") return s;
  try {
    return JSON.stringify(s);
  } catch {
    return "";
  }
}

export default function CounterOfferModal({
  listing,
  swap,
  swapMode,
  fixedQuantity,
  quantityLocked = false,
  editCounterOffer,
  editPairedCounterOffer,
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
  onSubmitDual,
  onUpdate,
  onBack,
}: Props) {
  const isSwap = !!swap;
  const refType: "listing" | "swap" = isSwap ? "swap" : "listing";
  const isEditMode = !!editCounterOffer && !!onUpdate;
  const isDualSwapEdit =
    isEditMode &&
    isSwap &&
    !!editCounterOffer &&
    !!editPairedCounterOffer &&
    ((editCounterOffer.mode === "sell" && editPairedCounterOffer.mode === "buy") ||
      (editCounterOffer.mode === "buy" && editPairedCounterOffer.mode === "sell"));
  const isBothSwapMode = isSwap && swapMode === "both" && !isEditMode;
  const useDualForm = isBothSwapMode || isDualSwapEdit;
  const resolvedSwapMode: "sell" | "buy" | "both" | undefined = isSwap
    ? useDualForm
      ? "both"
      : ((swapMode ?? editCounterOffer?.mode ?? "sell") as "sell" | "buy")
    : undefined;
  const editSellCo =
    isDualSwapEdit && editCounterOffer && editPairedCounterOffer
      ? editCounterOffer.mode === "sell"
        ? editCounterOffer
        : editPairedCounterOffer
      : null;
  const editBuyCo =
    isDualSwapEdit && editCounterOffer && editPairedCounterOffer
      ? editCounterOffer.mode === "buy"
        ? editCounterOffer
        : editPairedCounterOffer
      : null;

  // 安全地获取原始价格：listing/swap 可能为 null，先算出安全默认值
  const validListing = !isSwap && !!listing;
  const validSwap = isSwap && !!swap;

  // 原始价格和剩余数量（使用可选链 + 空值合并避免 null 访问崩溃）
  const originalPrice = isSwap
    ? resolvedSwapMode === "buy"
      ? swap?.buy_price ?? 0
      : swap?.sell_price ?? 0
    : listing?.price ?? 0;

  const remaining = isSwap
    ? resolvedSwapMode === "buy"
      ? Math.floor((swap?.buy_quantity ?? 0) - (swap?.buy_filled ?? 0))
      : resolvedSwapMode === "sell"
        ? Math.floor((swap?.sell_quantity ?? 0) - (swap?.sell_filled ?? 0))
        : Math.min(
            Math.floor((swap?.sell_quantity ?? 0) - (swap?.sell_filled ?? 0)),
            Math.floor((swap?.buy_quantity ?? 0) - (swap?.buy_filled ?? 0))
          )
    : Math.floor((listing?.quantity ?? 0) - (listing?.filled ?? 0));

  const allowPartial = isSwap
    ? resolvedSwapMode === "buy"
      ? swap?.buy_allow_partial !== false
      : swap?.sell_allow_partial !== false
    : listing?.allow_partial !== false;

  const minQty = isSwap
    ? resolvedSwapMode === "buy"
      ? swap?.buy_min_quantity
      : swap?.sell_min_quantity
    : listing?.min_quantity;

  const lockedQty =
    quantityLocked && fixedQuantity != null && fixedQuantity > 0
      ? Math.floor(fixedQuantity)
      : null;

  const [price, setPrice] = useState(String(isEditMode && editCounterOffer ? editCounterOffer.offer_price : originalPrice));
  const [quantity, setQuantity] = useState(
    String(
      isEditMode && editCounterOffer
        ? editCounterOffer.offer_quantity
        : lockedQty != null
          ? lockedQty
          : remaining > 0
            ? remaining
            : "",
    ),
  );
  const [shareCount, setShareCount] = useState("");
  const [touched, setTouched] = useState(false);

  // 可协商的其他条款（预填原盘值，用户可修改；为空即沿用原盘）
  const [deliveryPeriod, setDeliveryPeriod] = useState("");
  const [deliveryLocation, setDeliveryLocation] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState("");
  const [freeStorageEnabled, setFreeStorageEnabled] = useState(false);
  const [freeStorageDays, setFreeStorageDays] = useState("");
  const [specs, setSpecs] = useState("");

  // 计算原盘预填值（根据 listing / swap 对应方）
  const sellPrefill = useMemo(() => {
    if (!swap) return null;
    const sp = swap.sell_specs ?? "";
    return {
      price: swap.sell_price,
      remain: Math.floor((swap.sell_quantity ?? 0) - (swap.sell_filled ?? 0)),
      dp: swap.sell_delivery_period ?? "",
      dl: swap.sell_delivery_location ?? "",
      pm: swap.sell_payment_method ?? "",
      dm: swap.sell_delivery_method ?? "",
      fse: !!swap.sell_free_storage_enabled,
      fsd: swap.sell_free_storage_days != null ? String(swap.sell_free_storage_days) : "",
      sp: typeof sp === "string" ? sp : specsToString(sp as any),
      allowCO: (swap.sell_allow_counter_offer ?? swap.allow_counter_offer) !== false,
      terms: swap.sell_negotiable_terms,
      allowPartial: swap.sell_allow_partial !== false,
      minQty: swap.sell_min_quantity,
    };
  }, [swap]);

  const buyPrefill = useMemo(() => {
    if (!swap) return null;
    const sp = swap.buy_specs ?? "";
    return {
      price: swap.buy_price,
      remain: Math.floor((swap.buy_quantity ?? 0) - (swap.buy_filled ?? 0)),
      dp: swap.buy_delivery_period ?? "",
      dl: swap.buy_delivery_location ?? "",
      pm: swap.buy_payment_method ?? "",
      dm: swap.buy_delivery_method ?? "",
      fse: !!swap.buy_free_storage_enabled,
      fsd: swap.buy_free_storage_days != null ? String(swap.buy_free_storage_days) : "",
      sp: typeof sp === "string" ? sp : specsToString(sp as any),
      allowCO: (swap.buy_allow_counter_offer ?? swap.allow_counter_offer) !== false,
      terms: swap.buy_negotiable_terms,
      allowPartial: swap.buy_allow_partial !== false,
      minQty: swap.buy_min_quantity,
    };
  }, [swap]);

  const prefill = useMemo(() => {
    if (isSwap && swap) {
      const leg = resolvedSwapMode === "buy" ? "buy" : "sell";
      const dp = (leg === "buy" ? swap.buy_delivery_period : swap.sell_delivery_period) ?? "";
      const dl = (leg === "buy" ? swap.buy_delivery_location : swap.sell_delivery_location) ?? "";
      const pm = (leg === "buy" ? swap.buy_payment_method : swap.sell_payment_method) ?? "";
      const dm = (leg === "buy" ? swap.buy_delivery_method : swap.sell_delivery_method) ?? "";
      const fse = (leg === "buy" ? swap.buy_free_storage_enabled : swap.sell_free_storage_enabled) ?? false;
      const fsd = (leg === "buy" ? swap.buy_free_storage_days : swap.sell_free_storage_days) ?? null;
      const sp = (leg === "buy" ? swap.buy_specs : swap.sell_specs) ?? "";
      return {
        dp: dp ?? "",
        dl: dl ?? "",
        pm: pm ?? "",
        dm: dm ?? "",
        fse: !!fse,
        fsd: fsd != null ? String(fsd) : "",
        sp: typeof sp === "string" ? sp : specsToString(sp as any),
      };
    }
    if (listing) {
      return {
        dp: listing.delivery_period ?? "",
        dl: listing.delivery_location ?? "",
        pm: listing.payment_method ?? "",
        dm: listing.delivery_method ?? "",
        fse: listing.free_storage_enabled ?? false,
        fsd: listing.free_storage_days != null ? String(listing.free_storage_days) : "",
        sp: specsToString(listing.specs as any),
      };
    }
    return { dp: "", dl: "", pm: "", dm: "", fse: false, fsd: "", sp: "" };
  }, [isSwap, swap, resolvedSwapMode, listing]);

  // 可议条款范围：换盘按 swapMode 使用对应方的 negotiable_terms；挂牌按 listing.negotiable_terms
  const allowedTerms = useMemo<Set<string>>(() => {
    if (isSwap) {
      if (swap) {
        // 根据 swapMode 选择对应方的商谈条款
        const legTerms = resolvedSwapMode === "buy"
          ? (swap.buy_negotiable_terms ?? swap.negotiable_terms)
          : resolvedSwapMode === "both"
            ? mergeTerms(swap.sell_negotiable_terms ?? swap.negotiable_terms, swap.buy_negotiable_terms ?? swap.negotiable_terms)
            : (swap.sell_negotiable_terms ?? swap.negotiable_terms);
        if (legTerms && legTerms.length > 0) {
          return new Set(sanitizeNegotiableTerms(legTerms));
        }
      }
      return new Set(DEFAULT_NEGOTIABLE_TERMS);
    }
    if (!listing) return new Set(DEFAULT_NEGOTIABLE_TERMS);
    const t =
      listing.negotiable_terms && listing.negotiable_terms.length > 0
        ? listing.negotiable_terms
        : DEFAULT_NEGOTIABLE_TERMS;
    return new Set(sanitizeNegotiableTerms(t));
  }, [isSwap, listing, swap, resolvedSwapMode]);

  // 价格 / 数量变化时重置主字段（编辑模式不覆盖已有商谈值；闪拼锁定数量优先）
  useEffect(() => {
    const configuredMin =
      allowPartial && minQty != null && minQty > 0 ? Math.floor(minQty) : 0;
    const pick = getSharePickState(remaining, configuredMin, allowPartial);
    const initQty =
      isEditMode && editCounterOffer
        ? Math.floor(editCounterOffer.offer_quantity)
        : lockedQty != null
          ? lockedQty
          : remaining > 0
            ? remaining
            : 0;

    if (isEditMode && editCounterOffer) {
      setPrice(String(editCounterOffer.offer_price));
    } else {
      setPrice(String(originalPrice));
    }

    if (lockedQty != null || !pick.canPickShares) {
      setShareCount("");
      setQuantity(initQty > 0 ? String(initQty) : "");
    } else {
      const sc = shareCountFromQty(initQty, pick.perShare, pick.maxShares);
      setShareCount(sc);
      setQuantity(String(Math.floor(Number(sc) || 0) * pick.perShare));
    }
    setTouched(false);
  }, [originalPrice, remaining, isEditMode, editCounterOffer, lockedQty, allowPartial, minQty]);

  // 原盘条款预填值变化时重置"其他条款"（编辑模式优先用已有商谈条款）
  useEffect(() => {
    if (isEditMode && editCounterOffer) {
      setDeliveryPeriod(editCounterOffer.offer_delivery_period ?? prefill.dp);
      setDeliveryLocation(editCounterOffer.offer_delivery_location ?? prefill.dl);
      setPaymentMethod(editCounterOffer.offer_payment_method ?? prefill.pm);
      setDeliveryMethod(editCounterOffer.offer_delivery_method ?? prefill.dm);
      setFreeStorageEnabled(editCounterOffer.offer_free_storage_enabled ?? prefill.fse);
      setFreeStorageDays(
        editCounterOffer.offer_free_storage_days != null
          ? String(editCounterOffer.offer_free_storage_days)
          : prefill.fsd
      );
      setSpecs(editCounterOffer.offer_specs ?? prefill.sp);
    } else {
      setDeliveryPeriod(prefill.dp);
      setDeliveryLocation(prefill.dl);
      setPaymentMethod(prefill.pm);
      setDeliveryMethod(prefill.dm);
      setFreeStorageEnabled(prefill.fse);
      setFreeStorageDays(prefill.fsd);
      setSpecs(prefill.sp);
    }
  }, [prefill, isEditMode, editCounterOffer]);

  // 守卫：listing/swap 为 null 或剩余数量不足时，不渲染弹窗
  if (!validListing && !validSwap) return null;
  if (useDualForm) {
    if (!sellPrefill?.allowCO && !buyPrefill?.allowCO) return null;
    if ((sellPrefill?.remain ?? 0) <= 0 && (buyPrefill?.remain ?? 0) <= 0) return null;
  } else if (remaining <= 0) {
    return null;
  }

  const configuredMin =
    allowPartial && minQty != null && minQty > 0 ? Math.floor(minQty) : 0;
  const sharePick = getSharePickState(remaining, configuredMin, allowPartial);
  const canPickShares =
    lockedQty == null && allowedTerms.has("quantity") && sharePick.canPickShares;

  const priceNum = Number(price);
  const qtyNum = canPickShares
    ? Math.floor(Number(shareCount) || 0) * sharePick.perShare
    : Math.floor(Number(quantity));

  const validationError = (() => {
    if (!price) return null;
    if (Number.isNaN(priceNum) || priceNum <= 0) return "商谈价格必须大于 0";
    if (lockedQty != null) {
      if (qtyNum !== lockedQty) return `闪拼数量不可修改，须为 ${lockedQty}`;
      if (qtyNum > remaining) return `商谈数量不能超过剩余数量 ${remaining}`;
      return null;
    }
    if (canPickShares) {
      const n = Math.floor(Number(shareCount));
      if (!shareCount || n <= 0) return "请选择商谈份数";
      if (n > sharePick.maxShares) return `最多 ${sharePick.maxShares} 份`;
    } else if (!quantity) {
      return null;
    }
    return validateQuantity(qtyNum, remaining, allowPartial, minQty, unit);
  })();

  const isValid =
    priceNum > 0 &&
    qtyNum > 0 &&
    !validationError;

  // 议价方向：我方作为卖方(接买盘) / 买方(接卖盘)
  const offererSide = isSwap
    ? resolvedSwapMode === "sell"
      ? "BUY"
      : resolvedSwapMode === "buy"
        ? "SELL"
        : ""
    : listing?.side === "BUY"
      ? "SELL"
      : listing?.side === "SELL"
        ? "BUY"
        : "";

  // 议价与原价差额
  const delta = priceNum - originalPrice;
  // 对议价者不利判定：卖方报低于买价 / 买方报高于卖价
  const isDisadvantage = (() => {
    if (!isValid || originalPrice <= 0 || priceNum <= 0 || !offererSide) return false;
    if (offererSide === "SELL") return priceNum < originalPrice;
    if (offererSide === "BUY") return priceNum > originalPrice;
    return false;
  })();
  // 不利时的红色告警文案
  const disadvantageWarning = (() => {
    if (!isDisadvantage) return null;
    if (offererSide === "SELL") {
      return `您作为卖方报出的价格（${priceNum.toLocaleString()}）低于对方买价（${originalPrice.toLocaleString()}），低于买价对您不利，请确认是否合理`;
    }
    return `您作为买方报出的价格（${priceNum.toLocaleString()}）高于对方卖价（${originalPrice.toLocaleString()}），高于卖价对您不利，请确认是否合理`;
  })();

  // 可编辑字段高亮样式：醒目蓝色左边框 + 浅蓝背景
  const highlightInputCls =
    "w-full px-3 py-2.5 border border-blue-400/70 border-l-4 border-l-blue-500 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-t-text dark:text-t-text focus:outline-none focus:ring-2 focus:ring-amber-300 dark:placeholder-blue-200/50 read-only:cursor-not-allowed read-only:opacity-60";

  const handleDualUpdate = (
    updates: { id: string; params: Omit<DualLegSubmitParams, "mode"> }[]
  ) => {
    if (!onUpdate) return;
    for (const u of updates) {
      onUpdate(u.id, u.params);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!isValid) return;

    // 安全性检查：防止 XSS 注入
    const allTextFields = [deliveryPeriod, deliveryLocation, paymentMethod, deliveryMethod, specs];
    if (allTextFields.some((f) => !isSafeInput(f))) {
      return;
    }

    // 不可商谈的条款不传 offer_xxx（设为 undefined），后端自动沿用原盘值，避免校验冲突
    // 价格/数量不可议时传原盘值（后端 required 字段不能省略），让后端识别为"沿用原盘"
    const fs = optionalOfferFreeStorage(
      allowedTerms.has("free_storage"),
      freeStorageEnabled,
      freeStorageDays,
      prefill.fse,
      prefill.fsd
    );
    const params = {
      offer_price: allowedTerms.has("price") && priceNum !== originalPrice ? priceNum : originalPrice,
      offer_quantity:
        lockedQty != null
          ? lockedQty
          : allowedTerms.has("quantity") && qtyNum !== remaining
            ? qtyNum
            : remaining,
      offer_delivery_period: optionalOfferField(allowedTerms.has("delivery_period"), deliveryPeriod, prefill.dp),
      offer_delivery_location: optionalOfferField(allowedTerms.has("delivery_location"), deliveryLocation, prefill.dl),
      offer_payment_method: optionalOfferField(allowedTerms.has("payment_method"), paymentMethod, prefill.pm),
      offer_delivery_method: optionalOfferField(allowedTerms.has("delivery_method"), deliveryMethod, prefill.dm),
      offer_free_storage_enabled: fs.enabled,
      offer_free_storage_days: fs.days,
      offer_specs: optionalOfferField(allowedTerms.has("specs"), specs, prefill.sp),
    };

    const ok = await confirmDialog({
      title: isEditMode ? "确认保存商谈" : "确认发起商谈",
      message: isEditMode ? "确认保存商谈修改？" : "确认向对方发起商谈？",
      content: (
        <CounterOfferConfirmSheet
          intro={
            isEditMode
              ? "请核对修改后的商谈条款，确认无误后再保存。"
              : "请核对以下商谈条款，确认无误后再发出。"
          }
          serialLabel={
            isSwap && swap
              ? formatBoardSerial("S", swap.serial_no, swap.created_at)
              : listing
                ? formatBoardSerial("L", listing.serial_no, listing.created_at)
                : undefined
          }
          modeLabel={
            isSwap
              ? resolvedSwapMode === "both"
                ? "换盘·双向"
                : resolvedSwapMode === "sell"
                  ? "换盘·卖盘商谈"
                  : "换盘·买盘商谈"
              : listing?.side === "BUY"
                ? "买盘商谈"
                : "卖盘商谈"
          }
          offer={{
            price: params.offer_price,
            quantity: params.offer_quantity,
            delivery_period: params.offer_delivery_period ?? prefill.dp,
            delivery_location: params.offer_delivery_location ?? prefill.dl,
            payment_method: params.offer_payment_method ?? prefill.pm,
            delivery_method: params.offer_delivery_method ?? prefill.dm,
            free_storage_enabled:
              params.offer_free_storage_enabled ?? prefill.fse,
            free_storage_days:
              params.offer_free_storage_days ??
              (prefill.fsd ? Number(prefill.fsd) : null),
            specs: params.offer_specs ?? prefill.sp,
          }}
          refTerms={{
            price: originalPrice,
            quantity: remaining,
            delivery_period: prefill.dp,
            delivery_location: prefill.dl,
            payment_method: prefill.pm,
            delivery_method: prefill.dm,
            free_storage_enabled: prefill.fse,
            free_storage_days: prefill.fsd ? Number(prefill.fsd) : null,
            specs: prefill.sp,
          }}
          outro={
            isEditMode
              ? "保存后将通知对方，请核对条款。"
              : "发出后对方可接受、拒绝或继续协商，请核对后再发出。"
          }
        />
      ),
      wide: true,
      variant: "warning",
      icon: "warning",
      confirmText: isEditMode ? "确认保存" : "确认发出",
      cancelText: "再想想",
    });
    if (!ok) return;

    if (isEditMode && editCounterOffer && onUpdate) {
      onUpdate(editCounterOffer.id, params);
    } else {
      onSubmit({
        ref_type: refType,
        ref_id: isSwap ? swap!.id : listing!.id,
        mode: isSwap ? resolvedSwapMode : undefined,
        ...params,
      });
    }
  };

  const handleDualSubmit = async (legs: DualLegSubmitParams[]) => {
    if (!swap || !onSubmitDual) return;
    // DualLegForm 内已二次确认，此处直接提交
    onSubmitDual(
      legs.map((leg) => ({
        ref_type: "swap" as const,
        ref_id: swap.id,
        mode: leg.mode,
        offer_price: leg.offer_price,
        offer_quantity: leg.offer_quantity,
        offer_delivery_period: leg.offer_delivery_period,
        offer_delivery_location: leg.offer_delivery_location,
        offer_payment_method: leg.offer_payment_method,
        offer_delivery_method: leg.offer_delivery_method,
        offer_free_storage_enabled: leg.offer_free_storage_enabled,
        offer_free_storage_days: leg.offer_free_storage_days,
        offer_specs: leg.offer_specs,
      }))
    );
  };

  const title = isEditMode
    ? `修改商谈 · ${isDualSwapEdit || resolvedSwapMode === "both" ? "双向换盘" : resolvedSwapMode === "sell" ? "买入" : resolvedSwapMode === "buy" ? "卖出" : "一键换盘"}`
    : isSwap
    ? `商谈 · ${resolvedSwapMode === "both" ? "双向换盘" : resolvedSwapMode === "sell" ? "买入" : resolvedSwapMode === "buy" ? "卖出" : "一键换盘"}`
    : `商谈 · ${listing!.side === "SELL" ? "买入" : "卖出"}`;

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className={`relative bg-t-card rounded-xl shadow-2xl w-full mx-4 border border-t-border max-h-[90vh] overflow-y-auto ${useDualForm ? "max-w-2xl" : "max-w-md"}`}>
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-t-border bg-t-card backdrop-blur-md">
          <div className="flex items-center gap-2">
            {onBack && (
              <button
                onClick={onBack}
                className="flex items-center gap-1 text-sm text-t-text-3 hover:text-t-text transition-colors"
                title="返回详情"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                返回
              </button>
            )}
            <h2 className="text-lg font-bold text-t-text">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-t-text-3 hover:text-t-text text-xl leading-none p-1"
          >
            ✕
          </button>
        </div>

        <ModalUpdateNotice show={opponentWithdrawn} variant="withdrawn" onDismiss={onDismissWithdrawn} />
        <ModalUpdateNotice show={dataUpdated && !opponentWithdrawn} variant="updated" message={updateMessage} onDismiss={onDismissUpdate} />

        {useDualForm && swap && sellPrefill && buyPrefill && (onSubmitDual || isDualSwapEdit) ? (
          <div className="p-6">
            <CounterOfferDualLegForm
              swap={swap}
              sellPrefill={sellPrefill}
              buyPrefill={buyPrefill}
              unit={unit}
              loading={loading}
              opponentWithdrawn={opponentWithdrawn}
              error={error}
              touched={touched}
              onTouched={setTouched}
              onClose={onClose}
              isEditMode={isDualSwapEdit}
              editSellCo={editSellCo}
              editBuyCo={editBuyCo}
              onSubmit={handleDualSubmit}
              onUpdate={isDualSwapEdit ? handleDualUpdate : undefined}
            />
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <>
          {/* 原盘不可商谈条款（只读汇总） */}
          <div className="rounded-lg p-4 space-y-2 text-sm bg-slate-100/90 dark:bg-slate-800/50 border border-slate-300/80 dark:border-slate-600/60 border-l-4 border-l-slate-400 dark:border-l-slate-500">
            <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">原盘条款（不可商谈）</div>
            {!allowedTerms.has("price") && (
              <InfoRow label="价格" value={`¥${originalPrice.toLocaleString()}/${unit}`} />
            )}
            <InfoRow
              label="数量"
              value={`${(lockedQty ?? remaining).toLocaleString()} ${unit}${quantityLocked ? "（闪拼锁定）" : ""}`}
            />
            <InfoRow label="数量方式" value={formatPartial(allowPartial, minQty, unit, remaining)} />
            {!allowedTerms.has("delivery_period") && (
              <InfoRow label="交割期" value={prefill.dp || "现货"} />
            )}
            <InfoRow label="交割地" value={prefill.dl || "-"} />
            {!allowedTerms.has("payment_method") && (
              <InfoRow label="付款方式" value={prefill.pm || "-"} />
            )}
            {!allowedTerms.has("delivery_method") && (
              <InfoRow label="交割方式" value={prefill.dm || "-"} />
            )}
            {!allowedTerms.has("free_storage") && (
              <InfoRow
                label="免仓期"
                value={formatFreeStorage(prefill.fse, prefill.fsd ? Number(prefill.fsd) : null)}
              />
            )}
            <InfoRow label="规格" value={formatSpecs(prefill.sp) || "-"} />
            <InfoRow
              label="可商谈条款"
              value={formatNegotiableTerms(Array.from(allowedTerms))}
            />
          </div>

          {/* 可商谈条款（仅展示可编辑项） */}
          {allowedTerms.size > 0 && (
            <div className="rounded-lg p-4 space-y-3 bg-amber-50/90 dark:bg-amber-950/30 border border-amber-400/70 dark:border-amber-500/50 border-l-4 border-l-amber-500">
              <div className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                可商谈条款
                <span className="ml-2 text-xs font-normal text-amber-700/80 dark:text-amber-400/80">蓝色高亮字段可修改</span>
              </div>

              {allowedTerms.has("price") && (
                <div>
                  <label className="block text-sm font-medium text-t-text-2 mb-1.5">
                    商谈价格 (¥/{unit})
                  </label>
                  <p className="text-xs text-t-text-3 mb-1">
                    原价 ¥{originalPrice.toLocaleString()}/{unit}
                  </p>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={price}
                    onChange={(e) => {
                      setPrice(e.target.value);
                      setTouched(false);
                    }}
                    onBlur={() => setTouched(true)}
                    className={`${highlightInputCls} font-mono ${
                      touched && validationError && priceNum <= 0 ? "border-status-error" : ""
                    }`}
                    autoFocus
                    disabled={loading}
                    readOnly={loading}
                  />
                  {disadvantageWarning && (
                    <p className="mt-1.5 text-sm text-status-error flex items-start gap-1 font-medium">
                      <span>⚠️</span>
                      <span>{disadvantageWarning}</span>
                    </p>
                  )}
                </div>
              )}

              {allowedTerms.has("delivery_period") && (
                <div>
                  <label className="flex items-center justify-between text-sm font-medium text-t-text-2 mb-1.5">
                    <span>交割期</span>
                    <span className="text-xs font-normal text-t-text-3">原值：{prefill.dp || "—"}</span>
                  </label>
                  <input
                    type="text"
                    value={deliveryPeriod}
                    onChange={(e) => setDeliveryPeriod(sanitizeText(e.target.value))}
                    placeholder="如 现货 / 2606下"
                    className={highlightInputCls}
                    disabled={loading}
                    readOnly={loading}
                  />
                </div>
              )}

              {allowedTerms.has("payment_method") && (
                <div>
                  <label className="flex items-center justify-between text-sm font-medium text-t-text-2 mb-1.5">
                    <span>付款方式</span>
                    <span className="text-xs font-normal text-t-text-3">原值：{prefill.pm || "—"}</span>
                  </label>
                  <Combobox
                    value={paymentMethod}
                    onChange={setPaymentMethod}
                    options={PAYMENT_METHOD_OPTIONS}
                    placeholder={prefill.pm || "选择或输入付款方式"}
                    disabled={loading}
                    readOnly={loading}
                    className={highlightInputCls}
                  />
                </div>
              )}

              {allowedTerms.has("delivery_method") && (
                <div>
                  <label className="flex items-center justify-between text-sm font-medium text-t-text-2 mb-1.5">
                    <span>交割方式</span>
                    <span className="text-xs font-normal text-t-text-3">原值：{prefill.dm || "—"}</span>
                  </label>
                  <Combobox
                    value={deliveryMethod}
                    onChange={setDeliveryMethod}
                    options={DELIVERY_METHOD_OPTIONS}
                    placeholder={prefill.dm || "选择或输入交割方式"}
                    disabled={loading}
                    readOnly={loading}
                    className={highlightInputCls}
                  />
                </div>
              )}

              {allowedTerms.has("free_storage") && (
                <div>
                  <label className="flex items-center justify-between text-sm font-medium text-t-text-2 mb-1.5">
                    <span>免仓</span>
                    <span className="text-xs font-normal text-t-text-3">
                      原值：{prefill.fse ? `${prefill.fsd || "—"}天` : "不免仓"}
                    </span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="co-free-storage"
                      checked={freeStorageEnabled}
                      onChange={(e) => setFreeStorageEnabled(e.target.checked)}
                      className="w-4 h-4 accent-brand-600"
                      disabled={loading}
                    />
                    <label htmlFor="co-free-storage" className="text-xs font-medium text-t-text-2">
                      可免仓（勾选后填写免仓天数）
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={freeStorageDays}
                      onChange={(e) => setFreeStorageDays(e.target.value)}
                      placeholder="天数"
                      disabled={!freeStorageEnabled || loading}
                      readOnly={!freeStorageEnabled || loading}
                      className={`${highlightInputCls} flex-1 disabled:opacity-50 read-only:opacity-50`}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {(touched || error) && validationError && (
            <p className="text-sm text-status-error">{validationError}</p>
          )}
          {error && !validationError && (
            <p className="text-sm text-status-error">{error}</p>
          )}

          {/* 预计成交额 */}
          {isValid && (
            <div className="text-sm text-t-text-2 bg-t-tertiary rounded px-3 py-2 space-y-1">
              <div className="flex justify-between">
                <span>预计成交额</span>
                <span className="font-mono font-bold text-brand-600">
                  ¥{(priceNum * qtyNum).toLocaleString()}
                </span>
              </div>
              {isValid && originalPrice > 0 && priceNum > 0 && (
                <div className="flex justify-between mt-1 text-xs">
                  <span>较原价差额</span>
                  <span
                    className={
                      delta === 0
                        ? "text-t-text-3"
                        : isDisadvantage
                        ? "text-status-error font-semibold"
                        : "text-status-success font-semibold"
                    }
                  >
                    {delta > 0 ? "↑ +" : delta < 0 ? "↓ " : ""}
                    {Math.abs(delta).toFixed(2)}/{unit}
                    {delta === 0 ? "（持平）" : isDisadvantage ? "（对您不利）" : "（对您有利）"}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* 按钮 */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 border border-t-border rounded-lg text-t-text-2 hover:bg-t-hover transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!isValid || loading || opponentWithdrawn}
              className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
            >
              {loading ? "提交中..." : isEditMode ? "保存修改" : "发起商谈"}
            </button>
          </div>
          </>
        </form>
        )}
      </div>
    </div>
  );
}
