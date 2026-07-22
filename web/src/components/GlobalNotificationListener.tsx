"use client";

import { useEffect } from "react";
import { useTradeWS } from "@/lib/use-trade-ws";
import { useNotificationStore } from "@/lib/notification-store";
import { useAuthStore } from "@/lib/auth-store";
import { fetchProducts } from "@/lib/api";
import { toast } from "@/components/Toast";
import { playNotificationSound, unlockAudio } from "@/lib/sound-prefs";
import { shouldSuppressSwapTradeToast } from "@/lib/listing-toast-suppress";
import type { WSTrade } from "@/lib/types";

// 缓存产品名称映射，避免每次成交都请求
let productNameCache: Record<string, string> = {};
let productCacheLoaded = false;

async function getProductName(productId: string): Promise<string> {
  if (productNameCache[productId]) return productNameCache[productId];
  if (!productCacheLoaded) {
    try {
      const products = await fetchProducts();
      productCacheLoaded = true;
      for (const p of products) {
        productNameCache[p.id] = p.name;
      }
      return productNameCache[productId] || "未知产品";
    } catch {
      productCacheLoaded = true;
      return "未知产品";
    }
  }
  return productNameCache[productId] || "未知产品";
}

function notifyTone() {
  unlockAudio();
  playNotificationSound();
}

/**
 * 全局通知监听器
 * 在所有页面都运行，通过 WebSocket 接收议价/成交消息，
 * 自动写入通知 store 并弹出 Toast 提示；按用户偏好播放统一铃声。
 */
export default function GlobalNotificationListener() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const switchUser = useNotificationStore((s) => s.switchUser);
  const fromCounterOffer = useNotificationStore((s) => s.fromCounterOffer);
  const fromTrade = useNotificationStore((s) => s.fromTrade);
  const fromSwapLock = useNotificationStore((s) => s.fromSwapLock);
  const fromScheduleReminder = useNotificationStore((s) => s.fromScheduleReminder);

  useEffect(() => {
    switchUser(userId);
  }, [userId, switchUser]);

  useTradeWS({
    onCounterOfferReceived: (data) => {
      fromCounterOffer(data, "received");
      notifyTone();
      toast("收到新商谈，请查看", "info");
    },
    onCounterOfferAccepted: (data) => {
      fromCounterOffer(data, "accepted");
      notifyTone();
      toast("您的商谈已被接受，成交完成", "success");
    },
    onCounterOfferRejected: (data) => {
      fromCounterOffer(data, "rejected");
      notifyTone();
      toast("商谈被拒绝", "info");
    },
    onCounterOfferCancelled: (data) => {
      fromCounterOffer(data, "cancelled");
      notifyTone();
      toast("商谈已被对方撤销", "info");
    },
    onCounterOfferUpdated: (data) => {
      fromCounterOffer(data, "updated");
      notifyTone();
      toast("对方修改了商谈条款，请查看", "info");
    },
    onCounterOfferPartialAccepted: (data) => {
      fromCounterOffer(data, "partial_accepted");
      notifyTone();
      toast("对方部分接受了您的商谈，请确认是否成交", "info");
    },
    onCounterOfferConfirmRejected: (data) => {
      fromCounterOffer(data, "confirm_rejected");
      notifyTone();
      toast("对方拒绝了您提出的部分接受", "info");
    },
    onTrade: async (trade: WSTrade) => {
      const productName = await getProductName(trade.product_id);
      const uid = useAuthStore.getState().user?.id;
      const isParty =
        !!uid &&
        (trade.buy_user_id === uid || trade.sell_user_id === uid);

      if (!isParty) return;

      const isAggressor =
        !!trade.aggressor_user_id && trade.aggressor_user_id === uid;
      const isSwap = trade.source === "swap" || trade.source === "swap_private";
      // 第一人称：若我是普通挂牌方，即使 source=swap 也按「发盘被接了」提示
      const isListingParty =
        !!trade.listing_user_id && trade.listing_user_id === uid;
      const perspective: "listing" | "swap" =
        isListingParty ? "listing" : isSwap ? "swap" : "listing";

      // 仅「主动摘盘 / 议价成交」主动方已有 HTTP toast，跳过 WS；
      // auto 自动撮合双方都要收第一人称通知（含发盘撞单的主动方）
      if (
        isAggressor &&
        (trade.source === "take" || trade.source === "counter_offer")
      ) {
        return;
      }

      // 主动参与换盘：HTTP 已 toast「换盘成功」，跳过 WS 重复提示（仅抑制主动方本机）
      if (perspective === "swap" && isAggressor && shouldSuppressSwapTradeToast()) {
        return;
      }
      if (perspective === "swap" && !trade.aggressor_user_id && shouldSuppressSwapTradeToast()) {
        return;
      }

      const role = trade.buy_user_id === uid ? "buyer" : "seller";
      const refId =
        role === "buyer" ? trade.buy_order_id : trade.sell_order_id;
      fromTrade(productName, trade.price, trade.quantity, role, refId, trade.source, perspective);
      notifyTone();
      if (perspective === "swap") {
        if (trade.source === "swap_private") {
          toast(`换盘成功：${productName} ¥${trade.price}/吨 × ${trade.quantity}`, "success");
        } else {
          toast(`单边成交：${productName} ¥${trade.price}/吨 × ${trade.quantity}`, "success");
        }
      } else {
        toast(
          `${role === "seller" ? "您的卖盘被接了" : "您的买盘成交了"}：${productName} ¥${trade.price}/吨 × ${trade.quantity}`,
          "success",
        );
      }
    },
    onSwapLockReceived: (data) => {
      fromSwapLock(data, "received");
      notifyTone();
      toast("您的换盘被单边锁定，请查看", "info");
    },
    onSwapLockCancelled: (data) => {
      fromSwapLock(data, "cancelled");
      notifyTone();
      toast("换盘单边锁定已取消", "info");
    },
    onListingExpireSoon: (data) => {
      fromScheduleReminder(data, "expire");
      notifyTone();
      const mins = data.minutes_left != null && data.minutes_left > 0 ? data.minutes_left : 5;
      toast(`${data.ref_type === "swap" ? "换盘" : "发盘"}约 ${mins} 分钟后到期`, "info");
    },
    onListingPublishSoon: (data) => {
      fromScheduleReminder(data, "publish");
      notifyTone();
      const mins = data.minutes_left != null && data.minutes_left > 0 ? data.minutes_left : 5;
      toast(`${data.ref_type === "swap" ? "换盘" : "发盘"}约 ${mins} 分钟后发布`, "info");
    },
  });

  return null;
}
