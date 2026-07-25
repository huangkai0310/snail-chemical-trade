import { useAuthStore } from "./auth-store";
import type {
  Product,
  DictItem,
  Holiday,
  MarketConfig,
  MarketStatus,
  CronTask,
  LoginResponse,
  AdminUser,
} from "./types";

/**
 * 管理后台默认直连 API 域名（后端已开 CORS）。
 * 若 trade 域名已反代 /api，可设 NEXT_PUBLIC_API_URL="" 走同源。
 */
const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL !== undefined
    ? process.env.NEXT_PUBLIC_API_URL
    : "https://api.snailchemical.com"
).replace(/\/$/, "");

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = useAuthStore.getState().getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    if (res.status === 401) {
      useAuthStore.getState().logout();
      if (typeof window !== "undefined") window.location.href = "/admin/auth";
    }
    let msg = res.statusText;
    try {
      const body = await res.json();
      msg = body.error || body.message || msg;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const authApi = {
  login: (username: string, password: string) =>
    request<LoginResponse>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  fetchMe: () => request<AdminUser>("/api/v1/auth/me"),
};

export const productApi = {
  list: () => request<{ data: Product[] }>("/api/v1/admin/products"),

  create: (data: {
    id: string;
    name: string;
    name_en?: string | null;
    unit: string;
    category?: string | null;
    sort_order?: number;
  }) =>
    request<{ data: Product }>("/api/v1/admin/products", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (
    id: string,
    data: {
      name: string;
      name_en?: string | null;
      unit: string;
      category?: string | null;
      sort_order?: number;
      active: boolean;
    }
  ) =>
    request<{ message: string }>(`/api/v1/admin/products/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<{ message: string }>(`/api/v1/admin/products/${id}`, { method: "DELETE" }),
};

export const dictApi = {
  list: (dictType: string) =>
    request<{ data: DictItem[] }>(`/api/v1/admin/dict/${dictType}`),

  create: (dictType: string, data: Record<string, unknown>) =>
    request<{ data: DictItem }>(`/api/v1/admin/dict/${dictType}`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (dictType: string, id: string | number, data: Record<string, unknown>) =>
    request<{ message: string }>(`/api/v1/admin/dict/${dictType}/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  delete: (dictType: string, id: string | number) =>
    request<{ message: string }>(`/api/v1/admin/dict/${dictType}/${id}`, {
      method: "DELETE",
    }),
};

export const holidayApi = {
  list: (year?: number) => {
    const query = year ? `?year=${year}` : "";
    return request<{ data: Holiday[] }>(`/api/v1/admin/holidays${query}`);
  },

  create: (data: { date: string; name: string; is_holiday: boolean }) =>
    request<{ data: Holiday }>("/api/v1/admin/holidays", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string | number, data: { date: string; name: string; is_holiday: boolean }) =>
    request<{ message: string }>(`/api/v1/admin/holidays/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  delete: (id: string | number) =>
    request<{ message: string }>(`/api/v1/admin/holidays/${id}`, { method: "DELETE" }),

  batchUpsert: (items: { date: string; name: string; is_holiday: boolean }[]) =>
    request<{ count?: number; message?: string }>("/api/v1/admin/holidays/batch", {
      method: "POST",
      body: JSON.stringify({ items }),
    }),

  deleteByYear: (year: number) =>
    request<{ message: string }>(`/api/v1/admin/holidays/year/${year}`, { method: "DELETE" }),
};

export const marketConfigApi = {
  list: () => request<{ data: MarketConfig[] }>("/api/v1/admin/market-config"),

  get: (key: string) =>
    request<{ key: string; value: string }>(`/api/v1/admin/market-config/${key}`),

  set: (key: string, value: string, description?: string) =>
    request<{ message: string }>(`/api/v1/admin/market-config/${key}`, {
      method: "PUT",
      body: JSON.stringify({ value, description }),
    }),

  delete: (key: string) =>
    request<{ message: string }>(`/api/v1/admin/market-config/${key}`, { method: "DELETE" }),

  getMarketStatus: () => request<MarketStatus>("/api/v1/admin/market-status"),

  setMarketStatus: (open: boolean, reason?: string) =>
    request<MarketStatus>("/api/v1/admin/market-status", {
      method: "PUT",
      body: JSON.stringify({ open, reason: reason || "" }),
    }),
};

export const cronTaskApi = {
  list: () => request<{ data: CronTask[] }>("/api/v1/admin/cron-tasks"),

  create: (data: {
    name: string;
    description?: string;
    task_type: "interval" | "cron";
    interval_seconds?: number | null;
    cron_expr?: string | null;
    enabled?: boolean;
  }) =>
    request<{ data: CronTask }>("/api/v1/admin/cron-tasks", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (
    id: string | number,
    data: {
      name: string;
      description?: string;
      task_type: "interval" | "cron";
      interval_seconds?: number | null;
      cron_expr?: string | null;
      enabled?: boolean;
    }
  ) =>
    request<{ message: string }>(`/api/v1/admin/cron-tasks/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  delete: (id: string | number) =>
    request<{ message: string }>(`/api/v1/admin/cron-tasks/${id}`, { method: "DELETE" }),

  toggle: (id: string | number, enabled: boolean) =>
    request<{ message: string; enabled: boolean }>(`/api/v1/admin/cron-tasks/${id}/toggle`, {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    }),
};
