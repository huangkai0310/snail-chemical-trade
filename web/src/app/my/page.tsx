"use client";

import { useState, useMemo, Suspense, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchMyListings,
  fetchMyTrades,
  fetchProducts,
  cancelListing,
  ApiError,
  fetchBlacklist,
  addToBlacklist,
  removeFromBlacklist,
  searchUsers,
  fetchMySwaps,
  cancelSwap,
  updateListing,
  updateSwap,
  type UpdateSwapParams,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import type { Listing, TradeRecord, Product, BlacklistItem, User, SwapListing } from "@/lib/types";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { toast } from "@/components/Toast";
import { confirmDialog } from "@/components/ConfirmDialog";
import {
  ListingBoardConfirmSheet,
  SwapBoardConfirmSheet,
  GenericDetailConfirmSheet,
} from "@/components/PostingConfirmSheet";
import TradeDetailModal, { formatTradeNo } from "@/components/TradeDetailModal";
import BlockUserModal from "@/components/BlockUserModal";
import EditListingModal, { type EditListingFormData } from "@/components/EditListingModal";
import EditSwapModal from "@/components/EditSwapModal";
import { suppressOwnListingToast } from "@/lib/listing-toast-suppress";
import { formatBoardSerial } from "@/lib/format";
import { formatExpiresAt, formatExpiresAtBadge, formatStartsAt, isExpiringSoon } from "@/lib/expires";

import { formatListingStatus } from "@/lib/listing-status";

/** 时间格式化：年月日 时分秒（YYYY-MM-DD HH:MM:SS） */
function formatDateTime(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

function statusLabel(status: string, filled = 0): string {
  if (status === "MATCHED") return "已成交";
  return formatListingStatus(status, filled);
}

function statusColor(status: string): string {
  switch (status) {
    case "OPEN":
    case "PARTIAL":   return "text-status-info bg-status-info-bg";
    case "FILLED":
    case "MATCHED":   return "text-t-text-2 bg-t-hover";
    case "CANCELLED": return "text-status-error bg-status-error-bg";
    case "EXPIRED":   return "text-status-warning bg-status-warning-bg";
    case "SCHEDULED": return "text-sky-700 bg-sky-500/15 dark:text-sky-300";
    default: return "text-t-text-3 bg-t-hover";
  }
}

/** 是否允许撤盘 */
function canCancel(status: string): boolean {
  return status === "OPEN" || status === "PARTIAL" || status === "SCHEDULED";
}

/** 是否允许编辑挂牌 */
function canEditListing(status: string): boolean {
  return status === "OPEN" || status === "PARTIAL" || status === "SCHEDULED";
}

/** 是否允许编辑换盘 */
function canEditSwap(status: string): boolean {
  return status === "OPEN" || status === "SCHEDULED";
}

/** 规格格式化：对象 → "key:value" 拼接；字符串原样；空 → "-" */
function formatSpecs(specs?: string | Record<string, unknown> | null): string {
  if (!specs) return "-";
  if (typeof specs === "string") return specs || "-";
  const entries = Object.entries(specs);
  if (entries.length === 0) return "-";
  return entries.map(([k, v]) => `${k}:${v}`).join(" ");
}

/** 免仓期文本：可免仓显示天数，不免仓显示「不免仓」 */
function freeStorageText(enabled?: boolean | null, days?: number | null): string {
  if (enabled === true) {
    return days && days > 0 ? `${days}天免仓` : "可免仓";
  }
  if (enabled === false) return "不免仓";
  return "-";
}

/** 成交来源标签（从当前用户视角区分主动/被动） */
function tradeSourceLabel(t: TradeRecord, myUserID?: string): { text: string; cls: string } {
  const isAggressor = !!t.aggressor_user_id && t.aggressor_user_id === myUserID;
  switch (t.source) {
    case "take":
      return isAggressor
        ? { text: "我主动摘盘", cls: "bg-t-accent-bg text-t-accent" }
        : { text: "对方主动摘盘", cls: "bg-status-warning-bg text-status-warning" };
    case "counter_offer":
      return { text: "商谈成交", cls: "bg-status-info-bg text-status-info" };
    case "swap":
      // 换盘成交：醒目的实心徽章，突出区分
      return { text: "换盘成交", cls: "bg-brand-600 text-white font-semibold" };
    default:
      return { text: "自动撮合", cls: "bg-t-hover text-t-text-2" };
  }
}

/** 分页条组件 */
function Pager({ page, total, onChange }: { page: number; total: number; onChange: (p: number) => void }) {
  const totalPages = Math.max(1, total);
  const current = Math.min(page, totalPages);
  return (
    <div className="flex items-center justify-between px-4 py-3 bg-t-card border-t border-t-border">
      <span className="text-xs text-t-text-3">
        共 {totalPages} 页，当前第 {current} / {totalPages} 页
      </span>
      <div className="flex gap-2">
        <button
          onClick={() => onChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="px-3 py-1.5 text-xs rounded border border-t-border text-t-text-2 hover:bg-t-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          上一页
        </button>
        <button
          onClick={() => onChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="px-3 py-1.5 text-xs rounded border border-t-border text-t-text-2 hover:bg-t-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          下一页
        </button>
      </div>
    </div>
  );
}

function MyPageContent() {
  const { isAuthenticated, user } = useAuthStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  // 从 URL query 参数读取初始 Tab 状态
  const [tab, setTab] = useState<"listings" | "trades" | "blacklist">(() => {
    const t = searchParams.get("tab");
    if (t === "trades" || t === "listings" || t === "blacklist") return t;
    return "listings";
  });
  const myUserID = user?.id;

  useEffect(() => {
    if (!isAuthenticated) router.push("/");
  }, [isAuthenticated, router]);

  const listingsQuery = useQuery({
    queryKey: ["my-listings"],
    queryFn: fetchMyListings,
    enabled: isAuthenticated,
  });

  const tradesQuery = useQuery({
    queryKey: ["my-trades"],
    queryFn: fetchMyTrades,
    enabled: isAuthenticated,
  });

  const swapsQuery = useQuery({
    queryKey: ["my-swaps"],
    queryFn: fetchMySwaps,
    enabled: isAuthenticated,
  });

  const cancelSwapMutation = useMutation({
    mutationFn: (swapId: string) => cancelSwap(swapId),
    onMutate: () => {
      suppressOwnListingToast();
    },
    onSuccess: () => {
      toast("换盘已撤销", "success");
      queryClient.invalidateQueries({ queryKey: ["my-swaps"] });
    },
    onError: (e: ApiError) => {
      toast(e.message || "撤销失败", "error");
    },
  });

  const [editListingTarget, setEditListingTarget] = useState<Listing | null>(null);
  const [editSwapTarget, setEditSwapTarget] = useState<SwapListing | null>(null);

  const updateListingMutation = useMutation({
    mutationFn: ({ id, params }: { id: string; params: Parameters<typeof updateListing>[1] }) =>
      updateListing(id, params),
    onMutate: () => {
      suppressOwnListingToast();
    },
    onSuccess: () => {
      setEditListingTarget(null);
      toast("挂盘已更新", "success");
      queryClient.invalidateQueries({ queryKey: ["my-listings"] });
      queryClient.invalidateQueries({ queryKey: ["listingsFiltered"] });
    },
    onError: (e: ApiError) => {
      toast(e.message || "编辑挂盘失败", "error");
    },
  });

  const updateSwapMutation = useMutation({
    mutationFn: ({ id, params }: { id: string; params: UpdateSwapParams }) =>
      updateSwap(id, params),
    onMutate: () => {
      suppressOwnListingToast();
    },
    onSuccess: () => {
      setEditSwapTarget(null);
      toast("换盘已更新", "success");
      queryClient.invalidateQueries({ queryKey: ["my-swaps"] });
      queryClient.invalidateQueries({ queryKey: ["swaps"] });
    },
    onError: (e: ApiError) => {
      toast(e.message || "编辑换盘失败", "error");
    },
  });

  const handleEditListing = (data: EditListingFormData) => {
    if (!editListingTarget) return;
    updateListingMutation.mutate({
      id: editListingTarget.id,
      params: {
        price: Number(data.price),
        quantity: Number(data.quantity),
        min_quantity: data.allow_partial && data.min_quantity ? Number(data.min_quantity) : 0,
        delivery_period: data.delivery_period || undefined,
        delivery_location: data.delivery_location || undefined,
        payment_method: data.payment_method || undefined,
        delivery_method: data.delivery_method || undefined,
        specs: data.specs || undefined,
        allow_partial: data.allow_partial,
        allow_counter_offer: data.allow_counter_offer,
        negotiable_terms: data.negotiable_terms,
        free_storage_enabled: data.free_storage_enabled,
        free_storage_days: data.free_storage_enabled && data.free_storage_days ? Number(data.free_storage_days) : undefined,
        expires_at: data.expires_at ? new Date(data.expires_at).toISOString() : undefined,
        starts_at: data.starts_at !== undefined
          ? (data.starts_at ? new Date(data.starts_at).toISOString() : "")
          : undefined,
      },
    });
  };

  const handleEditSwap = (id: string, data: UpdateSwapParams) => {
    updateSwapMutation.mutate({ id, params: data });
  };

  // 黑名单列表（成交页也要用来判断是否已拉黑）
  const blacklistQuery = useQuery({
    queryKey: ["my-blacklist"],
    queryFn: fetchBlacklist,
    enabled: isAuthenticated && (tab === "blacklist" || tab === "trades"),
  });
  const blockedUserIdSet = useMemo(() => {
    const s = new Set<string>();
    (blacklistQuery.data ?? []).forEach((b) => s.add(b.blocked_user_id));
    return s;
  }, [blacklistQuery.data]);

  // 拉黑确认弹窗目标
  const [blockTarget, setBlockTarget] = useState<{ id: string; name: string } | null>(null);

  // 拉黑用户输入
  const [blockedUserIdInput, setBlockedUserIdInput] = useState("");
  // 模糊搜索联想（按公司名/用户名）
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchInput = (value: string) => {
    setBlockedUserIdInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = value.trim();
    if (!q) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const users = await searchUsers(q);
        setSearchResults(users);
        setShowDropdown(true);
      } catch {
        setSearchResults([]);
      }
    }, 250);
  };

  const handleSelectUser = (u: User) => {
    setBlockedUserIdInput("");
    setSearchResults([]);
    setShowDropdown(false);
    setBlockTarget({
      id: u.id,
      name: (u.company_name || u.username || u.id).trim(),
    });
  };

  const addBlacklistMutation = useMutation({
    mutationFn: (id: string) => addToBlacklist(id.trim()),
    onSuccess: () => {
      toast("已添加到黑名单", "success");
      setBlockedUserIdInput("");
      setBlockTarget(null);
      queryClient.invalidateQueries({ queryKey: ["my-blacklist"] });
      queryClient.invalidateQueries({ queryKey: ["listings"] });
      queryClient.invalidateQueries({ queryKey: ["swaps"] });
    },
    onError: (e: ApiError) => {
      toast(e.message || "添加失败", "error");
    },
  });

  const removeBlacklistMutation = useMutation({
    mutationFn: (recordId: string) => removeFromBlacklist(recordId),
    onSuccess: () => {
      toast("已从黑名单移除", "success");
      queryClient.invalidateQueries({ queryKey: ["my-blacklist"] });
    },
    onError: (e: ApiError) => {
      toast(e.message || "移除失败", "error");
    },
  });

  // 拉取产品列表用于中文名映射
  const productsQuery = useQuery({
    queryKey: ["products"],
    queryFn: fetchProducts,
    staleTime: 5 * 60 * 1000,
  });

  // 产品 ID -> 中文名映射（兜底：找不到时显示 ID）
  const productNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    (productsQuery.data ?? []).forEach((p: Product) => { m[p.id] = p.name; });
    return m;
  }, [productsQuery.data]);
  const getProductName = (id: string) => productNameMap[id] ?? id;

  // 合并「我的挂盘」与「我的换盘」为统一列表（换盘作为独立行，带「换盘」徽章）
  type MixedRow =
    | { kind: "listing"; id: string; listing: Listing }
    | { kind: "swap"; id: string; swap: SwapListing };

  const allRows = useMemo<MixedRow[]>(() => {
    const rows: MixedRow[] = [];
    (listingsQuery.data ?? []).filter(Boolean).forEach((l: Listing) =>
      rows.push({ kind: "listing", id: l.id, listing: l })
    );
    (swapsQuery.data ?? []).filter(Boolean).forEach((s: SwapListing) =>
      rows.push({ kind: "swap", id: s.id, swap: s })
    );
    rows.sort((a, b) => {
      const ta = new Date(a.kind === "listing" ? a.listing.created_at : a.swap.created_at).getTime();
      const tb = new Date(b.kind === "listing" ? b.listing.created_at : b.swap.created_at).getTime();
      return tb - ta;
    });
    return rows;
  }, [listingsQuery.data, swapsQuery.data]);

  const PAGE_SIZE = 20;
  const [listingsPage, setListingsPage] = useState(1);
  const listingsTotalPages = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
  const listingsClampedPage = Math.min(listingsPage, listingsTotalPages);
  const pagedRows = allRows.slice((listingsClampedPage - 1) * PAGE_SIZE, listingsClampedPage * PAGE_SIZE);

  const tradesAll = useMemo(() => (tradesQuery.data ?? []).filter(Boolean), [tradesQuery.data]);
  const [tradesPage, setTradesPage] = useState(1);
  const [detailTrade, setDetailTrade] = useState<TradeRecord | null>(null);
  const tradesTotalPages = Math.max(1, Math.ceil(tradesAll.length / PAGE_SIZE));
  const tradesClampedPage = Math.min(tradesPage, tradesTotalPages);
  const pagedTrades = tradesAll.slice((tradesClampedPage - 1) * PAGE_SIZE, tradesClampedPage * PAGE_SIZE);

  if (!isAuthenticated) {
    return (
      <main className="w-full px-4 py-12 text-center text-t-text-3">
        请先登录
      </main>
    );
  }

  return (
    <main className="flex flex-col h-[calc(100vh-2.75rem)] w-full overflow-hidden">
      <div className="px-4 pt-5 pb-4 shrink-0">
        <h1 className="text-2xl font-bold text-t-text">我的交易</h1>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 px-4 mb-4 border-b border-t-border">
        <button
          onClick={() => setTab("listings")}
          className={`px-6 py-2.5 text-sm font-medium transition-colors border-b-2 ${
            tab === "listings"
              ? "border-brand-600 text-brand-600"
              : "border-transparent text-t-text-3 hover:text-t-text"
          }`}
        >
          我的挂盘
        </button>
        <button
          onClick={() => setTab("trades")}
          className={`px-6 py-2.5 text-sm font-medium transition-colors border-b-2 ${
            tab === "trades"
              ? "border-brand-600 text-brand-600"
              : "border-transparent text-t-text-3 hover:text-t-text"
          }`}
        >
          我的成交
        </button>
        <button
          onClick={() => setTab("blacklist")}
          className={`px-6 py-2.5 text-sm font-medium transition-colors border-b-2 ${
            tab === "blacklist"
              ? "border-brand-600 text-brand-600"
              : "border-transparent text-t-text-3 hover:text-t-text"
          }`}
        >
          黑名单管理
        </button>
      </div>

      {/* 我的挂盘（含换盘，统一列表） */}
      <div className="flex-1 min-h-0 px-4 pb-4">
      {tab === "listings" && (
        <div className="bg-t-card rounded-lg border border-t-border overflow-hidden flex flex-col h-full">
          {listingsQuery.isLoading || swapsQuery.isLoading ? (
            <div className="flex-1 flex items-center justify-center text-t-text-3">加载中...</div>
          ) : allRows.length > 0 ? (
            <>
              <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto">
                <table className="w-full table-auto text-sm">
                  <thead className="bg-t-hover border-b border-t-border sticky top-0 z-10">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap">序号</th>
                      <th className="text-left px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap">类型</th>
                      <th className="text-left px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap">品种</th>
                      <th className="text-right px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap">价格</th>
                      <th className="text-right px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap">数量</th>
                      <th className="text-right px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap">已成交</th>
                      <th className="text-left px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap">交割期</th>
                      <th className="text-left px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap hidden sm:table-cell">交割地</th>
                      <th className="text-left px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap hidden sm:table-cell">付款方式</th>
                      <th className="text-left px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap hidden sm:table-cell">交割方式</th>
                      <th className="text-left px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap hidden md:table-cell">免仓期</th>
                      <th className="text-left px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap hidden md:table-cell">规格</th>
                      <th className="text-left px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap">状态</th>
                      <th className="text-left px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap hidden sm:table-cell">时间</th>
                      <th className="text-left px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-t-border-subtle">
                    {pagedRows.map((row) => {
                      if (row.kind === "listing") {
                        const l = row.listing;
                        return (
                          <tr key={l.id} className="hover:bg-t-hover">
                            <td className="px-4 py-3 font-mono text-xs text-t-text-3 whitespace-nowrap">{formatBoardSerial("L", l.serial_no, l.created_at)}</td>
                            <td className="px-4 py-3">
                              <span className={`text-xs font-bold ${l.side === "BUY" ? "text-trade-up-text" : "text-trade-down-text"}`}>
                                {l.side === "BUY" ? "求购" : "销售"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-t-text">{getProductName(l.product_id)}</td>
                            <td className="px-4 py-3 text-right font-mono font-medium text-t-text whitespace-nowrap">
                              ¥{l.price.toLocaleString()}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-t-text-2 whitespace-nowrap">
                              {l.quantity.toLocaleString()}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-t-text-2 whitespace-nowrap">
                              {l.filled.toLocaleString()}
                            </td>
                            <td className="px-4 py-3 text-t-text-3 text-xs whitespace-nowrap">{l.delivery_period || "-"}</td>
                            <td className="px-4 py-3 text-t-text-3 text-xs hidden sm:table-cell whitespace-nowrap">
                              {l.delivery_location || "-"}
                            </td>
                            <td className="px-4 py-3 text-t-text-2 text-xs hidden sm:table-cell whitespace-nowrap">
                              {l.payment_method ? (
                                <span className="inline-block px-2 py-0.5 rounded bg-status-info-bg text-status-info">{l.payment_method}</span>
                              ) : (
                                <span className="text-t-text-disabled">-</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-t-text-2 text-xs hidden sm:table-cell whitespace-nowrap">
                              {l.delivery_method ? (
                                <span className="inline-block px-2 py-0.5 rounded bg-t-tertiary text-t-text-2">{l.delivery_method}</span>
                              ) : (
                                <span className="text-t-text-disabled">-</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-t-text-2 text-xs hidden md:table-cell whitespace-nowrap">
                              {freeStorageText(l.free_storage_enabled, l.free_storage_days)}
                            </td>
                            <td className="px-4 py-3 text-t-text-2 text-xs hidden md:table-cell max-w-[160px] truncate" title={typeof l.specs === "string" ? l.specs : undefined}>
                              {formatSpecs(l.specs)}
                            </td>
                            <td className="px-4 py-3">
                              <span className="inline-flex flex-col items-start gap-0.5">
                                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${statusColor(l.status)}`}>
                                  {statusLabel(l.status, l.filled)}
                                </span>
                                {l.status === "SCHEDULED" && l.starts_at && (
                                  <span
                                    className="text-[9px] leading-none font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap bg-sky-500 text-white"
                                    title={`开始 ${formatStartsAt(l.starts_at)}`}
                                  >
                                    {formatStartsAt(l.starts_at)}发布
                                  </span>
                                )}
                                {(l.status === "OPEN" || l.status === "PARTIAL") && l.expires_at && (
                                  <span
                                    className={`text-[9px] leading-none font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${
                                      isExpiringSoon(l.expires_at)
                                        ? "bg-status-error text-white"
                                        : "bg-amber-500 text-white"
                                    }`}
                                    title={`${formatExpiresAt(l.expires_at)}到期`}
                                  >
                                    {formatExpiresAtBadge(l.expires_at)}
                                  </span>
                                )}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-t-text-3 text-xs whitespace-nowrap hidden sm:table-cell">
                              {formatDateTime(l.created_at)}
                            </td>
                            <td className="px-4 py-3">
                              {canEditListing(l.status) || canCancel(l.status) ? (
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {canEditListing(l.status) && (
                                    <button
                                      type="button"
                                      onClick={() => setEditListingTarget(l)}
                                      className="text-xs px-2.5 py-1 rounded bg-violet-500/15 text-violet-600 dark:text-violet-400 border border-violet-500/30 hover:bg-violet-500/25 transition-colors whitespace-nowrap"
                                    >
                                      编辑
                                    </button>
                                  )}
                                  {canCancel(l.status) && (
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        if (!await confirmDialog({
                                          title: "确认撤盘",
                                          message: "确定撤销此挂牌？",
                                          content: (
                                            <ListingBoardConfirmSheet
                                              listing={l}
                                              productName={getProductName(l.product_id)}
                                              serialLabel={formatBoardSerial("L", l.serial_no, l.created_at)}
                                              intro="请核对以下挂牌后确认撤盘。"
                                              outro="撤盘后未成交部分将从市场撤下，已成交部分保留。此操作不可撤销。"
                                            />
                                          ),
                                          wide: true,
                                          variant: "danger",
                                          icon: "danger",
                                          confirmText: "确认撤盘",
                                          cancelText: "再想想",
                                        })) return;
                                        suppressOwnListingToast();
                                        cancelListing(l.id)
                                          .then(() => {
                                            toast("撤盘成功", "success");
                                            queryClient.invalidateQueries({ queryKey: ["my-listings"] });
                                          })
                                          .catch((e: ApiError) => toast(e.message || "撤盘失败", "error"));
                                      }}
                                      className="text-xs px-2.5 py-1 rounded bg-status-error-bg text-status-error hover:opacity-80 transition-colors whitespace-nowrap"
                                    >
                                      撤盘
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-t-text-disabled">-</span>
                              )}
                            </td>
                          </tr>
                        );
                      }
                      // 换盘行
                      const s = row.swap;
                      return (
                        <tr key={s.id} className="bg-t-hover hover:bg-t-active">
                          <td className="px-4 py-3 font-mono text-xs text-t-text-3 whitespace-nowrap">{formatBoardSerial("S", s.serial_no, s.created_at)}</td>
                          <td className="px-4 py-3">
                            <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-brand-600/15 text-brand-600">换盘</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="space-y-0.5">
                              <div className="text-t-text">卖 {getProductName(s.sell_product_id)}</div>
                              <div className="text-t-text">买 {getProductName(s.buy_product_id)}</div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-medium text-t-text whitespace-nowrap">
                            <div className="space-y-0.5">
                              <div>卖 ¥{s.sell_price.toLocaleString()}</div>
                              <div>买 ¥{s.buy_price.toLocaleString()}</div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-t-text-2 whitespace-nowrap">
                            <div className="space-y-0.5">
                              <div>卖 {s.sell_quantity.toLocaleString()}</div>
                              <div>买 {s.buy_quantity.toLocaleString()}</div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-t-text-2 whitespace-nowrap">
                            <div className="space-y-0.5">
                              <div>卖 {(s.sell_filled ?? 0).toLocaleString()}</div>
                              <div>买 {(s.buy_filled ?? 0).toLocaleString()}</div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-t-text-3 text-xs whitespace-nowrap">{s.sell_delivery_period || "-"}</td>
                          <td className="px-4 py-3 text-t-text-3 text-xs hidden sm:table-cell whitespace-nowrap">
                            {s.sell_delivery_location || "-"}
                          </td>
                          <td className="px-4 py-3 text-t-text-2 text-xs hidden sm:table-cell whitespace-nowrap">
                            {s.sell_payment_method ? (
                              <span className="inline-block px-2 py-0.5 rounded bg-status-info-bg text-status-info">{s.sell_payment_method}</span>
                            ) : (
                              <span className="text-t-text-disabled">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-t-text-2 text-xs hidden sm:table-cell whitespace-nowrap">
                            {s.sell_delivery_method ? (
                              <span className="inline-block px-2 py-0.5 rounded bg-t-tertiary text-t-text-2">{s.sell_delivery_method}</span>
                            ) : (
                              <span className="text-t-text-disabled">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-t-text-2 text-xs hidden md:table-cell whitespace-nowrap">
                            {freeStorageText(s.sell_free_storage_enabled, s.sell_free_storage_days)}
                          </td>
                          <td className="px-4 py-3 text-t-text-2 text-xs hidden md:table-cell max-w-[160px] truncate" title={typeof s.sell_specs === "string" ? s.sell_specs : undefined}>
                            {formatSpecs(s.sell_specs)}
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex flex-col items-start gap-0.5">
                              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${statusColor(s.status)}`}>
                                {statusLabel(s.status, Math.max(s.sell_filled ?? 0, s.buy_filled ?? 0))}
                              </span>
                              {s.status === "SCHEDULED" && s.starts_at && (
                                <span
                                  className="text-[9px] leading-none font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap bg-sky-500 text-white"
                                  title={`开始 ${formatStartsAt(s.starts_at)}`}
                                >
                                  {formatStartsAt(s.starts_at)}发布
                                </span>
                              )}
                              {s.status === "OPEN" && s.expires_at && (
                                <span
                                  className={`text-[9px] leading-none font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${
                                    isExpiringSoon(s.expires_at)
                                      ? "bg-status-error text-white"
                                      : "bg-amber-500 text-white"
                                  }`}
                                  title={`${formatExpiresAt(s.expires_at)}到期`}
                                >
                                  {formatExpiresAtBadge(s.expires_at)}
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-t-text-3 text-xs whitespace-nowrap hidden sm:table-cell">
                            {formatDateTime(s.created_at)}
                          </td>
                          <td className="px-4 py-3">
                            {canEditSwap(s.status) ? (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() => setEditSwapTarget(s)}
                                  className="text-xs px-2.5 py-1 rounded bg-violet-500/15 text-violet-600 dark:text-violet-400 border border-violet-500/30 hover:bg-violet-500/25 transition-colors whitespace-nowrap"
                                >
                                  编辑
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    if (!await confirmDialog({
                                      title: "确认撤销换盘",
                                      message: "确定撤销此换盘？",
                                      content: (
                                        <SwapBoardConfirmSheet
                                          swap={s}
                                          sellProductName={getProductName(s.sell_product_id)}
                                          buyProductName={getProductName(s.buy_product_id)}
                                          serialLabel={formatBoardSerial("S", s.serial_no, s.created_at)}
                                          intro="请核对以下换盘后确认撤销。"
                                          outro="撤销后未成交部分将从市场撤下，已成交部分保留。此操作不可撤销。"
                                        />
                                      ),
                                      wide: true,
                                      variant: "danger",
                                      icon: "danger",
                                      confirmText: "确认撤销",
                                      cancelText: "再想想",
                                    })) return;
                                    cancelSwapMutation.mutate(s.id);
                                  }}
                                  disabled={cancelSwapMutation.isPending}
                                  className="text-xs px-2.5 py-1 rounded bg-status-error-bg text-status-error hover:opacity-80 transition-colors disabled:opacity-50 whitespace-nowrap"
                                >
                                  撤销换盘
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-t-text-disabled">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pager page={listingsClampedPage} total={listingsTotalPages} onChange={setListingsPage} />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-t-text-3">暂无挂盘记录</div>
          )}
        </div>
      )}

      {/* 我的成交 */}
      {tab === "trades" && (
        <div className="bg-t-card rounded-lg border border-t-border overflow-hidden flex flex-col h-full">
          {tradesQuery.isLoading ? (
            <div className="flex-1 flex items-center justify-center text-t-text-3">加载中...</div>
          ) : pagedTrades.length > 0 ? (
            <>
              <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto">
                <table className="w-full table-auto text-sm">
                  <thead className="bg-t-hover border-b border-t-border sticky top-0 z-10">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap">成交单号</th>
                      <th className="text-left px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap">成交时间</th>
                      <th className="text-left px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap">方向</th>
                      <th className="text-left px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap">对手方</th>
                      <th className="text-left px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap">品种</th>
                      <th className="text-right px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap">价格</th>
                      <th className="text-right px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap">数量</th>
                      <th className="text-right px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap hidden sm:table-cell">金额</th>
                      <th className="text-left px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap">交割期</th>
                      <th className="text-left px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap hidden sm:table-cell">交割地</th>
                      <th className="text-left px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap hidden sm:table-cell">付款方式</th>
                      <th className="text-left px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap hidden sm:table-cell">交割方式</th>
                      <th className="text-left px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap hidden md:table-cell">免仓期</th>
                      <th className="text-left px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap hidden md:table-cell">规格</th>
                      <th className="text-left px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap">成交来源</th>
                      <th className="text-left px-4 py-2.5 font-medium text-t-text-3 whitespace-nowrap">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-t-border-subtle">
                    {pagedTrades.map((t: TradeRecord) => {
                      const isBuyer = !!myUserID && t.buy_user_id === myUserID;
                      const paymentMethod = isBuyer ? t.buy_payment_method : t.sell_payment_method;
                      const specs = isBuyer ? t.buy_specs : t.sell_specs;
                      const counterpartyId = isBuyer ? t.sell_user_id : t.buy_user_id;
                      const counterparty =
                        (isBuyer ? t.sell_company_name : t.buy_company_name)?.trim() || "-";
                      const src = tradeSourceLabel(t, myUserID);
                      const isSwap = t.source === "swap";
                      const alreadyBlocked = blockedUserIdSet.has(counterpartyId);
                      return (
                        <tr
                          key={t.id}
                          title="双击查看成交详情"
                          onDoubleClick={() => setDetailTrade(t)}
                          className={`cursor-pointer ${isSwap ? "bg-t-hover hover:bg-t-active" : "hover:bg-t-hover"}`}
                        >
                          <td className="px-4 py-3 font-mono text-xs text-t-text-3 whitespace-nowrap">{formatTradeNo(t.serial_no, t.traded_at)}</td>
                          <td className="px-4 py-3 text-t-text-3 text-xs whitespace-nowrap">
                            {formatDateTime(t.traded_at)}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-bold ${isBuyer ? "text-trade-up-text" : "text-trade-down-text"}`}>
                              {isBuyer ? "买入" : "卖出"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-t-text text-xs max-w-[140px] truncate" title={counterparty !== "-" ? counterparty : undefined}>
                            {counterparty}
                          </td>
                          <td className="px-4 py-3 text-t-text">{getProductName(t.product_id)}</td>
                          <td className="px-4 py-3 text-right font-mono font-medium text-t-text whitespace-nowrap">
                            ¥{t.price.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-t-text-2 whitespace-nowrap">
                            {t.quantity.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-brand-600 hidden sm:table-cell whitespace-nowrap">
                            ¥{t.amount.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-t-text-3 text-xs whitespace-nowrap">
                            {t.delivery_period || "-"}
                          </td>
                          <td className="px-4 py-3 text-t-text-3 text-xs hidden sm:table-cell whitespace-nowrap">
                            {t.delivery_location || "-"}
                          </td>
                          <td className="px-4 py-3 text-t-text-2 text-xs hidden sm:table-cell whitespace-nowrap">
                            {paymentMethod ? (
                              <span className="inline-block px-2 py-0.5 rounded bg-status-info-bg text-status-info">{paymentMethod}</span>
                            ) : (
                              <span className="text-t-text-disabled">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-t-text-2 text-xs hidden sm:table-cell whitespace-nowrap">
                            {t.delivery_method ? (
                              <span className="inline-block px-2 py-0.5 rounded bg-t-tertiary text-t-text-2">{t.delivery_method}</span>
                              ) : (
                                <span className="text-t-text-disabled">-</span>
                              )}
                          </td>
                          <td className="px-4 py-3 text-t-text-2 text-xs hidden md:table-cell whitespace-nowrap">
                            {freeStorageText(t.free_storage_enabled, t.free_storage_days)}
                          </td>
                          <td className="px-4 py-3 text-t-text-2 text-xs hidden md:table-cell max-w-[160px] truncate" title={typeof specs === "string" ? specs : undefined}>
                            {formatSpecs(specs)}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-block px-2 py-0.5 rounded text-xs whitespace-nowrap ${src.cls}`}>
                              {src.text}
                            </span>
                          </td>
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                            {alreadyBlocked ? (
                              <span className="text-xs text-t-text-disabled whitespace-nowrap">已拉黑</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  setBlockTarget({
                                    id: counterpartyId,
                                    name: counterparty !== "-" ? counterparty : "对手方",
                                  })
                                }
                                className="text-xs px-2.5 py-1 rounded bg-status-error-bg text-status-error hover:opacity-80 transition-colors whitespace-nowrap"
                              >
                                拉黑
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pager page={tradesClampedPage} total={tradesTotalPages} onChange={setTradesPage} />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-t-text-3">暂无成交记录</div>
          )}
        </div>
      )}

      {/* 黑名单管理 */}
      {tab === "blacklist" && (
        <div className="flex flex-col h-full gap-4">
          {/* 添加黑名单 */}
          <div className="bg-t-card rounded-lg border border-t-border p-4 shrink-0">
            <h2 className="text-sm font-semibold text-t-text mb-3">添加用户到黑名单</h2>
            <div className="flex gap-2 items-start">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={blockedUserIdInput}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && blockedUserIdInput.trim() && !addBlacklistMutation.isPending) {
                      setBlockTarget({
                        id: blockedUserIdInput.trim(),
                        name: blockedUserIdInput.trim(),
                      });
                    }
                  }}
                  onBlur={() => {
                    // 延迟关闭，确保点击下拉项能先触发
                    setTimeout(() => setShowDropdown(false), 150);
                  }}
                  placeholder="输入公司名称 / 用户名 / 用户 UUID"
                  className="w-full px-3 py-2 text-sm border border-t-border rounded focus:outline-none focus:border-brand-500"
                  disabled={addBlacklistMutation.isPending}
                />
                {showDropdown && searchResults.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full bg-t-card border border-t-border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {searchResults.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); handleSelectUser(u); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-t-hover transition-colors border-b border-t-border-subtle last:border-0"
                      >
                        <span className="font-medium text-t-text">{u.company_name || "（未填写公司）"}</span>
                        <span className="text-t-text-3 text-xs ml-2">@{u.username}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => {
                  if (blockedUserIdInput.trim() && !addBlacklistMutation.isPending) {
                    setBlockTarget({
                      id: blockedUserIdInput.trim(),
                      name: blockedUserIdInput.trim(),
                    });
                  }
                }}
                disabled={!blockedUserIdInput.trim() || addBlacklistMutation.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                拉黑
              </button>
            </div>
            <p className="text-xs text-t-text-3 mt-2">
              支持按公司名称、用户名或用户 UUID 拉黑。拉黑后双方都看不到对方发盘，且无法成交；您主动移除黑名单后恢复。
            </p>
          </div>

          {/* 黑名单列表 */}
          <div className="bg-t-card rounded-lg border border-t-border overflow-hidden flex flex-col flex-1 min-h-0">
            {blacklistQuery.isLoading ? (
              <div className="flex-1 flex items-center justify-center text-t-text-3">加载中...</div>
            ) : blacklistQuery.data && blacklistQuery.data.length > 0 ? (
              <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-t-hover border-b border-t-border">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium text-t-text-3">用户名</th>
                      <th className="text-left px-4 py-2.5 font-medium text-t-text-3">公司</th>
                      <th className="text-left px-4 py-2.5 font-medium text-t-text-3 hidden sm:table-cell">拉黑时间</th>
                      <th className="text-left px-4 py-2.5 font-medium text-t-text-3">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-t-border-subtle">
                    {blacklistQuery.data.map((item: BlacklistItem) => (
                      <tr key={item.id} className="hover:bg-t-hover">
                        <td className="px-4 py-3 text-t-text font-medium">{item.blocked_name || item.blocked_user_id}</td>
                        <td className="px-4 py-3 text-t-text-3 text-xs">{item.blocked_company || "-"}</td>
                        <td className="px-4 py-3 text-t-text-3 text-xs hidden sm:table-cell whitespace-nowrap">{formatDateTime(item.created_at)}</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={async () => {
                              const name = item.blocked_name || item.blocked_company || item.blocked_user_id;
                              if (!await confirmDialog({
                                title: "移出黑名单",
                                message: `确定将「${name}」移出黑名单？`,
                                content: (
                                  <GenericDetailConfirmSheet
                                    intro="请核对以下黑名单记录后确认移出。"
                                    rows={[
                                      { label: "用户名", value: item.blocked_name || "-", strong: true },
                                      { label: "公司", value: item.blocked_company || "-" },
                                      { label: "用户 ID", value: item.blocked_user_id },
                                      {
                                        label: "可见性",
                                        value: item.allow_view ? "可查看对方发盘" : "隐藏对方发盘",
                                      },
                                      { label: "拉黑时间", value: formatDateTime(item.created_at) },
                                    ]}
                                    outro="移出后双方将重新看到对方的发盘，并可以再次成交。请确认后再操作。"
                                  />
                                ),
                                wide: true,
                                variant: "warning",
                                icon: "warning",
                                confirmText: "确认移出",
                                cancelText: "再想想",
                              })) return;
                              removeBlacklistMutation.mutate(item.id);
                            }}
                            disabled={removeBlacklistMutation.isPending}
                            className="text-xs px-2.5 py-1 rounded bg-t-hover text-t-text-2 hover:bg-t-active transition-colors"
                          >
                            移除
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-t-text-3">黑名单为空</div>
            )}
          </div>
        </div>
      )}
      </div>

      {detailTrade && (
        <TradeDetailModal
          trade={detailTrade}
          productName={getProductName(detailTrade.product_id)}
          myUserID={myUserID}
          onClose={() => setDetailTrade(null)}
        />
      )}

      {editListingTarget && (
        <EditListingModal
          open
          listing={editListingTarget}
          product={(productsQuery.data ?? []).find((p) => p.id === editListingTarget.product_id)}
          loading={updateListingMutation.isPending}
          onClose={() => setEditListingTarget(null)}
          onSubmit={handleEditListing}
        />
      )}

      {editSwapTarget && (
        <EditSwapModal
          open
          swap={editSwapTarget}
          products={productsQuery.data ?? []}
          loading={updateSwapMutation.isPending}
          onClose={() => setEditSwapTarget(null)}
          onSubmit={handleEditSwap}
        />
      )}

      {blockTarget && (
        <BlockUserModal
          displayName={blockTarget.name}
          onCancel={() => setBlockTarget(null)}
          onConfirm={async () => {
            await addBlacklistMutation.mutateAsync(blockTarget.id);
          }}
        />
      )}
    </main>
  );
}

export default function MyPage() {
  return (
    <Suspense fallback={<main className="w-full px-4 py-12 text-center text-t-text-3">加载中...</main>}>
      <MyPageContent />
    </Suspense>
  );
}
