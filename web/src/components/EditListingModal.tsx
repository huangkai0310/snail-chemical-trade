"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Listing, Product } from "@/lib/types";
import { PAYMENT_METHOD_OPTIONS, getDefaultPayment, NEGOTIABLE_TERMS, sanitizeNegotiableTerms } from "@/lib/types";
import { fetchCounterOffersByRef } from "@/lib/api";
import { Tooltip } from "./ui/Tooltip";
import { DELIVERY_METHOD_OPTIONS } from "./CreateListingModal";
import { sanitizeText, isSafeInput } from "@/lib/validate";
import { DELIVERY_LOCATION_OPTIONS, SPECS_OPTIONS, mergeSelectOptions } from "@/lib/listing-options";
import Combobox from "./ui/Combobox";
import ModalUpdateNotice from "./ModalUpdateNotice";
import { toast } from "./Toast";
import { confirmDialog, type EditChangeItem } from "./ConfirmDialog";
import { formatBoardSerial } from "@/lib/format";
import {
  computeSharesTotal,
  deriveShareFields,
  qtyModeFromPartial,
  resolveQtyForSubmit,
  type QtyMode,
} from "@/lib/qty-mode";
import QtyModeFields from "./QtyModeFields";
import { defaultExpiresAtLocal, defaultStartsAtLocal, isoToDatetimeLocal, toDatetimeLocalValue } from "@/lib/expires";

export interface EditListingFormData {
  price: string;
  quantity: string;
  min_quantity: string;
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
  per_share: string;
  share_count: string;
  expires_at: string;
  starts_at: string;
}

function sameTerms(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort().join("\0");
  const sb = [...b].sort().join("\0");
  return sa === sb;
}

function formTotalQty(form: EditListingFormData): number {
  if (form.allow_partial) {
    const total = computeSharesTotal(form.per_share, form.share_count);
    return total > 0 ? total : Number(form.quantity) || 0;
  }
  return Number(form.quantity) || 0;
}

function listingFormUnchanged(listing: Listing, form: EditListingFormData): boolean {
  const orig = listingToForm(listing);
  return (
    Number(form.price) === Number(orig.price) &&
    formTotalQty(form) === formTotalQty(orig) &&
    (form.allow_partial
      ? (form.per_share.trim() || "") === (orig.per_share.trim() || "") &&
        (form.share_count.trim() || "") === (orig.share_count.trim() || "")
      : true) &&
    form.delivery_period.trim() === orig.delivery_period.trim() &&
    form.delivery_location.trim() === orig.delivery_location.trim() &&
    form.delivery_method.trim() === orig.delivery_method.trim() &&
    form.payment_method.trim() === orig.payment_method.trim() &&
    form.specs.trim() === orig.specs.trim() &&
    form.allow_partial === orig.allow_partial &&
    form.allow_counter_offer === orig.allow_counter_offer &&
    sameTerms(form.negotiable_terms, orig.negotiable_terms) &&
    form.free_storage_enabled === orig.free_storage_enabled &&
    (form.free_storage_days.trim() || "") === (orig.free_storage_days.trim() || "") &&
    (form.expires_at || "") === (orig.expires_at || "") &&
    (form.starts_at || "") === (orig.starts_at || "")
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

/** 列出挂盘表单相对原盘的变更 */
function describeListingFormChanges(listing: Listing, form: EditListingFormData): EditChangeItem[] {
  const orig = listingToForm(listing);
  const items: EditChangeItem[] = [];
  const push = (label: string, before: string, after: string) => {
    if (before !== after) items.push({ label, before, after });
  };

  push("价格", `¥${Number(orig.price).toLocaleString()}`, `¥${Number(form.price).toLocaleString()}`);
  push("数量方式", orig.allow_partial ? "按份数" : "整单", form.allow_partial ? "按份数" : "整单");
  push("数量", formTotalQty(orig).toLocaleString(), formTotalQty(form).toLocaleString());
  if (orig.allow_partial || form.allow_partial) {
    push("每份数量", orig.per_share.trim() || orig.min_quantity.trim() || "无", form.per_share.trim() || form.min_quantity.trim() || "无");
    push("份数", orig.share_count.trim() || "-", form.share_count.trim() || "-");
  }
  push("交割期", orig.delivery_period.trim() || "-", form.delivery_period.trim() || "-");
  push("交割地", orig.delivery_location.trim() || "-", form.delivery_location.trim() || "-");
  push("交割方式", orig.delivery_method.trim() || "-", form.delivery_method.trim() || "-");
  push("付款方式", orig.payment_method.trim() || "-", form.payment_method.trim() || "-");
  push("规格", orig.specs.trim() || "-", form.specs.trim() || "-");
  push("可商谈", orig.allow_counter_offer ? "允许" : "不允许", form.allow_counter_offer ? "允许" : "不允许");
  if (!sameTerms(form.negotiable_terms, orig.negotiable_terms)) {
    push("可商谈条款", fmtNegotiableTerms(orig.negotiable_terms), fmtNegotiableTerms(form.negotiable_terms));
  }
  push(
    "免仓期",
    fmtFreeStorage(orig.free_storage_enabled, orig.free_storage_days),
    fmtFreeStorage(form.free_storage_enabled, form.free_storage_days),
  );
  push(
    "过期时间",
    orig.expires_at.replace("T", " ") || "-",
    form.expires_at.replace("T", " ") || "-",
  );
  push(
    "开始时间",
    orig.starts_at ? orig.starts_at.replace("T", " ") : "立即",
    form.starts_at ? form.starts_at.replace("T", " ") : "立即",
  );
  return items;
}

interface Props {
  open: boolean;
  listing: Listing | null;
  product?: Product;
  loading?: boolean;
  dataUpdated?: boolean;
  updateMessage?: string;
  onDismissUpdate?: () => void;
  onClose: () => void;
  onSubmit: (data: EditListingFormData) => void;
  /** 返回详情弹窗（仅从详情弹窗打开时显示） */
  onBack?: () => void;
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

    const midDate = new Date(year, month, 15);
    const endDate = new Date(year, month, 28);

    if (midDate >= now) options.push(`${prefix}中`);
    if (endDate >= now) options.push(`${prefix}下`);
  }
  return options;
}

function listingToForm(listing: Listing): EditListingFormData {
  // 解析 negotiable_terms（JSONB 传到前端可能被序列化成 string 或已是数组）
  let nt: string[] = [];
  const raw = listing.negotiable_terms;
  if (raw) {
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed)) nt = sanitizeNegotiableTerms(parsed as string[]);
    } catch { /* ignore */ }
  }

  const allowPartial = listing.allow_partial ?? false;
  const quantity = String(listing.quantity ?? "");
  const minQuantity = listing.min_quantity ? String(listing.min_quantity) : "";
  let per_share = "";
  let share_count = "";
  if (allowPartial) {
    const derived = deriveShareFields(
      Number(listing.quantity) || 0,
      listing.min_quantity != null && listing.min_quantity > 0 ? listing.min_quantity : null,
    );
    per_share = derived.perShare;
    share_count = derived.shareCount;
  }

  return {
    price: String(listing.price ?? ""),
    quantity,
    min_quantity: minQuantity,
    delivery_period: listing.delivery_period ?? "",
    delivery_location: listing.delivery_location ?? "",
    delivery_method: listing.delivery_method ?? "",
    payment_method: listing.payment_method ?? "",
    specs: typeof listing.specs === "string" ? listing.specs : (listing.specs ? JSON.stringify(listing.specs) : ""),
    allow_partial: allowPartial,
    allow_counter_offer: listing.allow_counter_offer ?? true,
    negotiable_terms: nt.length > 0 ? nt : NEGOTIABLE_TERMS.map(t => t.key),
    free_storage_enabled: listing.free_storage_enabled ?? true,
    free_storage_days: listing.free_storage_days ? String(listing.free_storage_days) : "",
    per_share,
    share_count,
    expires_at: isoToDatetimeLocal(listing.expires_at),
    starts_at: listing.starts_at && listing.status === "SCHEDULED"
      ? isoToDatetimeLocal(listing.starts_at)
      : defaultStartsAtLocal(),
  };
}

export default function EditListingModal({ open, listing, product, loading, dataUpdated, updateMessage, onDismissUpdate, onClose, onSubmit, onBack }: Props) {
  const [form, setForm] = useState<EditListingFormData | null>(null);
  const [minQtyError, setMinQtyError] = useState("");
  const deliveryOptions = buildDeliveryOptions();
  const prevPaymentRef = useRef("");

  const pendingCoQuery = useQuery({
    queryKey: ["counterOffersByRef", "listing", listing?.id, "edit"],
    queryFn: () => fetchCounterOffersByRef("listing", listing!.id),
    enabled: open && !!listing?.id,
  });
  const pendingCoCount = (pendingCoQuery.data?.data ?? []).filter((c) => c.status === "PENDING").length;
  const termsLockedByCo = pendingCoCount > 0;

  useEffect(() => {
    if (open && listing) {
      setForm(listingToForm(listing));
      setMinQtyError("");
    }
  }, [open, listing]);

  if (!open || !form || !listing) return null;

  const filled = listing.filled ?? 0;
  const remaining = listing.quantity - filled;
  const unit = product?.unit || "吨";

  const update = (field: keyof EditListingFormData, value: string) => {
    setForm((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [field]: value };
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

  const handleQtyModeChange = (mode: QtyMode) => {
    setForm((prev) => {
      if (!prev) return prev;
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
        };
      }
      const total = computeSharesTotal(prev.per_share, prev.share_count);
      return {
        ...prev,
        allow_partial: false,
        quantity: total > 0 ? String(total) : prev.quantity,
        min_quantity: "",
      };
    });
    setMinQtyError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const mode: QtyMode = form.allow_partial ? "shares" : "whole";
    const resolved = resolveQtyForSubmit(mode, form.quantity, form.per_share, form.share_count);
    if (resolved.error) {
      setMinQtyError(resolved.error);
      return;
    }

    // 数量不能少于已成交量
    if (resolved.quantity < filled) {
      setMinQtyError(`数量不能少于已成交量 ${filled}`);
      return;
    }

    const submitData: EditListingFormData = {
      ...form,
      quantity: String(resolved.quantity),
      allow_partial: resolved.allow_partial,
      min_quantity: resolved.min_quantity > 0 ? String(resolved.min_quantity) : "",
    };

    const missingFields: string[] = [];
    if (!(Number(submitData.price) > 0)) missingFields.push("价格");
    if (submitData.allow_partial) {
      if (!(Number(submitData.per_share) > 0)) missingFields.push("每份数量");
      if (!(Number(submitData.share_count) > 0)) missingFields.push("份数");
    } else if (!(Number(submitData.quantity) > 0)) {
      missingFields.push("数量");
    }
    if (!submitData.delivery_period) missingFields.push("交割期");
    if (!submitData.delivery_location) missingFields.push("交割地点");
    if (!submitData.delivery_method) missingFields.push("交割方式");
    if (!submitData.payment_method) missingFields.push("付款方式");
    if (!submitData.specs) missingFields.push("规格");
    if (missingFields.length > 0) return;

    // 安全性检查：防止 XSS 注入
    const allTextFields = [submitData.delivery_period, submitData.delivery_location, submitData.delivery_method, submitData.payment_method, submitData.specs];
    if (allTextFields.some((f) => !isSafeInput(f))) return;

    if (listingFormUnchanged(listing, submitData)) {
      toast("信息未修改，无需保存", "info");
      return;
    }

    const changes = describeListingFormChanges(listing, submitData);
    const ok = await confirmDialog({
      title: "确认保存编辑",
      message: "确认保存挂盘修改？",
      changes,
      changesIntro: "确认保存挂盘修改？下方高亮为本次变更：",
      changesOutro: "保存后盘面将按新条款展示，请核对后再确认。",
      variant: "warning",
      icon: "warning",
      confirmText: "确认保存",
      cancelText: "再想想",
      wide: true,
    });
    if (!ok) return;

    onSubmit(submitData);
  };

  const displayMissingFields: string[] = [];
  if (!(Number(form.price) > 0)) displayMissingFields.push("价格");
  if (form.allow_partial) {
    if (!(Number(form.per_share) > 0)) displayMissingFields.push("每份数量");
    if (!(Number(form.share_count) > 0)) displayMissingFields.push("份数");
  } else if (!(Number(form.quantity) > 0)) {
    displayMissingFields.push("数量");
  }
  if (!form.delivery_period) displayMissingFields.push("交割期");
  if (!form.delivery_location) displayMissingFields.push("交割地点");
  if (!form.delivery_method) displayMissingFields.push("交割方式");
  if (!form.payment_method) displayMissingFields.push("付款方式");
  if (!form.specs) displayMissingFields.push("规格");
  const isValid = displayMissingFields.length === 0;

  const defaultFreeStorageDays = formTotalQty(form) >= 100 ? 7 : 3;
  const sideLabel = listing.side === "BUY" ? "求购" : "销售";

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-t-panel rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
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
              <h2 className="text-lg font-bold text-t-text">编辑挂盘</h2>
              <p className="text-xs text-t-text-3 mt-0.5">
                {sideLabel}{product?.name || listing.product_id}（{formatBoardSerial("L", listing.serial_no, listing.created_at)}）
                {filled > 0 && <span className="text-amber-500 ml-1">已成交 {filled} 吨，剩余 {remaining} 吨</span>}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-t-text-3 hover:text-t-text text-xl leading-none p-1"
          >
            ✕
          </button>
        </div>

        <ModalUpdateNotice show={dataUpdated} variant="updated" message={updateMessage} onDismiss={onDismissUpdate} />

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {termsLockedByCo && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              该盘已有 {pendingCoCount} 笔待处理商谈。为公平对待对手，盘面条款与可议范围暂不可改，请先在「商谈管理」处理后再编辑。
              {filled > 0 ? ` 已成交 ${filled} 吨不受影响。` : ""}
            </div>
          )}

          <div className={termsLockedByCo ? "pointer-events-none opacity-60 space-y-4" : "space-y-4"}>
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
                setForm((prev) => prev ? { ...prev, quantity: v } : prev);
                setMinQtyError("");
              }}
              onPerShareChange={(v) => {
                setForm((prev) => {
                  if (!prev) return prev;
                  const total = computeSharesTotal(v, prev.share_count);
                  return {
                    ...prev,
                    per_share: v,
                    min_quantity: v,
                    quantity: total > 0 ? String(total) : prev.quantity,
                  };
                });
                setMinQtyError("");
              }}
              onShareCountChange={(v) => {
                setForm((prev) => {
                  if (!prev) return prev;
                  const total = computeSharesTotal(prev.per_share, v);
                  return {
                    ...prev,
                    share_count: v,
                    quantity: total > 0 ? String(total) : prev.quantity,
                  };
                });
                setMinQtyError("");
              }}
              error={minQtyError}
            />
            {filled > 0 && (
              <p className="text-xs text-amber-500">整单数量不少于已成交 {filled} {unit}</p>
            )}
          </div>

          {/* 交割期 */}
          <div>
            <label className="block text-sm font-medium text-t-text-2 mb-1.5">交割期</label>
            <input
              type="text"
              value={form.delivery_period}
              onChange={(e) => update("delivery_period", sanitizeText(e.target.value))}
              list="edit-delivery-period-options"
              placeholder="选择或输入交割期"
              className="w-full px-3 py-2.5 border border-t-border rounded-lg text-sm bg-t-panel text-t-text focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
            />
            <datalist id="edit-delivery-period-options">
              {deliveryOptions.map((o) => <option key={o} value={o} />)}
            </datalist>
          </div>

          {/* 交割地 */}
          <div>
            <label className="block text-sm font-medium text-t-text-2 mb-1.5">交割地点</label>
            <Combobox
              value={form.delivery_location}
              onChange={(v) => update("delivery_location", v)}
              options={mergeSelectOptions(DELIVERY_LOCATION_OPTIONS, form.delivery_location)}
              placeholder="选择或输入交割地点"
              className="w-full px-3 py-2.5 border border-t-border rounded-lg text-sm bg-t-panel text-t-text focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
            />
          </div>

          {/* 规格 */}
          <div>
            <label className="block text-sm font-medium text-t-text-2 mb-1.5">产品规格</label>
            <Combobox
              value={form.specs}
              onChange={(v) => update("specs", v)}
              options={mergeSelectOptions(SPECS_OPTIONS, form.specs)}
              placeholder="选择或输入产品规格"
              className="w-full px-3 py-2.5 border border-t-border rounded-lg text-sm bg-t-panel text-t-text focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
            />
          </div>

          {/* 付款方式 */}
          <div>
            <label className="block text-sm font-medium text-t-text-2 mb-1.5">付款方式</label>
            <input
              type="text"
              value={form.payment_method}
              onChange={(e) => update("payment_method", sanitizeText(e.target.value))}
              list="edit-payment-method-options"
              placeholder="选择或输入付款方式"
              className="w-full px-3 py-2.5 border border-t-border rounded-lg text-sm bg-t-panel text-t-text focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
            />
            <datalist id="edit-payment-method-options">
              {PAYMENT_METHOD_OPTIONS.map((o) => <option key={o} value={o} />)}
            </datalist>
          </div>

          {/* 交割方式 */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-t-text-2 mb-1.5">
              交割方式
              <Tooltip content="货物交付的方式：混罐货转（多方拼罐后过户）、货转（整批货权过户）、自提（买方自行提货）、送到（卖方送货上门）。可自定义输入其他方式。">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-t-text-3 text-white text-[10px] cursor-help">?</span>
              </Tooltip>
            </label>
            <input
              type="text"
              value={form.delivery_method}
              onChange={(e) => update("delivery_method", sanitizeText(e.target.value))}
              list="edit-delivery-method-options"
              placeholder="选择或输入交割方式"
              className="w-full px-3 py-2.5 border border-t-border rounded-lg text-sm bg-t-panel text-t-text focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
            />
            <datalist id="edit-delivery-method-options">
              {DELIVERY_METHOD_OPTIONS.map((o) => <option key={o} value={o} />)}
            </datalist>
          </div>

          {/* 免仓期 */}
          <div className="p-3 bg-t-hover rounded-lg border border-t-border space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.free_storage_enabled}
                  onChange={(e) => setForm((prev) => prev ? { ...prev, free_storage_enabled: e.target.checked } : prev)}
                  className="w-4 h-4 text-brand-600 rounded focus:ring-brand-500"
                />
                <span className="text-sm font-medium text-t-text">可以免仓</span>
              </label>
              <Tooltip content={`免仓期是指成交后买方可免费存储货物的天数，超期后按约定收取仓储费。`}>
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-t-text-3 text-white text-[10px] cursor-help">?</span>
              </Tooltip>
            </div>

            {form.free_storage_enabled ? (
              <div className="flex items-center gap-2 pl-6">
                <label className="text-xs text-t-text-3 shrink-0">免仓天数</label>
                <input
                  type="number"
                  value={form.free_storage_days}
                  onChange={(e) => setForm((prev) => prev ? { ...prev, free_storage_days: e.target.value } : prev)}
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
                  onChange={(e) => setForm((prev) => prev ? { ...prev, allow_counter_offer: e.target.checked } : prev)}
                  className="w-4 h-4 text-brand-600 rounded focus:ring-brand-500"
                />
                <span className="text-sm font-medium text-t-text">允许商谈</span>
              </label>
            </div>

            {form.allow_counter_offer && (
              <div className="pl-6 pt-1">
                <div className="flex items-center justify-end gap-2 mb-1 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => setForm((prev) => prev ? { ...prev, negotiable_terms: NEGOTIABLE_TERMS.map((t) => t.key) } : prev)}
                    className="text-xs text-brand-600 hover:text-brand-500 font-medium"
                  >
                    全选
                  </button>
                  <span className="text-t-text-3 text-xs">|</span>
                  <button
                    type="button"
                    onClick={() => setForm((prev) => prev ? { ...prev, negotiable_terms: [] } : prev)}
                    className="text-xs text-brand-600 hover:text-brand-500 font-medium"
                  >
                    全取消
                  </button>
                </div>
                <div className="text-xs text-t-text-3 mb-1.5">
                  可商谈条款范围（取消勾选的条款对方不可在商谈中修改）
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {NEGOTIABLE_TERMS.map((t) => (
                    <label key={t.key} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.negotiable_terms.includes(t.key)}
                        onChange={(e) => {
                          setForm((prev) => {
                            if (!prev) return prev;
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
          </div>

          {/* 开始时间 */}
          <div>
            <label className="block text-sm font-medium text-t-text-2 mb-1.5">
              开始时间
              <span className="ml-2 text-xs font-normal text-t-text-3">空=立即发布</span>
            </label>
            <input
              type="datetime-local"
              value={form.starts_at}
              onChange={(e) => update("starts_at", e.target.value)}
              disabled={termsLockedByCo}
              className="w-full px-3 py-2.5 border border-sky-400/60 rounded-lg text-sm bg-sky-50/50 dark:bg-sky-950/20 text-t-text focus:ring-2 focus:ring-sky-400 focus:border-sky-500 outline-none disabled:opacity-50"
            />
            <div className="mt-1.5 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={termsLockedByCo}
                onClick={() => update("starts_at", defaultStartsAtLocal())}
                className="text-xs px-2 py-1 rounded border border-sky-400/50 text-sky-800 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/40 disabled:opacity-40"
              >
                立即发布
              </button>
              <button
                type="button"
                disabled={termsLockedByCo}
                onClick={() => {
                  const now = new Date();
                  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
                  update("starts_at", toDatetimeLocalValue(d));
                }}
                className="text-xs px-2 py-1 rounded border border-t-border text-t-text-2 hover:bg-t-hover disabled:opacity-40"
              >
                明日9:00
              </button>
            </div>
          </div>

          {/* 过期时间 */}
          <div>
            <label className="block text-sm font-medium text-t-text-2 mb-1.5">
              过期时间
              <span className="ml-2 text-xs font-normal text-t-text-3">可修改</span>
            </label>
            <input
              type="datetime-local"
              value={form.expires_at}
              onChange={(e) => update("expires_at", e.target.value)}
              disabled={termsLockedByCo}
              className="w-full px-3 py-2.5 border border-amber-400/60 rounded-lg text-sm bg-amber-50/50 dark:bg-amber-950/20 text-t-text focus:ring-2 focus:ring-amber-400 focus:border-amber-500 outline-none disabled:opacity-50"
            />
            <div className="mt-1.5 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={termsLockedByCo}
                onClick={() => update("expires_at", defaultExpiresAtLocal())}
                className="text-xs px-2 py-1 rounded border border-amber-400/50 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-40"
              >
                当日18:00
              </button>
              <button
                type="button"
                disabled={termsLockedByCo}
                onClick={() => {
                  const now = new Date();
                  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 18, 0, 0, 0);
                  update("expires_at", toDatetimeLocalValue(d));
                }}
                className="text-xs px-2 py-1 rounded border border-t-border text-t-text-2 hover:bg-t-hover disabled:opacity-40"
              >
                次日18:00
              </button>
              <button
                type="button"
                disabled={termsLockedByCo}
                onClick={() => update("expires_at", defaultExpiresAtLocal())}
                className="text-xs px-2 py-1 rounded border border-t-border text-t-text-2 hover:bg-t-hover disabled:opacity-40"
              >
                恢复默认
              </button>
            </div>
          </div>

          {!isValid && !termsLockedByCo && (
            <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-400">
              还需填写：{displayMissingFields.join("、")}
            </div>
          )}
          <button
            type="submit"
            disabled={!isValid || loading || termsLockedByCo}
            className="w-full py-3 rounded-lg text-white font-bold text-sm transition-colors bg-brand-600 hover:bg-brand-700 disabled:bg-t-hover disabled:text-t-text-3 disabled:cursor-not-allowed"
          >
            {loading ? "提交中..." : termsLockedByCo ? "请先处理商谈" : "保存修改"}
          </button>
        </form>
      </div>
    </div>
  );
}
