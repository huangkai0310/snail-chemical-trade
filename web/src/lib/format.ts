/**
 * 数字格式化工具
 * 平台统一规则：所有数字不带千分位逗号
 */

export function formatNumber(
  value: number | null | undefined,
  decimals: number = 2
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(decimals);
}

export function formatPrice(
  price: number | null | undefined,
  decimals: number = 2,
  prefix: string = "¥"
): string {
  if (price == null || !Number.isFinite(price)) return "—";
  return `${prefix}${price.toFixed(decimals)}`;
}

export function formatQuantity(
  qty: number | null | undefined,
  decimals: number = 2
): string {
  if (qty == null || !Number.isFinite(qty)) return "—";
  return qty.toFixed(decimals);
}

export function formatVolumeCompact(vol: number | null | undefined): string {
  if (vol == null || !Number.isFinite(vol)) return "—";
  if (vol >= 10000) {
    return `${(vol / 10000).toFixed(2)}万`;
  }
  return vol.toString();
}

/** 上海时区 yyMMdd（用于单号日期段） */
function shanghaiYYMMDD(iso: string): string | null {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const yy = parts.find((p) => p.type === "year")?.value ?? "";
    const mm = parts.find((p) => p.type === "month")?.value ?? "";
    const dd = parts.find((p) => p.type === "day")?.value ?? "";
    if (yy && mm && dd) return `${yy}${mm}${dd}`;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * 挂牌/换盘序号：与成交单号同思路
 * 有日期 → L/S + yyMMdd + 流水（自然变长，不卡 6 位）
 * 例：L260719-1、S260719-1000000
 * 无日期 → 前缀 + 至少 6 位补零，超过自然变长
 */
export function formatBoardSerial(
  prefix: "L" | "S",
  serial?: number | null,
  createdAt?: string | null,
): string {
  if (serial == null || serial <= 0) return "-";
  const seq = String(Math.floor(serial));
  if (createdAt) {
    const ymd = shanghaiYYMMDD(createdAt);
    if (ymd) return `${prefix}${ymd}-${seq}`;
  }
  return `${prefix}${seq.padStart(6, "0")}`;
}

export function formatPercent(
  value: number | null | undefined,
  decimals: number = 2
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}%`;
}

// ── 挂盘条款格式化 ─────────────────────────────────────────

import { NEGOTIABLE_TERMS, sanitizeNegotiableTerms } from "./types";

/** 格式化可商谈条款为中文标签 */
export function formatNegotiableTerms(terms?: string[] | null): string {
  const cleaned = sanitizeNegotiableTerms(terms);
  if (cleaned.length === 0) return "不可商谈";
  const labels = cleaned.map(
    (t) => NEGOTIABLE_TERMS.find((n) => n.key === t)?.label ?? t
  );
  return labels.join("、");
}

/** 格式化免仓期 */
export function formatFreeStorage(
  enabled?: boolean,
  days?: number | null
): string {
  if (enabled === false) return "不免仓";
  if (days && days > 0) return `免仓${days}天`;
  return "-";
}

/** 格式化规格 */
export function formatSpecs(
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

/** 格式化数量方式（整单 / 按份数） */
export function formatPartial(
  allowPartial?: boolean,
  minQuantity?: number,
  unit: string = "吨",
  quantity?: number,
): string {
  if (allowPartial === false) return "整单（须一次成交）";
  const min = minQuantity && minQuantity > 0 ? Math.floor(minQuantity) : 0;
  const qty = quantity != null && quantity > 0 ? Math.floor(quantity) : 0;
  if (min > 0 && qty > 0 && qty % min === 0) {
    return `按份数 · 每份 ${min} ${unit} × ${qty / min} 份`;
  }
  if (min > 0) return `按份数 · 每份 ${min} ${unit}`;
  return "按份数";
}
