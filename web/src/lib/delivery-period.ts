/**
 * 交割期标签规则：
 * - 当天 → 现货
 * - 当月月中工作日 → YYMM中（如 2607中）
 * - 当月最后一个工作日 → YYMM下（如 2607下）
 * - 其他 → YYMMDD（如 260725）
 * 优先级：现货 > 月下 > 月中（若同日冲突）
 */
import {
  formatYMD,
  lastWorkdayOfMonth,
  midMonthDate,
  parseYMD,
  sameDay,
  todayStart,
  yymmPrefix,
} from "./china-calendar";

export type DeliveryBadge = "现货" | "中" | "下" | null;

export interface DeliveryPeriodInfo {
  /** 写入业务字段的值 */
  value: string;
  /** 日历角标 */
  badge: DeliveryBadge;
  /** 说明文案 */
  hint: string;
  /** 锚定的具体日期 YYYY-MM-DD（现货为当天） */
  dateYmd: string;
}

/** Date → YYMMDD（规范显示/存储） */
export function formatYYMMDD(d: Date): string {
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

const PRODUCT_SYMBOLS: Record<string, string> = {
  methanol: "MA",
  pta: "TA",
  styrene: "SM",
  meg: "EG",
  pp: "PP",
  benzene: "BZ",
  propylene: "PL",
  phenol: "PH",
  acetone: "AC",
  isopropanol: "IPA",
  mibk: "MIBK",
  toluene: "TL",
  xylene: "XL",
};

/** 品种代码前缀：acetone → AC */
export function productSymbol(productId: string, nameEn?: string | null): string {
  return PRODUCT_SYMBOLS[productId] ?? (nameEn ? nameEn.toUpperCase() : productId.toUpperCase());
}

/**
 * 合约代码规范：AC260725 / AC00（现货）
 * 月中/月下按其锚定日期转 YYMMDD
 */
export function contractCode(productId: string, deliveryPeriod: string, nameEn?: string | null): string {
  const sym = productSymbol(productId, nameEn);
  const v = (deliveryPeriod || "").trim() || "现货";
  if (v === "现货") return `${sym}00`;
  const d = dateFromDeliveryPeriod(v, false);
  if (d) return `${sym}${formatYYMMDD(d)}`;
  return `${sym}${formatDeliveryPeriodDisplay(v)}`;
}

/** 交割期排序键：现货最前，其余按锚定日期正序 */
export function deliveryPeriodSortKey(value: string): number {
  const v = (value || "").trim() || "现货";
  if (v === "现货") return Number.NEGATIVE_INFINITY;
  const d = dateFromDeliveryPeriod(v, false);
  if (!d) return Number.MAX_SAFE_INTEGER;
  return d.getTime();
}

export function compareDeliveryPeriods(a: string, b: string): number {
  return deliveryPeriodSortKey(a) - deliveryPeriodSortKey(b);
}

export function sortDeliveryPeriods(periods: string[]): string[] {
  return [...periods].sort(compareDeliveryPeriods);
}

/** 解析 YYMMDD / YYYY-MM-DD */
export function parseDeliveryDate(s: string): Date | null {
  const t = s.trim();
  const ymd = parseYMD(t);
  if (ymd) return ymd;
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec(t);
  if (!m) return null;
  const year = 2000 + Number(m[1]);
  const month0 = Number(m[2]) - 1;
  const day = Number(m[3]);
  if (month0 < 0 || month0 > 11 || day < 1 || day > 31) return null;
  const d = new Date(year, month0, day);
  d.setHours(0, 0, 0, 0);
  if (d.getFullYear() !== year || d.getMonth() !== month0 || d.getDate() !== day) return null;
  return d;
}

/**
 * 规范显示：现货 / YYMM中 / YYMM下 / YYMMDD
 * 兼容旧值 YYYY-MM-DD → 转为 YYMMDD
 */
export function formatDeliveryPeriodDisplay(value?: string | null): string {
  const v = (value || "").trim();
  if (!v) return "现货";
  if (v === "现货") return "现货";
  if (/^\d{4}中$|^\d{4}下$/.test(v)) return v;
  const d = parseDeliveryDate(v);
  if (d) return formatYYMMDD(d);
  return v;
}

export function deliveryPeriodFromDate(date: Date): DeliveryPeriodInfo {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const ymd = formatYMD(d);
  const compact = formatYYMMDD(d);
  const today = todayStart();
  const prefix = yymmPrefix(d.getFullYear(), d.getMonth());
  const mid = midMonthDate(d.getFullYear(), d.getMonth());
  const monthEnd = lastWorkdayOfMonth(d.getFullYear(), d.getMonth());

  if (sameDay(d, today)) {
    return {
      value: "现货",
      badge: "现货",
      hint: "当天交割 · 现货",
      dateYmd: ymd,
    };
  }
  if (sameDay(d, monthEnd)) {
    return {
      value: `${prefix}下`,
      badge: "下",
      hint: `月底最后一个工作日 · ${prefix}下`,
      dateYmd: ymd,
    };
  }
  if (sameDay(d, mid)) {
    return {
      value: `${prefix}中`,
      badge: "中",
      hint: `月中工作日 · ${prefix}中`,
      dateYmd: ymd,
    };
  }
  return {
    value: compact,
    badge: null,
    hint: `指定日期 · ${compact}`,
    dateYmd: ymd,
  };
}

/** 将已有交割期文案解析回日期（用于回显日历选中态） */
export function dateFromDeliveryPeriod(value: string, fallbackToday = true): Date | null {
  const v = (value || "").trim();
  if (!v) return fallbackToday ? todayStart() : null;

  if (v === "现货") return todayStart();

  const parsed = parseDeliveryDate(v);
  if (parsed) return parsed;

  // YYMM中 / YYMM下
  const m = /^(\d{2})(\d{2})([中下])$/.exec(v);
  if (m) {
    const year = 2000 + Number(m[1]);
    const month0 = Number(m[2]) - 1;
    if (month0 < 0 || month0 > 11) return null;
    if (m[3] === "中") return midMonthDate(year, month0);
    return lastWorkdayOfMonth(year, month0);
  }

  return fallbackToday ? todayStart() : null;
}

/** 某日在日历上的角标（用于提示关键节点） */
export function badgeForCalendarDay(date: Date): DeliveryBadge {
  return deliveryPeriodFromDate(date).badge;
}

/** 兼容旧逻辑：生成下拉快捷选项 */
export function buildDeliveryPeriodOptions(monthsAhead = 12): string[] {
  const options: string[] = ["现货"];
  const today = todayStart();
  const startYear = today.getFullYear();
  const startMonth = today.getMonth();

  for (let offset = 0; offset <= monthsAhead; offset++) {
    const total = startMonth + offset;
    const year = startYear + Math.floor(total / 12);
    const month0 = total % 12;
    const mid = midMonthDate(year, month0);
    const end = lastWorkdayOfMonth(year, month0);
    const prefix = yymmPrefix(year, month0);
    if (mid >= today) options.push(`${prefix}中`);
    if (end >= today) options.push(`${prefix}下`);
  }
  return options;
}
