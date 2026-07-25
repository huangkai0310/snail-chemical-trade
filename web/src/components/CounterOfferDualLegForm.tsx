"use client";

import { useState, useEffect, useMemo } from "react";
import type { SwapListing } from "@/lib/types";
import { DEFAULT_NEGOTIABLE_TERMS, sanitizeNegotiableTerms } from "@/lib/types";
import { DELIVERY_METHOD_OPTIONS } from "@/components/CreateListingModal";
import Combobox from "@/components/ui/Combobox";
import DeliveryPeriodPicker from "@/components/DeliveryPeriodPicker";
import { sanitizeText, isSafeInput } from "@/lib/validate";
import { formatNegotiableTerms, formatFreeStorage, formatPartial, formatSpecs, formatBoardSerial } from "@/lib/format";
import { optionalOfferField, optionalOfferFreeStorage } from "@/lib/swap-counter-offer";
import type { CounterOffer } from "@/lib/types";
import { confirmDialog } from "./ConfirmDialog";
import { CounterOfferConfirmSheet } from "./PostingConfirmSheet";
import { getSharePickState, shareCountFromQty } from "@/lib/swap-lock";

const LABEL_CLS = "text-t-text-3 shrink-0";
const VALUE_CLS = "text-t-text font-medium text-right";
const PAYMENT_METHOD_OPTIONS = ["先款后货", "先货后款", "预付10%保证金，交货前付全款", "货到付款", "款到发货"];

function fmtPeriod(p?: string | null) {
  if (!p || p.trim() === "") return "现货";
  return p;
}

export interface LegPrefill {
  price: number;
  remain: number;
  dp: string;
  dl: string;
  pm: string;
  dm: string;
  fse: boolean;
  fsd: string;
  sp: string;
  allowCO: boolean;
  terms?: string[] | null;
  allowPartial: boolean;
  minQty?: number;
}

export interface DualLegSubmitParams {
  mode: "sell" | "buy";
  offer_price: number;
  offer_quantity: number;
  offer_delivery_period?: string;
  offer_delivery_location?: string;
  offer_payment_method?: string;
  offer_delivery_method?: string;
  offer_free_storage_enabled?: boolean;
  offer_free_storage_days?: number | null;
  offer_specs?: string;
}

interface LegForm {
  price: string;
  quantity: string;
  shareCount: string;
  deliveryPeriod: string;
  deliveryLocation: string;
  paymentMethod: string;
  deliveryMethod: string;
  freeStorageEnabled: boolean;
  freeStorageDays: string;
  specs: string;
}

interface Props {
  swap: SwapListing;
  sellPrefill: LegPrefill;
  buyPrefill: LegPrefill;
  unit?: string;
  loading?: boolean;
  error?: string | null;
  touched: boolean;
  onTouched: (v: boolean) => void;
  onClose: () => void;
  opponentWithdrawn?: boolean;
  isEditMode?: boolean;
  editSellCo?: CounterOffer | null;
  editBuyCo?: CounterOffer | null;
  onSubmit: (offers: DualLegSubmitParams[]) => void;
  onUpdate?: (updates: { id: string; params: Omit<DualLegSubmitParams, "mode"> }[]) => void;
}

function legAllowedTerms(terms?: string[] | null): Set<string> {
  if (terms && terms.length > 0) return new Set(sanitizeNegotiableTerms(terms));
  return new Set(DEFAULT_NEGOTIABLE_TERMS);
}

function prefilledLegForm(prefill: LegPrefill, qty?: number): LegForm {
  const q = qty ?? prefill.remain;
  const pick = getSharePickState(prefill.remain, prefill.minQty ?? 0, prefill.allowPartial);
  const initQty = q > 0 ? Math.floor(q) : 0;
  if (pick.canPickShares && initQty > 0) {
    const sc = shareCountFromQty(initQty, pick.perShare, pick.maxShares);
    return {
      price: String(prefill.price),
      quantity: String(Math.floor(Number(sc) || 0) * pick.perShare),
      shareCount: sc,
      deliveryPeriod: prefill.dp,
      deliveryLocation: prefill.dl,
      paymentMethod: prefill.pm,
      deliveryMethod: prefill.dm,
      freeStorageEnabled: prefill.fse,
      freeStorageDays: prefill.fsd,
      specs: prefill.sp,
    };
  }
  return {
    price: String(prefill.price),
    quantity: initQty > 0 ? String(initQty) : "",
    shareCount: "",
    deliveryPeriod: prefill.dp,
    deliveryLocation: prefill.dl,
    paymentMethod: prefill.pm,
    deliveryMethod: prefill.dm,
    freeStorageEnabled: prefill.fse,
    freeStorageDays: prefill.fsd,
    specs: prefill.sp,
  };
}

function legFormFromCO(co: CounterOffer, prefill: LegPrefill): LegForm {
  const pick = getSharePickState(prefill.remain, prefill.minQty ?? 0, prefill.allowPartial);
  const q = Math.floor(co.offer_quantity);
  const sc = pick.canPickShares ? shareCountFromQty(q, pick.perShare, pick.maxShares) : "";
  return {
    price: String(co.offer_price),
    quantity: String(q),
    shareCount: sc,
    deliveryPeriod: co.offer_delivery_period ?? prefill.dp,
    deliveryLocation: co.offer_delivery_location ?? prefill.dl,
    paymentMethod: co.offer_payment_method ?? prefill.pm,
    deliveryMethod: co.offer_delivery_method ?? prefill.dm,
    freeStorageEnabled: co.offer_free_storage_enabled ?? prefill.fse,
    freeStorageDays:
      co.offer_free_storage_days != null ? String(co.offer_free_storage_days) : prefill.fsd,
    specs: co.offer_specs ?? prefill.sp,
  };
}

function validateLegQty(
  qty: number,
  remain: number,
  allowPartial: boolean,
  minQty: number | undefined,
  unit: string,
  legLabel: string
): string | null {
  if (Number.isNaN(qty) || qty <= 0) return `${legLabel}数量必须大于 0`;
  if (qty > remain) return `${legLabel}数量不能超过剩余 ${remain} ${unit}`;
  if (!allowPartial && qty !== remain) return `${legLabel}不可拆单，须整单 ${remain} ${unit}`;
  if (allowPartial && minQty && minQty > 0) {
    const min = Math.floor(minQty);
    if (qty !== remain || remain >= min * 2) {
      if (qty < min) return `${legLabel}数量不能低于最小成交量 ${min} ${unit}`;
      if (qty % min !== 0) return `${legLabel}数量须为每份 ${min} ${unit} 的整数倍`;
    }
  }
  return null;
}

function buildLegParams(
  leg: "sell" | "buy",
  form: LegForm,
  prefill: LegPrefill,
  allowed: Set<string>
): DualLegSubmitParams {
  const priceNum = Number(form.price);
  const pick = getSharePickState(prefill.remain, prefill.minQty ?? 0, prefill.allowPartial);
  const canPick = allowed.has("quantity") && pick.canPickShares;
  const qtyNum = canPick
    ? Math.floor(Number(form.shareCount) || 0) * pick.perShare
    : Math.floor(Number(form.quantity));
  const fs = optionalOfferFreeStorage(
    allowed.has("free_storage"),
    form.freeStorageEnabled,
    form.freeStorageDays,
    prefill.fse,
    prefill.fsd
  );
  return {
    mode: leg,
    offer_price: allowed.has("price") && priceNum !== prefill.price ? priceNum : prefill.price,
    offer_quantity: allowed.has("quantity") && qtyNum !== prefill.remain ? qtyNum : prefill.remain,
    offer_delivery_period: optionalOfferField(allowed.has("delivery_period"), form.deliveryPeriod, prefill.dp),
    offer_delivery_location: optionalOfferField(allowed.has("delivery_location"), form.deliveryLocation, prefill.dl),
    offer_payment_method: optionalOfferField(allowed.has("payment_method"), form.paymentMethod, prefill.pm),
    offer_delivery_method: optionalOfferField(allowed.has("delivery_method"), form.deliveryMethod, prefill.dm),
    offer_free_storage_enabled: fs.enabled,
    offer_free_storage_days: fs.days,
    offer_specs: optionalOfferField(allowed.has("specs"), form.specs, prefill.sp),
  };
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 text-xs">
      <span className={LABEL_CLS}>{label}</span>
      <span className={`${VALUE_CLS} break-all`}>{value}</span>
    </div>
  );
}

function LegNegotiationColumn({
  leg,
  label,
  subLabel,
  colorCls,
  borderCls,
  prefill,
  form,
  setForm,
  allowed,
  unit,
  loading,
  highlightInputCls,
}: {
  leg: "sell" | "buy";
  label: string;
  subLabel: string;
  colorCls: string;
  borderCls: string;
  prefill: LegPrefill;
  form: LegForm;
  setForm: (fn: (prev: LegForm) => LegForm) => void;
  allowed: Set<string>;
  unit: string;
  loading?: boolean;
  highlightInputCls: string;
}) {
  const priceNum = Number(form.price);
  const pick = getSharePickState(prefill.remain, prefill.minQty ?? 0, prefill.allowPartial);
  const canPickShares = allowed.has("quantity") && pick.canPickShares;
  const qtyNum = canPickShares
    ? Math.floor(Number(form.shareCount) || 0) * pick.perShare
    : Math.floor(Number(form.quantity));
  const offererSide = leg === "sell" ? "BUY" : "SELL";
  const isDisadvantage =
    priceNum > 0 &&
    prefill.price > 0 &&
    ((offererSide === "BUY" && priceNum > prefill.price) || (offererSide === "SELL" && priceNum < prefill.price));

  if (!prefill.allowCO) {
    return (
      <div className={`rounded-xl p-4 border ${borderCls} opacity-70`}>
        <div className="flex items-center gap-2 mb-2">
          <span className={`w-5 h-5 rounded-full text-white text-[10px] flex items-center justify-center font-bold ${colorCls}`}>
            {leg === "sell" ? "卖" : "买"}
          </span>
          <span className="text-sm font-semibold">{label}</span>
        </div>
        <p className="text-xs text-t-text-3">{subLabel}</p>
        <p className="mt-3 text-sm text-amber-500">该侧不可商谈</p>
      </div>
    );
  }

  const update = <K extends keyof LegForm>(key: K, value: LegForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className={`rounded-xl p-4 border ${borderCls}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`w-5 h-5 rounded-full text-white text-[10px] flex items-center justify-center font-bold ${colorCls}`}>
          {leg === "sell" ? "卖" : "买"}
        </span>
        <span className="text-sm font-semibold">{label}</span>
      </div>
      <p className="text-xs text-t-text-3 mb-3">{subLabel}</p>

      <div className="rounded-lg p-3 space-y-1.5 mb-3 bg-slate-100/90 dark:bg-slate-800/50 border border-slate-300/80 dark:border-slate-600/60 border-l-4 border-l-slate-400 dark:border-l-slate-500">
        <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-0.5">原盘条款（不可商谈）</div>
        {!allowed.has("price") && (
          <InfoRow label="价格" value={`¥${prefill.price.toLocaleString()}/${unit}`} />
        )}
        <InfoRow label="数量" value={`${prefill.remain.toLocaleString()} ${unit}`} />
        <InfoRow label="数量方式" value={formatPartial(prefill.allowPartial, prefill.minQty, unit, prefill.remain)} />
        {!allowed.has("delivery_period") && (
          <InfoRow label="交割期" value={prefill.dp || "现货"} />
        )}
        <InfoRow label="交割地" value={prefill.dl || "-"} />
        {!allowed.has("payment_method") && (
          <InfoRow label="付款方式" value={prefill.pm || "-"} />
        )}
        {!allowed.has("delivery_method") && (
          <InfoRow label="交割方式" value={prefill.dm || "-"} />
        )}
        {!allowed.has("free_storage") && (
          <InfoRow
            label="免仓期"
            value={formatFreeStorage(prefill.fse, prefill.fsd ? Number(prefill.fsd) : null)}
          />
        )}
        <InfoRow label="规格" value={formatSpecs(prefill.sp) || "-"} />
        <InfoRow label="可商谈条款" value={formatNegotiableTerms(Array.from(allowed))} />
      </div>

      {allowed.size > 0 && (
        <div className="rounded-lg p-3 space-y-2.5 bg-amber-50/90 dark:bg-amber-950/30 border border-amber-400/70 dark:border-amber-500/50 border-l-4 border-l-amber-500">
          <div className="text-xs font-semibold text-amber-800 dark:text-amber-300">
            可商谈条款
            <span className="ml-1.5 text-[10px] font-normal text-amber-700/80 dark:text-amber-400/80">蓝色高亮可改</span>
          </div>

          {allowed.has("price") && (
            <div>
              <label className="block text-xs text-t-text-3 mb-1">商谈价格 (¥/{unit})</label>
              <p className="text-[10px] text-t-text-3 mb-1">原价 ¥{prefill.price.toLocaleString()}/{unit}</p>
              <input
                type="number"
                value={form.price}
                onChange={(e) => update("price", e.target.value)}
                className={`${highlightInputCls} font-mono text-sm`}
                readOnly={loading}
                disabled={loading}
              />
              {isDisadvantage && (
                <p className="mt-1 text-[10px] text-status-error">价格对您可能不利，请确认</p>
              )}
            </div>
          )}

          {allowed.has("delivery_period") && (
            <div>
              <label className="flex items-center justify-between text-xs text-t-text-3 mb-1">
                <span>交割期</span>
                <span className="text-t-text-2 font-normal">原值：{prefill.dp || "—"}</span>
              </label>
              <DeliveryPeriodPicker
                value={form.deliveryPeriod}
                onChange={(v) => update("deliveryPeriod", v)}
                placeholder="在日历中选择交割期"
              />
            </div>
          )}

          {allowed.has("payment_method") && (
            <div>
              <label className="flex items-center justify-between text-xs text-t-text-3 mb-1">
                <span>付款方式</span>
                <span className="text-t-text-2 font-normal">原值：{prefill.pm || "—"}</span>
              </label>
              <Combobox
                value={form.paymentMethod}
                onChange={(v) => update("paymentMethod", v)}
                options={PAYMENT_METHOD_OPTIONS}
                placeholder={prefill.pm || "选择或输入付款方式"}
                disabled={loading}
                readOnly={loading}
                className={`${highlightInputCls} text-sm`}
              />
            </div>
          )}

          {allowed.has("delivery_method") && (
            <div>
              <label className="flex items-center justify-between text-xs text-t-text-3 mb-1">
                <span>交割方式</span>
                <span className="text-t-text-2 font-normal">原值：{prefill.dm || "—"}</span>
              </label>
              <Combobox
                value={form.deliveryMethod}
                onChange={(v) => update("deliveryMethod", v)}
                options={DELIVERY_METHOD_OPTIONS}
                placeholder={prefill.dm || "选择或输入交割方式"}
                disabled={loading}
                readOnly={loading}
                className={`${highlightInputCls} text-sm`}
              />
            </div>
          )}

          {allowed.has("free_storage") && (
            <div>
              <label className="flex items-center justify-between text-xs text-t-text-3 mb-1">
                <span>免仓</span>
                <span className="text-t-text-2 font-normal">
                  原值：{prefill.fse ? `${prefill.fsd || "—"}天` : "不免仓"}
                </span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.freeStorageEnabled}
                  onChange={(e) => update("freeStorageEnabled", e.target.checked)}
                  className="w-4 h-4 accent-brand-600"
                  disabled={loading}
                />
                <label className="text-xs text-t-text-2 shrink-0">可免仓</label>
                <input
                  type="number"
                  value={form.freeStorageDays}
                  onChange={(e) => update("freeStorageDays", e.target.value)}
                  placeholder="天数"
                  disabled={!form.freeStorageEnabled || loading}
                  readOnly={!form.freeStorageEnabled || loading}
                  className={`${highlightInputCls} flex-1 text-sm`}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {qtyNum > 0 && (
        <p className="mt-2 text-[10px] text-t-text-3">
          预计成交额 ¥{(qtyNum * (allowed.has("price") ? priceNum : prefill.price)).toLocaleString()}
        </p>
      )}
    </div>
  );
}

export default function CounterOfferDualLegForm({
  swap,
  sellPrefill,
  buyPrefill,
  unit = "吨",
  loading,
  error,
  touched,
  onTouched,
  onClose,
  opponentWithdrawn,
  isEditMode,
  editSellCo,
  editBuyCo,
  onSubmit,
  onUpdate,
}: Props) {
  const [sellForm, setSellForm] = useState<LegForm>(() =>
    isEditMode && editSellCo ? legFormFromCO(editSellCo, sellPrefill) : prefilledLegForm(sellPrefill)
  );
  const [buyForm, setBuyForm] = useState<LegForm>(() =>
    isEditMode && editBuyCo ? legFormFromCO(editBuyCo, buyPrefill) : prefilledLegForm(buyPrefill)
  );

  const sellAllowed = useMemo(() => legAllowedTerms(sellPrefill.terms), [sellPrefill.terms]);
  const buyAllowed = useMemo(() => legAllowedTerms(buyPrefill.terms), [buyPrefill.terms]);

  useEffect(() => {
    setSellForm(isEditMode && editSellCo ? legFormFromCO(editSellCo, sellPrefill) : prefilledLegForm(sellPrefill));
    setBuyForm(isEditMode && editBuyCo ? legFormFromCO(editBuyCo, buyPrefill) : prefilledLegForm(buyPrefill));
    onTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swap.id, isEditMode, editSellCo?.id, editBuyCo?.id]);

  const sellPick = getSharePickState(sellPrefill.remain, sellPrefill.minQty ?? 0, sellPrefill.allowPartial);
  const buyPick = getSharePickState(buyPrefill.remain, buyPrefill.minQty ?? 0, buyPrefill.allowPartial);
  const sellCanPick = sellAllowed.has("quantity") && sellPick.canPickShares;
  const buyCanPick = buyAllowed.has("quantity") && buyPick.canPickShares;

  const sellQtyNum = sellCanPick
    ? Math.floor(Number(sellForm.shareCount) || 0) * sellPick.perShare
    : Math.floor(Number(sellForm.quantity));
  const buyQtyNum = buyCanPick
    ? Math.floor(Number(buyForm.shareCount) || 0) * buyPick.perShare
    : Math.floor(Number(buyForm.quantity));
  const sellPriceNum = Number(sellForm.price);
  const buyPriceNum = Number(buyForm.price);

  const validationError = (() => {
    if (sellPrefill.allowCO) {
      if (Number.isNaN(sellPriceNum) || sellPriceNum <= 0) return "卖盘商谈价格必须大于 0";
      if (sellCanPick) {
        const n = Math.floor(Number(sellForm.shareCount));
        if (!sellForm.shareCount || n <= 0) return "请选择卖盘商谈份数";
        if (n > sellPick.maxShares) return `卖盘最多 ${sellPick.maxShares} 份`;
      }
      const err = validateLegQty(
        sellQtyNum,
        sellPrefill.remain,
        sellPrefill.allowPartial,
        sellPrefill.minQty,
        unit,
        "卖盘"
      );
      if (err) return err;
    }
    if (buyPrefill.allowCO) {
      if (Number.isNaN(buyPriceNum) || buyPriceNum <= 0) return "买盘商谈价格必须大于 0";
      if (buyCanPick) {
        const n = Math.floor(Number(buyForm.shareCount));
        if (!buyForm.shareCount || n <= 0) return "请选择买盘商谈份数";
        if (n > buyPick.maxShares) return `买盘最多 ${buyPick.maxShares} 份`;
      }
      const err = validateLegQty(
        buyQtyNum,
        buyPrefill.remain,
        buyPrefill.allowPartial,
        buyPrefill.minQty,
        unit,
        "买盘"
      );
      if (err) return err;
    }
    return null;
  })();

  const isValid =
    (sellPrefill.allowCO || buyPrefill.allowCO) &&
    !validationError &&
    (!sellPrefill.allowCO || (sellPriceNum > 0 && sellQtyNum > 0)) &&
    (!buyPrefill.allowCO || (buyPriceNum > 0 && buyQtyNum > 0));

  const highlightInputCls =
    "w-full px-3 py-2 border border-blue-400/70 border-l-4 border-l-blue-500 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-t-text focus:outline-none focus:ring-2 focus:ring-amber-300 read-only:cursor-not-allowed read-only:opacity-60";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    onTouched(true);
    if (!isValid) return;

    const textFields = [
      sellForm.deliveryPeriod, sellForm.deliveryLocation, sellForm.paymentMethod, sellForm.deliveryMethod, sellForm.specs,
      buyForm.deliveryPeriod, buyForm.deliveryLocation, buyForm.paymentMethod, buyForm.deliveryMethod, buyForm.specs,
    ];
    if (textFields.some((f) => !isSafeInput(f))) return;

    const offers: DualLegSubmitParams[] = [];
    if (sellPrefill.allowCO) {
      offers.push(buildLegParams("sell", sellForm, sellPrefill, sellAllowed));
    }
    if (buyPrefill.allowCO) {
      offers.push(buildLegParams("buy", buyForm, buyPrefill, buyAllowed));
    }
    if (offers.length === 0) return;
    if (isEditMode && onUpdate) {
      const updates: { id: string; params: Omit<DualLegSubmitParams, "mode"> }[] = [];
      if (sellPrefill.allowCO && editSellCo) {
        const p = buildLegParams("sell", sellForm, sellPrefill, sellAllowed);
        const { mode: _m, ...rest } = p;
        updates.push({ id: editSellCo.id, params: rest });
      }
      if (buyPrefill.allowCO && editBuyCo) {
        const p = buildLegParams("buy", buyForm, buyPrefill, buyAllowed);
        const { mode: _m, ...rest } = p;
        updates.push({ id: editBuyCo.id, params: rest });
      }
      if (!updates.length) return;
      const ok = await confirmDialog({
        title: "确认保存商谈",
        message: `确认保存双向换盘商谈修改（共 ${updates.length} 条）？`,
        content: (
          <div className="space-y-3 text-sm">
            <p className="text-t-text leading-relaxed font-medium">
              请核对双向换盘商谈修改（共 {updates.length} 条），确认无误后再保存。
            </p>
            {sellPrefill.allowCO && editSellCo && (() => {
              const p = buildLegParams("sell", sellForm, sellPrefill, sellAllowed);
              return (
                <CounterOfferConfirmSheet
                  sideTitle="卖盘商谈"
                  modeLabel="换盘·卖盘"
                  serialLabel={formatBoardSerial("S", swap.serial_no, swap.created_at)}
                  offer={{
                    price: p.offer_price,
                    quantity: p.offer_quantity,
                    delivery_period: p.offer_delivery_period ?? sellPrefill.dp,
                    delivery_location: p.offer_delivery_location ?? sellPrefill.dl,
                    payment_method: p.offer_payment_method ?? sellPrefill.pm,
                    delivery_method: p.offer_delivery_method ?? sellPrefill.dm,
                    free_storage_enabled: p.offer_free_storage_enabled ?? sellPrefill.fse,
                    free_storage_days: p.offer_free_storage_days ?? (sellPrefill.fsd ? Number(sellPrefill.fsd) : null),
                    specs: p.offer_specs ?? sellPrefill.sp,
                  }}
                  refTerms={{
                    price: sellPrefill.price,
                    quantity: sellPrefill.remain,
                    delivery_period: sellPrefill.dp,
                    delivery_location: sellPrefill.dl,
                    payment_method: sellPrefill.pm,
                    delivery_method: sellPrefill.dm,
                    free_storage_enabled: sellPrefill.fse,
                    free_storage_days: sellPrefill.fsd ? Number(sellPrefill.fsd) : null,
                    specs: sellPrefill.sp,
                  }}
                />
              );
            })()}
            {buyPrefill.allowCO && editBuyCo && (() => {
              const p = buildLegParams("buy", buyForm, buyPrefill, buyAllowed);
              return (
                <CounterOfferConfirmSheet
                  sideTitle="买盘商谈"
                  modeLabel="换盘·买盘"
                  offer={{
                    price: p.offer_price,
                    quantity: p.offer_quantity,
                    delivery_period: p.offer_delivery_period ?? buyPrefill.dp,
                    delivery_location: p.offer_delivery_location ?? buyPrefill.dl,
                    payment_method: p.offer_payment_method ?? buyPrefill.pm,
                    delivery_method: p.offer_delivery_method ?? buyPrefill.dm,
                    free_storage_enabled: p.offer_free_storage_enabled ?? buyPrefill.fse,
                    free_storage_days: p.offer_free_storage_days ?? (buyPrefill.fsd ? Number(buyPrefill.fsd) : null),
                    specs: p.offer_specs ?? buyPrefill.sp,
                  }}
                  refTerms={{
                    price: buyPrefill.price,
                    quantity: buyPrefill.remain,
                    delivery_period: buyPrefill.dp,
                    delivery_location: buyPrefill.dl,
                    payment_method: buyPrefill.pm,
                    delivery_method: buyPrefill.dm,
                    free_storage_enabled: buyPrefill.fse,
                    free_storage_days: buyPrefill.fsd ? Number(buyPrefill.fsd) : null,
                    specs: buyPrefill.sp,
                  }}
                />
              );
            })()}
            <p className="text-[11px] text-t-text-3 leading-relaxed">
              保存后将通知对方，请核对后再确认。
            </p>
          </div>
        ),
        wide: true,
        variant: "warning",
        icon: "warning",
        confirmText: "确认保存",
        cancelText: "再想想",
      });
      if (!ok) return;
      onUpdate(updates);
      return;
    }
    const ok = await confirmDialog({
      title: "确认发起商谈",
      message: `确认向对方发起双向换盘商谈（共 ${offers.length} 条）？`,
      content: (
        <div className="space-y-3 text-sm">
          <p className="text-t-text leading-relaxed font-medium">
            请核对双向换盘商谈（共 {offers.length} 条），确认无误后再发出。
          </p>
          {offers.map((o) => {
            const pref = o.mode === "sell" ? sellPrefill : buyPrefill;
            return (
              <CounterOfferConfirmSheet
                key={o.mode}
                sideTitle={o.mode === "sell" ? "卖盘商谈" : "买盘商谈"}
                modeLabel={o.mode === "sell" ? "换盘·卖盘" : "换盘·买盘"}
                serialLabel={formatBoardSerial("S", swap.serial_no, swap.created_at)}
                offer={{
                  price: o.offer_price,
                  quantity: o.offer_quantity,
                  delivery_period: o.offer_delivery_period ?? pref.dp,
                  delivery_location: o.offer_delivery_location ?? pref.dl,
                  payment_method: o.offer_payment_method ?? pref.pm,
                  delivery_method: o.offer_delivery_method ?? pref.dm,
                  free_storage_enabled: o.offer_free_storage_enabled ?? pref.fse,
                  free_storage_days: o.offer_free_storage_days ?? (pref.fsd ? Number(pref.fsd) : null),
                  specs: o.offer_specs ?? pref.sp,
                }}
                refTerms={{
                  price: pref.price,
                  quantity: pref.remain,
                  delivery_period: pref.dp,
                  delivery_location: pref.dl,
                  payment_method: pref.pm,
                  delivery_method: pref.dm,
                  free_storage_enabled: pref.fse,
                  free_storage_days: pref.fsd ? Number(pref.fsd) : null,
                  specs: pref.sp,
                }}
              />
            );
          })}
          <p className="text-[11px] text-t-text-3 leading-relaxed">
            发出后对方可分别接受或拒绝，请核对后再发出。
          </p>
        </div>
      ),
      wide: true,
      variant: "warning",
      icon: "warning",
      confirmText: "确认发出",
      cancelText: "再想想",
    });
    if (!ok) return;
    onSubmit(offers);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-xs text-t-text-3">对方挂盘条款对比</p>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-600 dark:text-blue-400 font-medium">卖</span>
            <span className="text-t-text-3">对方卖出</span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between"><span className={LABEL_CLS}>价格</span><span className="font-mono font-bold text-green-600 dark:text-green-400">¥{sellPrefill.price.toLocaleString()}</span></div>
            <div className="flex justify-between"><span className={LABEL_CLS}>数量</span><span className={`font-mono ${VALUE_CLS}`}>{sellPrefill.remain}{unit}</span></div>
            <div className="flex justify-between"><span className={LABEL_CLS}>交割地</span><span className={VALUE_CLS}>{sellPrefill.dl || "-"}</span></div>
            <div className="flex justify-between"><span className={LABEL_CLS}>拆单</span><span className={VALUE_CLS}>{formatPartial(sellPrefill.allowPartial, sellPrefill.minQty, unit)}</span></div>
          </div>
        </div>
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-600 dark:text-blue-400 font-medium">买</span>
            <span className="text-t-text-3">对方买入</span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between"><span className={LABEL_CLS}>价格</span><span className="font-mono font-bold text-red-600 dark:text-red-400">¥{buyPrefill.price.toLocaleString()}</span></div>
            <div className="flex justify-between"><span className={LABEL_CLS}>数量</span><span className={`font-mono ${VALUE_CLS}`}>{buyPrefill.remain}{unit}</span></div>
            <div className="flex justify-between"><span className={LABEL_CLS}>交割地</span><span className={VALUE_CLS}>{buyPrefill.dl || "-"}</span></div>
            <div className="flex justify-between"><span className={LABEL_CLS}>拆单</span><span className={VALUE_CLS}>{formatPartial(buyPrefill.allowPartial, buyPrefill.minQty, unit)}</span></div>
          </div>
        </div>
      </div>

      <p className="text-xs text-blue-600 dark:text-blue-400 px-1">
        卖盘、买盘数量可分别填写，须遵守各侧拆单与最小成交量限制
      </p>

      <div className="grid grid-cols-2 gap-4">
        <LegNegotiationColumn
          leg="sell"
          label="卖盘商谈"
          subLabel="您买入对方卖盘"
          colorCls="bg-green-500"
          borderCls="bg-green-500/5 border-green-500/30 dark:bg-green-500/10"
          prefill={sellPrefill}
          form={sellForm}
          setForm={setSellForm}
          allowed={sellAllowed}
          unit={unit}
          loading={loading}
          highlightInputCls={highlightInputCls}
        />
        <LegNegotiationColumn
          leg="buy"
          label="买盘商谈"
          subLabel="您卖出接对方买盘"
          colorCls="bg-red-500"
          borderCls="bg-red-500/5 border-red-500/30 dark:bg-red-500/10"
          prefill={buyPrefill}
          form={buyForm}
          setForm={setBuyForm}
          allowed={buyAllowed}
          unit={unit}
          loading={loading}
          highlightInputCls={highlightInputCls}
        />
      </div>

      {(touched || error) && validationError && (
        <p className="text-sm text-status-error">{validationError}</p>
      )}
      {error && !validationError && (
        <p className="text-sm text-status-error">{error}</p>
      )}

      <p className="text-xs text-t-text-3">
        {isEditMode
          ? "修改双向换盘商谈：卖盘、买盘条款分别保存。"
          : "将分别为可商谈的卖盘、买盘各发起一条商谈记录，对方可分别接受或拒绝。未修改的条款沿用原盘。"}
      </p>

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
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
    </form>
  );
}
