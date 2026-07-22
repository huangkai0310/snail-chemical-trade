"use client";

import { create } from "zustand";
import type { User } from "./types";
import { useNotificationStore } from "./notification-store";

interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  // actions
  setAuth: (token: string, user: User) => void;
  logout: () => void;
  getToken: () => string | null;
}

const TOKEN_KEY = "snailchem_token";
const USER_KEY = "snailchem_user";

function loadToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

function loadUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>((set, get) => {
  const token = loadToken();
  const user = loadUser();

  // 页面刷新时按当前登录用户加载通知
  if (user?.id) {
    useNotificationStore.getState().switchUser(user.id);
  }

  // 多 Tab 账号切换：监听 localStorage 变化
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (e) => {
      if (e.key !== TOKEN_KEY && e.key !== USER_KEY) return;
      const newToken = loadToken();
      const newUser = loadUser();
      useNotificationStore.getState().switchUser(newUser?.id ?? null);
      set({
        token: newToken,
        user: newUser,
        isAuthenticated: !!newToken && !!newUser,
      });
    });
  }

  return {
    token,
    user,
    isAuthenticated: !!token && !!user,

    setAuth: (token: string, user: User) => {
      if (typeof window !== "undefined") {
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(USER_KEY, JSON.stringify(user));
      }
      useNotificationStore.getState().switchUser(user.id);
      set({ token, user, isAuthenticated: true });
    },

    logout: () => {
      if (typeof window !== "undefined") {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
      }
      useNotificationStore.getState().switchUser(null);
      set({ token: null, user: null, isAuthenticated: false });
    },

    getToken: () => get().token,
  };
});
