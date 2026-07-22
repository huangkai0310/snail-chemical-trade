"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuthStore } from "@/lib/auth-store";
import { fetchMe } from "@/lib/api";
import AuthModal from "./AuthModal";

function AuthSection() {
  const { user, isAuthenticated, logout } = useAuthStore();
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = useAuthStore.getState().token;
    if (!token) {
      setReady(true);
      return;
    }
    fetchMe()
      .then((me) => {
        useAuthStore.getState().setAuth(token, me);
      })
      .catch(() => {
        logout();
      })
      .finally(() => setReady(true));
  }, [logout]);

  const openAuth = useCallback((mode: "login" | "register") => {
    setAuthMode(mode);
    setAuthOpen(true);
  }, []);

  // Default render: always show login/register buttons
  // After hydration, update based on auth state
  const showLoggedIn = ready && isAuthenticated && user;

  return (
    <>
      <div className="flex items-center gap-2 text-sm">
        {!ready ? (
          // Hydration placeholder — matches the default buttons
          <>
            <button
              onClick={() => openAuth("login")}
              className="px-4 py-1.5 text-brand-600 hover:bg-brand-50 rounded-lg font-medium transition-colors"
            >
              登录
            </button>
            <button
              onClick={() => openAuth("register")}
              className="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-medium transition-colors"
            >
              注册
            </button>
          </>
        ) : showLoggedIn ? (
          <>
            <span className="text-gray-600 hidden sm:inline">
              {user.company_name || user.username}
            </span>
            <span className="text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 px-2 py-1 rounded">
              已登录
            </span>
            <button
              onClick={logout}
              className="px-3 py-1.5 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
            >
              退出
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => openAuth("login")}
              className="px-4 py-1.5 text-brand-600 hover:bg-brand-50 rounded-lg font-medium transition-colors"
            >
              登录
            </button>
            <button
              onClick={() => openAuth("register")}
              className="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-medium transition-colors"
            >
              注册
            </button>
          </>
        )}
      </div>

      <AuthModal
        open={authOpen}
        initialMode={authMode}
        onClose={() => setAuthOpen(false)}
      />
    </>
  );
}

export default function AuthButtons() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    // SSR fallback — static login/register buttons (no hooks)
    return (
      <div className="flex items-center gap-2 text-sm">
        <button className="px-4 py-1.5 text-brand-600 hover:bg-brand-50 rounded-lg font-medium transition-colors">
          登录
        </button>
        <button className="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-medium transition-colors">
          注册
        </button>
      </div>
    );
  }

  return <AuthSection />;
}
