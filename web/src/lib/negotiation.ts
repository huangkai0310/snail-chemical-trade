// 商谈条款对比与利弊分析共享逻辑
// 约定：发牌方 = ref 侧（原始挂牌/换盘方），议价方 = offer 侧（还价提出方）。
// 该文件只做纯计算，不依赖任何 UI 框架，供「商谈管理」页面与「商谈列表」弹窗复用。

import type { CounterOffer } from "./types";

export type TermKey =
  | "price"
  | "quantity"
  | "delivery_period"
  | "delivery_location"
  | "payment_method"
  | "delivery_method"
  | "free_storage"
  | "specs";

export type Advantage = "good" | "bad" | "neutral";

export type ViewerRole = "maker" | "offerer";

/** 按查看者角色映射「对方/己方」：ref 侧为原始挂牌/换盘方，offer 侧为还价提出方 */
export function sideLabel(viewerRole: ViewerRole, side: "ref" | "offer"): string {
  const isMakerSide = side === "ref";
  if (viewerRole === "maker") return isMakerSide ? "己方" : "对方";
  return isMakerSide ? "对方" : "己方";
}

export const TERM_KEYS: TermKey[] = [
  "price",
  "delivery_period",
  "payment_method",
  "delivery_method",
  "free_storage",
];

export const TERM_LABELS: Record<string, string> = {
  price: "价格",
  quantity: "数量",
  delivery_period: "交割期",
  delivery_location: "交割地",
  payment_method: "付款方式",
  delivery_method: "交割方式",
  free_storage: "免仓期",
  specs: "规格",
};

/** 当前用户相对于某条商谈的角色：发牌方(maker) / 议价方(offerer) */
export function getViewerRole(co: CounterOffer, currentUserId: string): ViewerRole {
  if (currentUserId && co.listing_user_id === currentUserId) return "maker";
  if (currentUserId && co.offer_user_id === currentUserId) return "offerer";
  return "maker"; // 兜底：按接收方视角
}

/** 发牌方买卖方向：SELL=卖盘(高价利好), BUY=买盘(低价利好), null=双向/无法判定 */
function getMakerDirection(co: CounterOffer): "BUY" | "SELL" | null {
  if (co.ref_type === "listing") return co.ref_side ?? null;
  const mode = co.mode ?? "both";
  if (mode === "sell") return "SELL";
  if (mode === "buy") return "BUY";
  return null; // both：买卖均有，净方向模糊
}

function fmtPrice(v?: number | null): string {
  if (v == null) return "—";
  return `¥${Number(v).toFixed(2)}`;
}

function fmtFreeStorage(enabled?: boolean | null, days?: number | null): string {
  if (!enabled) return "不免仓";
  return `免仓${days ?? 0}天`;
}

function fmtSpecs(v?: string | null): string {
  if (!v || !v.trim()) return "未填";
  const s = v.trim();
  return s.length > 18 ? s.slice(0, 18) + "…" : s;
}

/** 取某条款在 发牌方(ref) 或 议价方(offer) 侧的展示文本 */
export function termValue(co: CounterOffer, key: TermKey, side: "ref" | "offer"): string {
  const offer = side === "offer";
  switch (key) {
    case "price":
      return fmtPrice(offer ? co.offer_price : co.ref_price);
    case "quantity": {
      if (offer) return `${co.offer_quantity}`;
      if (co.ref_quantity == null) return "—";
      const rem = (co.ref_quantity ?? 0) - (co.ref_filled ?? 0);
      return `${rem}`;
    }
    case "delivery_period": {
      const v = offer ? co.offer_delivery_period : co.ref_delivery_period;
      if (v == null || String(v).trim() === "") return "现货";
      return String(v).trim();
    }
    case "delivery_location":
      return offer ? co.offer_delivery_location ?? "—" : co.ref_delivery_location ?? "—";
    case "payment_method":
      return offer ? co.offer_payment_method ?? "—" : co.ref_payment_method ?? "—";
    case "delivery_method":
      return offer ? co.offer_delivery_method ?? "—" : co.ref_delivery_method ?? "—";
    case "free_storage":
      return offer
        ? fmtFreeStorage(co.offer_free_storage_enabled, co.offer_free_storage_days)
        : fmtFreeStorage(co.ref_free_storage_enabled, co.ref_free_storage_days);
    case "specs":
      return offer ? fmtSpecs(co.offer_specs) : fmtSpecs(co.ref_specs);
  }
}

function invert(a: Advantage): Advantage {
  return a === "good" ? "bad" : a === "bad" ? "good" : "neutral";
}

/** 价格对当前查看者的利弊：卖盘高价利好发牌方，买盘低价利好发牌方 */
function priceAdvantage(co: CounterOffer, diff: number, viewerRole: ViewerRole): Advantage {
  const dir = getMakerDirection(co);
  if (dir == null || Math.abs(diff) < 1e-9) return "neutral";
  const makerGood = dir === "SELL" ? diff > 0 : diff < 0;
  const makerAdv: Advantage = makerGood ? "good" : "bad";
  return viewerRole === "maker" ? makerAdv : invert(makerAdv);
}

function priceHint(co: CounterOffer, diff: number, viewerRole: ViewerRole): string {
  if (Math.abs(diff) < 1e-9) return "价格与原盘一致";
  const dir = getMakerDirection(co);
  const higher = diff > 0;
  const who = "您";
  if (dir == null) {
    return `换盘双向：商谈价${higher ? "高于" : "低于"}原盘 ${fmtPrice(Math.abs(diff))}，双向净影响不确定`;
  }
  const makerGood = dir === "SELL" ? higher : !higher;
  const goodForViewer = viewerRole === "maker" ? makerGood : !makerGood;
  return `${who}视角：价格${higher ? "上调" : "下调"} ${fmtPrice(Math.abs(diff))}，${goodForViewer ? "对您有利" : "对您不利"}`;
}

/** 付款方式对当前查看者的利弊：先款后货对卖方更有利、对买方更不利 */
function paymentAdvantage(co: CounterOffer, viewerRole: ViewerRole): Advantage {
  const dir = getMakerDirection(co);
  if (dir == null) return "neutral";
  const pm = co.offer_payment_method ?? "";
  const preferSeller = pm === "先款后货";
  const makerGood = dir === "SELL" ? preferSeller : !preferSeller;
  return viewerRole === "maker" ? (makerGood ? "good" : "bad") : makerGood ? "bad" : "good";
}

export interface TermAnalysis {
  key: TermKey;
  label: string;
  ref: string; // 发牌方原值文本
  offer: string; // 议价方提出值文本
  offered: boolean; // 议价方是否提出（非 null/空）
  changed: boolean; // 是否与原值不同
  advantage: Advantage; // 对当前查看者利弊
  deltaText: string; // 变化方向/量
  hint: string; // 提示文案
}

/** 分析单条条款：对比发牌方/议价方取值 + 给出对当前查看者的利弊提示 */
export function analyzeTerm(co: CounterOffer, key: TermKey, viewerRole: ViewerRole): TermAnalysis {
  const ref = termValue(co, key, "ref");
  const offer = termValue(co, key, "offer");

  let offered = true;
  switch (key) {
    case "price":
    case "quantity":
      offered = true;
      break;
    case "delivery_period":
      offered = !!co.offer_delivery_period;
      break;
    case "delivery_location":
      offered = !!co.offer_delivery_location;
      break;
    case "payment_method":
      offered = !!co.offer_payment_method;
      break;
    case "delivery_method":
      offered = !!co.offer_delivery_method;
      break;
    case "free_storage":
      offered = co.offer_free_storage_enabled != null;
      break;
    case "specs":
      offered = !!co.offer_specs && co.offer_specs.trim() !== "";
      break;
  }

  let changed = false;
  let advantage: Advantage = "neutral";
  let deltaText = "";
  let hint = "";

  if (!offered) {
    hint = "未协商该条款";
  } else if (key === "price") {
    const refP = co.ref_price ?? 0;
    const diff = co.offer_price - refP;
    const d = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
    changed = Math.abs(diff) > 1e-9;
    // 价格字段后端必填，相同时视为未提出改价
    offered = changed;
    deltaText = d === "flat" ? "持平" : `报价${d === "up" ? "高" : "低"} ${fmtPrice(Math.abs(diff))}`;
    advantage = priceAdvantage(co, diff, viewerRole);
    hint = priceHint(co, diff, viewerRole);
  } else if (key === "quantity") {
    // 与原盘「剩余可成交量」比：商谈提交时常把剩余量作为默认值，不等于故意改数量
    const refQty = (co.ref_quantity ?? 0) - (co.ref_filled ?? 0);
    const offerQty = co.offer_quantity ?? 0;
    changed = Math.abs(offerQty - refQty) > 1e-9;
    offered = changed;
    deltaText = changed ? `数量 ${refQty} → ${offerQty}` : "未变更";
    advantage = "neutral";
    hint = changed ? `数量由 ${refQty} 协商为 ${offerQty}` : "数量未调整";
  } else if (key === "payment_method") {
    changed = !!co.offer_payment_method && co.offer_payment_method !== co.ref_payment_method;
    advantage = changed ? paymentAdvantage(co, viewerRole) : "neutral";
    deltaText = changed ? "付款方式变更" : "未变更";
    hint = changed
      ? `付款方式：${co.ref_payment_method ?? "—"} → ${co.offer_payment_method}`
      : "付款方式未调整";
  } else if (key === "free_storage") {
    // 免仓时间利弊：免仓天数越久对买盘越有利
    const refDays = co.ref_free_storage_enabled ? (co.ref_free_storage_days ?? 0) : 0;
    const offerDays = co.offer_free_storage_enabled ? (co.offer_free_storage_days ?? 0) : 0;
    const refText = fmtFreeStorage(co.ref_free_storage_enabled, co.ref_free_storage_days);
    const offText = fmtFreeStorage(co.offer_free_storage_enabled, co.offer_free_storage_days);
    changed = offText !== refText && offered;
    const diff = offerDays - refDays;
    if (!changed || diff === 0) {
      advantage = "neutral";
      deltaText = "未变更";
      hint = "免仓期未调整";
    } else {
      // diff > 0：免仓天数增加 → 对买方有利
      // 发牌方方向：SELL=卖方(免仓增加对卖方不利), BUY=买方(免仓增加对买方有利)
      const dir = getMakerDirection(co);
      if (dir == null) {
        advantage = "neutral";
        deltaText = `免仓 ${refDays} → ${offerDays} 天`;
        hint = `免仓天数${diff > 0 ? "增加" : "减少"} ${Math.abs(diff)} 天，换盘双向净影响不确定`;
      } else {
        const buyerGood = diff > 0; // 免仓增加对买方有利
        const makerIsBuyer = dir === "BUY";
        const makerGood = makerIsBuyer ? buyerGood : !buyerGood;
        advantage = (viewerRole === "maker" ? makerGood : !makerGood) ? "good" : "bad";
        deltaText = `免仓 ${refDays} → ${offerDays} 天`;
        const goodForViewer = viewerRole === "maker" ? makerGood : !makerGood;
        hint = `免仓天数${diff > 0 ? "增加" : "减少"} ${Math.abs(diff)} 天（${refText} → ${offText}），${goodForViewer ? "对您有利" : "对您不利"}`;
      }
    }
  } else {
    const refV = termValue(co, key, "ref");
    const offV = termValue(co, key, "offer");
    changed = offV !== refV && offered;
    advantage = "neutral";
    deltaText = changed ? "条款变更" : "未变更";
    hint = changed
      ? `${TERM_LABELS[key]}：${refV} → ${offV}`
      : `${TERM_LABELS[key]}未调整`;
  }

  return { key, label: TERM_LABELS[key], ref, offer, offered, changed, advantage, deltaText, hint };
}

/** 分析全部条款 */
export function analyzeNegotiation(co: CounterOffer, viewerRole: ViewerRole): TermAnalysis[] {
  return TERM_KEYS.map((k) => analyzeTerm(co, k, viewerRole));
}

/** 议价方实际提出且与原盘不同的条款（商谈管理「同意」勾选范围） */
export function disputedTermKeys(co: CounterOffer): TermKey[] {
  return analyzeNegotiation(co, "maker")
    .filter((a) => a.offered && a.changed)
    .map((a) => a.key);
}

/** 一句话商谈分析（面向当前查看者） */
export function summarizeNegotiation(co: CounterOffer, viewerRole: ViewerRole): string {
  const changed = analyzeNegotiation(co, viewerRole).filter((t) => t.changed);
  if (changed.length === 0) return "本次商谈未对条款提出变更";
  const goods = changed.filter((t) => t.advantage === "good").map((t) => TERM_LABELS[t.key]);
  const bads = changed.filter((t) => t.advantage === "bad").map((t) => TERM_LABELS[t.key]);
  const who = "您";
  const parts: string[] = [];
  if (goods.length) parts.push(`对${who}有利：${goods.join("、")}`);
  if (bads.length) parts.push(`对${who}不利：${bads.join("、")}`);
  if (goods.length === 0 && bads.length === 0) {
    parts.push(`涉及：${changed.map((t) => TERM_LABELS[t.key]).join("、")}`);
  }
  return `共协商 ${changed.length} 项条款 —— ` + parts.join("；");
}
