"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useNotificationStore } from "@/lib/notification-store";
import type { AppNotification } from "@/lib/notification-store";

// ---------- 通知图标 ----------

function NotificationIcon({ type }: { type: AppNotification["type"] }) {
  const config: Record<string, { color: string; bg: string; svg: string }> = {
    counter_offer_received: {
      color: "text-amber-400",
      bg: "bg-amber-500/10",
      svg: "M2.25 6h14.25M2.25 12h14.25M2.25 18h14.25",
    },
    counter_offer_accepted: {
      color: "text-green-400",
      bg: "bg-green-500/10",
      svg: "M4.5 12.75l6 6 9-13.5",
    },
    counter_offer_rejected: {
      color: "text-red-400",
      bg: "bg-red-500/10",
      svg: "M6 18L18 6M6 6l12 12",
    },
    counter_offer_cancelled: {
      color: "text-gray-400",
      bg: "bg-gray-500/10",
      svg: "M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    },
    counter_offer_partial_accepted: {
      color: "text-amber-400",
      bg: "bg-amber-500/10",
      svg: "M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    },
    counter_offer_confirm_rejected: {
      color: "text-red-400",
      bg: "bg-red-500/10",
      svg: "M6 18L18 6M6 6l12 12",
    },
    listing_taken: {
      color: "text-blue-400",
      bg: "bg-blue-500/10",
      svg: "M2.25 18.75a60.07 60.07 0 0115.797 0M3 13.5h15m-1.5 0a8.977 8.977 0 01-4.5 7.5m-6-3a8.977 8.977 0 01-4.5-7.5m4.5 7.5V9m4.5 6.75V5.25M6 18h12",
    },
    trade_completed: {
      color: "text-green-400",
      bg: "bg-green-500/10",
      svg: "M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    },
    swap_side_filled: {
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      svg: "M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5",
    },
    listing_expire_soon: {
      color: "text-amber-400",
      bg: "bg-amber-500/10",
      svg: "M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z",
    },
    listing_publish_soon: {
      color: "text-sky-400",
      bg: "bg-sky-500/10",
      svg: "M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z",
    },
  };
  const cfg = config[type] || config.counter_offer_received;
  return (
    <div className={`w-8 h-8 rounded-full ${cfg.bg} flex items-center justify-center flex-shrink-0`}>
      <svg className={`w-4 h-4 ${cfg.color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d={cfg.svg} />
      </svg>
    </div>
  );
}

// ---------- 时间格式化 ----------

function timeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;
  const d = new Date(timestamp);
  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ---------- 通知中心弹窗 ----------

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function NotificationPanel({ open, onClose }: Props) {
  const { notifications, markAllRead, clearAll, removeNotification, markRead } = useNotificationStore();
  const [filter, setFilter] = useState<"all" | "unread">("unread");
  const router = useRouter();

  if (!open) return null;

  const filtered = filter === "unread"
    ? notifications.filter((n) => !n.read)
    : notifications;

  const handleNotificationClick = (n: AppNotification) => {
    // 标记已读
    markRead(n.id);
    onClose();
    // 根据通知类型跳转到对应 Tab
    const counterOfferTypes = ["counter_offer_received", "counter_offer_accepted", "counter_offer_rejected", "counter_offer_cancelled", "counter_offer_partial_accepted", "counter_offer_confirm_rejected"];
    if (counterOfferTypes.includes(n.type)) {
      // 议价通知 → 跳转到议价管理独立页面
      router.push("/counter-offers");
    } else if (n.type === "trade_completed" || n.type === "swap_side_filled") {
      // 成交通知 → 跳转到成交记录 Tab
      router.push("/my?tab=trades");
    } else if (n.type === "listing_taken" || n.type === "listing_expire_soon" || n.type === "listing_publish_soon" || n.type === "swap_lock_received" || n.type === "swap_lock_cancelled") {
      // 挂牌/换盘相关 → 我的挂牌
      router.push("/my?tab=listings");
    }
  };

  return (
    <div className="fixed inset-0 z-[9997] flex items-start justify-end pt-12 pr-2 sm:pr-4">
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />

      {/* 面板 */}
      <div className="relative bg-t-panel border border-t-border rounded-xl shadow-2xl w-full max-w-sm mt-1 flex flex-col max-h-[70vh] animate-panel-in">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-t-border">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-t-text">消息通知</h3>
            {notifications.some((n) => !n.read) && (
              <span className="px-1.5 py-0.5 bg-red-500 text-white text-[10px] rounded-full font-medium">
                {notifications.filter((n) => !n.read).length}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-t-text-3 hover:text-t-text text-lg leading-none p-1"
          >
            ✕
          </button>
        </div>

        {/* 筛选 */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-t-border">
          <button
            onClick={() => setFilter("unread")}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              filter === "unread"
                ? "bg-brand-600 text-white"
                : "bg-t-hover text-t-text-2 hover:bg-t-border"
            }`}
          >
            未读
          </button>
          <button
            onClick={() => setFilter("all")}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              filter === "all"
                ? "bg-brand-600 text-white"
                : "bg-t-hover text-t-text-2 hover:bg-t-border"
            }`}
          >
            全部
          </button>
          <div className="flex-1" />
          {notifications.length > 0 && (
            <>
              <button
                onClick={markAllRead}
                className="text-xs text-t-text-3 hover:text-t-text transition-colors"
              >
                全部已读
              </button>
              <button
                onClick={clearAll}
                className="text-xs text-t-text-3 hover:text-red-500 transition-colors"
              >
                清空
              </button>
            </>
          )}
        </div>

        {/* 列表 */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-t-text-3">
              <svg className="w-12 h-12 mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.097 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
              </svg>
              <span className="text-sm">
                {filter === "unread" ? "没有未读消息" : "暂无消息"}
              </span>
            </div>
          ) : (
            <div className="divide-y divide-t-border">
              {filtered.map((n) => (
                <div
                  key={n.id}
                  onClick={() => handleNotificationClick(n)}
                  className={`flex items-start gap-3 px-4 py-3 hover:bg-t-hover/50 transition-colors group cursor-pointer ${
                    !n.read ? "bg-brand-600/5" : ""
                  }`}
                >
                  <NotificationIcon type={n.type} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-t-text truncate">{n.title}</span>
                      <span className="text-[10px] text-t-text-3 flex-shrink-0">{timeAgo(n.createdAt)}</span>
                    </div>
                    <p className="text-xs text-t-text-2 mt-0.5 leading-relaxed">{n.body}</p>
                  </div>
                  {!n.read && (
                    <div className="w-2 h-2 rounded-full bg-brand-500 flex-shrink-0 mt-1.5" />
                  )}
                  {/* 删除按钮 */}
                  <button
                    onClick={() => removeNotification(n.id)}
                    className="opacity-0 group-hover:opacity-100 text-t-text-3 hover:text-red-500 transition-all text-xs p-0.5"
                    title="删除"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes panel-in {
          from { opacity: 0; transform: translateY(-8px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .animate-panel-in { animation: panel-in 0.18s ease-out; }
      `}</style>
    </div>
  );
}
