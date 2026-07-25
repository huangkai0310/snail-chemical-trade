export interface Product {
  id: string;
  name: string;
  name_en?: string | null;
  category?: string | null;
  unit: string;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at?: string;
}

export interface DictItem {
  id: number | string;
  name: string;
  sort_order?: number;
  active?: boolean;
  days?: number;
  min_quantity?: number;
  created_at?: string;
}

export interface Holiday {
  id: number | string;
  date: string;
  name: string;
  is_holiday: boolean;
  created_at?: string;
}

export interface MarketConfig {
  key: string;
  value: string;
  description?: string;
  updated_at?: string;
}

/** 与后端 admin_market_config 一致 */
export interface MarketStatus {
  market_open: boolean;
  reason?: string;
  message?: string;
  status?: string;
}

export interface CronTask {
  id: number | string;
  name: string;
  description: string;
  task_type: "interval" | "cron" | string;
  interval_seconds?: number | null;
  cron_expr?: string | null;
  enabled: boolean;
  last_status?: string;
  last_message?: string | null;
  last_run_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface LoginResponse {
  token: string;
  user: AdminUser;
}

export interface AdminUser {
  id: string;
  username: string;
  email?: string | null;
  company_name?: string | null;
  role: string;
  status?: string;
}

/** 格式化后端 time.Time / ISO 日期为 YYYY-MM-DD */
export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return "—";
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
