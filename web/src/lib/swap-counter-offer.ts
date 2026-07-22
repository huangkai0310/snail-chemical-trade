import type { CounterOffer } from "./types";

/** 某换盘是否存在进行中的商谈（当前用户相关：发出或收到） */
export function getSwapPendingCOs(
  swapId: string,
  pending: CounterOffer[] | undefined
): CounterOffer[] {
  return (pending ?? []).filter((co) => co.ref_type === "swap" && co.ref_id === swapId);
}

export function isSwapInNegotiation(swapId: string, pending: CounterOffer[] | undefined): boolean {
  return getSwapPendingCOs(swapId, pending).length > 0;
}

/** 查找同一批次双向商谈的配对记录 */
export function findPairedSwapCounterOffer(
  co: CounterOffer,
  pending: CounterOffer[] | undefined
): CounterOffer | undefined {
  const list = pending ?? [];
  if (co.ref_type !== "swap") return undefined;

  if (co.negotiation_group_id) {
    const byGroup = list.find(
      (p) =>
        p.id !== co.id &&
        p.ref_type === "swap" &&
        p.ref_id === co.ref_id &&
        p.negotiation_group_id === co.negotiation_group_id
    );
    if (byGroup) return byGroup;
  }

  const otherMode = co.mode === "sell" ? "buy" : co.mode === "buy" ? "sell" : null;
  if (!otherMode) return undefined;

  const coTime = new Date(co.created_at).getTime();
  return list.find(
    (p) =>
      p.id !== co.id &&
      p.ref_type === "swap" &&
      p.ref_id === co.ref_id &&
      p.mode === otherMode &&
      p.offer_user_id === co.offer_user_id &&
      Math.abs(new Date(p.created_at).getTime() - coTime) < 120_000
  );
}

/** 是否为双向换盘商谈组（卖+买两条） */
export function isDualSwapCounterOfferGroup(
  co: CounterOffer,
  pending: CounterOffer[] | undefined
): boolean {
  return !!findPairedSwapCounterOffer(co, pending);
}

/** 获取同组全部商谈 */
export function getSwapCounterOfferGroup(
  co: CounterOffer,
  all: CounterOffer[]
): CounterOffer[] {
  if (co.ref_type !== "swap") return [co];
  if (co.negotiation_group_id) {
    const grouped = all.filter(
      (p) =>
        p.ref_type === "swap" &&
        p.ref_id === co.ref_id &&
        p.negotiation_group_id === co.negotiation_group_id
    );
    if (grouped.length > 0) return grouped;
  }
  const paired = findPairedSwapCounterOffer(co, all);
  if (paired) return [co, paired];
  return [co];
}

export type CounterOfferDisplayRow =
  | { kind: "single"; co: CounterOffer }
  | { kind: "dual"; sellCo: CounterOffer; buyCo: CounterOffer; groupKey: string };

/** 将列表中的双向商谈合并为一行展示 */
export function groupCounterOfferRows(cos: CounterOffer[]): CounterOfferDisplayRow[] {
  const used = new Set<string>();
  const rows: CounterOfferDisplayRow[] = [];

  for (const co of cos) {
    if (used.has(co.id)) continue;

    if (co.ref_type === "swap" && (co.mode === "sell" || co.mode === "buy")) {
      const paired = findPairedSwapCounterOffer(
        co,
        cos.filter((c) => c.ref_type === "swap" && c.ref_id === co.ref_id)
      );
      if (paired && !used.has(paired.id)) {
        used.add(co.id);
        used.add(paired.id);
        const sellCo = co.mode === "sell" ? co : paired;
        const buyCo = co.mode === "buy" ? co : paired;
        rows.push({
          kind: "dual",
          sellCo,
          buyCo,
          groupKey: co.negotiation_group_id ?? `${co.ref_id}-${co.offer_user_id}-${co.created_at}`,
        });
        continue;
      }
    }

    used.add(co.id);
    rows.push({ kind: "single", co });
  }

  return rows;
}

/** 可选条款：仅当与原价不同时才提交 offer 字段 */
export function optionalOfferField(
  allowed: boolean,
  offered: string,
  original: string
): string | undefined {
  if (!allowed) return undefined;
  const o = offered.trim();
  const r = original.trim();
  if (!o || o === r) return undefined;
  return o;
}

export function optionalOfferFreeStorage(
  allowed: boolean,
  enabled: boolean,
  days: string,
  origEnabled: boolean,
  origDays: string
): { enabled?: boolean; days?: number | null } {
  if (!allowed) return {};
  const d = days.trim() ? Number(days) : null;
  const origD = origDays.trim() ? Number(origDays) : null;
  if (enabled === origEnabled && d === origD) return {};
  if (!enabled) return { enabled: false, days: null };
  return { enabled: true, days: d };
}
