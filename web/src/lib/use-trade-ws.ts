"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import type { WSTrade } from "./types";
import { useAuthStore } from "./auth-store";

const WS_BASE =
  typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`
    : (process.env.NEXT_PUBLIC_WS_URL ?? "wss://api.snailchemical.com/ws");

/** WebSocket 通用消息格式 */
export interface WSMessage {
  type: string;
  payload: unknown;
}

/** 议价通知回调参数 */
export interface CounterOfferNotification {
  id: string;
  ref_type?: string;
  ref_id: string;
  offer_user_id?: string;
  offer_price?: number;
  offer_quantity?: number;
  rejected_reason?: string;
  accepted_terms?: string[]; // 部分接受时，挂牌方接受的条款键
}

/** 换盘单边锁定通知 */
export interface SwapLockNotification {
  swap_id: string;
  serial_no?: number;
  created_at?: string;
  match_id?: string;
  match_side?: "sell" | "buy";
  matched_qty?: number;
  side_label?: string;
}

/** 到期/开盘前约 5 分钟提醒 */
export interface ScheduleReminderNotification {
  ref_type: "listing" | "swap";
  ref_id: string;
  serial_no?: number;
  product_id?: string;
  side?: string;
  expires_at?: string;
  starts_at?: string;
  minutes_left?: number;
}

export interface UseTradeWSCallbacks {
  onTrade?: (trade: WSTrade) => void;
  onNewListing?: (data: { product_id: string }) => void;
  onCounterOfferReceived?: (data: CounterOfferNotification) => void;
  onCounterOfferAccepted?: (data: CounterOfferNotification) => void;
  onCounterOfferRejected?: (data: CounterOfferNotification) => void;
  onCounterOfferCancelled?: (data: CounterOfferNotification) => void;
  onCounterOfferPartialAccepted?: (data: CounterOfferNotification) => void;
  onCounterOfferConfirmRejected?: (data: CounterOfferNotification) => void;
  onCounterOfferUpdated?: (data: CounterOfferNotification) => void;
  onSwapLockReceived?: (data: SwapLockNotification) => void;
  onSwapLockCancelled?: (data: SwapLockNotification) => void;
  onListingExpireSoon?: (data: ScheduleReminderNotification) => void;
  onListingPublishSoon?: (data: ScheduleReminderNotification) => void;
}

// ---------- 全局单例 WS：避免多组件重复连接 ----------

type Subscriber = { id: number; ref: MutableRefObject<UseTradeWSCallbacks> };
let nextSubId = 1;
const subscribers = new Map<number, Subscriber>();

let ws: WebSocket | null = null;
let wsToken: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let closed = false;

function dispatchMessage(msg: WSMessage) {
  subscribers.forEach(({ ref }) => {
    const cb = ref.current;
    switch (msg.type) {
      case "trade":
        cb.onTrade?.(msg.payload as WSTrade);
        break;
      case "new_listing":
        cb.onNewListing?.(msg.payload as { product_id: string });
        break;
      case "counter_offer_received":
        cb.onCounterOfferReceived?.(msg.payload as CounterOfferNotification);
        break;
      case "counter_offer_accepted":
        cb.onCounterOfferAccepted?.(msg.payload as CounterOfferNotification);
        break;
      case "counter_offer_rejected":
        cb.onCounterOfferRejected?.(msg.payload as CounterOfferNotification);
        break;
      case "counter_offer_cancelled":
        cb.onCounterOfferCancelled?.(msg.payload as CounterOfferNotification);
        break;
      case "counter_offer_partial_accepted":
        cb.onCounterOfferPartialAccepted?.(msg.payload as CounterOfferNotification);
        break;
      case "counter_offer_confirm_rejected":
        cb.onCounterOfferConfirmRejected?.(msg.payload as CounterOfferNotification);
        break;
      case "counter_offer_updated":
        cb.onCounterOfferUpdated?.(msg.payload as CounterOfferNotification);
        break;
      case "swap_lock_received":
        cb.onSwapLockReceived?.(msg.payload as SwapLockNotification);
        break;
      case "swap_lock_cancelled":
        cb.onSwapLockCancelled?.(msg.payload as SwapLockNotification);
        break;
      case "listing_expire_soon":
        cb.onListingExpireSoon?.(msg.payload as ScheduleReminderNotification);
        break;
      case "listing_publish_soon":
        cb.onListingPublishSoon?.(msg.payload as ScheduleReminderNotification);
        break;
    }
  });
}

function teardownWS() {
  closed = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  wsToken = null;
}

function connectWS(token: string) {
  closed = false;
  if (ws && wsToken === token && ws.readyState === WebSocket.OPEN) {
    return;
  }

  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }

  wsToken = token;
  const url = `${WS_BASE}?token=${encodeURIComponent(token)}`;
  const socket = new WebSocket(url);
  ws = socket;

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data) as WSMessage;
      dispatchMessage(msg);
    } catch {
      // ignore malformed messages
    }
  };

  socket.onclose = () => {
    if (closed || wsToken !== token) return;
    reconnectTimer = setTimeout(() => {
      if (!closed && wsToken === token) {
        connectWS(token);
      }
    }, 3000);
  };

  socket.onerror = () => {
    socket.close();
  };
}

function ensureConnection(token: string | null) {
  if (!token) {
    teardownWS();
    return;
  }
  connectWS(token);
}

export function useTradeWS(callbacks: UseTradeWSCallbacks) {
  const callbackRef = useRef(callbacks);
  callbackRef.current = callbacks;

  const token = useAuthStore((s) => s.token);
  const isAuthenticated = !!token;

  useEffect(() => {
    const id = nextSubId++;
    subscribers.set(id, { id, ref: callbackRef });

    if (token) ensureConnection(token);

    return () => {
      subscribers.delete(id);
      if (subscribers.size === 0) {
        teardownWS();
      }
    };
  }, [token]);

  // token 变化时重连（切换账号）
  useEffect(() => {
    if (!isAuthenticated || !token) {
      if (subscribers.size === 0) teardownWS();
      return;
    }
    ensureConnection(token);
  }, [isAuthenticated, token]);
}
