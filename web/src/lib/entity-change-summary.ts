import type { Listing, SwapListing } from "./types";

function normStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function arrChanged(a?: string[] | null, b?: string[] | null): boolean {
  const sa = [...(a ?? [])].sort().join("\0");
  const sb = [...(b ?? [])].sort().join("\0");
  return sa !== sb;
}

function freeStorageChanged(
  prevEnabled?: boolean,
  prevDays?: number | null,
  nextEnabled?: boolean,
  nextDays?: number | null
): boolean {
  return !!prevEnabled !== !!nextEnabled || (prevDays ?? null) !== (nextDays ?? null);
}

/**
 * 对比挂牌「主动编辑」字段变更（不含成交量 filled 等系统推进字段）。
 * 摘盘/锁定导致的数量变化不应触发「对方已修改」提示。
 */
export function diffListingChanges(prev: Listing, next: Listing): string[] {
  const changes: string[] = [];
  if (prev.price !== next.price) changes.push("价格");
  if (prev.quantity !== next.quantity) changes.push("数量");
  if (normStr(prev.delivery_period) !== normStr(next.delivery_period)) changes.push("交割期");
  if (normStr(prev.delivery_location) !== normStr(next.delivery_location)) changes.push("交割地");
  if (normStr(prev.payment_method) !== normStr(next.payment_method)) changes.push("付款方式");
  if (normStr(prev.delivery_method) !== normStr(next.delivery_method)) changes.push("交割方式");
  if (freeStorageChanged(prev.free_storage_enabled, prev.free_storage_days, next.free_storage_enabled, next.free_storage_days)) {
    changes.push("免仓期");
  }
  if (normStr(prev.specs) !== normStr(next.specs)) changes.push("规格");
  if ((prev.allow_partial ?? true) !== (next.allow_partial ?? true)) changes.push("拆单设置");
  if ((prev.min_quantity ?? 0) !== (next.min_quantity ?? 0)) changes.push("最小成交量");
  if ((prev.allow_counter_offer ?? true) !== (next.allow_counter_offer ?? true)) changes.push("是否可商谈");
  if (arrChanged(prev.negotiable_terms, next.negotiable_terms)) changes.push("可商谈条款");
  return changes;
}

function diffSwapLeg(leg: "sell" | "buy", prev: SwapListing, next: SwapListing): string[] {
  const prefix = leg === "sell" ? "卖盘" : "买盘";
  const changes: string[] = [];

  const priceKey = `${leg}_price` as const;
  const qtyKey = `${leg}_quantity` as const;
  const dpKey = `${leg}_delivery_period` as const;
  const dlKey = `${leg}_delivery_location` as const;
  const pmKey = `${leg}_payment_method` as const;
  const dmKey = `${leg}_delivery_method` as const;
  const fseKey = `${leg}_free_storage_enabled` as const;
  const fsdKey = `${leg}_free_storage_days` as const;
  const spKey = `${leg}_specs` as const;
  const apKey = `${leg}_allow_partial` as const;
  const mqKey = `${leg}_min_quantity` as const;
  const acoKey = `${leg}_allow_counter_offer` as const;
  const ntKey = `${leg}_negotiable_terms` as const;

  if (prev[priceKey] !== next[priceKey]) changes.push(`${prefix}价格`);
  // 不含 filled：单边锁定/闪拼/摘盘导致的 filled 变动不算主动编辑
  if (prev[qtyKey] !== next[qtyKey]) {
    changes.push(`${prefix}数量`);
  }
  if (normStr(prev[dpKey]) !== normStr(next[dpKey])) changes.push(`${prefix}交割期`);
  if (normStr(prev[dlKey]) !== normStr(next[dlKey])) changes.push(`${prefix}交割地`);
  if (normStr(prev[pmKey]) !== normStr(next[pmKey])) changes.push(`${prefix}付款方式`);
  if (normStr(prev[dmKey]) !== normStr(next[dmKey])) changes.push(`${prefix}交割方式`);
  if (
    freeStorageChanged(
      prev[fseKey] as boolean | undefined,
      prev[fsdKey] as number | null | undefined,
      next[fseKey] as boolean | undefined,
      next[fsdKey] as number | null | undefined
    )
  ) {
    changes.push(`${prefix}免仓期`);
  }
  if (normStr(prev[spKey]) !== normStr(next[spKey])) changes.push(`${prefix}规格`);
  if ((prev[apKey] ?? true) !== (next[apKey] ?? true)) changes.push(`${prefix}拆单设置`);
  if ((prev[mqKey] ?? 0) !== (next[mqKey] ?? 0)) changes.push(`${prefix}最小成交量`);
  if ((prev[acoKey] ?? prev.allow_counter_offer ?? true) !== (next[acoKey] ?? next.allow_counter_offer ?? true)) {
    changes.push(`${prefix}是否可商谈`);
  }
  if (arrChanged(prev[ntKey] as string[] | undefined, next[ntKey] as string[] | undefined)) {
    changes.push(`${prefix}可商谈条款`);
  }

  return changes;
}

/** 对比换盘变更，返回中文条款名列表（含卖盘/买盘前缀） */
export function diffSwapChanges(prev: SwapListing, next: SwapListing): string[] {
  const changes = [...diffSwapLeg("sell", prev, next), ...diffSwapLeg("buy", prev, next)];
  if ((prev.allow_single_side ?? true) !== (next.allow_single_side ?? true)) changes.push("单边交易设置");
  if ((prev.single_side_mode ?? "both") !== (next.single_side_mode ?? "both")) changes.push("单边模式");
  return changes;
}

/** 生成弹窗更新提示文案 */
export function formatEntityUpdateMessage(changes: string[]): string {
  if (changes.length === 0) return "盘子信息已更新，请查看最新数据";
  return `对方已修改：${changes.join("、")}`;
}

/** 是否存在对方主动编辑的条款变更（用于决定是否弹「已修改」通知） */
export function hasEditorialEntityUpdate(
  prev: Listing | SwapListing,
  next: Listing | SwapListing
): boolean {
  const isSwap = "sell_price" in prev && "sell_price" in next;
  const changes = isSwap
    ? diffSwapChanges(prev as SwapListing, next as SwapListing)
    : diffListingChanges(prev as Listing, next as Listing);
  return changes.length > 0;
}

/** 根据实体类型对比并生成提示文案；无主动编辑变更时返回 null */
export function describeEntityUpdate(
  prev: Listing | SwapListing,
  next: Listing | SwapListing
): string | null {
  const isSwap = "sell_price" in prev && "sell_price" in next;
  const changes = isSwap
    ? diffSwapChanges(prev as SwapListing, next as SwapListing)
    : diffListingChanges(prev as Listing, next as Listing);
  if (changes.length === 0) return null;
  return formatEntityUpdateMessage(changes);
}
