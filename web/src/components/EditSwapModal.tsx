"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Product, SwapListing } from "@/lib/types";
import type { UpdateSwapParams } from "@/lib/api";
import { fetchCounterOffersByRef, fetchPendingSwapLocks } from "@/lib/api";
import { getProductSymbol, PAYMENT_METHOD_OPTIONS, getDefaultPayment, NEGOTIABLE_TERMS, DEFAULT_NEGOTIABLE_TERMS, sanitizeNegotiableTerms } from "@/lib/types";
import { DELIVERY_METHOD_OPTIONS } from "./CreateListingModal";
import { Tooltip } from "./ui/Tooltip";
import { sanitizeText, isSafeInput } from "@/lib/validate";
import { DELIVERY_LOCATION_OPTIONS, SPECS_OPTIONS, mergeSelectOptions } from "@/lib/listing-options";
import {
  qtyModeFromPartial,
  deriveShareFields,
  resolveQtyForSubmit,
  formatQtyModeLabel,
  applySharedSwapQty,
  type QtyMode,
} from "@/lib/qty-mode";
import QtyModeFields from "./QtyModeFields";
import ModalUpdateNotice from "./ModalUpdateNotice";
import { toast } from "./Toast";
import { confirmDialog, type EditChangeItem } from "./ConfirmDialog";
import {
  defaultExpiresAtLocal,
  defaultStartsAtLocal,
  isoToDatetimeLocal,
  isWorkdayDateTimeLocal,
  nextWorkdayExpireLocal,
  nextWorkdayMorningLocal,
} from "@/lib/expires";
import DeliveryPeriodPicker from "./DeliveryPeriodPicker";
import WorkdayDateTimePicker from "./WorkdayDateTimePicker";

export interface EditSwapFormData {
  sell_product_id: string;
  sell_price: string;
  sell_quantity: string;
  sell_per_share: string;
  sell_share_count: string;
  sell_delivery_period: string;
  sell_delivery_location: string;
  sell_payment_method: string;
  sell_delivery_method: string;
  sell_free_storage_enabled: boolean;
  sell_free_storage_days: string;
  sell_specs: string;
  buy_product_id: string;
  buy_price: string;
  buy_quantity: string;
  buy_per_share: string;
  buy_share_count: string;
  buy_delivery_period: string;
  buy_delivery_location: string;
  buy_payment_method: string;
  buy_delivery_method: string;
  buy_free_storage_enabled: boolean;
  buy_free_storage_days: string;
  buy_specs: string;
  sell_allow_partial: boolean;
  sell_min_quantity: string;
  buy_allow_partial: boolean;
  buy_min_quantity: string;
  sell_allow_counter_offer: boolean;
  sell_negotiable_terms: string[];
  buy_allow_counter_offer: boolean;
  buy_negotiable_terms: string[];
  // 单边交易设置
  allow_single_side: boolean;
  single_side_mode: "both" | "single_buy" | "single_sell" | "none";
  starts_at: string;
  expires_at: string;
}

interface Props {
  open: boolean;
  swap: SwapListing | null;
  products: Product[];
  loading?: boolean;
  dataUpdated?: boolean;
  updateMessage?: string;
  onDismissUpdate?: () => void;
  onClose: () => void;
  onSubmit: (id: string, data: UpdateSwapParams) => void;
  /** 返回详情弹窗（仅从详情弹窗打开时显示） */
  onBack?: () => void;
}

/** 将 SwapListing 实体转换为表单数据 */
function swapToForm(swap: SwapListing): EditSwapFormData {
  // specs 可能是 JSON 文本或普通字符串
  const specsToString = (s?: string | null): string => {
    if (!s) return "";
    return s;
  };

  const sellQty = swap.sell_quantity != null ? Number(swap.sell_quantity) : 0;
  const buyQty = swap.buy_quantity != null ? Number(swap.buy_quantity) : 0;
  // 买卖数量保持一致：以卖侧为准（历史不一致时也统一）
  const qty = sellQty > 0 ? sellQty : buyQty;
  const allowPartial = swap.sell_allow_partial ?? swap.buy_allow_partial ?? false;
  const minQty = allowPartial
    ? (swap.sell_min_quantity != null && swap.sell_min_quantity > 0
        ? swap.sell_min_quantity
        : swap.buy_min_quantity)
    : 0;
  const shares = deriveShareFields(qty, minQty);

  return {
    sell_product_id: swap.sell_product_id || "",
    sell_price: swap.sell_price != null ? String(swap.sell_price) : "",
    sell_quantity: qty > 0 ? String(Math.floor(qty)) : "",
    sell_per_share: shares.perShare,
    sell_share_count: shares.shareCount,
    sell_delivery_period: swap.sell_delivery_period || "现货",
    sell_delivery_location: swap.sell_delivery_location || "",
    sell_payment_method: swap.sell_payment_method || "",
    sell_delivery_method: swap.sell_delivery_method || "",
    sell_free_storage_enabled: swap.sell_free_storage_enabled ?? true,
    sell_free_storage_days: swap.sell_free_storage_days != null ? String(swap.sell_free_storage_days) : "",
    sell_specs: specsToString(swap.sell_specs),
    buy_product_id: swap.buy_product_id || "",
    buy_price: swap.buy_price != null ? String(swap.buy_price) : "",
    buy_quantity: qty > 0 ? String(Math.floor(qty)) : "",
    buy_per_share: shares.perShare,
    buy_share_count: shares.shareCount,
    buy_delivery_period: swap.buy_delivery_period || "现货",
    buy_delivery_location: swap.buy_delivery_location || "",
    buy_payment_method: swap.buy_payment_method || "",
    buy_delivery_method: swap.buy_delivery_method || "",
    buy_free_storage_enabled: swap.buy_free_storage_enabled ?? true,
    buy_free_storage_days: swap.buy_free_storage_days != null ? String(swap.buy_free_storage_days) : "",
    buy_specs: specsToString(swap.buy_specs),
    sell_allow_partial: allowPartial,
    sell_min_quantity: minQty != null && minQty > 0 ? String(minQty) : "",
    buy_allow_partial: allowPartial,
    buy_min_quantity: minQty != null && minQty > 0 ? String(minQty) : "",
    sell_allow_counter_offer: swap.sell_allow_counter_offer ?? swap.allow_counter_offer ?? false,
    sell_negotiable_terms: sanitizeNegotiableTerms(swap.sell_negotiable_terms ?? swap.negotiable_terms ?? []),
    buy_allow_counter_offer: swap.buy_allow_counter_offer ?? swap.allow_counter_offer ?? false,
    buy_negotiable_terms: sanitizeNegotiableTerms(swap.buy_negotiable_terms ?? swap.negotiable_terms ?? []),
    allow_single_side: swap.allow_single_side ?? true,
    single_side_mode: (swap.single_side_mode as EditSwapFormData["single_side_mode"]) ?? "both",
    starts_at: swap.starts_at && swap.status === "SCHEDULED"
      ? isoToDatetimeLocal(swap.starts_at)
      : defaultStartsAtLocal(),
    expires_at: isoToDatetimeLocal(swap.expires_at),
  };
}

function resolveLegQty(form: EditSwapFormData, side: "sell" | "buy") {
  if (side === "sell") {
    return resolveQtyForSubmit(
      qtyModeFromPartial(form.sell_allow_partial),
      form.sell_quantity,
      form.sell_per_share,
      form.sell_share_count,
    );
  }
  return resolveQtyForSubmit(
    qtyModeFromPartial(form.buy_allow_partial),
    form.buy_quantity,
    form.buy_per_share,
    form.buy_share_count,
  );
}

function sameTerms(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return [...a].sort().join("\0") === [...b].sort().join("\0");
}

function swapFormUnchanged(swap: SwapListing, form: EditSwapFormData): boolean {
  const orig = swapToForm(swap);
  const sellResolved = resolveLegQty(form, "sell");
  const buyResolved = resolveLegQty(form, "buy");
  const origSell = resolveLegQty(orig, "sell");
  const origBuy = resolveLegQty(orig, "buy");
  return (
    form.sell_product_id === orig.sell_product_id &&
    Number(form.sell_price) === Number(orig.sell_price) &&
    sellResolved.quantity === origSell.quantity &&
    sellResolved.allow_partial === origSell.allow_partial &&
    sellResolved.min_quantity === origSell.min_quantity &&
    form.sell_delivery_period.trim() === orig.sell_delivery_period.trim() &&
    form.sell_delivery_location.trim() === orig.sell_delivery_location.trim() &&
    form.sell_payment_method.trim() === orig.sell_payment_method.trim() &&
    form.sell_delivery_method.trim() === orig.sell_delivery_method.trim() &&
    form.sell_free_storage_enabled === orig.sell_free_storage_enabled &&
    (form.sell_free_storage_days.trim() || "") === (orig.sell_free_storage_days.trim() || "") &&
    form.sell_specs.trim() === orig.sell_specs.trim() &&
    form.buy_product_id === orig.buy_product_id &&
    Number(form.buy_price) === Number(orig.buy_price) &&
    buyResolved.quantity === origBuy.quantity &&
    buyResolved.allow_partial === origBuy.allow_partial &&
    buyResolved.min_quantity === origBuy.min_quantity &&
    form.buy_delivery_period.trim() === orig.buy_delivery_period.trim() &&
    form.buy_delivery_location.trim() === orig.buy_delivery_location.trim() &&
    form.buy_payment_method.trim() === orig.buy_payment_method.trim() &&
    form.buy_delivery_method.trim() === orig.buy_delivery_method.trim() &&
    form.buy_free_storage_enabled === orig.buy_free_storage_enabled &&
    (form.buy_free_storage_days.trim() || "") === (orig.buy_free_storage_days.trim() || "") &&
    form.buy_specs.trim() === orig.buy_specs.trim() &&
    form.sell_allow_counter_offer === orig.sell_allow_counter_offer &&
    sameTerms(form.sell_negotiable_terms, orig.sell_negotiable_terms) &&
    form.buy_allow_counter_offer === orig.buy_allow_counter_offer &&
    sameTerms(form.buy_negotiable_terms, orig.buy_negotiable_terms) &&
    form.allow_single_side === orig.allow_single_side &&
    form.single_side_mode === orig.single_side_mode &&
    (form.starts_at || "") === (orig.starts_at || "") &&
    (form.expires_at || "") === (orig.expires_at || "")
  );
}

function fmtFreeStorage(enabled: boolean, days: string): string {
  if (!enabled) return "不免仓";
  const d = days.trim();
  return d ? `${d}天免仓` : "可免仓";
}

function fmtNegotiableTerms(keys: string[]): string {
  if (!keys.length) return "无";
  return keys
    .map((k) => NEGOTIABLE_TERMS.find((t) => t.key === k)?.label ?? k)
    .join("、");
}

function fmtSingleSideMode(mode: string): string {
  switch (mode) {
    case "single_buy":
    case "buy":
      return "仅买侧";
    case "single_sell":
    case "sell":
      return "仅卖侧";
    case "none":
      return "不允许单边";
    case "both":
    default:
      return "双侧";
  }
}

/** 列出换盘表单相对原盘的变更 */
function describeSwapFormChanges(
  swap: SwapListing,
  form: EditSwapFormData,
  productName: (id: string) => string,
): EditChangeItem[] {
  const orig = swapToForm(swap);
  const items: EditChangeItem[] = [];
  const push = (side: EditChangeItem["side"], label: string, before: string, after: string) => {
    if (before !== after) items.push({ label, before, after, side });
  };

  push("sell", "品种", productName(orig.sell_product_id), productName(form.sell_product_id));
  push("sell", "价格", `¥${Number(orig.sell_price).toLocaleString()}`, `¥${Number(form.sell_price).toLocaleString()}`);
  {
    const origSell = resolveLegQty(orig, "sell");
    const formSell = resolveLegQty(form, "sell");
    push(
      "sell",
      "数量方式",
      formatQtyModeLabel(origSell.allow_partial, origSell.quantity, origSell.min_quantity),
      formatQtyModeLabel(formSell.allow_partial, formSell.quantity, formSell.min_quantity),
    );
    push("sell", "数量", origSell.quantity.toLocaleString(), formSell.quantity.toLocaleString());
  }
  push("sell", "交割期", orig.sell_delivery_period.trim() || "-", form.sell_delivery_period.trim() || "-");
  push("sell", "交割地", orig.sell_delivery_location.trim() || "-", form.sell_delivery_location.trim() || "-");
  push("sell", "交割方式", orig.sell_delivery_method.trim() || "-", form.sell_delivery_method.trim() || "-");
  push("sell", "付款方式", orig.sell_payment_method.trim() || "-", form.sell_payment_method.trim() || "-");
  push("sell", "规格", orig.sell_specs.trim() || "-", form.sell_specs.trim() || "-");
  push(
    "sell",
    "免仓期",
    fmtFreeStorage(orig.sell_free_storage_enabled, orig.sell_free_storage_days),
    fmtFreeStorage(form.sell_free_storage_enabled, form.sell_free_storage_days),
  );
  push("sell", "可商谈", orig.sell_allow_counter_offer ? "允许" : "不允许", form.sell_allow_counter_offer ? "允许" : "不允许");
  if (!sameTerms(form.sell_negotiable_terms, orig.sell_negotiable_terms)) {
    push("sell", "可商谈条款", fmtNegotiableTerms(orig.sell_negotiable_terms), fmtNegotiableTerms(form.sell_negotiable_terms));
  }

  push("buy", "品种", productName(orig.buy_product_id), productName(form.buy_product_id));
  push("buy", "价格", `¥${Number(orig.buy_price).toLocaleString()}`, `¥${Number(form.buy_price).toLocaleString()}`);
  {
    const origBuy = resolveLegQty(orig, "buy");
    const formBuy = resolveLegQty(form, "buy");
    push(
      "buy",
      "数量方式",
      formatQtyModeLabel(origBuy.allow_partial, origBuy.quantity, origBuy.min_quantity),
      formatQtyModeLabel(formBuy.allow_partial, formBuy.quantity, formBuy.min_quantity),
    );
    push("buy", "数量", origBuy.quantity.toLocaleString(), formBuy.quantity.toLocaleString());
  }
  push("buy", "交割期", orig.buy_delivery_period.trim() || "-", form.buy_delivery_period.trim() || "-");
  push("buy", "交割地", orig.buy_delivery_location.trim() || "-", form.buy_delivery_location.trim() || "-");
  push("buy", "交割方式", orig.buy_delivery_method.trim() || "-", form.buy_delivery_method.trim() || "-");
  push("buy", "付款方式", orig.buy_payment_method.trim() || "-", form.buy_payment_method.trim() || "-");
  push("buy", "规格", orig.buy_specs.trim() || "-", form.buy_specs.trim() || "-");
  push(
    "buy",
    "免仓期",
    fmtFreeStorage(orig.buy_free_storage_enabled, orig.buy_free_storage_days),
    fmtFreeStorage(form.buy_free_storage_enabled, form.buy_free_storage_days),
  );
  push("buy", "可商谈", orig.buy_allow_counter_offer ? "允许" : "不允许", form.buy_allow_counter_offer ? "允许" : "不允许");
  if (!sameTerms(form.buy_negotiable_terms, orig.buy_negotiable_terms)) {
    push("buy", "可商谈条款", fmtNegotiableTerms(orig.buy_negotiable_terms), fmtNegotiableTerms(form.buy_negotiable_terms));
  }

  push("neutral", "单边交易", orig.allow_single_side ? "允许" : "不允许", form.allow_single_side ? "允许" : "不允许");
  push("neutral", "单边模式", fmtSingleSideMode(orig.single_side_mode), fmtSingleSideMode(form.single_side_mode));
  push("neutral", "开始时间", orig.starts_at.replace("T", " ") || "立即", form.starts_at.replace("T", " ") || "立即");
  push("neutral", "过期时间", orig.expires_at.replace("T", " ") || "-", form.expires_at.replace("T", " ") || "-");

  return items;
}

/** 自定义 Combobox */
function Combobox({
  value,
  onChange,
  options,
  placeholder,
  ringColor = "focus:ring-brand-400",
  error = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  ringColor?: string;
  error?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = filter
    ? options.filter((opt) => opt.toLowerCase().includes(filter.toLowerCase()))
    : options;

  return (
    <div className="relative" ref={ref}>
      <input
        type="text"
        value={open ? filter : value}
        onChange={(e) => { const v = sanitizeText(e.target.value); setFilter(v); onChange(v); if (!open) setOpen(true); }}
        onFocus={() => { setFilter(value); setOpen(true); }}
        onBlur={() => { setOpen(false); }}
        placeholder={placeholder}
        className={`w-full px-2.5 py-2 border rounded-lg text-sm bg-t-panel text-t-text focus:ring-2 ${ringColor} outline-none ${error ? "border-red-500" : "border-t-border"}`}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-t-panel border border-t-border rounded-lg shadow-lg max-h-44 overflow-y-auto">
          {filtered.map((opt) => (
            <button
              key={opt}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onChange(opt); setOpen(false); setFilter(""); }}
              className={`w-full text-left px-2.5 py-2 text-sm hover:bg-brand-600/10 transition-colors ${
                value === opt ? "bg-brand-600/10 text-brand-500 font-medium" : "text-t-text"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FreeStorageField({
  enabled,
  days,
  onEnabledChange,
  onDaysChange,
  ringColor = "focus:ring-brand-400",
}: {
  enabled: boolean;
  days: string;
  onEnabledChange: (v: boolean) => void;
  onDaysChange: (v: string) => void;
  ringColor?: string;
}) {
  // 校验免仓天数
  const daysNum = Number(days);
  let daysError = "";
  let daysWarning = "";
  if (enabled) {
    if (!days || isNaN(daysNum) || daysNum <= 0 || !Number.isInteger(daysNum)) {
      daysError = "免仓天数必须为大于0的整数";
    } else if (daysNum > 365) {
      daysWarning = "免仓天数偏长，请确认";
    }
  }
  return (
    <div>
      <label className="block text-xs text-t-text-3 mb-1">免仓期</label>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onEnabledChange(e.target.checked)}
            className="w-3.5 h-3.5 text-brand-600 rounded focus:ring-brand-500"
          />
          <span className="text-[11px] text-t-text-2">可免仓</span>
        </label>
        {enabled && (
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <input
              type="number"
              value={days}
              onChange={(e) => {
                // 只允许非负整数
                const v = e.target.value;
                if (v === "" || /^\d+$/.test(v)) {
                  onDaysChange(v);
                }
              }}
              placeholder="天数"
              min="1"
              step="1"
              className={`w-full min-w-0 px-2 py-1 border rounded text-xs bg-t-panel text-t-text focus:ring-1 outline-none ${
                daysError ? "border-red-500" : "border-t-border"
              } ${ringColor}`}
            />
            <span className="text-[10px] text-t-text-3 shrink-0">天</span>
          </div>
        )}
      </div>
      {daysError && <p className="mt-0.5 text-[10px] text-red-500">{daysError}</p>}
      {!daysError && daysWarning && <p className="mt-0.5 text-[10px] text-amber-500">{daysWarning}</p>}
    </div>
  );
}

export default function EditSwapModal({
  open,
  swap,
  products,
  loading,
  dataUpdated,
  updateMessage,
  onDismissUpdate,
  onClose,
  onSubmit,
  onBack,
}: Props) {
  const [form, setForm] = useState<EditSwapFormData | null>(null);
  const [minQtyError, setMinQtyError] = useState("");
  const sellPaymentRef = useRef("");
  const buyPaymentRef = useRef("");

  // pending-locks?mode=buy → 卖出侧待拼锁定
  // pending-locks?mode=sell → 买入侧待拼锁定
  const sellLocksQuery = useQuery({
    queryKey: ["swapPendingLocks", swap?.id, "buy", "editOwner"],
    queryFn: () => fetchPendingSwapLocks(swap!.id, "buy"),
    enabled: open && !!swap?.id,
  });
  const buyLocksQuery = useQuery({
    queryKey: ["swapPendingLocks", swap?.id, "sell", "editOwner"],
    queryFn: () => fetchPendingSwapLocks(swap!.id, "sell"),
    enabled: open && !!swap?.id,
  });
  const sellLockQty = (sellLocksQuery.data ?? []).reduce((s, l) => s + (l.matched_qty || 0), 0);
  const buyLockQty = (buyLocksQuery.data ?? []).reduce((s, l) => s + (l.matched_qty || 0), 0);
  const hasActiveLocks = sellLockQty > 0 || buyLockQty > 0;

  const pendingCoQuery = useQuery({
    queryKey: ["counterOffersByRef", "swap", swap?.id, "edit"],
    queryFn: () => fetchCounterOffersByRef("swap", swap!.id),
    enabled: open && !!swap?.id,
  });
  const pendingCoCount = (pendingCoQuery.data?.data ?? []).filter((c) => c.status === "PENDING").length;
  const termsLockedByCo = pendingCoCount > 0;

  // 弹窗打开时预填 swap 数据
  useEffect(() => {
    if (open && swap) {
      const f = swapToForm(swap);
      sellPaymentRef.current = f.sell_payment_method;
      buyPaymentRef.current = f.buy_payment_method;
      setForm(f);
      setMinQtyError("");
    }
  }, [open, swap]);

  if (!open || !form) return null;

  const sellMode = qtyModeFromPartial(form.sell_allow_partial);
  const sharedResolvedPreview = resolveLegQty(form, "sell");

  const setSharedMode = (mode: QtyMode) => {
    setForm((prev) => (prev ? applySharedSwapQty(prev, { mode }) : prev));
    setMinQtyError("");
  };

  const patchSharedQty = (patch: { quantity?: string; perShare?: string; shareCount?: string }) => {
    setForm((prev) => (prev ? applySharedSwapQty(prev, patch) : prev));
    setMinQtyError("");
  };

  const update = (field: keyof EditSwapFormData, value: string) => {
    setForm((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [field]: value };
      if (field === "sell_delivery_period") {
        const oldDefault = getDefaultPayment(prev.sell_delivery_period);
        if (!prev.sell_payment_method || prev.sell_payment_method === oldDefault || prev.sell_payment_method === sellPaymentRef.current) {
          next.sell_payment_method = getDefaultPayment(value);
          sellPaymentRef.current = next.sell_payment_method;
        }
      }
      if (field === "buy_delivery_period") {
        const oldDefault = getDefaultPayment(prev.buy_delivery_period);
        if (!prev.buy_payment_method || prev.buy_payment_method === oldDefault || prev.buy_payment_method === buyPaymentRef.current) {
          next.buy_payment_method = getDefaultPayment(value);
          buyPaymentRef.current = next.buy_payment_method;
        }
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!swap || !form) return;
    if (termsLockedByCo) {
      toast("请先处理完待处理商谈后再编辑", "error");
      return;
    }

    const sellResolved = resolveLegQty(form, "sell");
    if (sellResolved.error) {
      setMinQtyError(sellResolved.error);
      return;
    }
    const buyResolved = sellResolved;

    if (!form.sell_product_id || !form.buy_product_id ||
        !(Number(form.sell_price) > 0) || !(Number(form.buy_price) > 0) ||
        !form.sell_delivery_location || !form.buy_delivery_location) {
      return;
    }

    // 交割方式、付款方式、规格不能为空
    if (!form.sell_delivery_method || !form.sell_payment_method || !form.sell_specs ||
        !form.buy_delivery_method || !form.buy_payment_method || !form.buy_specs) {
      return;
    }

    // 商谈条款校验：选了可商谈但未选任何条款
    if (form.sell_allow_counter_offer && (!form.sell_negotiable_terms || form.sell_negotiable_terms.length === 0)) {
      return;
    }
    if (form.buy_allow_counter_offer && (!form.buy_negotiable_terms || form.buy_negotiable_terms.length === 0)) {
      return;
    }

    const sellFilledCheck = Math.floor(swap.sell_filled ?? 0);
    const buyFilledCheck = Math.floor(swap.buy_filled ?? 0);
    if (sellFilledCheck > 0 && sellResolved.quantity < sellFilledCheck) {
      setMinQtyError(`卖出数量不可低于已锁定量 ${sellFilledCheck} 吨`);
      return;
    }
    if (buyFilledCheck > 0 && buyResolved.quantity < buyFilledCheck) {
      setMinQtyError(`买入数量不可低于已锁定量 ${buyFilledCheck} 吨`);
      return;
    }
    setMinQtyError("");

    // 免仓天数校验
    const validateFreeStorageDays = (daysStr: string, enabled: boolean, label: string): string | null => {
      if (!enabled) return null;
      if (!daysStr) return `${label}免仓天数不能为空`;
      const num = Number(daysStr);
      if (isNaN(num) || num <= 0 || !Number.isInteger(num)) {
        return `${label}免仓天数必须为大于0的整数`;
      }
      return null;
    };
    const sellFreeStorageError = validateFreeStorageDays(form.sell_free_storage_days, form.sell_free_storage_enabled, "卖出");
    const buyFreeStorageError = validateFreeStorageDays(form.buy_free_storage_days, form.buy_free_storage_enabled, "买入");
    if (sellFreeStorageError || buyFreeStorageError) {
      setMinQtyError(sellFreeStorageError || buyFreeStorageError || "");
      return;
    }
    setMinQtyError("");

    // 安全性检查：防止 XSS 注入
    const allTextFields = [
      form.sell_delivery_period, form.sell_delivery_location, form.sell_payment_method,
      form.sell_delivery_method, form.sell_specs,
      form.buy_delivery_period, form.buy_delivery_location, form.buy_payment_method,
      form.buy_delivery_method, form.buy_specs,
    ];
    if (allTextFields.some((f) => !isSafeInput(f))) return;

    if (swapFormUnchanged(swap, form)) {
      toast("信息未修改，无需保存", "info");
      return;
    }

    // 有待拼锁定的一侧沿用原条款，只提交未锁侧变更（与后端 pin 一致）
    const orig = swapToForm(swap);
    const submitForm: EditSwapFormData = { ...form };
    if (sellLockQty > 0) {
      Object.assign(submitForm, {
        sell_product_id: orig.sell_product_id,
        sell_price: orig.sell_price,
        sell_delivery_period: orig.sell_delivery_period,
        sell_delivery_location: orig.sell_delivery_location,
        sell_payment_method: orig.sell_payment_method,
        sell_delivery_method: orig.sell_delivery_method,
        sell_free_storage_enabled: orig.sell_free_storage_enabled,
        sell_free_storage_days: orig.sell_free_storage_days,
        sell_specs: orig.sell_specs,
        sell_allow_partial: orig.sell_allow_partial,
        sell_min_quantity: orig.sell_min_quantity,
        sell_per_share: orig.sell_per_share,
        sell_allow_counter_offer: orig.sell_allow_counter_offer,
        sell_negotiable_terms: orig.sell_negotiable_terms,
      });
    }
    if (buyLockQty > 0) {
      Object.assign(submitForm, {
        buy_product_id: orig.buy_product_id,
        buy_price: orig.buy_price,
        buy_delivery_period: orig.buy_delivery_period,
        buy_delivery_location: orig.buy_delivery_location,
        buy_payment_method: orig.buy_payment_method,
        buy_delivery_method: orig.buy_delivery_method,
        buy_free_storage_enabled: orig.buy_free_storage_enabled,
        buy_free_storage_days: orig.buy_free_storage_days,
        buy_specs: orig.buy_specs,
        buy_allow_partial: orig.buy_allow_partial,
        buy_min_quantity: orig.buy_min_quantity,
        buy_per_share: orig.buy_per_share,
        buy_allow_counter_offer: orig.buy_allow_counter_offer,
        buy_negotiable_terms: orig.buy_negotiable_terms,
      });
    }

    // 数量始终买卖一致（锁定条款时也同步数量字段）
    submitForm.buy_quantity = submitForm.sell_quantity;
    submitForm.buy_per_share = submitForm.sell_per_share;
    submitForm.buy_share_count = submitForm.sell_share_count;
    submitForm.buy_allow_partial = submitForm.sell_allow_partial;
    submitForm.buy_min_quantity = submitForm.sell_min_quantity;

    const sellSubmit = resolveLegQty(submitForm, "sell");
    if (sellSubmit.error) {
      setMinQtyError(sellSubmit.error);
      return;
    }
    if (sellSubmit.quantity < lockedMinQty) {
      setMinQtyError(`数量不可低于已占用 ${lockedMinQty} 吨`);
      return;
    }
    const buySubmit = sellSubmit;

    const productName = (id: string) =>
      products.find((p) => p.id === id)?.name ?? id;
    const changes = describeSwapFormChanges(swap, submitForm, productName);
    if (changes.length === 0) {
      toast("信息未修改，无需保存", "info");
      return;
    }
    const ok = await confirmDialog({
      title: "确认保存编辑",
      message: "确认保存换盘修改？",
      changes,
      changesIntro: "确认保存换盘修改？下方高亮为本次变更：",
      changesOutro: "保存后盘面将按新条款展示，请核对后再确认。",
      variant: "warning",
      icon: "warning",
      confirmText: "确认保存",
      cancelText: "再想想",
      wide: true,
    });
    if (!ok) return;

    onSubmit(swap.id, {
      sell_product_id: submitForm.sell_product_id,
      sell_price: Number(submitForm.sell_price),
      sell_quantity: sellSubmit.quantity,
      sell_delivery_period: submitForm.sell_delivery_period || undefined,
      sell_delivery_location: submitForm.sell_delivery_location || undefined,
      sell_payment_method: submitForm.sell_payment_method || undefined,
      sell_delivery_method: submitForm.sell_delivery_method || undefined,
      sell_free_storage_enabled: submitForm.sell_free_storage_enabled,
      sell_free_storage_days: submitForm.sell_free_storage_enabled && submitForm.sell_free_storage_days ? Number(submitForm.sell_free_storage_days) : undefined,
      sell_specs: submitForm.sell_specs || undefined,
      buy_product_id: submitForm.buy_product_id,
      buy_price: Number(submitForm.buy_price),
      buy_quantity: buySubmit.quantity,
      buy_delivery_period: submitForm.buy_delivery_period || undefined,
      buy_delivery_location: submitForm.buy_delivery_location || undefined,
      buy_payment_method: submitForm.buy_payment_method || undefined,
      buy_delivery_method: submitForm.buy_delivery_method || undefined,
      buy_free_storage_enabled: submitForm.buy_free_storage_enabled,
      buy_free_storage_days: submitForm.buy_free_storage_enabled && submitForm.buy_free_storage_days ? Number(submitForm.buy_free_storage_days) : undefined,
      buy_specs: submitForm.buy_specs || undefined,
      sell_allow_partial: sellSubmit.allow_partial,
      sell_min_quantity: sellSubmit.min_quantity,
      buy_allow_partial: buySubmit.allow_partial,
      buy_min_quantity: buySubmit.min_quantity,
      sell_allow_counter_offer: submitForm.sell_allow_counter_offer,
      sell_negotiable_terms: submitForm.sell_allow_counter_offer ? submitForm.sell_negotiable_terms : [],
      buy_allow_counter_offer: submitForm.buy_allow_counter_offer,
      buy_negotiable_terms: submitForm.buy_allow_counter_offer ? submitForm.buy_negotiable_terms : [],
      allow_single_side: submitForm.allow_single_side,
      single_side_mode: submitForm.allow_single_side ? "both" : "none",
      starts_at: submitForm.starts_at !== undefined
        ? (submitForm.starts_at ? new Date(submitForm.starts_at).toISOString() : "")
        : undefined,
      expires_at: submitForm.expires_at ? new Date(submitForm.expires_at).toISOString() : undefined,
    });
  };

  // 实时校验哪些字段缺失
  const missingFields: string[] = [];
  if (!form.sell_product_id) missingFields.push("卖出品种");
  if (!(Number(form.sell_price) > 0)) missingFields.push("卖出报价");
  if (sharedResolvedPreview.error) missingFields.push(`换盘数量（${sharedResolvedPreview.error}）`);
  if (!form.sell_delivery_location) missingFields.push("卖出交割地点");
  if (!form.buy_product_id) missingFields.push("换入品种");
  if (!(Number(form.buy_price) > 0)) missingFields.push("换入期望价");
  if (!form.buy_delivery_location) missingFields.push("换入交割地点");
  // 交割方式、付款方式、规格不能为空
  if (!form.sell_delivery_method) missingFields.push("卖出交割方式");
  if (!form.sell_payment_method) missingFields.push("卖出付款方式");
  if (!form.sell_specs) missingFields.push("卖出规格");
  if (!form.buy_delivery_method) missingFields.push("换入交割方式");
  if (!form.buy_payment_method) missingFields.push("换入付款方式");
  if (!form.buy_specs) missingFields.push("换入规格");
  // 商谈条款校验
  if (form.sell_allow_counter_offer && (!form.sell_negotiable_terms || form.sell_negotiable_terms.length === 0)) {
    missingFields.push("卖出商谈条款（至少选一项）");
  }
  if (form.buy_allow_counter_offer && (!form.buy_negotiable_terms || form.buy_negotiable_terms.length === 0)) {
    missingFields.push("换入商谈条款（至少选一项）");
  }
  if (!isWorkdayDateTimeLocal(form.starts_at, true)) {
    missingFields.push("开始时间（须为工作日；休市日不可立即挂盘）");
  }
  if (!isWorkdayDateTimeLocal(form.expires_at)) {
    missingFields.push("过期时间（须为工作日）");
  }

  const isValid = missingFields.length === 0;

  // 已锁定量（含待拼锁定占用 + 已成交：数量不可低于此值）
  const sellFilled = swap?.sell_filled ?? 0;
  const buyFilled = swap?.buy_filled ?? 0;
  const lockedMinQty = Math.max(Math.floor(sellFilled), Math.floor(buyFilled));
  const isLocked = lockedMinQty > 0 && swap?.status !== "MATCHED";
  const isFinalMatched = swap?.status === "MATCHED";
  const hasFills = lockedMinQty > 0;
  // 仅冻结「有待拼锁定」的那一侧；另一侧仍可改。有待处理商谈时整盘先处理商谈。
  const sellTermsFrozen = termsLockedByCo || sellLockQty > 0;
  const buyTermsFrozen = termsLockedByCo || buyLockQty > 0;
  const editBlocked = termsLockedByCo;
  const qtyLocked = isFinalMatched || editBlocked;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-t-panel rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[92vh] overflow-y-auto">
        {/* 标题栏 sticky */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-t-border bg-t-panel backdrop-blur-md">
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
            <div>
              <h2 className="text-lg font-bold text-t-text">编辑换盘</h2>
              <p className="text-xs text-t-text-3 mt-0.5">
                {isFinalMatched
                  ? "换盘已全部成交，不可再编辑数量"
                  : isLocked
                    ? "单边锁定后需等待第三方拼盘；数量不可低于已锁定量"
                    : "修改换盘信息"}
                {hasFills && (
                  <span className="ml-2 text-amber-500">
                    （已锁定：卖 {Math.floor(sellFilled)} 吨 / 买 {Math.floor(buyFilled)} 吨，下限 {lockedMinQty} 吨）
                  </span>
                )}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-t-text-3 hover:text-t-text text-xl p-1">✕</button>
        </div>

        <ModalUpdateNotice show={dataUpdated} variant="updated" message={updateMessage} onDismiss={onDismissUpdate} />

        {termsLockedByCo && (
          <div className="mx-6 mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-400">
            该换盘已有 {pendingCoCount} 笔待处理商谈。请先在「商谈管理」处理完后再修改条款（含可议范围）。
          </div>
        )}

        {/* 待拼锁定提示 */}
        {(isLocked || hasActiveLocks) && !termsLockedByCo && (
          <div className="mx-6 mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-400 leading-relaxed">
            {hasActiveLocks ? (
              <>
                {sellLockQty > 0 && buyLockQty > 0 ? (
                  <>卖出、买入两侧均有待拼锁定（卖出 {Math.floor(sellLockQty)} 吨 / 买入 {Math.floor(buyLockQty)} 吨），两侧价格与交割等条款暂不可改。</>
                ) : sellLockQty > 0 ? (
                  <>卖出侧有待拼锁定 {Math.floor(sellLockQty)} 吨，卖出侧价格与交割等条款暂不可改；买入侧仍可修改。</>
                ) : (
                  <>买入侧有待拼锁定 {Math.floor(buyLockQty)} 吨，买入侧价格与交割等条款暂不可改；卖出侧仍可修改。</>
                )}
                {" "}数量不可低于已占用 {lockedMinQty} 吨。对方取消锁定后，未锁余量可按新条款执行。
              </>
            ) : (
              <>数量不可低于已占用 {lockedMinQty} 吨（卖 {Math.floor(sellFilled)} / 买 {Math.floor(buyFilled)}）。</>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className={`p-6 space-y-4 ${editBlocked ? "pointer-events-none opacity-60" : ""}`}>
          {/* 买卖共用数量：两侧保持一致 */}
          <div className={`p-3 rounded-xl border border-t-border bg-t-hover space-y-2 ${qtyLocked ? "pointer-events-none opacity-60" : ""}`}>
            <div className="text-xs text-t-text-3">
              换盘买卖数量保持一致（整单或按份数对两侧同时生效）
            </div>
            <QtyModeFields
              mode={sellMode}
              quantity={form.sell_quantity}
              perShare={form.sell_per_share}
              shareCount={form.sell_share_count}
              onModeChange={setSharedMode}
              onQuantityChange={(v) => patchSharedQty({ quantity: v })}
              onPerShareChange={(v) => patchSharedQty({ perShare: v })}
              onShareCountChange={(v) => patchSharedQty({ shareCount: v })}
              error={
                sharedResolvedPreview.error ||
                minQtyError ||
                (lockedMinQty > 0 &&
                !sharedResolvedPreview.error &&
                sharedResolvedPreview.quantity < lockedMinQty
                  ? `不可低于已占用 ${lockedMinQty} 吨`
                  : undefined)
              }
            />
          </div>

          {/* 两栏对比布局 */}
          <div className="grid grid-cols-2 gap-4">
            {/* 左：卖出（绿色） */}
            <div className={`bg-green-50 rounded-xl p-4 border border-green-100 dark:bg-green-500/10 dark:border-green-500/30 ${sellTermsFrozen && !editBlocked ? "ring-1 ring-amber-400/50" : ""}`}>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-5 h-5 rounded-full bg-green-500 text-white text-[10px] flex items-center justify-center font-bold">卖</span>
                <span className="text-sm font-semibold text-green-700 dark:text-green-400">我要卖出</span>
                {sellLockQty > 0 && !editBlocked && (
                  <span className="text-[10px] text-amber-600">卖出条款已锁定</span>
                )}
                {buyLockQty > 0 && sellLockQty <= 0 && !editBlocked && (
                  <span className="text-[10px] text-green-600 dark:text-green-400">仍可修改</span>
                )}
              </div>

              <div className="space-y-2.5">
                <div className={`space-y-2.5 ${sellTermsFrozen && !editBlocked ? "pointer-events-none opacity-60" : ""}`}>
                <div>
                  <label className="block text-xs text-t-text-3 mb-1">品种</label>
                  <select
                    value={form.sell_product_id}
                    onChange={(e) => update("sell_product_id", e.target.value)}
                    className={`w-full px-2.5 py-2 border rounded-lg text-sm bg-t-panel text-t-text focus:ring-2 focus:ring-green-400 outline-none ${!form.sell_product_id ? "border-red-500" : "border-t-border"}`}
                  >
                    <option value="">请选择</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({getProductSymbol(p)})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-t-text-3 mb-1">报价(元/吨)</label>
                  <input
                    type="number"
                    value={form.sell_price}
                    onChange={(e) => update("sell_price", e.target.value)}
                    placeholder="5200"
                    className={`w-full px-2.5 py-2 border rounded-lg text-sm bg-t-panel text-t-text focus:ring-2 focus:ring-green-400 outline-none ${!(Number(form.sell_price) > 0) ? "border-red-500" : "border-t-border"}`}
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-500 mb-1">交割期</label>
                  <DeliveryPeriodPicker
                    value={form.sell_delivery_period}
                    onChange={(v) => update("sell_delivery_period", v)}
                  />
                </div>

                <div>
                  <label className="block text-xs text-t-text-3 mb-1">交割地点 *</label>
                  <Combobox
                    value={form.sell_delivery_location}
                    onChange={(v) => update("sell_delivery_location", v)}
                    options={mergeSelectOptions(DELIVERY_LOCATION_OPTIONS, form.sell_delivery_location)}
                    placeholder="选择或输入交割地点"
                    ringColor="focus:ring-green-400"
                    error={!form.sell_delivery_location}
                  />
                </div>

                <div>
                  <label className="block text-xs text-t-text-3 mb-1">付款方式</label>
                  <Combobox
                    value={form.sell_payment_method}
                    onChange={(v) => update("sell_payment_method", v)}
                    options={PAYMENT_METHOD_OPTIONS}
                    placeholder="选择或输入"
                    ringColor="focus:ring-green-400"
                    error={!form.sell_payment_method}
                  />
                </div>

                <div>
                  <label className="block text-xs text-t-text-3 mb-1">交割方式</label>
                  <Combobox
                    value={form.sell_delivery_method}
                    onChange={(v) => update("sell_delivery_method", v)}
                    options={DELIVERY_METHOD_OPTIONS}
                    placeholder="选择或输入"
                    ringColor="focus:ring-green-400"
                    error={!form.sell_delivery_method}
                  />
                </div>

                <FreeStorageField
                  enabled={form.sell_free_storage_enabled}
                  days={form.sell_free_storage_days}
                  onEnabledChange={(v) => setForm((prev) => prev ? ({ ...prev, sell_free_storage_enabled: v }) : prev)}
                  onDaysChange={(v) => update("sell_free_storage_days", v)}
                  ringColor="focus:ring-green-400"
                />

                <div>
                  <label className="block text-xs text-t-text-3 mb-1">规格</label>
                  <Combobox
                    value={form.sell_specs}
                    onChange={(v) => update("sell_specs", v)}
                    options={mergeSelectOptions(SPECS_OPTIONS, form.sell_specs)}
                    placeholder="选择或输入规格"
                    ringColor="focus:ring-green-400"
                    error={!form.sell_specs}
                  />
                </div>
                </div>
              </div>
            </div>

            {/* 右：换入（红色） */}
            <div className={`bg-red-50 rounded-xl p-4 border border-red-100 dark:bg-red-500/10 dark:border-red-500/30 ${buyTermsFrozen && !editBlocked ? "ring-1 ring-amber-400/50" : ""}`}>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-5 h-5 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold">买</span>
                <span className="text-sm font-semibold text-red-700 dark:text-red-400">我要换入</span>
                {buyLockQty > 0 && !editBlocked && (
                  <span className="text-[10px] text-amber-600">买入条款已锁定</span>
                )}
                {sellLockQty > 0 && buyLockQty <= 0 && !editBlocked && (
                  <span className="text-[10px] text-red-600 dark:text-red-400">仍可修改</span>
                )}
              </div>

              <div className="space-y-2.5">
                <div className={`space-y-2.5 ${buyTermsFrozen && !editBlocked ? "pointer-events-none opacity-60" : ""}`}>
                <div>
                  <label className="block text-xs text-t-text-3 mb-1">品种</label>
                  <select
                    value={form.buy_product_id}
                    onChange={(e) => update("buy_product_id", e.target.value)}
                    className={`w-full px-2.5 py-2 border rounded-lg text-sm bg-t-panel text-t-text focus:ring-2 focus:ring-red-400 outline-none ${!form.buy_product_id ? "border-red-500" : "border-t-border"}`}
                  >
                    <option value="">请选择</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({getProductSymbol(p)})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-t-text-3 mb-1">期望价(元/吨)</label>
                  <input
                    type="number"
                    value={form.buy_price}
                    onChange={(e) => update("buy_price", e.target.value)}
                    placeholder="5300"
                    className={`w-full px-2.5 py-2 border rounded-lg text-sm bg-t-panel text-t-text focus:ring-2 focus:ring-red-400 outline-none ${!(Number(form.buy_price) > 0) ? "border-red-500" : "border-t-border"}`}
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-500 mb-1">交割期</label>
                  <DeliveryPeriodPicker
                    value={form.buy_delivery_period}
                    onChange={(v) => update("buy_delivery_period", v)}
                  />
                </div>

                <div>
                  <label className="block text-xs text-t-text-3 mb-1">交割地点 *</label>
                  <Combobox
                    value={form.buy_delivery_location}
                    onChange={(v) => update("buy_delivery_location", v)}
                    options={mergeSelectOptions(DELIVERY_LOCATION_OPTIONS, form.buy_delivery_location)}
                    placeholder="选择或输入交割地点"
                    ringColor="focus:ring-red-400"
                    error={!form.buy_delivery_location}
                  />
                </div>

                <div>
                  <label className="block text-xs text-t-text-3 mb-1">付款方式</label>
                  <Combobox
                    value={form.buy_payment_method}
                    onChange={(v) => update("buy_payment_method", v)}
                    options={PAYMENT_METHOD_OPTIONS}
                    placeholder="选择或输入"
                    ringColor="focus:ring-red-400"
                    error={!form.buy_payment_method}
                  />
                </div>

                <div>
                  <label className="block text-xs text-t-text-3 mb-1">交割方式</label>
                  <Combobox
                    value={form.buy_delivery_method}
                    onChange={(v) => update("buy_delivery_method", v)}
                    options={DELIVERY_METHOD_OPTIONS}
                    placeholder="选择或输入"
                    ringColor="focus:ring-red-400"
                    error={!form.buy_delivery_method}
                  />
                </div>

                <FreeStorageField
                  enabled={form.buy_free_storage_enabled}
                  days={form.buy_free_storage_days}
                  onEnabledChange={(v) => setForm((prev) => prev ? ({ ...prev, buy_free_storage_enabled: v }) : prev)}
                  onDaysChange={(v) => update("buy_free_storage_days", v)}
                  ringColor="focus:ring-red-400"
                />

                <div>
                  <label className="block text-xs text-t-text-3 mb-1">规格</label>
                  <Combobox
                    value={form.buy_specs}
                    onChange={(v) => update("buy_specs", v)}
                    options={mergeSelectOptions(SPECS_OPTIONS, form.buy_specs)}
                    placeholder="选择或输入规格"
                    ringColor="focus:ring-red-400"
                    error={!form.buy_specs}
                  />
                </div>
                </div>
              </div>
            </div>
          </div>

          {minQtyError && (
            <p className="mt-3 text-[10px] text-red-500 px-1">{minQtyError}</p>
          )}

          {/* 商谈设置 — 卖出/买入各自独立 */}
          <div className="mt-3 grid grid-cols-2 gap-3">
            {/* 卖出商谈 */}
            <div className={`px-3 py-2.5 bg-t-hover rounded-lg border border-t-border ${sellTermsFrozen && !editBlocked ? "pointer-events-none opacity-60" : ""}`}>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.sell_allow_counter_offer}
                  onChange={(e) => setForm((prev) => prev ? ({ ...prev, sell_allow_counter_offer: e.target.checked }) : prev)}
                  className="w-3.5 h-3.5 text-brand-600 rounded focus:ring-brand-500"
                />
                <span className="text-xs font-medium text-trade-down">卖出可商谈</span>
              </label>
              {form.sell_allow_counter_offer && (
                <div className="pl-6 pt-2">
                  <div className="flex items-center justify-end gap-1.5 mb-1 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setForm((prev) => prev ? ({ ...prev, sell_negotiable_terms: NEGOTIABLE_TERMS.map((t) => t.key) }) : prev)}
                      className="text-[10px] text-brand-500 hover:text-brand-600 transition-colors"
                    >
                      全选
                    </button>
                    <span className="text-[10px] text-t-text-3">|</span>
                    <button
                      type="button"
                      onClick={() => setForm((prev) => prev ? ({ ...prev, sell_negotiable_terms: [] }) : prev)}
                      className="text-[10px] text-t-text-3 hover:text-t-text transition-colors"
                    >
                      全取消
                    </button>
                  </div>
                  <div className="text-[10px] text-t-text-3 mb-1">可商谈条款</div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                    {NEGOTIABLE_TERMS.map((t) => (
                      <label key={t.key} className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.sell_negotiable_terms.includes(t.key)}
                          onChange={(e) => {
                            setForm((prev) => {
                              if (!prev) return prev;
                              const set = new Set(prev.sell_negotiable_terms);
                              if (e.target.checked) set.add(t.key);
                              else set.delete(t.key);
                              return { ...prev, sell_negotiable_terms: Array.from(set) };
                            });
                          }}
                          className="w-3 h-3 text-brand-600 rounded focus:ring-brand-500"
                        />
                        <span className="text-[10px] text-t-text-2">{t.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {/* 买入商谈 */}
            <div className={`px-3 py-2.5 bg-t-hover rounded-lg border border-t-border ${buyTermsFrozen && !editBlocked ? "pointer-events-none opacity-60" : ""}`}>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.buy_allow_counter_offer}
                  onChange={(e) => setForm((prev) => prev ? ({ ...prev, buy_allow_counter_offer: e.target.checked }) : prev)}
                  className="w-3.5 h-3.5 text-brand-600 rounded focus:ring-brand-500"
                />
                <span className="text-xs font-medium text-trade-up">买入可商谈</span>
              </label>
              {form.buy_allow_counter_offer && (
                <div className="pl-6 pt-2">
                  <div className="flex items-center justify-end gap-1.5 mb-1 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setForm((prev) => prev ? ({ ...prev, buy_negotiable_terms: NEGOTIABLE_TERMS.map((t) => t.key) }) : prev)}
                      className="text-[10px] text-brand-500 hover:text-brand-600 transition-colors"
                    >
                      全选
                    </button>
                    <span className="text-[10px] text-t-text-3">|</span>
                    <button
                      type="button"
                      onClick={() => setForm((prev) => prev ? ({ ...prev, buy_negotiable_terms: [] }) : prev)}
                      className="text-[10px] text-t-text-3 hover:text-t-text transition-colors"
                    >
                      全取消
                    </button>
                  </div>
                  <div className="text-[10px] text-t-text-3 mb-1">可商谈条款</div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                    {NEGOTIABLE_TERMS.map((t) => (
                      <label key={t.key} className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.buy_negotiable_terms.includes(t.key)}
                          onChange={(e) => {
                            setForm((prev) => {
                              if (!prev) return prev;
                              const set = new Set(prev.buy_negotiable_terms);
                              if (e.target.checked) set.add(t.key);
                              else set.delete(t.key);
                              return { ...prev, buy_negotiable_terms: Array.from(set) };
                            });
                          }}
                          className="w-3 h-3 text-brand-600 rounded focus:ring-brand-500"
                        />
                        <span className="text-[10px] text-t-text-2">{t.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 单边交易设置 */}
          <div className="mt-3 px-3 py-2.5 bg-t-hover rounded-lg border border-t-border">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.allow_single_side}
                  onChange={(e) => setForm((prev) => prev ? ({ ...prev, allow_single_side: e.target.checked }) : prev)}
                  className="w-3.5 h-3.5 text-brand-600 rounded focus:ring-brand-500"
                />
                <Tooltip content="开启后，对手方可以只与你做单边（单买你的卖盘 或 单卖你的买盘）；关闭则对方只能与你整体互换。">
                  <span className="text-xs font-medium text-t-text cursor-help">允许单边交易</span>
                </Tooltip>
              </label>
            </div>
            {!form.allow_single_side && (
              <div className="pl-6 pt-1 text-[10px] text-t-text-3">仅支持双边互换（对方只能整体互换）</div>
            )}
          </div>

          {/* 价差提示 */}
          {Number(form.sell_price) > 0 && Number(form.buy_price) > 0 && (
            <div className="mt-3 px-4 py-2 bg-t-hover rounded-lg border border-t-border text-xs text-t-text-2 flex items-center justify-between">
              <span>价差</span>
              <span className={`font-mono font-semibold ${Number(form.buy_price) - Number(form.sell_price) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                {Number(form.buy_price) > 0 ? `${(Number(form.buy_price) - Number(form.sell_price)).toFixed(1)} 元/吨` : "-"}
              </span>
            </div>
          )}


          {/* 开始时间 */}
          <div className="mt-3">
            <label className="block text-sm font-medium text-t-text-2 mb-1.5">
              开始时间
              <span className="ml-2 text-xs font-normal text-t-text-3">仅工作日；空=立即发布</span>
            </label>
            <WorkdayDateTimePicker
              value={form.starts_at}
              onChange={(v) => setForm((prev) => (prev ? { ...prev, starts_at: v } : prev))}
              allowEmpty
              emptyLabel="立即发布"
              placeholder="选择开始时间"
              accent="sky"
              defaultTime="09:00"
              disabled={editBlocked}
            />
            <div className="mt-1.5 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={editBlocked}
                onClick={() => setForm((prev) => (prev ? { ...prev, starts_at: defaultStartsAtLocal() } : prev))}
                className="text-xs px-2 py-1 rounded border border-sky-400/50 text-sky-800 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/40 disabled:opacity-40"
              >
                立即发布
              </button>
              <button
                type="button"
                disabled={editBlocked}
                onClick={() => setForm((prev) => (prev ? { ...prev, starts_at: nextWorkdayMorningLocal() } : prev))}
                className="text-xs px-2 py-1 rounded border border-t-border text-t-text-2 hover:bg-t-hover disabled:opacity-40"
              >
                下一工作日9:00
              </button>
            </div>
          </div>

          {/* 过期时间 */}
          <div className="mt-3">
            <label className="block text-sm font-medium text-t-text-2 mb-1.5">
              过期时间
              <span className="ml-2 text-xs font-normal text-t-text-3">仅工作日</span>
            </label>
            <WorkdayDateTimePicker
              value={form.expires_at}
              onChange={(v) => setForm((prev) => (prev ? { ...prev, expires_at: v } : prev))}
              placeholder="选择过期时间"
              accent="amber"
              defaultTime="18:00"
              disabled={editBlocked}
            />
            <div className="mt-1.5 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={editBlocked}
                onClick={() => setForm((prev) => (prev ? { ...prev, expires_at: defaultExpiresAtLocal() } : prev))}
                className="text-xs px-2 py-1 rounded border border-amber-400/50 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-40"
              >
                默认18:00
              </button>
              <button
                type="button"
                disabled={editBlocked}
                onClick={() => setForm((prev) => (prev ? { ...prev, expires_at: nextWorkdayExpireLocal() } : prev))}
                className="text-xs px-2 py-1 rounded border border-t-border text-t-text-2 hover:bg-t-hover disabled:opacity-40"
              >
                下一工作日18:00
              </button>
              <button
                type="button"
                disabled={editBlocked}
                onClick={() => setForm((prev) => (prev ? { ...prev, expires_at: defaultExpiresAtLocal() } : prev))}
                className="text-xs px-2 py-1 rounded border border-t-border text-t-text-2 hover:bg-t-hover disabled:opacity-40"
              >
                恢复默认
              </button>
            </div>
          </div>

          {/* 提交 */}
          {!isValid && (
            <div className="mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-400">
              ⚠️ 还需填写：{missingFields.join("、")}
            </div>
          )}
          <button
            type="submit"
            disabled={loading || editBlocked}
            className={`w-full mt-4 py-3 rounded-xl text-white font-bold text-sm transition-opacity ${
              isValid && !editBlocked
                ? "bg-gradient-to-r from-green-500 to-red-500 hover:opacity-90"
                : "bg-gradient-to-r from-green-500 to-red-500 hover:opacity-90 opacity-80"
            } disabled:from-t-hover disabled:to-t-hover disabled:text-t-text-3 disabled:cursor-not-allowed`}
          >
            {loading ? "保存中..." : editBlocked ? "请先处理商谈" : "💾 保存修改"}
          </button>
        </form>
      </div>
    </div>
  );
}
