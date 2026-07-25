"use client";

import { create } from "zustand";
import type {
  CounterOfferNotification,
  ScheduleReminderNotification,
  SwapLockNotification,
} from "./use-trade-ws";
import { formatBoardSerial } from "./format";

// ---------- 通知类型 ----------

export type NotificationType =
  | "counter_offer_received"    // 收到议价
  | "counter_offer_accepted"    // 议价被接受
  | "counter_offer_rejected"    // 议价被拒绝
  | "counter_offer_cancelled"   // 议价被撤销
  | "counter_offer_updated"     // 对方修改了商谈条款
  | "counter_offer_partial_accepted" // 对方部分接受了你的议价（等待你确认）
  | "counter_offer_confirm_rejected" // 对方拒绝了你提出的部分接受
  | "listing_taken"            // 发盘被接了
  | "trade_completed"          // 成交完成
  | "swap_side_filled"         // 换盘自动撮合单边成交
  | "swap_lock_received"       // 换盘被单边锁定
  | "swap_lock_cancelled"      // 换盘单边锁定被取消
  | "listing_expire_soon"      // 即将到期
  | "listing_publish_soon"     // 即将发布
  | "contract_cancelled";      // 自选合约已取消

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  refType?: "listing" | "swap";
  refId?: string;
  createdAt: number;     // timestamp
  read: boolean;
}

// ---------- Store ----------

interface NotificationState {
  notifications: AppNotification[];
  unreadCount: number;
  currentUserId: string | null;
  // actions
  switchUser: (userId: string | null) => void;
  addNotification: (n: Omit<AppNotification, "id" | "createdAt" | "read">) => void;
  markAllRead: () => void;
  markRead: (id: string) => void;
  clearAll: () => void;
  removeNotification: (id: string) => void;
  // 从 WebSocket 议价通知生成消息
  fromCounterOffer: (data: CounterOfferNotification, eventType: "received" | "accepted" | "rejected" | "cancelled" | "updated" | "partial_accepted" | "confirm_rejected") => void;
  // 从成交通知生成消息；perspective: listing=发盘方视角, swap=换盘方视角
  fromTrade: (productName: string, price: number, quantity: number, role: "buyer" | "seller", refId?: string, source?: string, perspective?: "listing" | "swap") => void;
  fromSwapLock: (data: SwapLockNotification, eventType: "received" | "cancelled") => void;
  fromScheduleReminder: (data: ScheduleReminderNotification, eventType: "expire" | "publish") => void;
  fromContractCancelled: (productName: string, deliveryPeriod: string, productId: string) => void;
}

function genId(): string {
  return `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildTitle(type: NotificationType): string {
  switch (type) {
    case "counter_offer_received":  return "收到新商谈";
    case "counter_offer_accepted":  return "商谈已被接受";
    case "counter_offer_rejected":  return "商谈被拒绝";
    case "counter_offer_cancelled": return "商谈已撤销";
    case "counter_offer_updated":   return "商谈已更新";
    case "counter_offer_partial_accepted": return "对方部分接受商谈";
    case "counter_offer_confirm_rejected": return "对方拒绝部分接受";
    case "listing_taken":           return "发盘被接了";
    case "trade_completed":         return "成交完成";
    case "swap_side_filled":        return "单边成交";
    case "swap_lock_received":      return "换盘被锁定";
    case "swap_lock_cancelled":     return "换盘锁定已取消";
    case "listing_expire_soon":     return "即将到期";
    case "listing_publish_soon":    return "即将发布";
    case "contract_cancelled":      return "合约已取消";
  }
}

function formatHm(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STORAGE_KEY_PREFIX = "snailchem_notifications";
const MAX_NOTIFICATIONS = 100;

function storageKey(userId: string | null): string {
  return userId ? `${STORAGE_KEY_PREFIX}_${userId}` : `${STORAGE_KEY_PREFIX}_anonymous`;
}

function loadNotifications(userId: string | null): AppNotification[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const arr = JSON.parse(raw) as AppNotification[];
    return arr.slice(0, MAX_NOTIFICATIONS);
  } catch {
    return [];
  }
}

function saveNotifications(userId: string | null, items: AppNotification[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(items.slice(0, MAX_NOTIFICATIONS)));
  } catch {}
}

export const useNotificationStore = create<NotificationState>((set, get) => {
  return {
    notifications: [],
    unreadCount: 0,
    currentUserId: null,

    switchUser: (userId) => {
      const items = loadNotifications(userId);
      set({
        currentUserId: userId,
        notifications: items,
        unreadCount: items.filter((n) => !n.read).length,
      });
    },

    addNotification: (n) => {
      const userId = get().currentUserId;
      const notification: AppNotification = {
        ...n,
        id: genId(),
        createdAt: Date.now(),
        read: false,
      };
      set((state) => {
        const updated = [notification, ...state.notifications].slice(0, MAX_NOTIFICATIONS);
        saveNotifications(userId, updated);
        return {
          notifications: updated,
          unreadCount: updated.filter((x) => !x.read).length,
        };
      });
    },

    markAllRead: () => {
      const userId = get().currentUserId;
      set((state) => {
        const updated = state.notifications.map((n) => ({ ...n, read: true }));
        saveNotifications(userId, updated);
        return { notifications: updated, unreadCount: 0 };
      });
    },

    markRead: (id) => {
      const userId = get().currentUserId;
      set((state) => {
        const updated = state.notifications.map((n) =>
          n.id === id ? { ...n, read: true } : n
        );
        saveNotifications(userId, updated);
        return {
          notifications: updated,
          unreadCount: updated.filter((x) => !x.read).length,
        };
      });
    },

    clearAll: () => {
      const userId = get().currentUserId;
      saveNotifications(userId, []);
      set({ notifications: [], unreadCount: 0 });
    },

    removeNotification: (id) => {
      const userId = get().currentUserId;
      set((state) => {
        const updated = state.notifications.filter((n) => n.id !== id);
        saveNotifications(userId, updated);
        return {
          notifications: updated,
          unreadCount: updated.filter((x) => !x.read).length,
        };
      });
    },

    fromCounterOffer: (data, eventType) => {
      const typeMap: Record<string, NotificationType> = {
        received: "counter_offer_received",
        accepted: "counter_offer_accepted",
        rejected: "counter_offer_rejected",
        cancelled: "counter_offer_cancelled",
        updated: "counter_offer_updated",
        partial_accepted: "counter_offer_partial_accepted",
        confirm_rejected: "counter_offer_confirm_rejected",
      };
      const type = typeMap[eventType];
      const title = buildTitle(type);

      let body = "";
      if (eventType === "received") {
        body = `对方提出商谈：¥${data.offer_price ?? "-"}/吨，数量 ${data.offer_quantity ?? "-"}`;
      } else if (eventType === "accepted") {
        body = `您的商谈已被接受，成交完成`;
      } else if (eventType === "rejected") {
        body = `对方拒绝了您的商谈${data.rejected_reason ? `：${data.rejected_reason}` : ""}`;
      } else if (eventType === "cancelled") {
        body = `对方撤销了商谈`;
      } else if (eventType === "updated") {
        body = `对方修改了商谈条款：¥${data.offer_price ?? "-"}/吨，数量 ${data.offer_quantity ?? "-"}`;
      } else if (eventType === "partial_accepted") {
        const terms = Array.isArray(data.accepted_terms) && data.accepted_terms.length > 0
          ? `（已接受 ${data.accepted_terms.length} 项条款）`
          : "";
        body = `对方部分接受了您的商谈${terms}，请确认是否成交`;
      } else if (eventType === "confirm_rejected") {
        body = `对方拒绝了您提出的部分接受`;
      }

      get().addNotification({
        type,
        title,
        body,
        refType: data.ref_type as "listing" | "swap" | undefined,
        refId: data.ref_id,
      });
    },

    fromTrade: (productName, price, quantity, role, refId?, source?, perspective?) => {
      const asListing =
        perspective === "listing" ||
        (perspective !== "swap" && source !== "swap" && source !== "swap_private");

      if (!asListing && source === "swap_private") {
        get().addNotification({
          type: "trade_completed",
          title: "换盘成功",
          body: `换盘成功：${productName} ¥${price}/吨 × ${quantity}`,
          refType: "swap",
          refId: refId,
        });
        return;
      }
      if (!asListing && source === "swap") {
        get().addNotification({
          type: "swap_side_filled",
          title: buildTitle("swap_side_filled"),
          body: `单边成交：${productName} ¥${price}/吨 × ${quantity}`,
          refType: "swap",
          refId: refId,
        });
        return;
      }
      get().addNotification({
        type: "listing_taken",
        title: buildTitle("listing_taken"),
        body: `${role === "seller" ? "您的卖盘" : "您的买盘"}被${role === "seller" ? "接了" : "成交"}：${productName} ¥${price}/吨 × ${quantity}`,
        refType: "listing",
        refId: refId,
      });
    },

    fromSwapLock: (data, eventType) => {
      const type: NotificationType = eventType === "received" ? "swap_lock_received" : "swap_lock_cancelled";
      const serial = data.serial_no
        ? formatBoardSerial("S", data.serial_no, data.created_at)
        : "";
      const side = data.side_label ?? (data.match_side === "buy" ? "买入" : "卖出");
      const qty = data.matched_qty != null ? `${data.matched_qty} 吨` : "";
      const body =
        eventType === "received"
          ? `${serial ? serial + " " : ""}对方已单边锁定${side}侧${qty ? `（${qty}）` : ""}，待拼盘或商谈`
          : `${serial ? serial + " " : ""}对方已取消${side}侧锁定${qty ? `（${qty}）` : ""}`;
      get().addNotification({
        type,
        title: buildTitle(type),
        body,
        refType: "swap",
        refId: data.swap_id,
      });
    },

    fromScheduleReminder: (data, eventType) => {
      const type: NotificationType =
        eventType === "expire" ? "listing_expire_soon" : "listing_publish_soon";
      const isSwap = data.ref_type === "swap";
      const kind = isSwap ? "换盘" : "发盘";
      const serial = data.serial_no
        ? formatBoardSerial(isSwap ? "S" : "L", data.serial_no)
        : "";
      const mins = data.minutes_left != null && data.minutes_left > 0 ? data.minutes_left : 5;
      const hm =
        eventType === "expire" ? formatHm(data.expires_at) : formatHm(data.starts_at);
      const body =
        eventType === "expire"
          ? `${serial ? serial + " " : ""}${kind}约 ${mins} 分钟后到期${hm ? `（${hm}）` : ""}`
          : `${serial ? serial + " " : ""}${kind}约 ${mins} 分钟后发布${hm ? `（${hm}）` : ""}`;
      get().addNotification({
        type,
        title: buildTitle(type),
        body,
        refType: data.ref_type,
        refId: data.ref_id,
      });
    },

    fromContractCancelled: (productName, deliveryPeriod, productId) => {
      const periodLabel = deliveryPeriod?.trim() || "现货";
      get().addNotification({
        type: "contract_cancelled",
        title: buildTitle("contract_cancelled"),
        body: `您自选的合约「${productName} · ${periodLabel}」已取消挂盘，已从自选中移除`,
        refId: productId,
      });
    },
  };
});
