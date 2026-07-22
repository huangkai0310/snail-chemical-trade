"use client";

import { useState, useMemo, Suspense } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchProducts,
  fetchReceivedCounterOffers,
  fetchSentCounterOffers,
  acceptCounterOffer,
  rejectCounterOffer,
  cancelCounterOffer,
  respondCounterOffer,
  ApiError,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import type { Product, CounterOffer } from "@/lib/types";
import {
  getViewerRole,
  analyzeNegotiation,
  disputedTermKeys,
  sideLabel,
  TERM_KEYS,
  TERM_LABELS,
} from "@/lib/negotiation";
import { formatBoardSerial } from "@/lib/format";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "@/components/Toast";
import { confirmDialog } from "@/components/ConfirmDialog";
import { CounterOfferConfirmSheetFromCo } from "@/components/PostingConfirmSheet";
import { useTradeWS } from "@/lib/use-trade-ws";
import { groupCounterOfferRows, findPairedSwapCounterOffer } from "@/lib/swap-counter-offer";
import DualSwapCounterOfferRow from "@/components/DualSwapCounterOfferRow";

// ========== 状态筛选常量 ==========
type COStatusFilter =
  | "PENDING"
  | "ACCEPTED"
  | "REJECTED"
  | "EXPIRED"
  | "CANCELLED"
  | "PARTIAL_ACCEPTED"
  | "ALL";

const STATUS_OPTIONS: { value: COStatusFilter; label: string }[] = [
  { value: "PENDING", label: "待处理" },
  { value: "PARTIAL_ACCEPTED", label: "部分接受" },
  { value: "ACCEPTED", label: "已接受" },
  { value: "REJECTED", label: "已拒绝" },
  { value: "EXPIRED", label: "已失效" },
  { value: "CANCELLED", label: "已撤销" },
  { value: "ALL", label: "全部" },
];

// ========== localStorage 持久化 ==========
const STORAGE_KEY_SUBTAB = "co_subtab";
const STORAGE_KEY_STATUS = "co_status_filter";

function loadSubTab(): "received" | "sent" {
  if (typeof window === "undefined") return "received";
  const v = localStorage.getItem(STORAGE_KEY_SUBTAB);
  return v === "sent" ? "sent" : "received";
}

function loadStatusFilter(): COStatusFilter {
  if (typeof window === "undefined") return "PENDING";
  const v = localStorage.getItem(STORAGE_KEY_STATUS);
  if (v && STATUS_OPTIONS.some((o) => o.value === v)) return v as COStatusFilter;
  return "PENDING";
}

// ========== 术语定义 ==========
// 列顺序与标签统一由 @/lib/negotiation 的 TERM_KEYS / TERM_LABELS 提供

// ========== 工具函数 ==========

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

function coStatusLabel(status: string): string {
  switch (status) {
    case "PENDING": return "待处理";
    case "PARTIAL_ACCEPTED": return "部分接受";
    case "ACCEPTED": return "已接受";
    case "REJECTED": return "已拒绝";
    case "CANCELLED": return "已撤销";
    case "EXPIRED": return "已失效";
    default: return status;
  }
}

function coStatusColor(status: string): string {
  switch (status) {
    case "PENDING": return "text-status-warning bg-status-warning-bg";
    case "PARTIAL_ACCEPTED": return "text-status-info bg-status-info-bg";
    case "ACCEPTED": return "text-status-success bg-status-success-bg";
    case "REJECTED": return "text-status-error bg-status-error-bg";
    case "CANCELLED": return "text-t-text-3 bg-t-hover";
    case "EXPIRED": return "text-t-text-3 bg-t-hover";
    default: return "text-t-text-3 bg-t-hover";
  }
}

function cancelReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "";
  switch (reason) {
    case "对方已成交": return "对方已成交";
    case "对方已撤盘": return "对方已撤盘";
    default: return reason;
  }
}

// 免仓期展示文本
function freeStorageText(enabled: boolean | null | undefined, days: number | null | undefined): string {
  if (enabled == null) return "-";
  if (enabled) return `免仓${days != null && days > 0 ? `${days}天` : ""}`;
  return "不免仓";
}

// 取某条款的「原始值」（ref=挂牌方原盘 / offer=议价方提出）
function rawVal(co: CounterOffer, key: string, side: "ref" | "offer"): string | undefined {
  if (side === "offer") {
    switch (key) {
      case "price": return String(co.offer_price);
      case "quantity": return String(co.offer_quantity);
      case "delivery_period": return co.offer_delivery_period ?? undefined;
      case "delivery_location": return co.offer_delivery_location ?? undefined;
      case "payment_method": return co.offer_payment_method ?? undefined;
      case "delivery_method": return co.offer_delivery_method ?? undefined;
      case "free_storage": return co.offer_free_storage_enabled == null ? undefined : freeStorageText(co.offer_free_storage_enabled, co.offer_free_storage_days);
      case "specs": return co.offer_specs?.trim() || undefined;
    }
  } else {
    switch (key) {
      case "price": return co.ref_price != null ? String(co.ref_price) : undefined;
      case "quantity": return co.ref_quantity != null && co.ref_filled != null ? String(co.ref_quantity - co.ref_filled) : undefined;
      case "delivery_period": return co.ref_delivery_period ?? undefined;
      case "delivery_location": return co.ref_delivery_location ?? undefined;
      case "payment_method": return co.ref_payment_method ?? undefined;
      case "delivery_method": return co.ref_delivery_method ?? undefined;
      case "free_storage": return freeStorageText(co.ref_free_storage_enabled, co.ref_free_storage_days);
      case "specs": return co.ref_specs?.trim() || undefined;
    }
  }
  return undefined;
}

// 展示用格式
function displayVal(co: CounterOffer, key: string, side: "ref" | "offer"): string {
  if (side === "offer") {
    switch (key) {
      case "price": return `¥${co.offer_price.toLocaleString()}/吨`;
      case "quantity": return `${co.offer_quantity.toLocaleString()}吨`;
      case "delivery_period": return co.offer_delivery_period ?? "—";
      case "delivery_location": return co.offer_delivery_location ?? "—";
      case "payment_method": return co.offer_payment_method ?? "—";
      case "delivery_method": return co.offer_delivery_method ?? "—";
      case "free_storage": return co.offer_free_storage_enabled == null ? "—" : freeStorageText(co.offer_free_storage_enabled, co.offer_free_storage_days);
      case "specs": return co.offer_specs?.trim() ? co.offer_specs : "—";
    }
  } else {
    switch (key) {
      case "price": return co.ref_price != null ? `¥${co.ref_price.toLocaleString()}/吨` : "-";
      case "quantity": return co.ref_quantity != null && co.ref_filled != null ? `${(co.ref_quantity - co.ref_filled).toLocaleString()}吨` : "-";
      case "delivery_period": return co.ref_delivery_period ?? "-";
      case "delivery_location": return co.ref_delivery_location ?? "-";
      case "payment_method": return co.ref_payment_method ?? "-";
      case "delivery_method": return co.ref_delivery_method ?? "-";
      case "free_storage": return freeStorageText(co.ref_free_storage_enabled, co.ref_free_storage_days);
      case "specs": return co.ref_specs?.trim() ? co.ref_specs : "-";
    }
  }
  return "-";
}

// ========== 角色命名：对方 / 己方 ==========
// 己方 = 当前登录用户；对方 = 交易对手（sideLabel 由 @/lib/negotiation 导出）

// ========== 分页条 ==========
const PAGE_SIZE = 20;
function Pager({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  const tp = Math.max(1, totalPages);
  const current = Math.min(page, tp);
  return (
    <div className="flex items-center justify-between px-4 py-3 bg-t-card border-t border-t-border">
      <span className="text-xs text-t-text-3">共 {tp} 页，当前第 {current} / {tp} 页</span>
      <div className="flex gap-2">
        <button
          onClick={() => onChange(Math.max(1, current - 1))}
          disabled={current <= 1}
          className="px-3 py-1.5 text-xs rounded border border-t-border text-t-text-2 hover:bg-t-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          上一页
        </button>
        <button
          onClick={() => onChange(Math.min(tp, current + 1))}
          disabled={current >= tp}
          className="px-3 py-1.5 text-xs rounded border border-t-border text-t-text-2 hover:bg-t-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          下一页
        </button>
      </div>
    </div>
  );
}

// ========== 主组件 ==========
function CounterOffersPageContent() {
  const { isAuthenticated, user } = useAuthStore();
  const router = useRouter();
  const queryClient = useQueryClient();

  // WebSocket 监听：对方修改商谈条款后实时局部刷新
  useTradeWS({
    onCounterOfferUpdated: () => {
      queryClient.invalidateQueries({ queryKey: ["received-counter-offers"] });
    },
    onCounterOfferReceived: () => {
      queryClient.invalidateQueries({ queryKey: ["received-counter-offers"] });
    },
    onCounterOfferCancelled: () => {
      queryClient.invalidateQueries({ queryKey: ["received-counter-offers"] });
      queryClient.invalidateQueries({ queryKey: ["sent-counter-offers"] });
    },
    onCounterOfferAccepted: () => {
      queryClient.invalidateQueries({ queryKey: ["received-counter-offers"] });
      queryClient.invalidateQueries({ queryKey: ["sent-counter-offers"] });
    },
    onCounterOfferRejected: () => {
      queryClient.invalidateQueries({ queryKey: ["received-counter-offers"] });
      queryClient.invalidateQueries({ queryKey: ["sent-counter-offers"] });
    },
    onCounterOfferPartialAccepted: () => {
      queryClient.invalidateQueries({ queryKey: ["received-counter-offers"] });
      queryClient.invalidateQueries({ queryKey: ["sent-counter-offers"] });
    },
    onCounterOfferConfirmRejected: () => {
      queryClient.invalidateQueries({ queryKey: ["received-counter-offers"] });
      queryClient.invalidateQueries({ queryKey: ["sent-counter-offers"] });
    },
  });

  // 从 localStorage 恢复上次的状态
  const [coSubTab, setCoSubTab] = useState<"received" | "sent">(loadSubTab);
  const [statusFilter, setStatusFilter] = useState<COStatusFilter>(loadStatusFilter);

  // 收到的议价：每条 PENDING 挂牌类议价勾选接受的条款（默认全选「有异议」的条款）
  const [selectedTerms, setSelectedTerms] = useState<Record<string, string[]>>({});

  // 分页（收到 / 发出 各自独立）
  const [receivedPage, setReceivedPage] = useState(1);
  const [sentPage, setSentPage] = useState(1);

  // 状态变化时持久化到 localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SUBTAB, coSubTab);
  }, [coSubTab]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_STATUS, statusFilter);
  }, [statusFilter]);

  // 切换 Tab / 状态筛选时回到第一页
  useEffect(() => {
    setReceivedPage(1);
    setSentPage(1);
  }, [coSubTab, statusFilter]);

  const myUserID = user?.id;

  useEffect(() => {
    if (!isAuthenticated) router.push("/");
  }, [isAuthenticated, router]);

  // 产品列表（用于名称映射）
  const productsQuery = useQuery({
    queryKey: ["products"],
    queryFn: fetchProducts,
    staleTime: 5 * 60 * 1000,
  });

  // 根据筛选状态构造 API 参数
  const apiStatus = statusFilter === "ALL" ? undefined : statusFilter;

  // 收到的议价
  const receivedQuery = useQuery({
    queryKey: ["received-counter-offers", statusFilter],
    queryFn: () => fetchReceivedCounterOffers(1, 100, apiStatus).then((r) => r.data),
    enabled: isAuthenticated,
  });

  // 发出的议价
  const sentQuery = useQuery({
    queryKey: ["sent-counter-offers", statusFilter],
    queryFn: () => fetchSentCounterOffers(1, 100, apiStatus).then((r) => r.data),
    enabled: isAuthenticated,
  });

  // 接受议价（支持条款级部分接受：terms 为接受的条款键子集）
  const acceptMutation = useMutation({
    mutationFn: (p: { id: string; terms?: string[] }) => acceptCounterOffer(p.id, p.terms),
    onSuccess: (data) => {
      toast(data.message || "已处理", "success");
      queryClient.invalidateQueries({ queryKey: ["received-counter-offers"] });
      queryClient.invalidateQueries({ queryKey: ["sent-counter-offers"] });
      queryClient.invalidateQueries({ queryKey: ["my-listings"] });
      queryClient.invalidateQueries({ queryKey: ["my-trades"] });
    },
    onError: (e: ApiError) => toast(e.message || "操作失败", "error"),
  });

  // 拒绝议价
  const rejectMutation = useMutation({
    mutationFn: (id: string) => rejectCounterOffer(id, "不予接受"),
    onSuccess: () => {
      toast("已拒绝商谈", "success");
      queryClient.invalidateQueries({ queryKey: ["received-counter-offers"] });
    },
    onError: (e: ApiError) => toast(e.message || "拒绝商谈失败", "error"),
  });

  // 撤销议价
  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelCounterOffer(id),
    onSuccess: () => {
      toast("商谈已撤销", "success");
      queryClient.invalidateQueries({ queryKey: ["sent-counter-offers"] });
      queryClient.invalidateQueries({ queryKey: ["received-counter-offers"] });
    },
    onError: (e: ApiError) => toast(e.message || "撤销商谈失败", "error"),
  });

  // 发起方确认/拒绝对方的部分接受
  const respondMutation = useMutation({
    mutationFn: (p: { id: string; action: "accept" | "reject" }) => respondCounterOffer(p.id, p.action),
    onSuccess: (data) => {
      toast(data.message || "已处理", "success");
      queryClient.invalidateQueries({ queryKey: ["sent-counter-offers"] });
      queryClient.invalidateQueries({ queryKey: ["received-counter-offers"] });
      queryClient.invalidateQueries({ queryKey: ["my-trades"] });
    },
    onError: (e: ApiError) => toast(e.message || "操作失败", "error"),
  });

  // 产品 ID -> 中文名映射
  const productNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    (productsQuery.data ?? []).forEach((p: Product) => { m[p.id] = p.name; });
    return m;
  }, [productsQuery.data]);

  if (!isAuthenticated) {
    return (
      <main className="w-full px-4 py-12 text-center text-t-text-3">
        请先登录
      </main>
    );
  }

  const allData = coSubTab === "received" ? receivedQuery.data : sentQuery.data;
  const isLoading = coSubTab === "received" ? receivedQuery.isLoading : sentQuery.isLoading;

  // 前端分页
  const rows = (allData ?? []).filter(Boolean);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = coSubTab === "received" ? receivedPage : sentPage;
  const clampedPage = Math.min(page, totalPages);
  const currentData = rows.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);
  const displayRows = groupCounterOfferRows(currentData);
  const setPage = coSubTab === "received" ? setReceivedPage : setSentPage;

  // 默认勾选 = 全部「有异议」条款（无异议条款无需勾选，成交时自动沿用）
  const getSel = (co: CounterOffer): string[] => selectedTerms[co.id] ?? disputedTermKeys(co);

  const toggleTerm = (co: CounterOffer, key: string) => {
    setSelectedTerms((prev) => {
      const cur = prev[co.id] ?? disputedTermKeys(co);
      const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      return { ...prev, [co.id]: next };
    });
  };

  // 接受收到的议价（received 视图）：
  //   - 无异议（对方未改条款）：可直接成交；
  //   - 有异议条款按勾选决定全接受或部分接受。
  const onAcceptReceived = async (co: CounterOffer) => {
    const disputed = disputedTermKeys(co);
    const checkedDisputed = getSel(co); // 勾选同意的有异议条款
    if (disputed.length > 0 && checkedDisputed.length === 0) {
      toast("请至少同意一项有异议的条款，或点击拒绝", "error");
      return;
    }
    const isFull = disputed.length === 0 || checkedDisputed.length === disputed.length;
    const ok = await confirmDialog({
      title: isFull ? "接受商谈" : "部分接受商谈",
      message: isFull
        ? "确认接受此商谈？接受后立即成交。"
        : "确认仅接受所选条款？对方将收到「部分接受」通知并需二次确认。",
      content: (
        <CounterOfferConfirmSheetFromCo
          co={co}
          productName={co.product_id ? productNameMap[co.product_id] : undefined}
          serialLabel={
            co.ref_serial_no
              ? formatBoardSerial(
                  co.ref_type === "swap" ? "S" : "L",
                  co.ref_serial_no,
                  co.ref_created_at,
                )
              : undefined
          }
          acceptedTermsLabel={
            isFull
              ? disputed.length === 0
                ? "对方无异议，全部接受"
                : "全部异议条款"
              : checkedDisputed.map((k) => TERM_LABELS[k] ?? k).join("、")
          }
          intro={
            isFull
              ? "请核对以下商谈条款，接受后将立即成交。"
              : "请核对所选接受条款；未勾选的异议条款将退回对方二次确认。"
          }
          outro={
            isFull
              ? "接受后立即成交，此操作不可撤销。"
              : "对方将收到「部分接受」通知并需二次确认。"
          }
        />
      ),
      wide: true,
      variant: "success",
      icon: "success",
      confirmText: "接受",
    });
    if (!ok) return;
    acceptMutation.mutate({ id: co.id, terms: isFull ? undefined : checkedDisputed });
  };

  return (
    <main className="flex flex-col h-[calc(100vh-2.75rem)] w-full overflow-hidden">
      <div className="px-6 pt-5 pb-3 shrink-0">
        <h1 className="text-2xl font-bold text-t-text mb-1">商谈管理</h1>
        <p className="text-xs text-t-text-3">
          条款对比：<span className="text-t-text-2 font-medium">己方</span> = 您（当前登录用户），
          <span className="text-t-text-2 font-medium">对方</span> = 交易对手；绿色「对您有利」/红色「对您不利」按您的身份判定
        </p>
      </div>

      {/* 子 Tab：收到 / 发出 */}
      <div className="flex gap-4 mb-4 border-b border-t-border px-6">
        <button
          onClick={() => setCoSubTab("received")}
          className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
            coSubTab === "received"
              ? "border-brand-500 text-brand-500"
              : "border-transparent text-t-text-2 hover:text-t-text"
          }`}
        >
          收到的商谈
        </button>
        <button
          onClick={() => setCoSubTab("sent")}
          className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
            coSubTab === "sent"
              ? "border-brand-500 text-brand-500"
              : "border-transparent text-t-text-2 hover:text-t-text"
          }`}
        >
          发出的商谈
        </button>

        {/* 状态筛选 — 右对齐 */}
        <div className="ml-auto flex items-center gap-2 pb-2">
          <span className="text-xs text-t-text-3">状态：</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as COStatusFilter)}
            className="text-xs px-2 py-1 rounded border border-t-border bg-t-panel text-t-text focus:outline-none focus:border-brand-500"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 议价列表区域：占满剩余高度，内部滚动 */}
      <div className="flex-1 min-h-0 px-4 pb-4">
        <div className="bg-t-card rounded-lg border border-t-border overflow-hidden flex flex-col h-full">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center text-t-text-3">加载中...</div>
        ) : displayRows && displayRows.length > 0 ? (
          <>
          <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto">
            <table className="w-full table-auto text-sm border-collapse">
              <thead className="bg-t-hover border-b border-t-border sticky top-0 z-10">
                <tr>
                  <th className="text-left px-3 py-2.5 font-medium text-t-text-2 whitespace-nowrap">序号</th>
                  <th className="text-left px-3 py-2.5 font-medium text-t-text-2 whitespace-nowrap">品种</th>
                  <th className="text-left px-3 py-2.5 font-medium text-t-text-2 whitespace-nowrap">类型</th>
                  <th className="text-left px-3 py-2.5 font-medium text-t-text-2 whitespace-nowrap">时间</th>
                  {TERM_KEYS.map((k) => (
                    <th key={k} className="text-left px-3 py-2.5 font-medium text-t-text-2 whitespace-nowrap">
                      {TERM_LABELS[k]}
                    </th>
                  ))}
                  <th className="text-left px-3 py-2.5 font-medium text-t-text-2 whitespace-nowrap">状态</th>
                  <th className="text-left px-3 py-2.5 font-medium text-t-text-2 whitespace-nowrap">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-t-border-subtle">
                {displayRows.map((row) => {
                  if (row.kind === "dual") {
                    const { sellCo, buyCo } = row;
                    const pid = sellCo.product_id ?? buyCo.product_id;
                    return (
                      <DualSwapCounterOfferRow
                        key={row.groupKey}
                        sellCo={sellCo}
                        buyCo={buyCo}
                        myUserID={myUserID}
                        coSubTab={coSubTab}
                        productName={pid ? productNameMap[pid] : undefined}
                        formatDateTime={formatDateTime}
                        coStatusLabel={coStatusLabel}
                        coStatusColor={coStatusColor}
                        cancelReasonLabel={cancelReasonLabel}
                        selectedTerms={selectedTerms}
                        toggleTerm={toggleTerm}
                        getSel={getSel}
                        onAcceptReceived={onAcceptReceived}
                        acceptPending={acceptMutation.isPending}
                        rejectPending={rejectMutation.isPending}
                        onReject={(id) => rejectMutation.mutate(id)}
                        cancelPending={cancelMutation.isPending}
                        onCancel={(id) => cancelMutation.mutate(id)}
                        respondPending={respondMutation.isPending}
                        onRespond={(p) => respondMutation.mutate(p)}
                        confirmDialog={confirmDialog}
                      />
                    );
                  }

                  const co = row.co;
                  // 发牌方 = ref 侧（原始挂牌/换盘方）；议价方 = offer 侧（还价提出方）
                  const viewerRole = getViewerRole(co, myUserID ?? "");
                  const analysisList = analyzeNegotiation(co, viewerRole);
                  const analysisOf = (k: string) => analysisList.find((a) => a.key === k)!;

                  return (
                    <tr key={co.id} className="hover:bg-t-hover transition-colors align-top">
                      {/* 序号 */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        {co.ref_serial_no != null ? (
                          <span className="font-mono text-xs font-medium text-t-text">
                            {formatBoardSerial(
                              co.ref_type === "listing" ? "L" : "S",
                              co.ref_serial_no,
                              co.ref_created_at,
                            )}
                          </span>
                        ) : (
                          <span className="text-xs text-t-text-3">-</span>
                        )}
                      </td>

                      {/* 品种 */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        {co.product_id && productNameMap[co.product_id] ? (
                          <span className="text-xs text-t-text">{productNameMap[co.product_id]}</span>
                        ) : (
                          <span className="text-xs text-t-text-3">-</span>
                        )}
                      </td>

                      {/* 类型 */}
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {co.ref_type === "swap" ? (
                            <>
                              {/* #695: 检测是否为双向换盘商谈（有配对记录则为双向，否则按单条 mode 显示） */}
                              {findPairedSwapCounterOffer(co, rows.filter((c: CounterOffer) => c.ref_type === "swap" && c.ref_id === co.ref_id)) ? (
                                <>
                                  <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-brand-600/15 text-brand-600">
                                    换
                                  </span>
                                  <span className="text-xs text-t-text-3">
                                    (双向)
                                  </span>
                                </>
                              ) : (
                                <>
                                  <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-brand-600/15 text-brand-600">
                                    换
                                  </span>
                                  <span className="text-xs text-t-text-3">
                                    ({co.mode === "buy" ? "买" : co.mode === "sell" ? "卖" : "双向"})
                                  </span>
                                </>
                              )}
                            </>
                          ) : co.ref_side === "BUY" ? (
                            <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-trade-up-bg text-trade-up-text">
                              买
                            </span>
                          ) : (
                            <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-trade-down-bg text-trade-down-text">
                              卖
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 时间 */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="text-xs text-t-text-3 font-mono">{formatDateTime(co.created_at)}</span>
                      </td>

                      {/* 各条款列：对方/己方对比 + 利弊提示 + 复选框（PENDING received 行） */}
                      {TERM_KEYS.map((k) => {
                        const a = analysisOf(k);
                        const changed = a.changed;
                        const refVal = displayVal(co, k, "ref");
                        const offerVal = displayVal(co, k, "offer");
                        const isPendingReceived = coSubTab === "received" && co.status === "PENDING";
                        const disputed = disputedTermKeys(co);
                        const isDisputedTerm = disputed.includes(k);
                        const checked = isPendingReceived && isDisputedTerm ? getSel(co).includes(k) : false;
                        return (
                          <td key={k} className="px-3 py-3 min-w-[120px]">
                            <div className="flex flex-col gap-0.5">
                              <span className={`text-xs ${changed ? "text-t-text" : "text-t-text-3"}`}>
                                {sideLabel(viewerRole, "ref")}：{refVal}
                              </span>
                              <span className={`text-xs ${changed ? "text-trade-up-text font-medium" : "text-t-text-3"}`}>
                                {sideLabel(viewerRole, "offer")}：{offerVal}
                              </span>
                              {changed && a.advantage !== "neutral" && (
                                <span
                                  className={`text-[10px] px-1 py-0.5 rounded inline-block w-fit ${
                                    a.advantage === "good"
                                      ? "bg-status-success-bg text-status-success"
                                      : "bg-status-error-bg text-status-error"
                                  }`}
                                  title={a.hint}
                                >
                                  {a.advantage === "good" ? "对您有利" : "对您不利"}
                                </span>
                              )}
                              {changed && a.advantage === "neutral" && (
                                <span
                                  className="text-[10px] px-1 py-0.5 rounded inline-block w-fit bg-t-hover text-t-text-2"
                                  title={a.hint}
                                >
                                  尚可
                                </span>
                              )}
                              {/* 复选框仅对「有异议」的条款显示；无异议条款自动沿用原盘、无需征求同意 */}
                              {isPendingReceived && isDisputedTerm && (
                                <label className="flex items-center gap-1 cursor-pointer group mt-0.5">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleTerm(co, k)}
                                    className="w-3.5 h-3.5 rounded border-t-border text-brand-500 focus:ring-brand-500 focus:ring-offset-0 cursor-pointer"
                                  />
                                  <span className="text-[10px] text-t-text-3 group-hover:text-t-text-2">同意</span>
                                </label>
                              )}
                            </div>
                          </td>
                        );
                      })}

                      {/* 状态 */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${coStatusColor(co.status)}`}>
                          {coStatusLabel(co.status)}
                        </span>
                        {co.cancel_reason && (
                          <div className="mt-1 text-[11px] text-t-text-3">
                            {cancelReasonLabel(co.cancel_reason)}
                          </div>
                        )}
                      </td>

                      {/* 操作 */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        {coSubTab === "received" && co.status === "PENDING" ? (
                          <div className="flex flex-col gap-2">
                            <div className="text-[11px] text-t-text-3">
                              {disputedTermKeys(co).length > 0
                                ? `已同意 ${getSel(co).length}/${disputedTermKeys(co).length} 项异议条款`
                                : "对方无异议，可直接成交"}
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => onAcceptReceived(co)}
                                disabled={acceptMutation.isPending}
                                className="text-xs px-2.5 py-1 rounded bg-status-success-bg text-status-success hover:opacity-80 transition-colors disabled:opacity-50"
                              >
                                接受
                              </button>
                              <button
                                onClick={async () => {
                                  if (!await confirmDialog({
                                    title: "拒绝商谈",
                                    message: "确认拒绝此商谈？",
                                    content: (
                                      <CounterOfferConfirmSheetFromCo
                                        co={co}
                                        productName={co.product_id ? productNameMap[co.product_id] : undefined}
                                        serialLabel={
                                          co.ref_serial_no
                                            ? formatBoardSerial(
                                                co.ref_type === "swap" ? "S" : "L",
                                                co.ref_serial_no,
                                                co.ref_created_at,
                                              )
                                            : undefined
                                        }
                                        intro="请核对以下商谈条款后确认拒绝。"
                                        outro="拒绝后对方将收到通知，此操作不可撤销。"
                                      />
                                    ),
                                    wide: true,
                                    variant: "danger",
                                    icon: "danger",
                                    confirmText: "拒绝",
                                  })) return;
                                  rejectMutation.mutate(co.id);
                                }}
                                disabled={rejectMutation.isPending}
                                className="text-xs px-2.5 py-1 rounded bg-status-error-bg text-status-error hover:opacity-80 transition-colors disabled:opacity-50"
                              >
                                拒绝
                              </button>
                            </div>
                          </div>
                        ) : coSubTab === "received" && co.status === "PARTIAL_ACCEPTED" ? (
                          <span className="text-xs text-t-text-3">已部分接受，等待对方确认</span>
                        ) : coSubTab === "sent" && co.status === "PENDING" ? (
                          <button
                            onClick={async () => {
                              if (!await confirmDialog({
                                title: "撤销商谈",
                                message: '确认撤销此商谈？撤销后对方将看到"已撤销"状态。',
                                content: (
                                  <CounterOfferConfirmSheetFromCo
                                    co={co}
                                    productName={co.product_id ? productNameMap[co.product_id] : undefined}
                                    serialLabel={
                                      co.ref_serial_no
                                        ? formatBoardSerial(
                                            co.ref_type === "swap" ? "S" : "L",
                                            co.ref_serial_no,
                                            co.ref_created_at,
                                          )
                                        : undefined
                                    }
                                    intro="请核对以下商谈条款后确认撤销。"
                                    outro={'撤销后对方将看到"已撤销"状态。'}
                                  />
                                ),
                                wide: true,
                                variant: "warning",
                                icon: "warning",
                                confirmText: "撤销",
                              })) return;
                              cancelMutation.mutate(co.id);
                            }}
                            disabled={cancelMutation.isPending}
                            className="text-xs px-2.5 py-1 rounded bg-t-hover text-t-text-2 hover:bg-t-active transition-colors"
                          >
                            撤销
                          </button>
                        ) : coSubTab === "sent" && co.status === "PARTIAL_ACCEPTED" ? (
                          <div className="flex flex-col gap-2">
                            <div className="flex flex-col gap-1">
                              <span className="text-[11px] text-t-text-3">对方已接受条款：</span>
                              <div className="flex flex-wrap gap-1">
                                {(co.accepted_terms ?? []).map((k) => (
                                  <span key={k} className="text-[11px] px-1.5 py-0.5 rounded bg-status-success-bg text-status-success">
                                    {TERM_LABELS[k] ?? k}
                                  </span>
                                ))}
                                {(co.accepted_terms ?? []).length === 0 && (
                                  <span className="text-[11px] text-t-text-3">全部条款</span>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={async () => {
                                  if (!await confirmDialog({
                                    title: "接受部分接受",
                                    message: "确认接受对方的部分接受？接受后即成交。",
                                    content: (
                                      <CounterOfferConfirmSheetFromCo
                                        co={co}
                                        productName={co.product_id ? productNameMap[co.product_id] : undefined}
                                        serialLabel={
                                          co.ref_serial_no
                                            ? formatBoardSerial(
                                                co.ref_type === "swap" ? "S" : "L",
                                                co.ref_serial_no,
                                                co.ref_created_at,
                                              )
                                            : undefined
                                        }
                                        acceptedTermsLabel={
                                          (co.accepted_terms ?? []).length > 0
                                            ? (co.accepted_terms ?? [])
                                                .map((k) => TERM_LABELS[k] ?? k)
                                                .join("、")
                                            : "全部条款"
                                        }
                                        intro="对方已部分接受，请核对条款后确认成交。"
                                        outro="接受后即成交，此操作不可撤销。"
                                      />
                                    ),
                                    wide: true,
                                    variant: "success",
                                    icon: "success",
                                    confirmText: "接受并成交",
                                  })) return;
                                  respondMutation.mutate({ id: co.id, action: "accept" });
                                }}
                                disabled={respondMutation.isPending}
                                className="text-xs px-2.5 py-1 rounded bg-status-success-bg text-status-success hover:opacity-80 transition-colors disabled:opacity-50"
                              >
                                接受并成交
                              </button>
                              <button
                                onClick={async () => {
                                  if (!await confirmDialog({
                                    title: "拒绝对方部分接受",
                                    message: "确认拒绝对方的部分接受？",
                                    content: (
                                      <CounterOfferConfirmSheetFromCo
                                        co={co}
                                        productName={co.product_id ? productNameMap[co.product_id] : undefined}
                                        serialLabel={
                                          co.ref_serial_no
                                            ? formatBoardSerial(
                                                co.ref_type === "swap" ? "S" : "L",
                                                co.ref_serial_no,
                                                co.ref_created_at,
                                              )
                                            : undefined
                                        }
                                        acceptedTermsLabel={
                                          (co.accepted_terms ?? []).length > 0
                                            ? (co.accepted_terms ?? [])
                                                .map((k) => TERM_LABELS[k] ?? k)
                                                .join("、")
                                            : "全部条款"
                                        }
                                        intro="请核对对方部分接受的条款后确认拒绝。"
                                        outro="拒绝后商谈将结束，此操作不可撤销。"
                                      />
                                    ),
                                    wide: true,
                                    variant: "danger",
                                    icon: "danger",
                                    confirmText: "拒绝",
                                  })) return;
                                  respondMutation.mutate({ id: co.id, action: "reject" });
                                }}
                                disabled={respondMutation.isPending}
                                className="text-xs px-2.5 py-1 rounded bg-status-error-bg text-status-error hover:opacity-80 transition-colors disabled:opacity-50"
                              >
                                拒绝
                              </button>
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-t-text-3">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <Pager page={clampedPage} totalPages={totalPages} onChange={setPage} />
          )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-t-text-3">
            暂无{coSubTab === "received" ? "收到的" : "发出的"}商谈
          </div>
        )}
      </div>
      </div>
    </main>
  );
}

export default function CounterOffersPage() {
  return (
    <Suspense fallback={<main className="w-full px-4 py-12 text-center text-t-text-3">加载中...</main>}>
      <CounterOffersPageContent />
    </Suspense>
  );
}
