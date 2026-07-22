import type { SwapListing } from "./types";

export const SWAP_LOCK_BUY_TOOLTIP =
  "锁定·买：仅接受对方卖盘侧，单边锁定，待第三方闪拼或商谈后最终成交";
export const SWAP_LOCK_SELL_TOOLTIP =
  "锁定·卖：仅接受对方买盘侧，单边锁定，待第三方闪拼或商谈后最终成交";

export interface SwapLockState {
  sellRemain: number;
  buyRemain: number;
  sellSideDone: boolean;
  buySideDone: boolean;
  /** 仅一侧有锁定/成交量，且该侧余量 > 0 */
  partialSingleSideLock: boolean;
  /** 仅一侧已满（余量=0），另一侧有余量 */
  fullSingleSideLock: boolean;
  /** 存在任一单边锁定状态 */
  anySingleSideLock: boolean;
  canFlashMatch: boolean;
  flashMode: "sell" | "buy" | null;
}

export function getSwapLockState(swap: SwapListing): SwapLockState {
  const sellFilled = swap.sell_filled ?? 0;
  const buyFilled = swap.buy_filled ?? 0;
  const sellRemain = Math.max(0, Math.floor(swap.sell_quantity - sellFilled));
  const buyRemain = Math.max(0, Math.floor(swap.buy_quantity - buyFilled));
  const sellSideDone = sellRemain <= 0;
  const buySideDone = buyRemain <= 0;

  const bilateralDone = Math.min(sellFilled, buyFilled);
  const sellLockExcess = Math.max(0, sellFilled - bilateralDone);
  const buyLockExcess = Math.max(0, buyFilled - bilateralDone);
  const anySingleSideLock = sellLockExcess > 0 || buyLockExcess > 0;

  const fullSingleSideLock =
    anySingleSideLock &&
    ((sellSideDone && buyRemain > 0) || (buySideDone && sellRemain > 0));

  const partialSingleSideLock = anySingleSideLock;

  const flashMode: "sell" | "buy" | null =
    sellLockExcess > 0 && buyRemain > 0
      ? "buy"
      : buyLockExcess > 0 && sellRemain > 0
        ? "sell"
        : null;

  const canFlashMatch = anySingleSideLock && flashMode !== null;

  return {
    sellRemain,
    buyRemain,
    sellSideDone,
    buySideDone,
    partialSingleSideLock,
    fullSingleSideLock,
    anySingleSideLock,
    canFlashMatch,
    flashMode,
  };
}

/** 是否可锁定·买（接受对方卖腿）——入口可见性：有余量且允许单边即可，具体数量在弹窗内校验 */
export function canSwapLockBuy(swap: SwapListing, sellRemain: number): boolean {
  return swapLockBuyDisabledReason(swap, sellRemain) === null;
}

/** 是否可锁定·卖（接受对方买腿）——入口可见性：有余量且允许单边即可，具体数量在弹窗内校验 */
export function canSwapLockSell(swap: SwapListing, buyRemain: number): boolean {
  return swapLockSellDisabledReason(swap, buyRemain) === null;
}

/** 锁定·买不可用原因；null 表示可用（按钮常驻，不可用时置灰） */
export function swapLockBuyDisabledReason(swap: SwapListing, sellRemain: number): string | null {
  if (sellRemain <= 0) return "卖侧已全部成交/锁定，无法锁定·买";
  if (swap.allow_single_side === false) return "该换盘不允许单边锁定";
  const mode = swap.single_side_mode ?? "both";
  if (mode === "none" || mode === "single_sell") return "该换盘不允许锁定·买";
  return null;
}

/** 锁定·卖不可用原因；null 表示可用 */
export function swapLockSellDisabledReason(swap: SwapListing, buyRemain: number): string | null {
  if (buyRemain <= 0) return "买侧已全部成交/锁定，无法锁定·卖";
  if (swap.allow_single_side === false) return "该换盘不允许单边锁定";
  const mode = swap.single_side_mode ?? "both";
  if (mode === "none" || mode === "single_buy") return "该换盘不允许锁定·卖";
  return null;
}

/** 双向摘盘不可用原因；null 表示可用 */
export function swapBothDisabledReason(sellRemain: number, buyRemain: number): string | null {
  if (sellRemain <= 0 || buyRemain <= 0) return "一侧已出完，无法双向摘盘";
  return null;
}

/** 闪拼不可用原因；null 表示可用 */
export function swapFlashDisabledReason(lockState: SwapLockState): string | null {
  if (!lockState.canFlashMatch || !lockState.flashMode) {
    return "当前无可闪拼的单边锁定";
  }
  return null;
}

/** 商谈·买入（针对换盘卖腿）不可用原因 */
export function swapCounterOfferBuyDisabledReason(
  swap: SwapListing,
  sellRemain: number,
): string | null {
  if (sellRemain <= 0) return "卖侧已全部成交/锁定，无法商谈·买入";
  if ((swap.sell_allow_counter_offer ?? swap.allow_counter_offer) === false) {
    return "卖出方不可商谈";
  }
  return null;
}

/** 商谈·卖出（针对换盘买腿）不可用原因 */
export function swapCounterOfferSellDisabledReason(
  swap: SwapListing,
  buyRemain: number,
): string | null {
  if (buyRemain <= 0) return "买侧已全部成交/锁定，无法商谈·卖出";
  if ((swap.buy_allow_counter_offer ?? swap.allow_counter_offer) === false) {
    return "买入方不可商谈";
  }
  return null;
}

/** 商谈·双向不可用原因 */
export function swapCounterOfferBothDisabledReason(
  swap: SwapListing,
  sellRemain: number,
  buyRemain: number,
): string | null {
  if (sellRemain <= 0 || buyRemain <= 0) return "一侧已出完，无法商谈·双向";
  const sellCO = (swap.sell_allow_counter_offer ?? swap.allow_counter_offer) !== false;
  const buyCO = (swap.buy_allow_counter_offer ?? swap.allow_counter_offer) !== false;
  if (!sellCO && !buyCO) return "双方均不可商谈";
  return null;
}

export function swapStatusLabel(
  status: string,
  lockState: SwapLockState,
  negotiating: boolean,
  sellFilled = 0,
  buyFilled = 0,
): string {
  if (negotiating) return "商谈中";
  if (status === "MATCHED") return "已成交";
  if (status === "CANCELLED") return "已撤盘";
  if (status === "EXPIRED") {
    return sellFilled > 0 || buyFilled > 0 ? "已过期（部分成交）" : "已过期";
  }
  if (status === "SCHEDULED") return "待发布";
  if (lockState.anySingleSideLock) return "部分单边锁定";
  return "挂盘中";
}

export function swapStatusTooltip(
  status: string,
  lockState: SwapLockState,
  negotiating: boolean,
  sellFilled = 0,
  buyFilled = 0,
): string {
  if (negotiating) return "当前有进行中的商谈";
  if (status === "MATCHED") return "换盘已双向成交完成";
  if (status === "EXPIRED") {
    return sellFilled > 0 || buyFilled > 0
      ? "换盘已到截止时间，存在部分成交"
      : "换盘已到截止时间未成交";
  }
  if (status === "SCHEDULED") return "已预约，到开始时间后自动发布";
  if (lockState.anySingleSideLock)
    return "存在单边锁定，可继续锁定、闪拼、双向摘盘或等待自动撮合";
  return "换盘挂盘中，等待对手方操作";
}

export interface MatchQuantityBounds {
  remain: number;
  minQty: number;
  max: number;
  allowPartial: boolean;
  min: number;
  /** 剩余量不足再拆出最小单量时，须全部锁定，数量不可改 */
  mustTakeAll: boolean;
}

/** 剩余量不足以再保留一个最小单量（或不可拆单）时，只能全部锁定 */
export function mustTakeAllRemain(remain: number, minQty: number, allowPartial: boolean): boolean {
  if (!allowPartial) return true;
  const effectiveMin = minQty > 0 ? minQty : 1;
  if (remain <= 0) return true;
  // 尾量不足最小单量，或任意合法拆单都会留下不足最小单量的尾数
  return remain < effectiveMin * 2;
}

/** 摘盘/锁定/商谈是否可用「选份数」：可拆、每份>0、余量为每份整数倍且至少 1 份 */
export function getSharePickState(
  remainRaw: number,
  minQtyRaw: number,
  allowPartial: boolean,
): { canPickShares: boolean; perShare: number; maxShares: number } {
  const remain = Math.floor(Math.max(0, remainRaw));
  const perShare = allowPartial && minQtyRaw > 0 ? Math.floor(minQtyRaw) : 0;
  if (!allowPartial || perShare <= 0 || remain <= 0) {
    return { canPickShares: false, perShare: 0, maxShares: 0 };
  }
  if (remain % perShare !== 0) {
    return { canPickShares: false, perShare, maxShares: 0 };
  }
  const maxShares = remain / perShare;
  if (maxShares < 1) {
    return { canPickShares: false, perShare, maxShares: 0 };
  }
  return { canPickShares: true, perShare, maxShares };
}

/** 从已有数量还原份数字符串（编辑商谈回填） */
export function shareCountFromQty(qty: number, perShare: number, maxShares: number): string {
  const q = Math.floor(qty);
  if (!(perShare > 0) || !(maxShares > 0) || !(q > 0)) return String(maxShares || "");
  if (q % perShare === 0) {
    return String(Math.min(maxShares, Math.max(1, q / perShare)));
  }
  return String(maxShares);
}

function legMatchBounds(
  remainRaw: number,
  allowPartial: boolean,
  configuredMin: number | null | undefined
): MatchQuantityBounds {
  const remain = Math.floor(Math.max(0, remainRaw));
  const minQty =
    allowPartial && configuredMin && configuredMin > 0
      ? Math.floor(configuredMin)
      : remain;
  const takeAll = mustTakeAllRemain(remain, minQty, allowPartial);
  return {
    remain,
    minQty,
    max: remain,
    allowPartial,
    // 须全锁时：min=max=剩余量（即便小于最小单量也允尾量全锁）
    min: takeAll ? remain : minQty,
    mustTakeAll: takeAll,
  };
}

export function getMatchQuantityBounds(
  swap: SwapListing,
  mode: "sell" | "buy" | "both"
): MatchQuantityBounds | DualMatchQuantityBounds | null {
  if (mode === "sell") {
    return legMatchBounds(
      swap.sell_quantity - (swap.sell_filled ?? 0),
      swap.sell_allow_partial !== false,
      swap.sell_min_quantity
    );
  }
  if (mode === "buy") {
    return legMatchBounds(
      swap.buy_quantity - (swap.buy_filled ?? 0),
      swap.buy_allow_partial !== false,
      swap.buy_min_quantity
    );
  }
  const sellRemain = Math.max(0, swap.sell_quantity - (swap.sell_filled ?? 0));
  const buyRemain = Math.max(0, swap.buy_quantity - (swap.buy_filled ?? 0));
  const allowPartial =
    swap.sell_allow_partial !== false && swap.buy_allow_partial !== false;
  const sellBounds = getMatchQuantityBounds(swap, "sell")!;
  const buyBounds = getMatchQuantityBounds(swap, "buy")!;
  const remain = Math.floor(Math.min(sellRemain, buyRemain));
  const minQty = Math.max(sellBounds.minQty, buyBounds.minQty);
  const takeAll = mustTakeAllRemain(remain, minQty, allowPartial);
  return {
    remain,
    minQty,
    max: remain,
    allowPartial,
    min: takeAll ? remain : Math.max(sellBounds.min, buyBounds.min),
    mustTakeAll: takeAll || sellBounds.mustTakeAll || buyBounds.mustTakeAll,
    sellRemain: sellBounds.remain,
    buyRemain: buyBounds.remain,
    sellMinQty: sellBounds.minQty,
    buyMinQty: buyBounds.minQty,
    sellMax: sellBounds.max,
    buyMax: buyBounds.max,
    sellAllowPartial: sellBounds.allowPartial,
    buyAllowPartial: buyBounds.allowPartial,
  };
}

export interface DualMatchQuantityBounds extends MatchQuantityBounds {
  sellRemain: number;
  buyRemain: number;
  sellMinQty: number;
  buyMinQty: number;
  sellMax: number;
  buyMax: number;
  sellAllowPartial: boolean;
  buyAllowPartial: boolean;
}

/** 闪拼数量上限：剩余量、所选锁定量、最小单量规则 */
export function getFlashQuantityBounds(
  swap: SwapListing,
  mode: "sell" | "buy",
  lockQty: number
): MatchQuantityBounds | null {
  const base = getMatchQuantityBounds(swap, mode);
  if (!base) return null;
  const lockFloor = Math.floor(lockQty);
  const max = Math.min(base.max, lockFloor);
  // 闪拼所选锁定量本身若不足再拆，也须全部闪拼
  const takeAll =
    base.mustTakeAll ||
    mustTakeAllRemain(max, base.minQty, base.allowPartial) ||
    mustTakeAllRemain(lockFloor, base.minQty, true);
  return {
    ...base,
    remain: base.remain,
    max,
    min: takeAll ? max : Math.min(base.min, max),
    mustTakeAll: takeAll,
  };
}

export function validateMatchQuantity(
  qty: number,
  remain: number,
  minQty: number,
  allowPartial: boolean,
  max: number,
  label: string
): string | null {
  if (!Number.isFinite(qty) || qty <= 0) {
    return `${label}数量须大于 0`;
  }
  if (qty > max) {
    return `${label}数量不能超过 ${max}`;
  }
  if (qty > remain) {
    return `${label}数量不能超过剩余量 ${remain}`;
  }
  if (!allowPartial && qty < remain) {
    return `${label}不可拆单，须全量操作`;
  }
  const effectiveMin = minQty > 0 ? minQty : 1;
  // 尾量 / 拆单后必留不足最小单量：只能全部锁定
  if (mustTakeAllRemain(remain, effectiveMin, allowPartial)) {
    if (qty !== remain) {
      return `${label}剩余量 ${remain} 不足再保留最小单量 ${effectiveMin}，须全部锁定 ${remain}`;
    }
    return null;
  }
  if (qty < effectiveMin) {
    return `${label}数量不能小于最小单量 ${effectiveMin}`;
  }
  // 按份数：部分操作时须为每份整数倍；全部锁定剩余量时放行
  if (allowPartial && minQty > 0 && qty !== remain && qty % effectiveMin !== 0) {
    return `${label}数量须为每份 ${effectiveMin} 的整数倍`;
  }
  const afterRemain = remain - qty;
  if (afterRemain > 0 && afterRemain < effectiveMin) {
    return `${label}后剩余量须为 0 或 ≥ 最小单量 ${effectiveMin}（当前仅能全部锁定 ${remain}）`;
  }
  return null;
}

/** 双向摘盘：分别校验卖出/买入数量，并校验成交后剩余量 */
export function validateDualMatchQuantity(
  sellQty: number,
  buyQty: number,
  bounds: DualMatchQuantityBounds,
  label: string
): string | null {
  const sellErr = validateMatchQuantity(
    sellQty,
    bounds.sellRemain,
    bounds.sellMinQty,
    bounds.sellAllowPartial,
    bounds.sellMax,
    `${label}（卖出）`
  );
  if (sellErr) return sellErr;
  const buyErr = validateMatchQuantity(
    buyQty,
    bounds.buyRemain,
    bounds.buyMinQty,
    bounds.buyAllowPartial,
    bounds.buyMax,
    `${label}（买入）`
  );
  if (buyErr) return buyErr;
  const paired = Math.min(sellQty, buyQty);
  if (paired <= 0) return `${label}成交数量须大于 0`;
  return null;
}

/** 单边锁定方向展示：match_side=sell → 锁定·买；buy → 锁定·卖 */
export function swapLockSideDisplay(matchSide: "sell" | "buy" | string): string {
  return matchSide === "buy" ? "锁定·卖" : "锁定·买";
}

/**
 * 解锁二次确认文案：汇总序号、方向、数量，提醒用户确认。
 */
export function buildUnlockConfirmMessage(
  locks: Array<{ match_side: "sell" | "buy" | string; matched_qty: number }>,
  opts?: { serialLabel?: string; unit?: string },
): { title: string; message: string } {
  const unit = opts?.unit ?? "吨";
  const serial = opts?.serialLabel?.trim() || "";
  const lines: string[] = [];
  if (serial) lines.push(`换盘序号：${serial}`);

  const bySide = new Map<string, number>();
  for (const lock of locks) {
    const side = swapLockSideDisplay(lock.match_side);
    bySide.set(side, (bySide.get(side) ?? 0) + Math.floor(lock.matched_qty || 0));
  }
  for (const [side, qty] of bySide) {
    lines.push(`${side}：${qty.toLocaleString()} ${unit}`);
  }
  const total = locks.reduce((s, l) => s + Math.floor(l.matched_qty || 0), 0);
  if (bySide.size > 1) {
    lines.push(`合计解锁：${total.toLocaleString()} ${unit}`);
  }

  lines.push("");
  lines.push("解锁后，对应数量将释放回换盘剩余量，第三方可再次锁定/闪拼。此操作不可撤销。");

  return {
    title: "确认解锁",
    message: `即将取消以下单边锁定：\n\n${lines.join("\n")}`,
  };
}
