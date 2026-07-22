"use client";

import {
  useCallback,
  useMemo,
  useEffect,
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { fetchPreferences, updatePreferences } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";

const DEFAULT_DELIVERY = "现货";
const CHANGED_EVENT = "favorites-changed";
const LEGACY_KEY = "snail_favorites_v2";
const LEGACY_KEY_V1 = "snail_favorites_v1";

export interface FavoriteEntry {
  key: string;
  productId: string;
  deliveryPeriod: string;
}

function cacheKey(userId: string | null): string {
  return userId ? `snail_favorites_u_${userId}` : "snail_favorites_guest";
}

function normalizeRawKey(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const s = raw.trim();
  if (s.includes(":")) return s;
  return `${s}:${DEFAULT_DELIVERY}`;
}

export function parseFavoriteEntry(raw: string): FavoriteEntry | null {
  const normalized = normalizeRawKey(raw);
  if (!normalized) return null;
  const idx = normalized.lastIndexOf(":");
  if (idx <= 0) return null;
  const productId = normalized.slice(0, idx);
  const deliveryPeriod = normalized.slice(idx + 1);
  if (!productId || !deliveryPeriod) return null;
  return { key: `${productId}:${deliveryPeriod}`, productId, deliveryPeriod };
}

function parseKeys(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const arr: unknown[] = Array.isArray(parsed) ? parsed : [];
    const seen = new Set<string>();
    const keys: string[] = [];
    for (const item of arr) {
      const entry = parseFavoriteEntry(typeof item === "string" ? item : String(item ?? ""));
      if (!entry || seen.has(entry.key)) continue;
      seen.add(entry.key);
      keys.push(entry.key);
    }
    return keys;
  } catch {
    return [];
  }
}

function keysToEntries(keys: string[]): FavoriteEntry[] {
  return keys
    .map(parseFavoriteEntry)
    .filter((e): e is FavoriteEntry => !!e);
}

function readLocalKeys(userId: string | null): string[] {
  if (typeof window === "undefined") return [];
  try {
    let raw = localStorage.getItem(cacheKey(userId));
    // 首次登录：迁移本机旧无账号自选
    if (!raw && userId) {
      raw = localStorage.getItem(LEGACY_KEY) || localStorage.getItem(LEGACY_KEY_V1);
    }
    return parseKeys(raw);
  } catch {
    return [];
  }
}

function writeLocalKeys(userId: string | null, keys: string[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(cacheKey(userId), JSON.stringify(keys));
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: { userId, keys } }));
}

/** in-memory mirror for sync external store */
let activeUserId: string | null = null;
let memoryKeys: string[] = [];
let memoryEntries: FavoriteEntry[] = [];
let syncTimer: ReturnType<typeof setTimeout> | null = null;

function setMemory(userId: string | null, keys: string[], persistLocal = true) {
  activeUserId = userId;
  memoryKeys = keys;
  memoryEntries = keysToEntries(keys);
  if (persistLocal) writeLocalKeys(userId, keys);
  else if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: { userId, keys } }));
  }
}

function scheduleServerSave(userId: string, keys: string[]) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    updatePreferences({ favorites: keys }).catch(() => {
      /* 网络失败时本地仍保留，下次登录会再推 */
    });
  }, 300);
}

/** 登录后从服务端拉取，并与本地缓存合并（服务端为空时上传本地） */
export async function syncFavoritesFromServer(userId: string): Promise<void> {
  const localKeys = readLocalKeys(userId);
  try {
    const res = await fetchPreferences();
    const serverKeys = parseKeys(JSON.stringify(res.data?.favorites ?? []));
    if (serverKeys.length > 0) {
      setMemory(userId, serverKeys, true);
      return;
    }
    // 服务端尚无自选：把本机缓存（含旧版）上传
    if (localKeys.length > 0) {
      setMemory(userId, localKeys, true);
      await updatePreferences({ favorites: localKeys });
      return;
    }
    setMemory(userId, [], true);
  } catch {
    // 拉失败则用本地
    setMemory(userId, localKeys, true);
  }
}

export function clearFavoritesMemory() {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  setMemory(null, [], false);
}

function getSnapshot(): FavoriteEntry[] {
  return memoryEntries;
}

function getServerSnapshot(): FavoriteEntry[] {
  return EMPTY;
}

const EMPTY: FavoriteEntry[] = [];

function subscribe(onStoreChange: () => void) {
  const onCustom = () => onStoreChange();
  window.addEventListener(CHANGED_EVENT, onCustom);
  return () => window.removeEventListener(CHANGED_EVENT, onCustom);
}

interface FavoritesContextValue {
  favorites: FavoriteEntry[];
  favCount: number;
  toggleFavorite: (key: string) => void;
  reorderFavorites: (fromKey: string, toKey: string) => void;
  isFav: (productId: string) => (dp: string) => boolean;
  isProductFav: (productId: string) => boolean;
  /** 是否已完成账号同步（可选用） */
  ready: boolean;
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

function useFavoritesStore(): FavoritesContextValue {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const favorites = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // 登录/切换账号：从服务端同步；退出：清空内存
  useEffect(() => {
    if (!isAuthenticated || !userId) {
      clearFavoritesMemory();
      return;
    }
    // 先灌本地缓存立刻显示，再拉服务器纠偏
    setMemory(userId, readLocalKeys(userId), false);
    let cancelled = false;
    syncFavoritesFromServer(userId).then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, userId]);

  const toggleFavorite = useCallback(
    (key: string) => {
      const uid = useAuthStore.getState().user?.id ?? null;
      if (!uid) return;
      const entry = parseFavoriteEntry(key);
      if (!entry) return;
      const prev = memoryKeys.length ? memoryKeys : readLocalKeys(uid);
      const exists = prev.includes(entry.key);
      const next = exists ? prev.filter((k) => k !== entry.key) : [...prev, entry.key];
      setMemory(uid, next, true);
      scheduleServerSave(uid, next);
    },
    []
  );

  const reorderFavorites = useCallback((fromKey: string, toKey: string) => {
    const uid = useAuthStore.getState().user?.id ?? null;
    if (!uid) return;
    const prev = memoryKeys.length ? [...memoryKeys] : readLocalKeys(uid);
    const fromIdx = prev.indexOf(fromKey);
    const toIdx = prev.indexOf(toKey);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
    const next = [...prev];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setMemory(uid, next, true);
    scheduleServerSave(uid, next);
  }, []);

  const isFav = useCallback(
    (productId: string) => (dp: string) =>
      favorites.some((f) => f.productId === productId && f.deliveryPeriod === dp),
    [favorites]
  );

  const isProductFav = useCallback(
    (productId: string) => favorites.some((f) => f.productId === productId),
    [favorites]
  );

  return useMemo(
    () => ({
      favorites,
      favCount: favorites.length,
      toggleFavorite,
      reorderFavorites,
      isFav,
      isProductFav,
      ready: isAuthenticated && !!userId,
    }),
    [favorites, toggleFavorite, reorderFavorites, isFav, isProductFav, isAuthenticated, userId]
  );
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const value = useFavoritesStore();
  return (
    <FavoritesContext.Provider value={value}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites() {
  const ctx = useContext(FavoritesContext);
  if (!ctx) {
    console.warn("useFavorites: No FavoritesProvider found");
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useFavoritesStore();
  }
  return ctx;
}
