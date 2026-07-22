/**
 * 发盘数量模式：
 * - whole（整单）→ 不可拆单：直接填总数量
 * - shares（按份数）→ 可拆单：每份数量 × 份数 = 总数量，最小成交量 = 每份数量
 */

export type QtyMode = "whole" | "shares";

export function qtyModeFromPartial(allowPartial?: boolean | null): QtyMode {
  return allowPartial ? "shares" : "whole";
}

/** 从已有挂盘还原「每份 / 份数」（编辑回填） */
export function deriveShareFields(
  quantity: number,
  minQuantity?: number | null,
): { perShare: string; shareCount: string } {
  const qty = Math.floor(quantity);
  const min = minQuantity != null && minQuantity > 0 ? Math.floor(minQuantity) : 0;
  if (min > 0 && qty > 0 && qty % min === 0) {
    return { perShare: String(min), shareCount: String(qty / min) };
  }
  if (min > 0) {
    return { perShare: String(min), shareCount: qty > 0 ? String(Math.max(1, Math.floor(qty / min))) : "" };
  }
  if (qty > 0) {
    return { perShare: String(qty), shareCount: "1" };
  }
  return { perShare: "", shareCount: "" };
}

export function computeSharesTotal(perShare: string, shareCount: string): number {
  const per = Math.floor(Number(perShare));
  const count = Math.floor(Number(shareCount));
  if (!(per > 0) || !(count > 0)) return 0;
  return per * count;
}

/** 提交前解析：返回 API 字段或错误文案 */
export function resolveQtyForSubmit(
  mode: QtyMode,
  quantity: string,
  perShare: string,
  shareCount: string,
): { quantity: number; allow_partial: boolean; min_quantity: number; error?: string } {
  if (mode === "whole") {
    const qty = Math.floor(Number(quantity));
    if (!(qty > 0)) {
      return { quantity: 0, allow_partial: false, min_quantity: 0, error: "请填写整单数量" };
    }
    return { quantity: qty, allow_partial: false, min_quantity: 0 };
  }
  const per = Math.floor(Number(perShare));
  const count = Math.floor(Number(shareCount));
  if (!(per > 0)) {
    return { quantity: 0, allow_partial: true, min_quantity: 0, error: "请填写每份数量" };
  }
  if (!(count > 0)) {
    return { quantity: 0, allow_partial: true, min_quantity: 0, error: "请填写份数" };
  }
  if (!Number.isInteger(Number(shareCount)) || count !== Number(shareCount)) {
    return { quantity: 0, allow_partial: true, min_quantity: 0, error: "份数须为正整数" };
  }
  const total = per * count;
  if (!(total > 0)) {
    return { quantity: 0, allow_partial: true, min_quantity: 0, error: "整单数量无效" };
  }
  return { quantity: total, allow_partial: true, min_quantity: per };
}

/** 展示文案（详情/列表） */
export function formatQtyModeLabel(
  allowPartial?: boolean | null,
  quantity?: number | null,
  minQuantity?: number | null,
  unit: string = "吨",
): string {
  if (allowPartial === false) return "整单";
  const qty = quantity != null ? Math.floor(quantity) : 0;
  const min = minQuantity != null && minQuantity > 0 ? Math.floor(minQuantity) : 0;
  if (min > 0 && qty > 0 && qty % min === 0) {
    return `按份数 · 每份 ${min} ${unit} × ${qty / min} 份`;
  }
  if (min > 0) return `按份数 · 每份 ${min} ${unit}`;
  return "按份数";
}

/** 换盘买卖数量保持一致：把数量方式写入买卖两侧同一套字段 */
export function applySharedSwapQty<
  T extends {
    sell_quantity: string;
    buy_quantity: string;
    sell_per_share: string;
    buy_per_share: string;
    sell_share_count: string;
    buy_share_count: string;
    sell_allow_partial: boolean;
    buy_allow_partial: boolean;
    sell_min_quantity?: string;
    buy_min_quantity?: string;
  },
>(
  form: T,
  patch: {
    mode?: QtyMode;
    quantity?: string;
    perShare?: string;
    shareCount?: string;
  },
): T {
  const mode = patch.mode ?? qtyModeFromPartial(form.sell_allow_partial);
  const allow = mode === "shares";
  let quantity = patch.quantity ?? form.sell_quantity;
  let perShare = patch.perShare ?? form.sell_per_share;
  let shareCount = patch.shareCount ?? form.sell_share_count;
  let minQty = "";

  if (allow) {
    if (patch.mode === "shares" && !perShare && Number(quantity) > 0) {
      perShare = quantity;
      shareCount = shareCount || "1";
    }
    const total = computeSharesTotal(perShare, shareCount);
    if (total > 0) quantity = String(total);
    minQty = perShare;
  } else {
    if (patch.mode === "whole") {
      const total = computeSharesTotal(perShare, shareCount);
      if (total > 0) quantity = String(total);
    }
  }

  const next: T = {
    ...form,
    sell_allow_partial: allow,
    buy_allow_partial: allow,
    sell_quantity: quantity,
    buy_quantity: quantity,
    sell_per_share: perShare,
    buy_per_share: perShare,
    sell_share_count: shareCount,
    buy_share_count: shareCount,
  };
  if ("sell_min_quantity" in form) {
    (next as T).sell_min_quantity = minQty;
    (next as T).buy_min_quantity = minQty;
  }
  return next;
}
