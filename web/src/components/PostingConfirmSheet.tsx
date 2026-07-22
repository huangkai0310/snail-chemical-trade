"use client";

import type { ReactNode } from "react";
import type { CounterOffer, Listing, SwapListing } from "@/lib/types";
import { NEGOTIABLE_TERMS } from "@/lib/types";
import { swapLockSideDisplay } from "@/lib/swap-lock";

function fmtLocal(dtLocal: string): string {
  if (!dtLocal?.trim()) return "立即发布";
  const d = new Date(dtLocal);
  if (Number.isNaN(d.getTime())) return dtLocal;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtIso(iso?: string | null, empty = "-"): string {
  if (!iso?.trim()) return empty;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 规格字段统一转字符串 */
export function specsText(specs?: string | Record<string, unknown> | null): string {
  if (specs == null || specs === "") return "";
  if (typeof specs === "string") return specs;
  try {
    return JSON.stringify(specs);
  } catch {
    return "";
  }
}

function periodText(p?: string | null): string {
  if (!p?.trim()) return "现货";
  return p;
}

function Row({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex gap-3 py-1.5 border-b border-dashed border-t-border/60 last:border-0">
      <div className="w-[4.5rem] shrink-0 text-[11px] text-t-text-3 pt-0.5">{label}</div>
      <div
        className={`flex-1 min-w-0 text-[12px] break-all ${
          strong ? "font-semibold text-t-text" : "text-t-text-2"
        }`}
      >
        {value || <span className="text-t-text-3">-</span>}
      </div>
    </div>
  );
}

function SheetCard({
  title,
  accent,
  badge,
  children,
}: {
  title: string;
  accent: "buy" | "sell" | "neutral" | "muted" | "action";
  /** 标题旁小标签，如「参考」「本次」 */
  badge?: string;
  children: ReactNode;
}) {
  const accentCls =
    accent === "buy"
      ? "border-trade-up/40 bg-trade-up-bg/40"
      : accent === "sell"
        ? "border-trade-down/40 bg-trade-down-bg/40"
        : accent === "muted"
          ? "border-t-border/70 bg-t-hover/30"
          : accent === "action"
            ? "border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/45 shadow-sm shadow-amber-500/20"
            : "border-t-border bg-t-card/40";
  const titleCls =
    accent === "buy"
      ? "text-trade-up-text"
      : accent === "sell"
        ? "text-trade-down-text"
        : accent === "muted"
          ? "text-t-text-3"
          : accent === "action"
            ? "text-amber-800 dark:text-amber-200"
            : "text-t-text";
  const badgeCls =
    accent === "action"
      ? "bg-amber-500 text-white"
      : accent === "muted"
        ? "bg-t-text-3/20 text-t-text-3"
        : accent === "buy"
          ? "bg-trade-up text-white"
          : accent === "sell"
            ? "bg-trade-down text-white"
            : "bg-t-hover text-t-text-2";
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${accentCls}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <div className={`text-[11px] font-bold ${titleCls}`}>{title}</div>
        {badge && (
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${badgeCls}`}>{badge}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function negotiableLabel(keys: string[]): string {
  if (!keys?.length) return "不可商谈";
  const map = new Map(NEGOTIABLE_TERMS.map((t) => [t.key, t.label]));
  return keys.map((k) => map.get(k) || k).join("、");
}

export interface ListingConfirmSheetProps {
  side: "BUY" | "SELL";
  productName: string;
  price: number;
  quantity: number;
  allowPartial: boolean;
  minQuantity?: number;
  deliveryPeriod: string;
  deliveryLocation: string;
  deliveryMethod: string;
  paymentMethod: string;
  specs: string;
  freeStorageEnabled: boolean;
  freeStorageDays?: string | number;
  allowCounterOffer: boolean;
  negotiableTerms: string[];
  startsAt: string;
  expiresAt: string;
  scheduled: boolean;
}

/** 挂盘发布确认单 */
export function ListingConfirmSheet(p: ListingConfirmSheetProps) {
  const sideLabel = p.side === "BUY" ? "买盘" : "卖盘";
  const qtyMode = p.allowPartial ? "按份数" : "整单";
  const minQty =
    p.allowPartial && p.minQuantity && p.minQuantity > 0
      ? `${Math.floor(p.minQuantity)} 吨/份`
      : "-";
  const freeStorage = !p.freeStorageEnabled
    ? "不免仓"
    : p.freeStorageDays
      ? `免仓 ${p.freeStorageDays} 天`
      : "免仓";
  const negotiate = p.allowCounterOffer
    ? `可商谈（${negotiableLabel(p.negotiableTerms)}）`
    : "不可商谈";

  return (
    <div className="space-y-3 text-sm">
      <p className="text-t-text leading-relaxed font-medium">
        请核对以下发盘确认单，确认无误后再发布。
      </p>
      <SheetCard title={`${sideLabel}确认单`} accent={p.side === "BUY" ? "buy" : "sell"}>
        <Row label="品种" value={p.productName} strong />
        <Row label="方向" value={sideLabel} strong />
        <Row label="价格" value={`¥${p.price.toFixed(1)} / 吨`} strong />
        <Row label="数量" value={`${Math.floor(p.quantity).toLocaleString()} 吨`} strong />
        <Row label="数量方式" value={qtyMode} />
        {p.allowPartial && <Row label="每份" value={minQty} />}
        <Row label="交割期" value={p.deliveryPeriod || "现货"} />
        <Row label="交割地" value={p.deliveryLocation} />
        <Row label="交割方式" value={p.deliveryMethod} />
        <Row label="付款方式" value={p.paymentMethod} />
        <Row label="规格" value={p.specs} />
        <Row label="免仓期" value={freeStorage} />
        <Row label="商谈" value={negotiate} />
        <Row label="开始时间" value={fmtLocal(p.startsAt)} />
        <Row label="过期时间" value={fmtLocal(p.expiresAt)} />
      </SheetCard>
      <p className="text-[11px] text-t-text-3 leading-relaxed">
        {p.scheduled
          ? "预约发布：到开始时间后自动挂出；若条款与对手盘一致，可能自动撮合。"
          : "立即发布：确认后立刻挂出；若条款与对手盘一致，可能自动撮合。"}
      </p>
    </div>
  );
}

export interface SwapConfirmSheetProps {
  sellProductName: string;
  buyProductName: string;
  sellPrice: number;
  buyPrice: number;
  quantity: number;
  allowPartial: boolean;
  minQuantity?: number;
  sellDeliveryPeriod: string;
  buyDeliveryPeriod: string;
  sellDeliveryLocation: string;
  buyDeliveryLocation: string;
  sellDeliveryMethod: string;
  buyDeliveryMethod: string;
  sellPaymentMethod: string;
  buyPaymentMethod: string;
  sellSpecs: string;
  buySpecs: string;
  sellFreeStorageEnabled: boolean;
  buyFreeStorageEnabled: boolean;
  sellFreeStorageDays?: string | number;
  buyFreeStorageDays?: string | number;
  sellAllowCounterOffer: boolean;
  buyAllowCounterOffer: boolean;
  sellNegotiableTerms: string[];
  buyNegotiableTerms: string[];
  allowSingleSide: boolean;
  startsAt: string;
  expiresAt: string;
  scheduled: boolean;
}

function freeStorageText(enabled: boolean, days?: string | number) {
  if (!enabled) return "不免仓";
  return days ? `免仓 ${days} 天` : "免仓";
}

/** 换盘发布确认单 */
export function SwapConfirmSheet(p: SwapConfirmSheetProps) {
  const qtyMode = p.allowPartial ? "按份数" : "整单";
  const minQty =
    p.allowPartial && p.minQuantity && p.minQuantity > 0
      ? `${Math.floor(p.minQuantity)} 吨/份`
      : "-";

  return (
    <div className="space-y-3 text-sm">
      <p className="text-t-text leading-relaxed font-medium">
        请核对以下换盘确认单（买卖两侧），确认无误后再发布。
      </p>
      <div className="rounded-xl border border-t-border bg-t-card/30 px-3 py-2 space-y-1">
        <Row label="换盘数量" value={`${Math.floor(p.quantity).toLocaleString()} 吨`} strong />
        <Row label="数量方式" value={qtyMode} />
        {p.allowPartial && <Row label="每份" value={minQty} />}
        <Row label="单边交易" value={p.allowSingleSide ? "允许" : "仅双边"} />
        <Row label="开始时间" value={fmtLocal(p.startsAt)} />
        <Row label="过期时间" value={fmtLocal(p.expiresAt)} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <SheetCard title="卖出" accent="sell">
          <Row label="品种" value={p.sellProductName} strong />
          <Row label="价格" value={`¥${p.sellPrice.toFixed(1)} / 吨`} strong />
          <Row label="交割期" value={p.sellDeliveryPeriod || "现货"} />
          <Row label="交割地" value={p.sellDeliveryLocation} />
          <Row label="交割方式" value={p.sellDeliveryMethod} />
          <Row label="付款方式" value={p.sellPaymentMethod} />
          <Row label="规格" value={p.sellSpecs} />
          <Row label="免仓期" value={freeStorageText(p.sellFreeStorageEnabled, p.sellFreeStorageDays)} />
          <Row
            label="商谈"
            value={
              p.sellAllowCounterOffer
                ? `可商谈（${negotiableLabel(p.sellNegotiableTerms)}）`
                : "不可商谈"
            }
          />
        </SheetCard>
        <SheetCard title="买入" accent="buy">
          <Row label="品种" value={p.buyProductName} strong />
          <Row label="价格" value={`¥${p.buyPrice.toFixed(1)} / 吨`} strong />
          <Row label="交割期" value={p.buyDeliveryPeriod || "现货"} />
          <Row label="交割地" value={p.buyDeliveryLocation} />
          <Row label="交割方式" value={p.buyDeliveryMethod} />
          <Row label="付款方式" value={p.buyPaymentMethod} />
          <Row label="规格" value={p.buySpecs} />
          <Row label="免仓期" value={freeStorageText(p.buyFreeStorageEnabled, p.buyFreeStorageDays)} />
          <Row
            label="商谈"
            value={
              p.buyAllowCounterOffer
                ? `可商谈（${negotiableLabel(p.buyNegotiableTerms)}）`
                : "不可商谈"
            }
          />
        </SheetCard>
      </div>
      <p className="text-[11px] text-t-text-3 leading-relaxed">
        {p.scheduled
          ? "预约发布：到开始时间后自动挂出，请再次确认买卖两侧条款一致无误。"
          : "立即发布：确认后立刻挂出，请再次确认买卖两侧条款一致无误。"}
      </p>
    </div>
  );
}

// ---------- 通用明细确认单 ----------

export interface DetailRow {
  label: string;
  value: ReactNode;
  strong?: boolean;
}

export interface GenericDetailConfirmSheetProps {
  intro?: string;
  rows?: DetailRow[];
  outro?: string;
  children?: ReactNode;
}

/** 通用明细确认单（黑名单等） */
export function GenericDetailConfirmSheet(p: GenericDetailConfirmSheetProps) {
  return (
    <div className="space-y-3 text-sm">
      {p.intro && (
        <p className="text-t-text leading-relaxed font-medium">{p.intro}</p>
      )}
      {p.rows && p.rows.length > 0 && (
        <div className="rounded-xl border border-t-border bg-t-card/30 px-3 py-2">
          {p.rows.map((r, i) => (
            <Row key={`${r.label}-${i}`} label={r.label} value={r.value} strong={r.strong} />
          ))}
        </div>
      )}
      {p.children}
      {p.outro && (
        <p className="text-[11px] text-t-text-3 leading-relaxed">{p.outro}</p>
      )}
    </div>
  );
}

function ActionSection({
  title,
  rows,
}: {
  title?: string;
  rows?: DetailRow[];
}) {
  if (!rows?.length && !title) return null;
  return (
    <SheetCard title={title || "本次操作"} accent="neutral">
      {(rows ?? []).map((r, i) => (
        <Row key={`${r.label}-${i}`} label={r.label} value={r.value} strong={r.strong} />
      ))}
    </SheetCard>
  );
}

function listingQtyMode(listing: Listing): string {
  return listing.allow_partial === false ? "整单" : "按份数";
}

function listingNegotiate(listing: Listing): string {
  if (listing.allow_counter_offer === false) return "不可商谈";
  return `可商谈（${negotiableLabel(listing.negotiable_terms ?? [])}）`;
}

export interface ListingBoardConfirmSheetProps {
  listing: Listing;
  productName: string;
  serialLabel?: string;
  actionTitle?: string;
  actionRows?: DetailRow[];
  intro?: string;
  outro?: string;
}

/** 挂牌看板确认单（撤盘等） */
export function ListingBoardConfirmSheet(p: ListingBoardConfirmSheetProps) {
  const { listing: l } = p;
  const sideLabel = l.side === "BUY" ? "买盘" : "卖盘";
  const remain = Math.max(0, Math.floor(l.quantity - l.filled));
  const minQty =
    l.allow_partial !== false && l.min_quantity && l.min_quantity > 0
      ? `${Math.floor(l.min_quantity)} 吨/份`
      : "-";

  return (
    <div className="space-y-3 text-sm">
      {p.intro && (
        <p className="text-t-text leading-relaxed font-medium">{p.intro}</p>
      )}
      <SheetCard title={`${sideLabel}明细`} accent={l.side === "BUY" ? "buy" : "sell"}>
        {p.serialLabel && <Row label="发盘号" value={p.serialLabel} strong />}
        <Row label="品种" value={p.productName} strong />
        <Row label="方向" value={sideLabel} strong />
        <Row label="价格" value={`¥${l.price.toFixed(1)} / 吨`} strong />
        <Row label="总量" value={`${Math.floor(l.quantity).toLocaleString()} 吨`} strong />
        <Row label="已成交" value={`${Math.floor(l.filled).toLocaleString()} 吨`} />
        <Row label="剩余" value={`${remain.toLocaleString()} 吨`} strong />
        <Row label="数量方式" value={listingQtyMode(l)} />
        {l.allow_partial !== false && <Row label="每份" value={minQty} />}
        <Row label="交割期" value={periodText(l.delivery_period)} />
        <Row label="交割地" value={l.delivery_location} />
        <Row label="交割方式" value={l.delivery_method} />
        <Row label="付款方式" value={l.payment_method} />
        <Row label="规格" value={specsText(l.specs)} />
        <Row label="免仓期" value={freeStorageText(!!l.free_storage_enabled, l.free_storage_days ?? undefined)} />
        <Row label="商谈" value={listingNegotiate(l)} />
        <Row label="状态" value={l.status} />
        <Row label="开始时间" value={fmtIso(l.starts_at, "已/立即发布")} />
        <Row label="过期时间" value={fmtIso(l.expires_at)} />
      </SheetCard>
      <ActionSection title={p.actionTitle} rows={p.actionRows} />
      {p.outro && (
        <p className="text-[11px] text-t-text-3 leading-relaxed">{p.outro}</p>
      )}
    </div>
  );
}

export interface SwapBoardConfirmSheetProps {
  swap: SwapListing;
  sellProductName: string;
  buyProductName: string;
  serialLabel?: string;
  actionTitle?: string;
  actionRows?: DetailRow[];
  intro?: string;
  outro?: string;
}

/** 换盘看板确认单（撤销换盘等） */
export function SwapBoardConfirmSheet(p: SwapBoardConfirmSheetProps) {
  const { swap: s } = p;
  const sellRemain = Math.max(0, Math.floor((s.sell_quantity ?? 0) - (s.sell_filled ?? 0)));
  const buyRemain = Math.max(0, Math.floor((s.buy_quantity ?? 0) - (s.buy_filled ?? 0)));
  const qty = Math.floor(s.sell_quantity ?? s.buy_quantity ?? 0);
  const allowPartial = (s.sell_allow_partial ?? s.buy_allow_partial) !== false;
  const minQty = Math.max(s.sell_min_quantity ?? 0, s.buy_min_quantity ?? 0);

  return (
    <div className="space-y-3 text-sm">
      {p.intro && (
        <p className="text-t-text leading-relaxed font-medium">{p.intro}</p>
      )}
      <div className="rounded-xl border border-t-border bg-t-card/30 px-3 py-2 space-y-1">
        {p.serialLabel && <Row label="发盘号" value={p.serialLabel} strong />}
        <Row label="换盘数量" value={`${qty.toLocaleString()} 吨`} strong />
        <Row label="卖出剩余" value={`${sellRemain.toLocaleString()} 吨`} />
        <Row label="买入剩余" value={`${buyRemain.toLocaleString()} 吨`} />
        <Row label="数量方式" value={allowPartial ? "按份数" : "整单"} />
        {allowPartial && minQty > 0 && (
          <Row label="每份" value={`${Math.floor(minQty)} 吨/份`} />
        )}
        <Row label="单边交易" value={s.allow_single_side !== false ? "允许" : "仅双边"} />
        <Row label="状态" value={s.status} />
        <Row label="开始时间" value={fmtIso(s.starts_at, "已/立即发布")} />
        <Row label="过期时间" value={fmtIso(s.expires_at)} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <SheetCard title="卖出" accent="sell">
          <Row label="品种" value={p.sellProductName} strong />
          <Row label="价格" value={`¥${s.sell_price.toFixed(1)} / 吨`} strong />
          <Row label="交割期" value={periodText(s.sell_delivery_period)} />
          <Row label="交割地" value={s.sell_delivery_location} />
          <Row label="交割方式" value={s.sell_delivery_method} />
          <Row label="付款方式" value={s.sell_payment_method} />
          <Row label="规格" value={specsText(s.sell_specs)} />
          <Row
            label="免仓期"
            value={freeStorageText(!!s.sell_free_storage_enabled, s.sell_free_storage_days ?? undefined)}
          />
          <Row
            label="商谈"
            value={
              (s.sell_allow_counter_offer ?? s.allow_counter_offer) === false
                ? "不可商谈"
                : `可商谈（${negotiableLabel(s.sell_negotiable_terms ?? s.negotiable_terms ?? [])}）`
            }
          />
        </SheetCard>
        <SheetCard title="买入" accent="buy">
          <Row label="品种" value={p.buyProductName} strong />
          <Row label="价格" value={`¥${s.buy_price.toFixed(1)} / 吨`} strong />
          <Row label="交割期" value={periodText(s.buy_delivery_period)} />
          <Row label="交割地" value={s.buy_delivery_location} />
          <Row label="交割方式" value={s.buy_delivery_method} />
          <Row label="付款方式" value={s.buy_payment_method} />
          <Row label="规格" value={specsText(s.buy_specs)} />
          <Row
            label="免仓期"
            value={freeStorageText(!!s.buy_free_storage_enabled, s.buy_free_storage_days ?? undefined)}
          />
          <Row
            label="商谈"
            value={
              (s.buy_allow_counter_offer ?? s.allow_counter_offer) === false
                ? "不可商谈"
                : `可商谈（${negotiableLabel(s.buy_negotiable_terms ?? s.negotiable_terms ?? [])}）`
            }
          />
        </SheetCard>
      </div>
      <ActionSection title={p.actionTitle} rows={p.actionRows} />
      {p.outro && (
        <p className="text-[11px] text-t-text-3 leading-relaxed">{p.outro}</p>
      )}
    </div>
  );
}

export interface TakeListingConfirmSheetProps {
  listing: Listing;
  productName?: string;
  serialLabel?: string;
  takeQuantity: number;
  takePrice: number;
  unit?: string;
  shareCount?: number;
  canPickShares?: boolean;
  intro?: string;
  outro?: string;
}

/** 摘盘确认单：盘面明细弱化，本次摘盘信息高亮 */
export function TakeListingConfirmSheet(p: TakeListingConfirmSheetProps) {
  const { listing: l } = p;
  const unit = p.unit ?? "吨";
  const sideLabel = l.side === "BUY" ? "买盘" : "卖盘";
  const actionLabel = l.side === "SELL" ? "买入摘盘" : "卖出摘盘";
  const remain = Math.max(0, Math.floor(l.quantity - l.filled));
  const amount = p.takePrice * p.takeQuantity;

  return (
    <div className="space-y-3 text-sm">
      <p className="text-t-text leading-relaxed font-medium">
        {p.intro ?? `请核对盘面条款与本次摘盘信息（${actionLabel}），确认后将立即成交。`}
      </p>

      {/* 盘面明细：弱化参考区 */}
      <SheetCard title={`${sideLabel}明细`} accent="muted" badge="盘面条款">
        {p.serialLabel && <Row label="发盘号" value={p.serialLabel} />}
        {p.productName && <Row label="品种" value={p.productName} />}
        <Row label="方向" value={sideLabel} />
        <Row label="挂牌价" value={`¥${l.price.toLocaleString()} / ${unit}`} />
        <Row label="挂牌总量" value={`${Math.floor(l.quantity).toLocaleString()} ${unit}`} />
        <Row label="剩余量" value={`${remain.toLocaleString()} ${unit}`} />
        <Row label="交割期" value={periodText(l.delivery_period)} />
        <Row label="交割地" value={l.delivery_location} />
        <Row label="交割方式" value={l.delivery_method} />
        <Row label="付款方式" value={l.payment_method} />
        <Row label="规格" value={specsText(l.specs)} />
        <Row label="免仓期" value={freeStorageText(!!l.free_storage_enabled, l.free_storage_days ?? undefined)} />
      </SheetCard>

      {/* 本次摘盘：高亮成交区 */}
      <SheetCard title="本次摘盘" accent="action" badge="即将成交">
        <Row label="操作" value={actionLabel} strong />
        <Row
          label="成交价"
          value={
            <span className="text-base font-bold text-amber-800 dark:text-amber-200">
              ¥{p.takePrice.toLocaleString()}
              <span className="text-[11px] font-medium opacity-80"> / {unit}</span>
            </span>
          }
          strong
        />
        {p.canPickShares && p.shareCount != null && (
          <Row
            label="份数"
            value={
              <span className="text-base font-bold text-amber-800 dark:text-amber-200">
                {Math.floor(p.shareCount)} 份
              </span>
            }
            strong
          />
        )}
        <Row
          label="成交量"
          value={
            <span className="text-base font-bold text-amber-800 dark:text-amber-200">
              {Math.floor(p.takeQuantity).toLocaleString()} {unit}
            </span>
          }
          strong
        />
        <Row
          label="成交金额"
          value={
            <span className="text-base font-bold text-amber-900 dark:text-amber-100">
              ¥{amount.toLocaleString()}
            </span>
          }
          strong
        />
      </SheetCard>

      <p className="text-[11px] text-t-text-3 leading-relaxed">
        {p.outro ?? "上方灰色为盘面条款（参考），琥珀色为本次摘盘成交信息。确认后立即成交且无法撤销。"}
      </p>
    </div>
  );
}

export interface TakeSwapConfirmSheetProps {
  swap: SwapListing;
  sellProductName?: string;
  buyProductName?: string;
  serialLabel?: string;
  mode: "sell" | "buy" | "both" | "flash";
  unit?: string;
  sellQty?: number;
  buyQty?: number;
  quantity?: number;
  shareCount?: number;
  canPickShares?: boolean;
  lockSide?: string;
  lockQty?: number;
  lockRef?: string;
  intro?: string;
  outro?: string;
}

function swapModeLabel(mode: TakeSwapConfirmSheetProps["mode"]): string {
  switch (mode) {
    case "sell":
      return "锁定·卖出";
    case "buy":
      return "锁定·买入";
    case "both":
      return "双边成交";
    case "flash":
      return "闪拼";
    default:
      return mode;
  }
}

/** 换盘摘盘/锁定/闪拼确认单：盘面条款与本次操作高亮区分 */
export function TakeSwapConfirmSheet(p: TakeSwapConfirmSheetProps) {
  const { swap: s } = p;
  const unit = p.unit ?? "吨";
  const sellRemain = Math.max(0, Math.floor((s.sell_quantity ?? 0) - (s.sell_filled ?? 0)));
  const buyRemain = Math.max(0, Math.floor((s.buy_quantity ?? 0) - (s.buy_filled ?? 0)));

  return (
    <div className="space-y-3 text-sm">
      <p className="text-t-text leading-relaxed font-medium">
        {p.intro ?? `请核对盘面条款与本次操作（${swapModeLabel(p.mode)}）。`}
      </p>
      <SheetCard title="换盘概要" accent="muted" badge="盘面条款">
        {p.serialLabel && <Row label="发盘号" value={p.serialLabel} />}
        <Row label="卖出剩余" value={`${sellRemain.toLocaleString()} ${unit}`} />
        <Row label="买入剩余" value={`${buyRemain.toLocaleString()} ${unit}`} />
      </SheetCard>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 opacity-90">
        <SheetCard title="卖出" accent="sell" badge="盘面">
          <Row label="品种" value={p.sellProductName || s.sell_product_id} />
          <Row label="价格" value={`¥${s.sell_price.toLocaleString()} / ${unit}`} />
          <Row label="交割期" value={periodText(s.sell_delivery_period)} />
          <Row label="交割地" value={s.sell_delivery_location} />
          <Row label="交割方式" value={s.sell_delivery_method} />
          <Row label="付款方式" value={s.sell_payment_method} />
          <Row label="规格" value={specsText(s.sell_specs)} />
        </SheetCard>
        <SheetCard title="买入" accent="buy" badge="盘面">
          <Row label="品种" value={p.buyProductName || s.buy_product_id} />
          <Row label="价格" value={`¥${s.buy_price.toLocaleString()} / ${unit}`} />
          <Row label="交割期" value={periodText(s.buy_delivery_period)} />
          <Row label="交割地" value={s.buy_delivery_location} />
          <Row label="交割方式" value={s.buy_delivery_method} />
          <Row label="付款方式" value={s.buy_payment_method} />
          <Row label="规格" value={specsText(s.buy_specs)} />
        </SheetCard>
      </div>
      <SheetCard title="本次操作" accent="action" badge="即将生效">
        <Row
          label="操作"
          value={
            <span className="text-base font-bold text-amber-800 dark:text-amber-200">
              {swapModeLabel(p.mode)}
            </span>
          }
          strong
        />
        {p.mode === "both" ? (
          <>
            <Row
              label="卖出数量"
              value={
                <span className="text-base font-bold text-amber-800 dark:text-amber-200">
                  {Math.floor(p.sellQty ?? 0).toLocaleString()} {unit}
                </span>
              }
              strong
            />
            <Row
              label="买入数量"
              value={
                <span className="text-base font-bold text-amber-800 dark:text-amber-200">
                  {Math.floor(p.buyQty ?? 0).toLocaleString()} {unit}
                </span>
              }
              strong
            />
          </>
        ) : (
          <>
            {p.canPickShares && p.shareCount != null && (
              <Row
                label="份数"
                value={
                  <span className="text-base font-bold text-amber-800 dark:text-amber-200">
                    {Math.floor(p.shareCount)} 份
                  </span>
                }
                strong
              />
            )}
            <Row
              label="数量"
              value={
                <span className="text-base font-bold text-amber-800 dark:text-amber-200">
                  {Math.floor(p.quantity ?? 0).toLocaleString()} {unit}
                </span>
              }
              strong
            />
          </>
        )}
        {p.mode === "flash" && (
          <>
            {p.lockSide && <Row label="锁定方向" value={p.lockSide} strong />}
            {p.lockQty != null && (
              <Row
                label="锁定量"
                value={`${Math.floor(p.lockQty).toLocaleString()} ${unit}`}
                strong
              />
            )}
            {p.lockRef && <Row label="锁定编号" value={p.lockRef} />}
          </>
        )}
      </SheetCard>
      <p className="text-[11px] text-t-text-3 leading-relaxed">
        {p.outro ??
          (p.mode === "flash"
            ? "上方为盘面条款，琥珀色为本次闪拼信息。确认后立即成交，无法撤销。"
            : p.mode === "both"
              ? "上方为盘面条款，琥珀色为本次双边成交信息。确认后立即成交，无法撤销。"
              : "上方为盘面条款，琥珀色为本次锁定信息。锁定后需等待对方或第三方完成另一侧。")}
      </p>
    </div>
  );
}

export interface OfferTermsSnapshot {
  price: number;
  quantity: number;
  delivery_period?: string | null;
  delivery_location?: string | null;
  payment_method?: string | null;
  delivery_method?: string | null;
  free_storage_enabled?: boolean | null;
  free_storage_days?: number | null;
  specs?: string | null;
}

function freeStorageOfferText(
  enabled?: boolean | null,
  days?: number | null,
): string {
  if (enabled === false) return "不免仓";
  if (enabled === true) return days && days > 0 ? `免仓 ${days} 天` : "免仓";
  return "-";
}

function CompareRow({
  label,
  offer,
  refValue,
}: {
  label: string;
  offer: ReactNode;
  refValue?: ReactNode;
}) {
  const changed =
    refValue != null &&
    String(offer ?? "") !== String(refValue ?? "") &&
    String(refValue ?? "") !== "" &&
    String(refValue ?? "") !== "-";
  return (
    <div className="py-1.5 border-b border-dashed border-t-border/60 last:border-0">
      <div className="text-[11px] text-t-text-3 mb-0.5">{label}</div>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] break-all">
        {refValue != null && String(refValue) !== "" && (
          <>
            <span className="text-t-text-3 line-through opacity-70">{refValue}</span>
            <span className="text-[10px] font-black text-amber-600">→</span>
          </>
        )}
        <span className={changed ? "font-semibold text-t-text" : "text-t-text-2"}>
          {offer || <span className="text-t-text-3">-</span>}
        </span>
      </div>
    </div>
  );
}

export interface CounterOfferConfirmSheetProps {
  intro?: string;
  outro?: string;
  serialLabel?: string;
  modeLabel?: string;
  productName?: string;
  sideTitle?: string;
  offer: OfferTermsSnapshot;
  refTerms?: OfferTermsSnapshot | null;
  acceptedTermsLabel?: string;
  unit?: string;
}

/** 从 CounterOffer 构造 offer/ref 快照 */
export function offerTermsFromCounterOffer(co: CounterOffer): {
  offer: OfferTermsSnapshot;
  refTerms: OfferTermsSnapshot;
} {
  return {
    offer: {
      price: co.offer_price,
      quantity: co.offer_quantity,
      delivery_period: co.offer_delivery_period,
      delivery_location: co.offer_delivery_location,
      payment_method: co.offer_payment_method,
      delivery_method: co.offer_delivery_method,
      free_storage_enabled: co.offer_free_storage_enabled,
      free_storage_days: co.offer_free_storage_days,
      specs: co.offer_specs,
    },
    refTerms: {
      price: co.ref_price ?? co.offer_price,
      quantity:
        co.ref_quantity != null && co.ref_filled != null
          ? Math.max(0, co.ref_quantity - co.ref_filled)
          : co.ref_quantity ?? co.offer_quantity,
      delivery_period: co.ref_delivery_period,
      delivery_location: co.ref_delivery_location,
      payment_method: co.ref_payment_method,
      delivery_method: co.ref_delivery_method,
      free_storage_enabled: co.ref_free_storage_enabled,
      free_storage_days: co.ref_free_storage_days,
      specs: co.ref_specs,
    },
  };
}

/** 商谈确认单：报价条款 vs 原盘条款 */
export function CounterOfferConfirmSheet(p: CounterOfferConfirmSheetProps) {
  const unit = p.unit ?? "吨";
  const o = p.offer;
  const r = p.refTerms;
  const accent =
    p.modeLabel?.includes("卖") ? "sell" : p.modeLabel?.includes("买") ? "buy" : "neutral";

  return (
    <div className="space-y-3 text-sm">
      {p.intro && (
        <p className="text-t-text leading-relaxed font-medium">{p.intro}</p>
      )}
      <div className="rounded-xl border border-t-border bg-t-card/30 px-3 py-2 space-y-1">
        {p.serialLabel && <Row label="发盘号" value={p.serialLabel} strong />}
        {p.productName && <Row label="品种" value={p.productName} strong />}
        {p.modeLabel && <Row label="方向/模式" value={p.modeLabel} strong />}
        {p.acceptedTermsLabel && (
          <Row label="已接受条款" value={p.acceptedTermsLabel} />
        )}
      </div>
      <SheetCard title={p.sideTitle || "商谈条款"} accent={accent as "buy" | "sell" | "neutral"}>
        <CompareRow
          label="价格"
          offer={`¥${o.price.toLocaleString()} / ${unit}`}
          refValue={r ? `¥${r.price.toLocaleString()} / ${unit}` : undefined}
        />
        <CompareRow
          label="数量"
          offer={`${Math.floor(o.quantity).toLocaleString()} ${unit}`}
          refValue={r ? `${Math.floor(r.quantity).toLocaleString()} ${unit}` : undefined}
        />
        <CompareRow
          label="交割期"
          offer={periodText(o.delivery_period)}
          refValue={r ? periodText(r.delivery_period) : undefined}
        />
        <CompareRow
          label="交割地"
          offer={o.delivery_location || "-"}
          refValue={r ? r.delivery_location || "-" : undefined}
        />
        <CompareRow
          label="交割方式"
          offer={o.delivery_method || "-"}
          refValue={r ? r.delivery_method || "-" : undefined}
        />
        <CompareRow
          label="付款方式"
          offer={o.payment_method || "-"}
          refValue={r ? r.payment_method || "-" : undefined}
        />
        <CompareRow
          label="免仓期"
          offer={freeStorageOfferText(o.free_storage_enabled, o.free_storage_days)}
          refValue={
            r
              ? freeStorageOfferText(r.free_storage_enabled, r.free_storage_days)
              : undefined
          }
        />
        <CompareRow
          label="规格"
          offer={specsText(o.specs) || "-"}
          refValue={r ? specsText(r.specs) || "-" : undefined}
        />
        <Row
          label="金额"
          value={`¥${(o.price * o.quantity).toLocaleString()}`}
          strong
        />
      </SheetCard>
      {p.outro && (
        <p className="text-[11px] text-t-text-3 leading-relaxed">{p.outro}</p>
      )}
    </div>
  );
}

/** 便捷：直接从 CounterOffer 渲染 */
export function CounterOfferConfirmSheetFromCo({
  co,
  productName,
  serialLabel,
  intro,
  outro,
  acceptedTermsLabel,
  unit,
}: {
  co: CounterOffer;
  productName?: string;
  serialLabel?: string;
  intro?: string;
  outro?: string;
  acceptedTermsLabel?: string;
  unit?: string;
}) {
  const { offer, refTerms } = offerTermsFromCounterOffer(co);
  const modeLabel =
    co.ref_type === "swap"
      ? co.mode === "sell"
        ? "换盘·卖盘商谈"
        : co.mode === "buy"
          ? "换盘·买盘商谈"
          : co.mode === "both"
            ? "换盘·双向商谈"
            : "换盘商谈"
      : co.ref_side === "BUY"
        ? "买盘商谈"
        : "卖盘商谈";

  return (
    <CounterOfferConfirmSheet
      intro={intro}
      outro={outro}
      serialLabel={
        serialLabel ??
        (co.ref_serial_no
          ? `${co.ref_type === "swap" ? "S" : "L"}${co.ref_serial_no}`
          : undefined)
      }
      modeLabel={modeLabel}
      productName={productName}
      offer={offer}
      refTerms={refTerms}
      acceptedTermsLabel={acceptedTermsLabel}
      unit={unit}
    />
  );
}

export interface UnlockConfirmSheetProps {
  serialLabel?: string;
  locks: Array<{ match_side: "sell" | "buy" | string; matched_qty: number }>;
  unit?: string;
  intro?: string;
  outro?: string;
}

/** 解锁单边锁定确认单 */
export function UnlockConfirmSheet(p: UnlockConfirmSheetProps) {
  const unit = p.unit ?? "吨";
  const bySide = new Map<string, number>();
  for (const lock of p.locks) {
    const side = swapLockSideDisplay(lock.match_side);
    bySide.set(side, (bySide.get(side) ?? 0) + Math.floor(lock.matched_qty || 0));
  }
  const total = p.locks.reduce((s, l) => s + Math.floor(l.matched_qty || 0), 0);

  return (
    <div className="space-y-3 text-sm">
      <p className="text-t-text leading-relaxed font-medium">
        {p.intro ?? "即将取消以下单边锁定，请核对后确认。"}
      </p>
      <SheetCard title="解锁明细" accent="neutral">
        {p.serialLabel && <Row label="换盘序号" value={p.serialLabel} strong />}
        {[...bySide.entries()].map(([side, qty]) => (
          <Row key={side} label={side} value={`${qty.toLocaleString()} ${unit}`} strong />
        ))}
        {bySide.size > 1 && (
          <Row label="合计解锁" value={`${total.toLocaleString()} ${unit}`} strong />
        )}
        <Row label="锁定笔数" value={`${p.locks.length} 笔`} />
      </SheetCard>
      <p className="text-[11px] text-t-text-3 leading-relaxed">
        {p.outro ??
          "解锁后，对应数量将释放回换盘剩余量，第三方可再次锁定/闪拼。此操作不可撤销。"}
      </p>
    </div>
  );
}
