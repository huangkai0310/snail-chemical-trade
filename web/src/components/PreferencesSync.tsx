"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth-store";
import { fetchPreferences, updatePreferences } from "@/lib/api";
import { persistThemeLocal, type ThemeMode } from "@/lib/theme-provider";
import { clearPostingPrefsCache, hydratePostingPrefs } from "@/lib/posting-prev";
import { hydrateSoundPrefs, loadSoundPrefsFromLocal, unlockAudio } from "@/lib/sound-prefs";

const AUTH_ROUTES = ["/trading", "/my", "/counter-offers", "/account", "/profile"];
const TRADING_VIEW_KEY = "trading_view";
const WL_TAB_KEY = "wl_tab";
const LAST_ROUTE_KEY = "last_route";

declare global {
  interface Window {
    __snailPrefsReady?: boolean;
  }
}

/**
 * 登录后把账号级偏好拉到本机；
 * 交易大厅 / 自选 Tab / 上次路由 / 主题等操作变更后写回服务端。
 */
export default function PreferencesSync() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const userId = useAuthStore((s) => s.user?.id);
  const pathname = usePathname();
  const router = useRouter();
  const didRestoreRoute = useRef(false);
  const hydrated = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !userId) {
      hydrated.current = false;
      didRestoreRoute.current = false;
      clearPostingPrefsCache();
      loadSoundPrefsFromLocal();
      if (typeof window !== "undefined") window.__snailPrefsReady = false;
      return;
    }
    let cancelled = false;
    if (typeof window !== "undefined") window.__snailPrefsReady = false;
    (async () => {
      try {
        const res = await fetchPreferences();
        if (cancelled) return;
        const p = res.data;
        if (p.trading_view && typeof p.trading_view === "object") {
          localStorage.setItem(TRADING_VIEW_KEY, JSON.stringify(p.trading_view));
          window.dispatchEvent(new CustomEvent("trading-view-changed"));
        }
        if (p.watchlist_tab === "favorites" || p.watchlist_tab === "overview") {
          localStorage.setItem(WL_TAB_KEY, p.watchlist_tab);
          window.dispatchEvent(new CustomEvent("wl-tab-changed"));
        }
        if (p.last_route) {
          localStorage.setItem(LAST_ROUTE_KEY, p.last_route);
        }
        hydratePostingPrefs(p.posting_prefs);
        hydrateSoundPrefs(p.sound_prefs);
        // 账号主题：服务端已设置则以账号为准；否则把本机主题上传，避免被默认值覆盖
        if (p.theme === "light" || p.theme === "dark") {
          persistThemeLocal(p.theme as ThemeMode);
          window.dispatchEvent(new CustomEvent("theme-changed", { detail: p.theme }));
        } else {
          const local = localStorage.getItem("snailchem_theme");
          if (local === "light" || local === "dark") {
            updatePreferences({ theme: local }).catch(() => {});
          }
        }
        hydrated.current = true;
        window.__snailPrefsReady = true;

        if (!didRestoreRoute.current) {
          didRestoreRoute.current = true;
          const last = p.last_route || localStorage.getItem(LAST_ROUTE_KEY);
          if (
            (pathname === "/" || pathname === "/index.html") &&
            last &&
            AUTH_ROUTES.includes(last)
          ) {
            router.replace(last);
          }
        }
      } catch {
        hydrated.current = true;
        loadSoundPrefsFromLocal();
        if (typeof window !== "undefined") window.__snailPrefsReady = true;
      }
    })();
    return () => {
      cancelled = true;
    };
    // pathname 不进依赖，避免重复拉取；仅用首次登录时的路径判断是否恢复
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, userId, router]);

  // 任意点击解锁音频（满足浏览器自动播放策略）
  useEffect(() => {
    const onFirstGesture = () => unlockAudio();
    window.addEventListener("pointerdown", onFirstGesture, { once: true, passive: true });
    window.addEventListener("keydown", onFirstGesture, { once: true });
    return () => {
      window.removeEventListener("pointerdown", onFirstGesture);
      window.removeEventListener("keydown", onFirstGesture);
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !userId || !hydrated.current) return;
    if (!AUTH_ROUTES.includes(pathname)) return;
    try {
      localStorage.setItem(LAST_ROUTE_KEY, pathname);
    } catch {}
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      updatePreferences({ last_route: pathname }).catch(() => {});
    }, 400);
  }, [pathname, isAuthenticated, userId]);

  return null;
}

/** 供交易大厅写入账号级 trading_view */
export function persistTradingView(patch: {
  productId?: string;
  marketType?: string;
  deliveryPeriod?: string;
}) {
  try {
    const raw = localStorage.getItem(TRADING_VIEW_KEY);
    const cur = raw ? JSON.parse(raw) : {};
    const next = { ...cur, ...patch };
    localStorage.setItem(TRADING_VIEW_KEY, JSON.stringify(next));
    // 账号偏好未就绪前只写本机，避免默认品种覆盖服务端记录
    if (typeof window !== "undefined" && window.__snailPrefsReady && useAuthStore.getState().token) {
      updatePreferences({ trading_view: next }).catch(() => {});
    }
  } catch {}
}

/** 供 WatchList 写入账号级 tab */
export function persistWatchlistTab(tab: "favorites" | "overview") {
  try {
    localStorage.setItem(WL_TAB_KEY, tab);
    if (typeof window !== "undefined" && window.__snailPrefsReady && useAuthStore.getState().token) {
      updatePreferences({ watchlist_tab: tab }).catch(() => {});
    }
  } catch {}
}

/** 写入铃声偏好（本机 + 服务端） */
export function persistSoundPrefs(next: { enabled: boolean }) {
  hydrateSoundPrefs(next);
  if (typeof window !== "undefined" && window.__snailPrefsReady && useAuthStore.getState().token) {
    updatePreferences({ sound_prefs: next }).catch(() => {});
  }
}
