import { create } from "zustand";

export interface AdminUser {
  id: string;
  username: string;
  email?: string | null;
  company_name?: string | null;
  role: string;
  status?: string;
}

interface AuthState {
  token: string | null;
  user: AdminUser | null;
  isAuthenticated: boolean;
  setAuth: (token: string, user: AdminUser) => void;
  logout: () => void;
  getToken: () => string | null;
}

const TOKEN_KEY = "admin_snailchem_token";
const USER_KEY = "admin_snailchem_user";

function normalizeUser(raw: Record<string, unknown>): AdminUser {
  return {
    id: String(raw.id ?? ""),
    username: String(raw.username ?? raw.nickname ?? raw.email ?? ""),
    email: (raw.email as string | null | undefined) ?? null,
    company_name: (raw.company_name as string | null | undefined) ?? null,
    role: String(raw.role ?? ""),
    status: raw.status ? String(raw.status) : undefined,
  };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  isAuthenticated: false,

  setAuth: (token: string, user: AdminUser) => {
    const normalized = normalizeUser(user as unknown as Record<string, unknown>);
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(normalized));
    set({ token, user: normalized, isAuthenticated: true });
  },

  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    set({ token: null, user: null, isAuthenticated: false });
  },

  getToken: () => {
    let token = get().token;
    if (!token) {
      token = localStorage.getItem(TOKEN_KEY);
      if (token) {
        try {
          const user = JSON.parse(localStorage.getItem(USER_KEY) || "null");
          if (user) set({ token, user: normalizeUser(user), isAuthenticated: true });
        } catch {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
          token = null;
        }
      }
    }
    return token;
  },
}));

/** 页面加载时从 localStorage 恢复 session */
export function initAuth() {
  const token = localStorage.getItem(TOKEN_KEY);
  const userRaw = localStorage.getItem(USER_KEY);
  if (token && userRaw) {
    try {
      const user = JSON.parse(userRaw);
      useAuthStore.getState().setAuth(token, normalizeUser(user));
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
  }
}
