"use client";

import { useState, useEffect, useRef, useSyncExternalStore } from "react";
import type { Product } from "@/lib/types";
import { getProductSymbol, PAYMENT_METHOD_OPTIONS, getDefaultPayment, NEGOTIABLE_TERMS } from "@/lib/types";
import { Tooltip } from "./ui/Tooltip";
import { sanitizeText, isSafeInput } from "@/lib/validate";
import { DELIVERY_LOCATION_OPTIONS, SPECS_OPTIONS } from "@/lib/listing-options";
import { loadListingPrev, saveListingPrev, subscribePostingPrefs, getPostingPrefsCache } from "@/lib/posting-prev";
import {
  computeSharesTotal,
  deriveShareFields,
  qtyModeFromPartial,
  resolveQtyForSubmit,
  type QtyMode,
} from "@/lib/qty-mode";
import QtyModeFields from "./QtyModeFields";
import { toast } from "./Toast";
import { confirmDialog } from "./ConfirmDialog";
import { ListingConfirmSheet } from "./PostingConfirmSheet";
import {
  defaultExpiresAtLocal,
  defaultStartsAtLocal,
  isWorkdayDateTimeLocal,
  nextWorkdayExpireLocal,
  nextWorkdayMorningLocal,
} from "@/lib/expires";
import DeliveryPeriodPicker from "./DeliveryPeriodPicker";
import WorkdayDateTimePicker from "./WorkdayDateTimePicker";

export interface CreateListingFormData {
  product_id: string;
  side: "BUY" | "SELL";
  price: string;
  quantity: string;
  delivery_period: string;
  delivery_location: string;
  delivery_method: string;
  payment_method: string;
  specs: string;
  allow_partial: boolean;
  allow_counter_offer: boolean;
  negotiable_terms: string[];
  free_storage_enabled: boolean;
  free_storage_days: string;
  min_quantity: string;
  per_share: string;
  share_count: string;
  expires_at: string; // datetime-local，默认当日 18:00
  starts_at: string;  // datetime-local，空=立即发布
}

/** 交割方式预设选项（支持自定义输入） */
export const DELIVERY_METHOD_OPTIONS = ["混罐货转", "货转", "自提", "送到"];

interface Props {
  open: boolean;
  products: Product[];
  loading?: boolean;
  initialSide?: "BUY" | "SELL";
  defaultProductId?: string;
  marketType?: "all" | "spot" | "forward";
  onClose: () => void;
  onSubmit: (data: CreateListingFormData) => void;
}

// ===== localStorage 按品种+市场类型记忆发盘表单 =====
const LISTING_DRAFT_PREFIX = "listing_draft_";

function getDraftKey(productId: string, marketType: string): string {
  return `${LISTING_DRAFT_PREFIX}${productId}_${marketType}`;
}

function loadDraft(productId: string, marketType: string): Partial<CreateListingFormData> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(getDraftKey(productId, marketType));
    return raw ? (JSON.parse(raw) as Partial<CreateListingFormData>) : null;
  } catch {
    return null;
  }
}

function saveDraft(productId: string, marketType: string, data: CreateListingFormData) {
  if (typeof window === "undefined") return;
  try {
    // 只保存有记忆价值的字段，不保存 product_id（它就是 key 的一部分）
    const draft: Partial<CreateListingFormData> = {
      side: data.side,
      price: data.price,
      quantity: data.quantity,
      delivery_period: data.delivery_period,
      delivery_location: data.delivery_location,
      delivery_method: data.delivery_method,
      payment_method: data.payment_method,
      specs: data.specs,
      allow_partial: data.allow_partial,
      allow_counter_offer: data.allow_counter_offer,
      negotiable_terms: data.negotiable_terms,
      free_storage_enabled: data.free_storage_enabled,
      free_storage_days: data.free_storage_days,
      min_quantity: data.min_quantity,
      per_share: data.per_share,
      share_count: data.share_count,
    };
    localStorage.setItem(getDraftKey(productId, marketType), JSON.stringify(draft));
  } catch {}
}

/** 自定义 Combobox：可输入 + 可选择，下拉面板宽度与输入框一致 */
function Combobox({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
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
        className="w-full px-3 py-2.5 border border-t-border rounded-lg text-sm bg-t-panel text-t-text focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-t-panel border border-t-border rounded-lg shadow-lg max-h-44 overflow-y-auto">
          {filtered.map((opt) => (
            <button
              key={opt}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onChange(opt); setOpen(false); setFilter(""); }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-brand-600/10 transition-colors ${
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

const initialState: CreateListingFormData = {
  product_id: "",
  side: "BUY",
  price: "",
  quantity: "",
  delivery_period: "现货",
  delivery_location: "",
  delivery_method: "",
  payment_method: "",
  specs: "",
  allow_partial: false,
  allow_counter_offer: false,
  negotiable_terms: [],
  free_storage_enabled: true,
  free_storage_days: "",
  min_quantity: "",
  per_share: "",
  share_count: "",
  expires_at: defaultExpiresAtLocal(),
  starts_at: defaultStartsAtLocal(),
};

/** 数量变化时同步默认免仓天数（≥100→7天，否则3天）；用户已改成非默认值则保留 */
function syncFreeStorageDays(prevDays: string, totalQty: number): string {
  const defaultDays = totalQty >= 100 ? "7" : "3";
  if (!prevDays || prevDays === "3" || prevDays === "7") return defaultDays;
  return prevDays;
}

// 交割期由日历选择（仅工作日）：当天→现货，月中工作日→YYMM中，月末工作日→YYMM下，其余→YYMMDD（如 260725）

export default function CreateListingModal({ open, products, loading, initialSide, defaultProductId, marketType, onClose, onSubmit }: Props) {
  const [form, setForm] = useState<CreateListingFormData>(initialState);
  const [minQtyError, setMinQtyError] = useState("");
  const prevPaymentRef = useRef("");
  // 必须在任何 early return 之前订阅，避免 Hooks 数量变化导致崩溃
  useSyncExternalStore(subscribePostingPrefs, getPostingPrefsCache, getPostingPrefsCache);

  // 当弹窗打开时，按品种+市场类型从 localStorage 恢复上次操作数据
  // 首次打开某品种时，自动选中该品种并使用默认值
  useEffect(() => {
    if (!open) return;

    // 确定品种：优先使用 defaultProductId（来自自选/当前选中品种），否则保持空
    const targetProductId = defaultProductId || "";
    // 市场类型用于区分现货/远期纸货
    const mt = marketType || "all";

    // 尝试从 localStorage 加载该品种+市场类型的记忆数据
    const draft = targetProductId ? loadDraft(targetProductId, mt) : null;

    if (draft) {
      // 有记忆数据 → 恢复上次操作
      const restored: CreateListingFormData = {
        ...initialState,
        ...draft,
        product_id: targetProductId,
        side: initialSide || draft.side || "BUY",
        per_share: draft.per_share ?? "",
        share_count: draft.share_count ?? "",
      };
      if (restored.allow_partial && (!restored.per_share || !restored.share_count)) {
        const derived = deriveShareFields(
          Number(restored.quantity) || 0,
          restored.min_quantity ? Number(restored.min_quantity) : null,
        );
        if (!restored.per_share) restored.per_share = derived.perShare;
        if (!restored.share_count) restored.share_count = derived.shareCount;
      }
      setForm({
        ...restored,
        expires_at: defaultExpiresAtLocal(),
        starts_at: defaultStartsAtLocal(),
      });
      // 恢复付款方式默认值引用
      if (draft.payment_method) {
        prevPaymentRef.current = draft.payment_method;
      }
    } else {
      // 无记忆数据 → 使用默认值，但自动选中当前品种
      setForm({
        ...initialState,
        product_id: targetProductId,
        side: initialSide || "BUY",
        expires_at: defaultExpiresAtLocal(),
        starts_at: defaultStartsAtLocal(),
        // 如果是现货，交割期默认"现货"；如果是远期纸货，交割期默认空（用户自选）
        delivery_period: mt === "spot" ? "现货" : initialState.delivery_period,
        // 现货默认付款方式
        payment_method: mt === "spot" ? getDefaultPayment("现货") : "",
      });
      if (mt === "spot") {
        prevPaymentRef.current = getDefaultPayment("现货");
      }
    }
  }, [open, defaultProductId, marketType, initialSide]);

  if (!open) return null;

  // 数量方式校验（提交时触发），返回错误文案（非空=校验失败）
  const validateMinQuantity = (): string => {
    const mode: QtyMode = form.allow_partial ? "shares" : "whole";
    const resolved = resolveQtyForSubmit(mode, form.quantity, form.per_share, form.share_count);
    if (resolved.error) {
      setMinQtyError(resolved.error);
      return resolved.error;
    }
    setMinQtyError("");
    return "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 同步校验，避免 setState 后读 stale minQtyError 误拦提交
    if (validateMinQuantity()) return;

    // 必填字段校验（拦截提交）
    if (missingFields.length > 0) return;

    // 安全性检查：防止 XSS 注入
    const allTextFields = [form.delivery_period, form.delivery_location, form.delivery_method, form.payment_method, form.specs];
    if (allTextFields.some((f) => !isSafeInput(f))) return;

    const mode: QtyMode = form.allow_partial ? "shares" : "whole";
    const resolved = resolveQtyForSubmit(mode, form.quantity, form.per_share, form.share_count);
    if (resolved.error) {
      setMinQtyError(resolved.error);
      return;
    }

    const submitData: CreateListingFormData = {
      ...form,
      quantity: String(resolved.quantity),
      allow_partial: resolved.allow_partial,
      min_quantity: resolved.min_quantity > 0 ? String(resolved.min_quantity) : "",
    };

    const product = products.find((p) => p.id === submitData.product_id);
    const scheduled = !!submitData.starts_at.trim();
    const ok = await confirmDialog({
      title: scheduled ? "发盘确认单 · 预约发布" : "发盘确认单 · 立即发布",
      message: "请核对发盘确认单",
      content: (
        <ListingConfirmSheet
          side={submitData.side}
          productName={product?.name || submitData.product_id}
          price={Number(submitData.price)}
          quantity={resolved.quantity}
          allowPartial={resolved.allow_partial}
          minQuantity={resolved.min_quantity}
          deliveryPeriod={submitData.delivery_period}
          deliveryLocation={submitData.delivery_location}
          deliveryMethod={submitData.delivery_method}
          paymentMethod={submitData.payment_method}
          specs={submitData.specs}
          freeStorageEnabled={submitData.free_storage_enabled}
          freeStorageDays={submitData.free_storage_days}
          allowCounterOffer={submitData.allow_counter_offer}
          negotiableTerms={submitData.negotiable_terms}
          startsAt={submitData.starts_at}
          expiresAt={submitData.expires_at}
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

    // 保存当前表单：市场类型草稿 + 品种+交割期上一发盘（账号级入库）
    if (submitData.product_id) {
      saveDraft(submitData.product_id, marketType || "all", submitData);
      if (submitData.delivery_period) {
        void saveListingPrev(submitData.product_id, submitData.delivery_period, submitData);
      }
    }

    onSubmit(submitData);
    setForm(initialState);
    onClose();
  };

  const update = (field: keyof CreateListingFormData, value: string) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      // 交割期变更时，若付款方式为空或仍为之前的默认值，自动填入新默认值
      if (field === "delivery_period") {
        const oldDefault = getDefaultPayment(prev.delivery_period);
        if (!prev.payment_method || prev.payment_method === oldDefault || prev.payment_method === prevPaymentRef.current) {
          next.payment_method = getDefaultPayment(value);
          prevPaymentRef.current = next.payment_method;
        }
      }
      return next;
    });
  };

  // 实时校验哪些字段缺失，用于在按钮下方显示提示
  const missingFields: string[] = [];
  if (!form.product_id) missingFields.push("产品");
  if (!(Number(form.price) > 0)) missingFields.push("价格");
  if (form.allow_partial) {
    if (!(Number(form.per_share) > 0)) missingFields.push("每份数量");
    if (!(Number(form.share_count) > 0)) missingFields.push("份数");
  } else if (!(Number(form.quantity) > 0)) {
    missingFields.push("数量");
  }
  if (!form.delivery_period) missingFields.push("交割期");
  if (!form.delivery_location) missingFields.push("交割地点");
  if (!form.delivery_method) missingFields.push("交割方式");
  if (!form.payment_method) missingFields.push("付款方式");
  if (!form.specs) missingFields.push("规格");
  // 商谈条款校验：选了可商谈但未选任何条款
  if (form.allow_counter_offer && (!form.negotiable_terms || form.negotiable_terms.length === 0)) {
    missingFields.push("商谈条款（至少选一项）");
  }
  if (!isWorkdayDateTimeLocal(form.starts_at, true)) {
    missingFields.push("开始时间（须为工作日；休市日不可立即挂盘）");
  }
  if (!isWorkdayDateTimeLocal(form.expires_at)) {
    missingFields.push("过期时间（须为工作日）");
  }

  const isValid = missingFields.length === 0;

  // 免仓天数默认：数量≥100 默认7天，否则3天（仅去掉括号说明，逻辑保留）
  const totalQty = form.allow_partial
    ? computeSharesTotal(form.per_share, form.share_count)
    : Number(form.quantity) || 0;
  const defaultFreeStorageDays = totalQty >= 100 ? 7 : 3;
  const unit = products.find((p) => p.id === form.product_id)?.unit || "吨";
  const prevListing = form.product_id && form.delivery_period
    ? loadListingPrev<CreateListingFormData>(form.product_id, form.delivery_period)
    : null;

  const handleCopyPrev = () => {
    if (!prevListing) {
      toast("暂无该品种+交割期的上一发盘可复制", "info");
      return;
    }
    setForm((prev) => {
      const merged: CreateListingFormData = {
        ...prev,
        ...prevListing,
        product_id: prev.product_id,
        delivery_period: prev.delivery_period,
        side: initialSide || prevListing.side || prev.side,
        per_share: prevListing.per_share ?? "",
        share_count: prevListing.share_count ?? "",
      };
      if (merged.allow_partial && (!merged.per_share || !merged.share_count)) {
        const derived = deriveShareFields(
          Number(merged.quantity) || 0,
          merged.min_quantity ? Number(merged.min_quantity) : null,
        );
        if (!merged.per_share) merged.per_share = derived.perShare;
        if (!merged.share_count) merged.share_count = derived.shareCount;
      }
      return merged;
    });
    if (prevListing.payment_method) {
      prevPaymentRef.current = prevListing.payment_method;
    }
    toast("已填入上一发盘内容", "success");
  };

  const handleQtyModeChange = (mode: QtyMode) => {
    setForm((prev) => {
      if (mode === "shares") {
        let per_share = prev.per_share;
        let share_count = prev.share_count;
        if (!per_share || !share_count) {
          const derived = deriveShareFields(
            Number(prev.quantity) || 0,
            prev.min_quantity ? Number(prev.min_quantity) : null,
          );
          if (!per_share) per_share = derived.perShare;
          if (!share_count) share_count = derived.shareCount;
        }
        const total = computeSharesTotal(per_share, share_count);
        return {
          ...prev,
          allow_partial: true,
          per_share,
          share_count,
          min_quantity: per_share || prev.min_quantity,
          quantity: total > 0 ? String(total) : prev.quantity,
          free_storage_days: syncFreeStorageDays(prev.free_storage_days, total > 0 ? total : Number(prev.quantity) || 0),
        };
      }
      const total = computeSharesTotal(prev.per_share, prev.share_count);
      const quantity = total > 0 ? String(total) : prev.quantity;
      return {
        ...prev,
        allow_partial: false,
        quantity,
        min_quantity: "",
        free_storage_days: syncFreeStorageDays(prev.free_storage_days, Number(quantity) || 0),
      };
    });
    setMinQtyError("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-t-panel rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-t-border bg-t-panel backdrop-blur-md">
          <h2 className="text-lg font-bold text-t-text">发布挂盘</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyPrev}
              disabled={!prevListing}
              title={prevListing ? "按当前品种+交割期复制上一发盘" : "请先选择品种和交割期，且需有历史发盘"}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-t-border text-t-text-2 hover:text-t-text hover:bg-t-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              复制上一发盘
            </button>
            <button
              onClick={onClose}
              className="text-t-text-3 hover:text-t-text text-xl leading-none p-1"
            >
              ✕
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* 买卖方向 */}
          <div>
            <label className="block text-sm font-medium text-t-text-2 mb-1.5">方向</label>
            {initialSide ? (
              <div className={`py-2.5 rounded-lg text-sm font-medium border-2 text-center ${
                form.side === "BUY"
                  ? "border-red-400 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/50"
                  : "border-green-400 bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400 dark:border-green-500/50"
              }`}>
                {form.side === "BUY" ? "🔴 求购" : "🟢 销售"}
              </div>
            ) : (
              <div className="flex gap-2">
                {(["BUY", "SELL"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => update("side", s)}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium border-2 transition-colors ${
                      form.side === s
                        ? s === "BUY"
                          ? "border-red-400 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/50"
                          : "border-green-400 bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400 dark:border-green-500/50"
                        : "border-t-border text-t-text-3 hover:border-t-border hover:bg-t-hover"
                    }`}
                  >
                    {s === "BUY" ? "🔴 求购" : "🟢 销售"}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 产品 */}
          <div>
            <label className="block text-sm font-medium text-t-text-2 mb-1.5">产品</label>
            <select
              value={form.product_id}
              onChange={(e) => update("product_id", e.target.value)}
              className="w-full px-3 py-2.5 border border-t-border rounded-lg text-sm bg-t-panel text-t-text focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
            >
              <option value="">请选择产品</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({getProductSymbol(p)})</option>
              ))}
            </select>
          </div>

          {/* 价格 + 数量方式 */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-t-text-2 mb-1.5">价格 (元/{unit})</label>
              <input
                type="number"
                value={form.price}
                onChange={(e) => update("price", e.target.value)}
                placeholder="如 2450"
                className="w-full px-3 py-2.5 border border-t-border rounded-lg text-sm bg-t-panel text-t-text focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
              />
            </div>
            <QtyModeFields
              mode={qtyModeFromPartial(form.allow_partial)}
              unit={unit}
              quantity={form.quantity}
              perShare={form.per_share}
              shareCount={form.share_count}
              onModeChange={handleQtyModeChange}
              onQuantityChange={(v) => {
                setForm((prev) => ({
                  ...prev,
                  quantity: v,
                  free_storage_days: syncFreeStorageDays(prev.free_storage_days, Number(v) || 0),
                }));
                setMinQtyError("");
              }}
              onPerShareChange={(v) => {
                setForm((prev) => {
                  const total = computeSharesTotal(v, prev.share_count);
                  return {
                    ...prev,
                    per_share: v,
                    min_quantity: v,
                    quantity: total > 0 ? String(total) : prev.quantity,
                    free_storage_days: syncFreeStorageDays(prev.free_storage_days, total > 0 ? total : Number(prev.quantity) || 0),
                  };
                });
                setMinQtyError("");
              }}
              onShareCountChange={(v) => {
                setForm((prev) => {
                  const total = computeSharesTotal(prev.per_share, v);
                  return {
                    ...prev,
                    share_count: v,
                    quantity: total > 0 ? String(total) : prev.quantity,
                    free_storage_days: syncFreeStorageDays(prev.free_storage_days, total > 0 ? total : Number(prev.quantity) || 0),
                  };
                });
                setMinQtyError("");
              }}
              error={minQtyError}
            />
          </div>

          {/* 交割期（日历选择） */}
          <div>
            <label className="block text-sm font-medium text-t-text-2 mb-1.5">交割期</label>
            <DeliveryPeriodPicker
              value={form.delivery_period}
              onChange={(v) => update("delivery_period", v)}
              placeholder="在日历中选择交割期"
            />
            <p className="mt-1 text-[10px] text-t-text-3">
              仅工作日可选：当天→现货；月中工作日→月中（如 2607中）；月末工作日→月下；其他按 YYMMDD（如 260725）
            </p>
          </div>

          {/* 交割地 */}
          <div>
            <label className="block text-sm font-medium text-t-text-2 mb-1.5">交割地点</label>
            <Combobox
              value={form.delivery_location}
              onChange={(v) => update("delivery_location", sanitizeText(v))}
              options={DELIVERY_LOCATION_OPTIONS}
              placeholder="选择或输入交割地点"
            />
          </div>

          {/* 规格 */}
          <div>
            <label className="block text-sm font-medium text-t-text-2 mb-1.5">产品规格</label>
            <Combobox
              value={form.specs}
              onChange={(v) => update("specs", sanitizeText(v))}
              options={SPECS_OPTIONS}
              placeholder="选择或输入产品规格"
            />
          </div>

          {/* 付款方式（combobox：预设选项 + 自定义输入） */}
          <div>
            <label className="block text-sm font-medium text-t-text-2 mb-1.5">付款方式</label>
            <Combobox
              value={form.payment_method}
              onChange={(v) => update("payment_method", v)}
              options={PAYMENT_METHOD_OPTIONS}
              placeholder="选择或输入付款方式（可选）"
            />
          </div>

          {/* 交割方式（combobox：预设选项 + 自定义输入） */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-t-text-2 mb-1.5">
              交割方式
              <Tooltip content="货物交付的方式：混罐货转（多方拼罐后过户）、货转（整批货权过户）、自提（买方自行提货）、送到（卖方送货上门）。可自定义输入其他方式。">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-t-text-3 text-white text-[10px] cursor-help">?</span>
              </Tooltip>
            </label>
            <Combobox
              value={form.delivery_method}
              onChange={(v) => update("delivery_method", v)}
              options={DELIVERY_METHOD_OPTIONS}
              placeholder="选择或输入交割方式（可选）"
            />
          </div>

          {/* 免仓期 */}
          <div className="p-3 bg-t-hover rounded-lg border border-t-border space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.free_storage_enabled}
                  onChange={(e) => setForm((prev) => ({ ...prev, free_storage_enabled: e.target.checked }))}
                  className="w-4 h-4 text-brand-600 rounded focus:ring-brand-500"
                />
                <span className="text-sm font-medium text-t-text">可以免仓</span>
              </label>
              <Tooltip content={`免仓期是指成交后买方可免费存储货物的天数，超期后按约定收取仓储费。规则：数量 ≥ 100 吨默认免仓 7 天，小于 100 吨默认免仓 3 天。可勾选"可以免仓"后自定义天数，也可取消勾选表示不免仓。`}>
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-t-text-3 text-white text-[10px] cursor-help">?</span>
              </Tooltip>
            </div>

            {form.free_storage_enabled ? (
              <div className="flex items-center gap-2 pl-6">
                <label className="text-xs text-t-text-3 shrink-0">免仓天数</label>
                <input
                  type="number"
                  value={form.free_storage_days}
                  onChange={(e) => setForm((prev) => ({ ...prev, free_storage_days: e.target.value }))}
                  placeholder={`不填默认${defaultFreeStorageDays}天`}
                  min="1"
                  step="1"
                  className="flex-1 min-w-0 px-2.5 py-1.5 border border-t-border rounded-lg text-sm bg-t-panel text-t-text focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
                />
                <span className="text-xs text-t-text-3 shrink-0">天</span>
              </div>
            ) : (
              <p className="text-xs text-t-text-3 pl-6">不免仓（成交后需立即安排提货或按约定计费）</p>
            )}
          </div>

          {/* 商谈设置 */}
          <div className="p-3 bg-t-hover rounded-lg border border-t-border space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.allow_counter_offer}
                  onChange={(e) => setForm((prev) => ({ ...prev, allow_counter_offer: e.target.checked }))}
                  className="w-4 h-4 text-brand-600 rounded focus:ring-brand-500"
                />
                <span className="text-sm font-medium text-t-text">允许商谈</span>
              </label>
              <Tooltip content="关闭后，对方无法对该挂盘发起商谈">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-t-text-3 text-white text-[10px] cursor-help">?</span>
              </Tooltip>
            </div>

            {/* 可议条款范围：仅当「允许议价」开启时展示，默认全选 */}
            {form.allow_counter_offer && (
              <div className="pl-6 pt-1">
                <div className="flex items-center justify-end gap-2 mb-1 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, negotiable_terms: NEGOTIABLE_TERMS.map((t) => t.key) }))}
                    className="text-xs text-brand-600 hover:text-brand-500 font-medium"
                  >
                    全选
                  </button>
                  <span className="text-t-text-3 text-xs">|</span>
                  <button
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, negotiable_terms: [] }))}
                    className="text-xs text-brand-600 hover:text-brand-500 font-medium"
                  >
                    全取消
                  </button>
                </div>
                <div className="text-xs text-t-text-3 mb-1.5">
                  可商谈条款范围（默认全选；取消勾选的条款对方不可在商谈中修改）
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {NEGOTIABLE_TERMS.map((t) => (
                    <label key={t.key} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.negotiable_terms.includes(t.key)}
                        onChange={(e) => {
                          setForm((prev) => {
                            const set = new Set(prev.negotiable_terms);
                            if (e.target.checked) set.add(t.key);
                            else set.delete(t.key);
                            return { ...prev, negotiable_terms: Array.from(set) };
                          });
                        }}
                        className="w-4 h-4 text-brand-600 rounded focus:ring-brand-500"
                      />
                      <span className="text-xs text-t-text-2">{t.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 开始时间（可选预约） */}
          <div>
            <label className="block text-sm font-medium text-t-text-2 mb-1.5">
              开始时间
              <span className="ml-2 text-xs font-normal text-t-text-3">仅工作日；空=立即发布（休市日不可立即挂）</span>
            </label>
            <WorkdayDateTimePicker
              value={form.starts_at}
              onChange={(v) => update("starts_at", v)}
              allowEmpty
              emptyLabel="立即发布"
              placeholder="选择开始时间"
              accent="sky"
              defaultTime="09:00"
            />
            <div className="mt-1.5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => update("starts_at", defaultStartsAtLocal())}
                className="text-xs px-2 py-1 rounded border border-sky-400/50 text-sky-800 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/40"
              >
                立即发布
              </button>
              <button
                type="button"
                onClick={() => update("starts_at", nextWorkdayMorningLocal())}
                className="text-xs px-2 py-1 rounded border border-t-border text-t-text-2 hover:bg-t-hover"
              >
                下一工作日9:00
              </button>
            </div>
          </div>

          {/* 过期时间 */}
          <div>
            <label className="block text-sm font-medium text-t-text-2 mb-1.5">
              过期时间
              <span className="ml-2 text-xs font-normal text-t-text-3">仅工作日；默认当日/下一工作日 18:00</span>
            </label>
            <WorkdayDateTimePicker
              value={form.expires_at}
              onChange={(v) => update("expires_at", v)}
              placeholder="选择过期时间"
              accent="amber"
              defaultTime="18:00"
            />
            <div className="mt-1.5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => update("expires_at", defaultExpiresAtLocal())}
                className="text-xs px-2 py-1 rounded border border-amber-400/50 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40"
              >
                默认18:00
              </button>
              <button
                type="button"
                onClick={() => update("expires_at", nextWorkdayExpireLocal())}
                className="text-xs px-2 py-1 rounded border border-t-border text-t-text-2 hover:bg-t-hover"
              >
                下一工作日18:00
              </button>
            </div>
          </div>

          {/* Submit */}
          {!isValid && (
            <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-400">
              ⚠️ 还需填写：{missingFields.join("、")}
            </div>
          )}
          <button
            type="submit"
            disabled={!isValid || loading}
            className="w-full py-3 rounded-lg text-white font-bold text-sm transition-colors bg-brand-600 hover:bg-brand-700 disabled:bg-t-hover disabled:text-t-text-3 disabled:cursor-not-allowed"
          >
            {loading ? "提交中..." : "确认发布"}
          </button>
        </form>
      </div>

    </div>
  );
}
