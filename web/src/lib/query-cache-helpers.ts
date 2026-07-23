import type { QueryClient } from "@tanstack/react-query";
import type { Listing, SwapListing } from "./types";

type Paged<T> = { data?: T[]; total?: number };

/** 在所有 listingsFiltered 缓存分片中查找挂牌 */
export function findListingInCache(queryClient: QueryClient, id: string): Listing | undefined {
  for (const entry of queryClient.getQueryCache().findAll({ queryKey: ["listingsFiltered"] })) {
    const data = entry.state.data as Paged<Listing> | undefined;
    const found = data?.data?.find((l) => l.id === id);
    if (found) return found;
  }
  return undefined;
}

/** 在所有 swaps 缓存分片中查找换盘 */
export function findSwapInCache(queryClient: QueryClient, id: string): SwapListing | undefined {
  for (const entry of queryClient.getQueryCache().findAll({ queryKey: ["swaps"] })) {
    const data = entry.state.data as Paged<SwapListing> | undefined;
    const found = data?.data?.find((s) => s.id === id);
    if (found) return found;
  }
  return undefined;
}

/** 判断实体是否有实质更新（优先比较 updated_at） */
export function entityChanged<T extends { updated_at?: string }>(prev: T, next: T): boolean {
  if (prev === next) return false;
  if (prev.updated_at && next.updated_at) {
    return prev.updated_at !== next.updated_at;
  }
  return true;
}

/** 在列表数据中查找挂牌（ListingPanel 用） */
export function findListingInLists(lists: Listing[][], id: string): Listing | undefined {
  for (const list of lists) {
    const found = list.find((l) => l.id === id);
    if (found) return found;
  }
  return undefined;
}

/** 在列表数据中查找换盘（ListingPanel 用） */
export function findSwapInList(list: SwapListing[], id: string): SwapListing | undefined {
  return list.find((s) => s.id === id);
}

/** 挂牌是否被对方撤盘/过期（不含已成交——全成应显示「已成交」而非「撤盘」） */
export function isListingWithdrawn(l: Listing): boolean {
  return l.status === "CANCELLED" || l.status === "EXPIRED";
}

/** 挂牌是否已全部成交 */
export function isListingFilled(l: Listing): boolean {
  return l.status === "FILLED";
}

/** 挂牌是否已不可再交易（成交/撤盘/过期） */
export function isListingUntradable(l: Listing): boolean {
  return isListingFilled(l) || isListingWithdrawn(l);
}

/** 换盘是否被对方撤盘（不含已撮合完成） */
export function isSwapWithdrawn(s: SwapListing): boolean {
  return s.status === "CANCELLED";
}

/** 换盘是否已全部撮合 */
export function isSwapMatched(s: SwapListing): boolean {
  return s.status === "MATCHED";
}

/** 换盘是否已不可再交易 */
export function isSwapUntradable(s: SwapListing): boolean {
  return isSwapMatched(s) || isSwapWithdrawn(s);
}

export function wasListingActive(l: Listing): boolean {
  return l.status === "OPEN" || l.status === "PARTIAL";
}

export function wasSwapActive(s: SwapListing): boolean {
  return s.status === "OPEN";
}
