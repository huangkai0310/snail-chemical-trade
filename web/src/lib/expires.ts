import { isWorkday, nextWorkday, nextWorkdayAfter, todayStart } from "./china-calendar";

/** 发盘默认过期：当天 18:00（本地）；若已到/已过 18:00 或非工作日则顺延至下一工作日 18:00 */
export function defaultExpiresAtLocal(): string {
  const day = resolveDefaultExpireDay(new Date());
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 18, 0, 0, 0);
  return toDatetimeLocalValue(d);
}

function resolveDefaultExpireDay(now: Date): Date {
  const today = todayStart();
  const today18 = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 18, 0, 0, 0);
  if (isWorkday(today) && now.getTime() < today18.getTime()) {
    return today;
  }
  return nextWorkday(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
}

/** 下一工作日 09:00（用于「下一工作日开盘」快捷） */
export function nextWorkdayMorningLocal(): string {
  const day = nextWorkdayAfter(todayStart(), 1);
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, 0, 0);
  return toDatetimeLocalValue(d);
}

/** 下一工作日 18:00 */
export function nextWorkdayExpireLocal(): string {
  const day = nextWorkdayAfter(todayStart(), 1);
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 18, 0, 0, 0);
  return toDatetimeLocalValue(d);
}

/** 发盘默认开始：空字符串 = 立即发布（仅工作日可立即挂；非工作日由 UI 禁用） */
export function defaultStartsAtLocal(): string {
  return "";
}

export function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO → datetime-local；无效则回退默认当日 18:00 */
export function isoToDatetimeLocal(iso?: string | null): string {
  if (!iso) return defaultExpiresAtLocal();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return defaultExpiresAtLocal();
  return toDatetimeLocalValue(d);
}

/** 开始时间：空表示立即发布；有值则转为 ISO */
export function startsAtLocalToISO(local?: string): string | undefined {
  if (!local || !local.trim()) return undefined;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

/** 开始时间展示 */
export function formatStartsAt(iso?: string | null): string {
  if (!iso) return "立即";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const pad = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameDay) return `今日 ${hm}`;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}

/** datetime-local → ISO8601（提交后端） */
export function expiresAtLocalToISO(local: string): string {
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return new Date(defaultExpiresAtLocal()).toISOString();
  return d.toISOString();
}

/** 校验 datetime-local / 立即发布 是否落在工作日 */
export function isWorkdayDateTimeLocal(local?: string, treatEmptyAsToday = false): boolean {
  if (!local || !local.trim()) {
    if (!treatEmptyAsToday) return true;
    return isWorkday(todayStart());
  }
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return false;
  return isWorkday(d);
}

/** 列表高亮展示过期时间 */
export function formatExpiresAt(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const pad = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return `今日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 状态角标：几点到期（当日仅时分，跨日带月日） */
export function formatExpiresAtBadge(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameDay) return `${hm}到期`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}到期`;
}

export function isExpiringSoon(iso?: string | null, withinHours = 2): boolean {
  if (!iso) return false;
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return false;
  const left = d - Date.now();
  return left > 0 && left <= withinHours * 3600 * 1000;
}
