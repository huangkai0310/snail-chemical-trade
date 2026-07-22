"use client";

import { useState, useEffect, useRef, useSyncExternalStore } from "react";
import type { Product } from "@/lib/types";
import type { CreateSwapParams } from "@/lib/api";
import { getProductSymbol, PAYMENT_METHOD_OPTIONS, getDefaultPayment, NEGOTIABLE_TERMS, DEFAULT_NEGOTIABLE_TERMS } from "@/lib/types";
import { DELIVERY_METHOD_OPTIONS } from "./CreateListingModal";
import { Tooltip } from "./ui/Tooltip";
import { sanitizeText, isSafeInput } from "@/lib/validate";
import { DELIVERY_LOCATION_OPTIONS, SPECS_OPTIONS, mergeSelectOptions } from "@/lib/listing-options";
import { loadSwapPrev, saveSwapPrev, subscribePostingPrefs, getPostingPrefsCache } from "@/lib/posting-prev";
import {
  qtyModeFromPartial,
  resolveQtyForSubmit,
  computeSharesTotal,
  deriveShareFields,
  applySharedSwapQty,
  type QtyMode,
} from "@/lib/qty-mode";
import QtyModeFields from "./QtyModeFields";
import { toast } from "./Toast";
import { confirmDialog } from "./ConfirmDialog";
import { SwapConfirmSheet } from "./PostingConfirmSheet";
import { defaultExpiresAtLocal, defaultStartsAtLocal, toDatetimeLocalValue } from "@/lib/expires";

interface CreateSwapFormData {
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
  sell_allow_counter_offer: boolean; // 卖出是否接受商谈
  sell_negotiable_terms: string[];   // 卖出可议条款范围
  buy_allow_counter_offer: boolean;  // 买入是否接受商谈
  buy_negotiable_terms: string[];    // 买入可议条款范围
  // 单边交易设置
  allow_single_side: boolean;        // 是否允许单边交易
  single_side_mode: "both" | "single_buy" | "single_sell" | "none"; // 单边模式
  expires_at: string;
  starts_at: string;
}

function legQtyTotal(mode: QtyMode, quantity: string, perShare: string, shareCount: string): number {
  if (mode === "whole") return Math.floor(Number(quantity) || 0);
  return computeSharesTotal(perShare, shareCount);
}

function freeStorageDefaultDays(sellQty: number, buyQty: number): string {
  return Math.max(sellQty, buyQty) >= 100 ? "7" : "3";
}

interface Props {
  open: boolean;
  products: Product[];
  defaultProductId?: string;
  loading?: boolean;
  onClose: () => void;
  onSubmit: (data: CreateSwapParams) => void;
}

function buildDeliveryOptions(): string[] {
  const options: string[] = ["现货"];
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const startYear = now.getFullYear();
  const startMonth = now.getMonth();
  for (let offset = 0; offset <= 12; offset++) {
    const totalMonths = startMonth + offset;
    const year = startYear + Math.floor(totalMonths / 12);
    const month = totalMonths % 12;
    const yy = String(year).slice(-2);
    const mm = String(month + 1).padStart(2, "0");
    const prefix = `${yy}${mm}`;
    if (new Date(year, month, 15) >= now) options.push(`${prefix}中`);
    if (new Date(year, month, 28) >= now) options.push(`${prefix}下`);
  }
  return options;
}

/** 自定义 Combobox：可输入 + 可选择，下拉面板宽度与输入框一致 */
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

function DeliverySelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 border border-t-border rounded-lg text-sm text-left bg-t-panel text-t-text flex items-center justify-between focus:ring-2 focus:ring-brand-400 outline-none"
      >
        <span className={value ? "text-t-text" : "text-t-text-3"}>
          {value || "选择交割期"}
        </span>
        <svg
          className={`w-4 h-4 text-t-text-3 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 mt-1 w-full bg-t-panel border border-t-border rounded-lg shadow-lg max-h-44 overflow-y-auto">
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => { onChange(opt); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-brand-600/10 transition-colors ${
                  value === opt ? "bg-brand-600/10 text-brand-500 font-medium" : "text-t-text"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </>
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

const emptyForm = (defaultProductId = ""): CreateSwapFormData => ({
  sell_product_id: defaultProductId,
  sell_price: "",
  sell_quantity: "",
  sell_per_share: "",
  sell_share_count: "",
  sell_delivery_period: "现货",
  sell_delivery_location: "",
  sell_payment_method: "",
  sell_delivery_method: "",
  sell_free_storage_enabled: true,
  sell_free_storage_days: "3",
  sell_specs: "",
  buy_product_id: defaultProductId,
  buy_price: "",
  buy_quantity: "",
  buy_per_share: "",
  buy_share_count: "",
  buy_delivery_period: "现货",
  buy_delivery_location: "",
  buy_payment_method: "",
  buy_delivery_method: "",
  buy_free_storage_enabled: true,
  buy_free_storage_days: "3",
  buy_specs: "",
  sell_allow_partial: false,
  sell_min_quantity: "",
  buy_allow_partial: false,
  buy_min_quantity: "",
  sell_allow_counter_offer: false,
  sell_negotiable_terms: [],
  buy_allow_counter_offer: false,
  buy_negotiable_terms: [],
  allow_single_side: true,
  single_side_mode: "both",
  expires_at: defaultExpiresAtLocal(),
  starts_at: defaultStartsAtLocal(),
});

export default function CreateSwapModal({
  open,
  products,
  defaultProductId,
  loading,
  onClose,
  onSubmit,
}: Props) {
  const [form, setForm] = useState<CreateSwapFormData>(emptyForm(defaultProductId));
  const [minQtyError, setMinQtyError] = useState("");
  const deliveryOptions = buildDeliveryOptions();
  const sellPaymentRef = useRef("");
  const buyPaymentRef = useRef("");
  // 必须在任何 early return 之前订阅，避免 Hooks 数量变化导致崩溃
  useSyncExternalStore(subscribePostingPrefs, getPostingPrefsCache, getPostingPrefsCache);

  // 每次弹窗打开时重置表单
  useEffect(() => {
    if (open) {
      setForm(emptyForm(defaultProductId || ""));
      setMinQtyError("");
    }
  }, [open, defaultProductId]);

  if (!open) return null;

  const sellMode = qtyModeFromPartial(form.sell_allow_partial);
  const sharedResolvedPreview = resolveQtyForSubmit(
    sellMode,
    form.sell_quantity,
    form.sell_per_share,
    form.sell_share_count,
  );

  const applyFreeStorageDefaults = (next: CreateSwapFormData): CreateSwapFormData => {
    const qty = legQtyTotal(
      qtyModeFromPartial(next.sell_allow_partial),
      next.sell_quantity,
      next.sell_per_share,
      next.sell_share_count,
    );
    const defaultDays = freeStorageDefaultDays(qty, qty);
    return {
      ...next,
      sell_free_storage_days: defaultDays,
      buy_free_storage_days: defaultDays,
    };
  };

  const setSharedMode = (mode: QtyMode) => {
    setForm((prev) => applyFreeStorageDefaults(applySharedSwapQty(prev, { mode })));
    setMinQtyError("");
  };

  const patchSharedQty = (patch: { quantity?: string; perShare?: string; shareCount?: string }) => {
    setForm((prev) => applyFreeStorageDefaults(applySharedSwapQty(prev, patch)));
    setMinQtyError("");
  };

  const update = (field: keyof CreateSwapFormData, value: string) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      // 卖出交割期变更时，自动设置卖出付款方式默认值
      if (field === "sell_delivery_period") {
        const oldDefault = getDefaultPayment(prev.sell_delivery_period);
        if (!prev.sell_payment_method || prev.sell_payment_method === oldDefault || prev.sell_payment_method === sellPaymentRef.current) {
          next.sell_payment_method = getDefaultPayment(value);
          sellPaymentRef.current = next.sell_payment_method;
        }
      }
      // 买入交割期变更时，自动设置买入付款方式默认值
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

    const sellResolved = resolveQtyForSubmit(
      sellMode,
      form.sell_quantity,
      form.sell_per_share,
      form.sell_share_count,
    );
    if (sellResolved.error) {
      setMinQtyError(sellResolved.error);
      return;
    }
    // 买卖数量强制一致
    const buyResolved = sellResolved;

    // 基础字段校验（防止无效提交）
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

    const freeDaysDefault = Math.max(sellResolved.quantity, buyResolved.quantity) >= 100 ? 7 : 3;

    const sellProduct = products.find((p) => p.id === form.sell_product_id);
    const buyProduct = products.find((p) => p.id === form.buy_product_id);
    const scheduled = !!form.starts_at.trim();
    const ok = await confirmDialog({
      title: scheduled ? "换盘确认单 · 预约发布" : "换盘确认单 · 立即发布",
      message: "请核对换盘确认单",
      content: (
        <SwapConfirmSheet
          sellProductName={sellProduct?.name || form.sell_product_id}
          buyProductName={buyProduct?.name || form.buy_product_id}
          sellPrice={Number(form.sell_price)}
          buyPrice={Number(form.buy_price)}
          quantity={sellResolved.quantity}
          allowPartial={sellResolved.allow_partial}
          minQuantity={sellResolved.min_quantity}
          sellDeliveryPeriod={form.sell_delivery_period}
          buyDeliveryPeriod={form.buy_delivery_period}
          sellDeliveryLocation={form.sell_delivery_location}
          buyDeliveryLocation={form.buy_delivery_location}
          sellDeliveryMethod={form.sell_delivery_method}
          buyDeliveryMethod={form.buy_delivery_method}
          sellPaymentMethod={form.sell_payment_method}
          buyPaymentMethod={form.buy_payment_method}
          sellSpecs={form.sell_specs}
          buySpecs={form.buy_specs}
          sellFreeStorageEnabled={form.sell_free_storage_enabled}
          buyFreeStorageEnabled={form.buy_free_storage_enabled}
          sellFreeStorageDays={
            form.sell_free_storage_enabled
              ? form.sell_free_storage_days || freeDaysDefault
              : undefined
          }
          buyFreeStorageDays={
            form.buy_free_storage_enabled
              ? form.buy_free_storage_days || freeDaysDefault
              : undefined
          }
          sellAllowCounterOffer={form.sell_allow_counter_offer}
          buyAllowCounterOffer={form.buy_allow_counter_offer}
          sellNegotiableTerms={form.sell_negotiable_terms}
          buyNegotiableTerms={form.buy_negotiable_terms}
          allowSingleSide={form.allow_single_side}
          startsAt={form.starts_at}
          expiresAt={form.expires_at}
          scheduled={scheduled}
        />
      ),
      variant: "warning",
      icon: "warning",
      confirmText: scheduled ? "确认预约" : "确认发布",
      cancelText: "再想想",
      wide: true,
    });
    if (!ok) return;

    void saveSwapPrev(
      form.sell_product_id,
      form.sell_delivery_period,
      form.buy_product_id,
      form.buy_delivery_period,
      form,
    );

    onSubmit({
      sell_product_id: form.sell_product_id,
      sell_price: Number(form.sell_price),
      sell_quantity: sellResolved.quantity,
      sell_delivery_period: form.sell_delivery_period || undefined,
      sell_delivery_location: form.sell_delivery_location || undefined,
      sell_payment_method: form.sell_payment_method || undefined,
      sell_delivery_method: form.sell_delivery_method || undefined,
      sell_free_storage_enabled: form.sell_free_storage_enabled,
      sell_free_storage_days: form.sell_free_storage_enabled
        ? (form.sell_free_storage_days ? Number(form.sell_free_storage_days) : freeDaysDefault)
        : undefined,
      sell_specs: form.sell_specs || undefined,
      buy_product_id: form.buy_product_id,
      buy_price: Number(form.buy_price),
      buy_quantity: buyResolved.quantity,
      buy_delivery_period: form.buy_delivery_period || undefined,
      buy_delivery_location: form.buy_delivery_location || undefined,
      buy_payment_method: form.buy_payment_method || undefined,
      buy_delivery_method: form.buy_delivery_method || undefined,
      buy_free_storage_enabled: form.buy_free_storage_enabled,
      buy_free_storage_days: form.buy_free_storage_enabled
        ? (form.buy_free_storage_days ? Number(form.buy_free_storage_days) : freeDaysDefault)
        : undefined,
      buy_specs: form.buy_specs || undefined,
      sell_allow_partial: sellResolved.allow_partial,
      sell_min_quantity: sellResolved.min_quantity,
      buy_allow_partial: buyResolved.allow_partial,
      buy_min_quantity: buyResolved.min_quantity,
      sell_allow_counter_offer: form.sell_allow_counter_offer,
      sell_negotiable_terms: form.sell_allow_counter_offer ? form.sell_negotiable_terms : [],
      buy_allow_counter_offer: form.buy_allow_counter_offer,
      buy_negotiable_terms: form.buy_allow_counter_offer ? form.buy_negotiable_terms : [],
      allow_single_side: form.allow_single_side,
      single_side_mode: form.allow_single_side ? "both" : "none",
      expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : undefined,
      starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : undefined,
    });
    setForm(emptyForm(defaultProductId));
    onClose();
  };

  // 实时校验哪些字段缺失，用于在按钮下方显示提示
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

  const isValid = missingFields.length === 0;

  // 检测是否是换期（同品种，不同交割期）
  const isSwapPeriod = form.sell_product_id === form.buy_product_id &&
    form.sell_delivery_period !== form.buy_delivery_period;

  const prevSwap =
    form.sell_product_id && form.sell_delivery_period && form.buy_product_id && form.buy_delivery_period
      ? loadSwapPrev<CreateSwapFormData>(
          form.sell_product_id,
          form.sell_delivery_period,
          form.buy_product_id,
          form.buy_delivery_period,
        )
      : null;

  const handleCopyPrev = () => {
    if (!prevSwap) {
      toast("暂无该买卖品种+交割期组合的上一发盘可复制", "info");
      return;
    }
    const sellShares =
      prevSwap.sell_per_share != null && prevSwap.sell_per_share !== ""
        ? { perShare: prevSwap.sell_per_share, shareCount: prevSwap.sell_share_count || "" }
        : deriveShareFields(Number(prevSwap.sell_quantity) || 0, Number(prevSwap.sell_min_quantity) || 0);
    setForm((prev) => {
      const merged = {
        ...prev,
        ...prevSwap,
        sell_product_id: prev.sell_product_id,
        sell_delivery_period: prev.sell_delivery_period,
        buy_product_id: prev.buy_product_id,
        buy_delivery_period: prev.buy_delivery_period,
        sell_per_share: sellShares.perShare,
        sell_share_count: sellShares.shareCount,
        buy_per_share: sellShares.perShare,
        buy_share_count: sellShares.shareCount,
        buy_quantity: prevSwap.sell_quantity || prev.buy_quantity,
        buy_allow_partial: !!prevSwap.sell_allow_partial,
        buy_min_quantity: prevSwap.sell_min_quantity || "",
      };
      return applySharedSwapQty(merged, {
        mode: qtyModeFromPartial(merged.sell_allow_partial),
        quantity: merged.sell_quantity,
        perShare: sellShares.perShare,
        shareCount: sellShares.shareCount,
      });
    });
    if (prevSwap.sell_payment_method) sellPaymentRef.current = prevSwap.sell_payment_method;
    if (prevSwap.buy_payment_method) buyPaymentRef.current = prevSwap.buy_payment_method;
    toast("已填入上一发盘内容", "success");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-t-panel rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[92vh] overflow-y-auto">
        {/* 标题 */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-t-border bg-t-panel backdrop-blur-md">
          <div>
            <h2 className="text-lg font-bold text-t-text">发起换盘</h2>
            <p className="text-xs text-t-text-3 mt-0.5">
              设置你想卖出的货物和希望换到的货物，等待对手方接受
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyPrev}
              disabled={!prevSwap}
              title={prevSwap ? "按当前买卖品种+交割期复制上一发盘" : "请先选齐买卖品种与交割期，且需有历史发盘"}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-t-border text-t-text-2 hover:text-t-text hover:bg-t-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              复制上一发盘
            </button>
            <button onClick={onClose} className="text-t-text-3 hover:text-t-text text-xl p-1">✕</button>
          </div>
        </div>

        {/* 换盘类型提示 */}
        {isSwapPeriod && (
          <div className="mx-6 mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-400">
            💡 <strong>换期模式</strong>：同品种、不同交割期换换
          </div>
        )}
        {form.sell_product_id && form.buy_product_id && form.sell_product_id !== form.buy_product_id && (
          <div className="mx-6 mt-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700 dark:bg-blue-500/10 dark:border-blue-500/30 dark:text-blue-400">
            🔄 <strong>换品种/换仓</strong>：不同品种或不同交割地互换
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* 买卖共用数量：两侧保持一致 */}
          <div className="p-3 rounded-xl border border-t-border bg-t-hover space-y-2">
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
              error={sharedResolvedPreview.error || minQtyError || undefined}
            />
          </div>

          {/* 两栏对比布局 */}
          <div className="grid grid-cols-2 gap-4">
            {/* 左：我要卖出（绿色） */}
            <div className="bg-green-50 rounded-xl p-4 border border-green-100 dark:bg-green-500/10 dark:border-green-500/30">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-5 h-5 rounded-full bg-green-500 text-white text-[10px] flex items-center justify-center font-bold">卖</span>
                <span className="text-sm font-semibold text-green-700 dark:text-green-400">我要卖出</span>
              </div>

              <div className="space-y-2.5">
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
                  <DeliverySelect
                    value={form.sell_delivery_period}
                    onChange={(v) => update("sell_delivery_period", v)}
                    options={deliveryOptions}
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

                {/* 付款方式 */}
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

                {/* 交割方式 */}
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

                {/* 免仓期 */}
                <FreeStorageField
                  enabled={form.sell_free_storage_enabled}
                  days={form.sell_free_storage_days}
                  onEnabledChange={(v) => setForm((prev) => ({ ...prev, sell_free_storage_enabled: v }))}
                  onDaysChange={(v) => update("sell_free_storage_days", v)}
                  ringColor="focus:ring-green-400"
                />

                {/* 规格 */}
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

            {/* 右：我要换入（红色） */}
            <div className="bg-red-50 rounded-xl p-4 border border-red-100 dark:bg-red-500/10 dark:border-red-500/30">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-5 h-5 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold">买</span>
                <span className="text-sm font-semibold text-red-700 dark:text-red-400">我要换入</span>
              </div>

              <div className="space-y-2.5">
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
                  <DeliverySelect
                    value={form.buy_delivery_period}
                    onChange={(v) => update("buy_delivery_period", v)}
                    options={deliveryOptions}
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

                {/* 付款方式 */}
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

                {/* 交割方式 */}
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

                {/* 免仓期 */}
                <FreeStorageField
                  enabled={form.buy_free_storage_enabled}
                  days={form.buy_free_storage_days}
                  onEnabledChange={(v) => setForm((prev) => ({ ...prev, buy_free_storage_enabled: v }))}
                  onDaysChange={(v) => update("buy_free_storage_days", v)}
                  ringColor="focus:ring-red-400"
                />

                {/* 规格 */}
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

          {minQtyError && (
            <p className="mt-3 text-[10px] text-red-500 px-1">{minQtyError}</p>
          )}

          {/* 商谈设置 — 卖出/买入各自独立 */}
          <div className="mt-3 grid grid-cols-2 gap-3">
            {/* 卖出商谈 */}
            <div className="px-3 py-2.5 bg-t-hover rounded-lg border border-t-border">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.sell_allow_counter_offer}
                  onChange={(e) => setForm((prev) => ({ ...prev, sell_allow_counter_offer: e.target.checked }))}
                  className="w-3.5 h-3.5 text-brand-600 rounded focus:ring-brand-500"
                />
                <span className="text-xs font-medium text-trade-down">卖出可商谈</span>
              </label>
              {form.sell_allow_counter_offer && (
                <div className="pl-6 pt-2">
                  <div className="flex items-center justify-end gap-1.5 mb-1 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, sell_negotiable_terms: NEGOTIABLE_TERMS.map((t) => t.key) }))}
                      className="text-[10px] text-brand-500 hover:text-brand-600 transition-colors"
                    >
                      全选
                    </button>
                    <span className="text-[10px] text-t-text-3">|</span>
                    <button
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, sell_negotiable_terms: [] }))}
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
            <div className="px-3 py-2.5 bg-t-hover rounded-lg border border-t-border">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.buy_allow_counter_offer}
                  onChange={(e) => setForm((prev) => ({ ...prev, buy_allow_counter_offer: e.target.checked }))}
                  className="w-3.5 h-3.5 text-brand-600 rounded focus:ring-brand-500"
                />
                <span className="text-xs font-medium text-trade-up">买入可商谈</span>
              </label>
              {form.buy_allow_counter_offer && (
                <div className="pl-6 pt-2">
                  <div className="flex items-center justify-end gap-1.5 mb-1 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, buy_negotiable_terms: NEGOTIABLE_TERMS.map((t) => t.key) }))}
                      className="text-[10px] text-brand-500 hover:text-brand-600 transition-colors"
                    >
                      全选
                    </button>
                    <span className="text-[10px] text-t-text-3">|</span>
                    <button
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, buy_negotiable_terms: [] }))}
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
                  onChange={(e) => setForm((prev) => ({ ...prev, allow_single_side: e.target.checked }))}
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
              <span className="ml-2 text-xs font-normal text-t-text-3">空=立即发布；可预约到点自动挂出</span>
            </label>
            <input
              type="datetime-local"
              value={form.starts_at}
              onChange={(e) => setForm((prev) => ({ ...prev, starts_at: e.target.value }))}
              className="w-full px-3 py-2.5 border border-sky-400/60 rounded-lg text-sm bg-sky-50/50 dark:bg-sky-950/20 text-t-text focus:ring-2 focus:ring-sky-400 focus:border-sky-500 outline-none"
            />
            <div className="mt-1.5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, starts_at: defaultStartsAtLocal() }))}
                className="text-xs px-2 py-1 rounded border border-sky-400/50 text-sky-800 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/40"
              >
                立即发布
              </button>
              <button
                type="button"
                onClick={() => {
                  const now = new Date();
                  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
                  setForm((prev) => ({ ...prev, starts_at: toDatetimeLocalValue(d) }));
                }}
                className="text-xs px-2 py-1 rounded border border-t-border text-t-text-2 hover:bg-t-hover"
              >
                明日9:00
              </button>
            </div>
          </div>

          {/* 过期时间 */}
          <div className="mt-3">
            <label className="block text-sm font-medium text-t-text-2 mb-1.5">
              过期时间
              <span className="ml-2 text-xs font-normal text-t-text-3">默认当日 18:00</span>
            </label>
            <input
              type="datetime-local"
              value={form.expires_at}
              onChange={(e) => setForm((prev) => ({ ...prev, expires_at: e.target.value }))}
              className="w-full px-3 py-2.5 border border-amber-400/60 rounded-lg text-sm bg-amber-50/50 dark:bg-amber-950/20 text-t-text focus:ring-2 focus:ring-amber-400 focus:border-amber-500 outline-none"
            />
            <div className="mt-1.5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, expires_at: defaultExpiresAtLocal() }))}
                className="text-xs px-2 py-1 rounded border border-amber-400/50 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40"
              >
                当日18:00
              </button>
              <button
                type="button"
                onClick={() => {
                  const now = new Date();
                  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 18, 0, 0, 0);
                  setForm((prev) => ({ ...prev, expires_at: toDatetimeLocalValue(d) }));
                }}
                className="text-xs px-2 py-1 rounded border border-t-border text-t-text-2 hover:bg-t-hover"
              >
                次日18:00
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
            disabled={loading}
            className={`w-full mt-4 py-3 rounded-xl text-white font-bold text-sm transition-opacity ${
              isValid
                ? "bg-gradient-to-r from-green-500 to-red-500 hover:opacity-90"
                : "bg-gradient-to-r from-green-500 to-red-500 hover:opacity-90 opacity-80"
            } disabled:from-t-hover disabled:to-t-hover disabled:text-t-text-3 disabled:cursor-not-allowed`}
          >
            {loading ? "提交中..." : "🔄 发布换盘"}
          </button>
        </form>
      </div>
    </div>
  );
}
