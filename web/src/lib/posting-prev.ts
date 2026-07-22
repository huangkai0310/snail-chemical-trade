/**
 * 按「品种 + 交割期」记忆上一发盘（账号级，后端 user_preferences.posting_prefs）。
 * 例：丙酮+现货 与 丙酮+2607中 互不影响。
 */

import { fetchPreferences, updatePreferences, type PostingPrefsMap } from "./api";
import { useAuthStore } from "./auth-store";

function normPeriod(period: string): string {
  return (period || "").trim() || "现货";
}

export function listingPrefKey(productId: string, deliveryPeriod: string): string {
  return `${productId}|${normPeriod(deliveryPeriod)}`;
}

export function swapPrefKey(
  sellProductId: string,
  sellPeriod: string,
  buyProductId: string,
  buyPeriod: string,
): string {
  return `${sellProductId}|${normPeriod(sellPeriod)}|${buyProductId}|${normPeriod(buyPeriod)}`;
}

type Cache = PostingPrefsMap;

let cache: Cache = { listing: {}, swap: {} };
let hydrated = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function subscribePostingPrefs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getPostingPrefsCache(): Cache {
  return cache;
}

export function hydratePostingPrefs(prefs?: PostingPrefsMap | null) {
  cache = {
    listing: { ...(prefs?.listing ?? {}) },
    swap: { ...(prefs?.swap ?? {}) },
  };
  hydrated = true;
  notify();
}

export function clearPostingPrefsCache() {
  cache = { listing: {}, swap: {} };
  hydrated = false;
  notify();
}

/** 登录后拉取（PreferencesSync 也会调用） */
export async function ensurePostingPrefsLoaded(): Promise<void> {
  if (!useAuthStore.getState().token) {
    clearPostingPrefsCache();
    return;
  }
  try {
    const res = await fetchPreferences();
    hydratePostingPrefs(res.data?.posting_prefs);
  } catch {
    /* ignore */
  }
}

export function loadListingPrev<T extends object>(
  productId: string,
  deliveryPeriod: string,
): T | null {
  if (!productId || !deliveryPeriod) return null;
  const key = listingPrefKey(productId, deliveryPeriod);
  const raw = cache.listing?.[key];
  return (raw as T) ?? null;
}

export function loadSwapPrev<T extends object>(
  sellProductId: string,
  sellPeriod: string,
  buyProductId: string,
  buyPeriod: string,
): T | null {
  if (!sellProductId || !sellPeriod || !buyProductId || !buyPeriod) return null;
  const key = swapPrefKey(sellProductId, sellPeriod, buyProductId, buyPeriod);
  const raw = cache.swap?.[key];
  return (raw as T) ?? null;
}

export async function saveListingPrev<T extends object>(
  productId: string,
  deliveryPeriod: string,
  data: T,
): Promise<void> {
  if (!productId || !deliveryPeriod) return;
  if (!useAuthStore.getState().token) return;
  const key = listingPrefKey(productId, deliveryPeriod);
  // 乐观更新本地缓存
  cache = {
    ...cache,
    listing: { ...(cache.listing ?? {}), [key]: data as Record<string, unknown> },
  };
  notify();
  try {
    const res = await updatePreferences({
      posting_pref: { kind: "listing", key, data: data as Record<string, unknown> },
    });
    hydratePostingPrefs(res.data?.posting_prefs);
  } catch {
    /* 本地缓存已更新，下次同步可覆盖 */
  }
}

export async function saveSwapPrev<T extends object>(
  sellProductId: string,
  sellPeriod: string,
  buyProductId: string,
  buyPeriod: string,
  data: T,
): Promise<void> {
  if (!sellProductId || !buyProductId) return;
  if (!useAuthStore.getState().token) return;
  const key = swapPrefKey(sellProductId, sellPeriod, buyProductId, buyPeriod);
  cache = {
    ...cache,
    swap: { ...(cache.swap ?? {}), [key]: data as Record<string, unknown> },
  };
  notify();
  try {
    const res = await updatePreferences({
      posting_pref: { kind: "swap", key, data: data as Record<string, unknown> },
    });
    hydratePostingPrefs(res.data?.posting_prefs);
  } catch {
    /* ignore */
  }
}

export function isPostingPrefsHydrated(): boolean {
  return hydrated;
}
