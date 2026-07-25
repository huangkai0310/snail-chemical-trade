/**
 * 中国大陆工作日判断（与 backend/calendar/china.go 内置 2025-2026 数据对齐）
 * 用于交割期「月下」= 当月最后一个工作日，以及日历节假日标注。
 */

function addRange(set: Set<string>, from: string, to: string) {
  const start = parseYMD(from)!;
  const end = parseYMD(to)!;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    set.add(formatYMD(d));
  }
}

function addNamedRange(
  names: Map<string, string>,
  from: string,
  to: string,
  name: string
) {
  const start = parseYMD(from)!;
  const end = parseYMD(to)!;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    names.set(formatYMD(d), name);
  }
}

const HOLIDAYS = new Set<string>();
const HOLIDAY_NAMES = new Map<string, string>();

addRange(HOLIDAYS, "2025-01-01", "2025-01-01");
addNamedRange(HOLIDAY_NAMES, "2025-01-01", "2025-01-01", "元旦");
addRange(HOLIDAYS, "2025-01-28", "2025-02-04");
addNamedRange(HOLIDAY_NAMES, "2025-01-28", "2025-02-04", "春节");
addRange(HOLIDAYS, "2025-04-04", "2025-04-06");
addNamedRange(HOLIDAY_NAMES, "2025-04-04", "2025-04-06", "清明");
addRange(HOLIDAYS, "2025-05-01", "2025-05-05");
addNamedRange(HOLIDAY_NAMES, "2025-05-01", "2025-05-05", "劳动节");
addRange(HOLIDAYS, "2025-05-31", "2025-06-02");
addNamedRange(HOLIDAY_NAMES, "2025-05-31", "2025-06-02", "端午");
addRange(HOLIDAYS, "2025-10-01", "2025-10-08");
addNamedRange(HOLIDAY_NAMES, "2025-10-01", "2025-10-08", "国庆/中秋");

addRange(HOLIDAYS, "2026-01-01", "2026-01-03");
addNamedRange(HOLIDAY_NAMES, "2026-01-01", "2026-01-03", "元旦");
addRange(HOLIDAYS, "2026-02-15", "2026-02-23");
addNamedRange(HOLIDAY_NAMES, "2026-02-15", "2026-02-23", "春节");
addRange(HOLIDAYS, "2026-04-04", "2026-04-06");
addNamedRange(HOLIDAY_NAMES, "2026-04-04", "2026-04-06", "清明");
addRange(HOLIDAYS, "2026-05-01", "2026-05-05");
addNamedRange(HOLIDAY_NAMES, "2026-05-01", "2026-05-05", "劳动节");
addRange(HOLIDAYS, "2026-06-19", "2026-06-21");
addNamedRange(HOLIDAY_NAMES, "2026-06-19", "2026-06-21", "端午");
addRange(HOLIDAYS, "2026-09-25", "2026-09-27");
addNamedRange(HOLIDAY_NAMES, "2026-09-25", "2026-09-27", "中秋");
addRange(HOLIDAYS, "2026-10-01", "2026-10-07");
addNamedRange(HOLIDAY_NAMES, "2026-10-01", "2026-10-07", "国庆");

const MAKEUP_WORKDAYS = new Set([
  "2025-01-26",
  "2025-02-08",
  "2025-04-27",
  "2025-09-28",
  "2025-10-11",
  "2026-01-04",
  "2026-02-14",
  "2026-02-28",
  "2026-05-09",
  "2026-09-20",
  "2026-10-10",
]);

export function parseYMD(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setHours(0, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function isHoliday(d: Date): boolean {
  return HOLIDAYS.has(formatYMD(d));
}

export function isMakeupWorkday(d: Date): boolean {
  return MAKEUP_WORKDAYS.has(formatYMD(d));
}

/** 法定放假日名称；非假日返回 null */
export function holidayName(d: Date): string | null {
  return HOLIDAY_NAMES.get(formatYMD(d)) ?? null;
}

export type DayKind = "workday" | "weekend" | "holiday" | "makeup";

export function dayKind(d: Date): DayKind {
  if (isMakeupWorkday(d)) return "makeup";
  if (isHoliday(d)) return "holiday";
  const wd = d.getDay();
  if (wd === 0 || wd === 6) return "weekend";
  return "workday";
}

export function isWorkday(d: Date): boolean {
  const kind = dayKind(d);
  return kind === "workday" || kind === "makeup";
}

/** 从 from 起（含当日）向后找最近工作日，最多向后 40 天 */
export function nextWorkday(from: Date = todayStart()): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  for (let i = 0; i < 40; i++) {
    if (isWorkday(d)) return new Date(d);
    d.setDate(d.getDate() + 1);
  }
  return new Date(from);
}

/** 从 from 的次日（或 offset 天后）起找最近工作日 */
export function nextWorkdayAfter(from: Date = todayStart(), dayOffset = 1): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + dayOffset);
  return nextWorkday(d);
}

/** 是否早于今天（不可选交割期） */
export function isBeforeToday(d: Date, today: Date = todayStart()): boolean {
  const a = new Date(d);
  a.setHours(0, 0, 0, 0);
  return a.getTime() < today.getTime();
}

/** 当月最后一个工作日 */
export function lastWorkdayOfMonth(year: number, month0: number): Date {
  const d = new Date(year, month0 + 1, 0);
  d.setHours(0, 0, 0, 0);
  while (d.getMonth() === month0 && !isWorkday(d)) {
    d.setDate(d.getDate() - 1);
  }
  return d;
}

/** 月中锚点：当月 15 日及之后的第一个工作日；若无则取 15 日之前最近工作日 */
export function midMonthDate(year: number, month0: number): Date {
  const mid = new Date(year, month0, 15);
  mid.setHours(0, 0, 0, 0);

  // 向后找（含 15 日）
  for (let d = new Date(mid); d.getMonth() === month0; d.setDate(d.getDate() + 1)) {
    if (isWorkday(d)) return new Date(d);
  }
  // 向前找
  for (let d = new Date(mid); d.getMonth() === month0; d.setDate(d.getDate() - 1)) {
    if (isWorkday(d)) return new Date(d);
  }
  return mid;
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function yymmPrefix(year: number, month0: number): string {
  return `${String(year).slice(-2)}${String(month0 + 1).padStart(2, "0")}`;
}
