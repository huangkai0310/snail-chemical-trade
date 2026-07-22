"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/auth-store";
import {
  fetchReceivedCounterOffers,
  fetchSentCounterOffers,
  acceptCounterOffer,
  rejectCounterOffer,
  cancelCounterOffer,
  respondCounterOffer,
  ApiError,
} from "@/lib/api";
import type { CounterOffer } from "@/lib/types";
import {
  getViewerRole,
  analyzeNegotiation,
  summarizeNegotiation,
  TERM_LABELS,
  type Advantage,
} from "@/lib/negotiation";
import { toast } from "@/components/Toast";
import { confirmDialog } from "@/components/ConfirmDialog";
import { CounterOfferConfirmSheetFromCo } from "@/components/PostingConfirmSheet";
import { formatBoardSerial } from "@/lib/format";

interface Props {
  open: boolean;
  onClose: () => void;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${m}-${day} ${h}:${min}`;
}

function statusLabel(status: string): string {
  switch (status) {
    case "PENDING":   return "待处理";
    case "PARTIAL_ACCEPTED": return "部分接受";
    case "ACCEPTED":  return "已接受";
    case "REJECTED":  return "已拒绝";
    case "EXPIRED":   return "已失效";
    case "CANCELLED": return "已撤销";
    default: return status;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "PENDING":   return "text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-400";
    case "PARTIAL_ACCEPTED": return "text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-400";
    case "ACCEPTED":  return "text-green-600 bg-green-50 dark:bg-green-500/10 dark:text-green-400";
    case "REJECTED":  return "text-red-500 bg-red-50 dark:bg-red-500/10 dark:text-red-400";
    case "EXPIRED":   return "text-gray-500 bg-gray-100 dark:bg-t-hover dark:text-t-text-2";
    case "CANCELLED": return "text-gray-400 bg-gray-100 dark:bg-t-hover dark:text-t-text-2";
    default: return "text-gray-500 bg-gray-50 dark:bg-t-hover dark:text-t-text-2";
  }
}

function advantageChip(a: Advantage): { cls: string; text: string } {
  if (a === "good") return { cls: "bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400", text: "对您有利" };
  if (a === "bad") return { cls: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400", text: "对您不利" };
  return { cls: "bg-gray-100 text-gray-500 dark:bg-t-hover dark:text-t-text-2", text: "尚可" };
}

type FilterStatus = "all" | "PENDING" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "CANCELLED";
type SubTab = "received" | "sent";

export default function CounterOfferListModal({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const myUserID = user?.id;
  const [subTab, setSubTab] = useState<SubTab>("received");
  const [filter, setFilter] = useState<FilterStatus>("PENDING");

  // 收到的商谈
  const receivedQuery = useQuery({
    queryKey: ["received-counter-offers", filter],
    queryFn: () =>
      fetchReceivedCounterOffers(1, 100, filter === "all" ? undefined : filter).then(
        (r) => r.data
      ),
    enabled: open && subTab === "received",
  });

  // 发出的商谈
  const sentQuery = useQuery({
    queryKey: ["sent-counter-offers", filter],
    queryFn: () =>
      fetchSentCounterOffers(1, 100, filter === "all" ? undefined : filter).then(
        (r) => r.data
      ),
    enabled: open && subTab === "sent",
  });

  const acceptMutation = useMutation({
    mutationFn: (id: string) => acceptCounterOffer(id),
    onSuccess: () => {
      toast("商谈已接受，成交完成！", "success");
      queryClient.invalidateQueries({ queryKey: ["received-counter-offers"] });
      queryClient.invalidateQueries({ queryKey: ["my-listings"] });
      queryClient.invalidateQueries({ queryKey: ["my-trades"] });
    },
    onError: (e: ApiError) => toast(e.message || "接受商谈失败", "error"),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => rejectCounterOffer(id, "不予接受"),
    onSuccess: () => {
      toast("已拒绝商谈", "success");
      queryClient.invalidateQueries({ queryKey: ["received-counter-offers"] });
    },
    onError: (e: ApiError) => toast(e.message || "拒绝商谈失败", "error"),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelCounterOffer(id),
    onSuccess: () => {
      toast("商谈已撤销", "success");
      queryClient.invalidateQueries({ queryKey: ["sent-counter-offers"] });
      queryClient.invalidateQueries({ queryKey: ["counterOffers"] });
    },
    onError: (e: ApiError) => toast(e.message || "撤销商谈失败", "error"),
  });

  const respondMutation = useMutation({
    mutationFn: (p: { id: string; action: "accept" | "reject" }) => respondCounterOffer(p.id, p.action),
    onSuccess: (data) => {
      toast(data.message || "已处理", "success");
      queryClient.invalidateQueries({ queryKey: ["sent-counter-offers"] });
      queryClient.invalidateQueries({ queryKey: ["my-trades"] });
    },
    onError: (e: ApiError) => toast(e.message || "操作失败", "error"),
  });

  if (!open) return null;

  const items =
    subTab === "received"
      ? receivedQuery.data ?? []
      : sentQuery.data ?? [];
  const isLoading = subTab === "received" ? receivedQuery.isLoading : sentQuery.isLoading;

  const filterOptions: FilterStatus[] = [
    "PENDING",
    "ACCEPTED",
    "REJECTED",
    "EXPIRED",
    "CANCELLED",
    "all",
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white dark:bg-t-panel rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-t-border">
          <h2 className="text-lg font-bold text-gray-800 dark:text-t-text">商谈管理</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-t-text text-xl leading-none p-1"
          >
            ✕
          </button>
        </div>

        {/* Sub-tab: 收到 / 发出 */}
        <div className="flex gap-4 px-6 pt-3 border-b border-gray-50 dark:border-t-border">
          <button
            onClick={() => {
              setSubTab("received");
              setFilter("PENDING");
            }}
            className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
              subTab === "received"
                ? "border-brand-600 text-brand-600 dark:text-brand-400"
                : "border-transparent text-gray-500 dark:text-t-text-2 hover:text-gray-700 dark:hover:text-t-text"
            }`}
          >
            收到的商谈（我是发牌方）
          </button>
          <button
            onClick={() => {
              setSubTab("sent");
              setFilter("PENDING");
            }}
            className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
              subTab === "sent"
                ? "border-brand-600 text-brand-600 dark:text-brand-400"
                : "border-transparent text-gray-500 dark:text-t-text-2 hover:text-gray-700 dark:hover:text-t-text"
            }`}
          >
            发出的商谈（我是议价方）
          </button>
        </div>

        {/* Filter */}
        <div className="flex gap-2 px-6 py-3 border-b border-gray-50 dark:border-t-border">
          {filterOptions.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                filter === s
                  ? "bg-brand-600 text-white"
                  : "bg-gray-100 dark:bg-t-hover text-gray-500 dark:text-t-text-2 hover:bg-gray-200 dark:hover:bg-t-hover/80"
              }`}
            >
              {s === "all" ? "全部" : statusLabel(s)}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="text-center text-gray-400 dark:text-t-text-2 py-8">加载中...</div>
          ) : items.length === 0 ? (
            <div className="text-center text-gray-400 dark:text-t-text-2 py-8">
              {subTab === "received" ? "暂无收到的商谈" : "暂无发出的商谈"}
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((co: CounterOffer) => {
                const viewerRole = getViewerRole(co, myUserID ?? "");
                const analysis = analyzeNegotiation(co, viewerRole);
                const summary = summarizeNegotiation(co, viewerRole);
                return (
                  <div
                    key={co.id}
                    className={`border rounded-lg p-4 ${
                      co.status === "PENDING"
                        ? "border-amber-200 bg-amber-50/30 dark:bg-amber-500/5 dark:border-amber-500/30"
                        : "border-gray-200 dark:border-t-border"
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                            co.ref_type === "swap"
                              ? "bg-purple-50 text-purple-600 dark:bg-purple-500/10 dark:text-purple-400"
                              : co.ref_side === "BUY"
                              ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"
                              : "bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400"
                          }`}
                        >
                          {co.ref_type === "swap"
                            ? "换"
                            : co.ref_side === "BUY"
                            ? "买"
                            : "卖"}
                        </span>
                        {co.ref_type === "swap" && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-t-hover text-gray-500 dark:text-t-text-2">
                            {co.mode === "buy" ? "买" : co.mode === "sell" ? "卖" : "双向"}
                          </span>
                        )}
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded font-medium ${statusColor(co.status)}`}
                        >
                          {statusLabel(co.status)}
                        </span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-brand-50 dark:bg-brand-500/10 text-brand-600 dark:text-brand-400 font-medium">
                          您是{co.ref_type === "swap" ? "换盘" : ""}
                          {viewerRole === "maker" ? "发牌方" : "议价方"}
                        </span>
                      </div>
                      <span className="text-xs text-gray-400 dark:text-t-text-2">
                        {formatDateTime(co.created_at)}
                      </span>
                    </div>

                    {/* 逐条款对比：发牌方 vs 议价方 */}
                    <div className="space-y-2 text-sm">
                      {analysis
                        .filter((t) => t.offered)
                        .map((t) => {
                          const chip = t.changed ? advantageChip(t.advantage) : null;
                          return (
                            <div key={t.key} className="rounded-md border border-gray-100 dark:border-t-border p-2">
                              <div className="flex items-center justify-between">
                                <span className="text-gray-500 dark:text-t-text-2">{t.label}</span>
                                {chip && (
                                  <span
                                    className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${chip.cls}`}
                                    title={t.hint}
                                  >
                                    {chip.text}
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 grid grid-cols-2 gap-2">
                                <div className="flex justify-between bg-gray-50 dark:bg-t-hover rounded px-2 py-1">
                                  <span className="text-gray-400 dark:text-t-text-2 text-xs">发牌方</span>
                                  <span className="font-mono text-gray-700 dark:text-t-text">{t.ref}</span>
                                </div>
                                <div className="flex justify-between bg-amber-50 dark:bg-amber-500/10 rounded px-2 py-1">
                                  <span className="text-gray-400 dark:text-t-text-2 text-xs">议价方</span>
                                  <span className="font-mono text-gray-800 dark:text-t-text font-medium">
                                    {t.offer}
                                  </span>
                                </div>
                              </div>
                              {t.changed && t.hint && (
                                <div className="mt-1 text-[11px] text-gray-400 dark:text-t-text-2">{t.hint}</div>
                              )}
                            </div>
                          );
                        })}
                    </div>

                    {/* 商谈分析（优势/劣势提示） */}
                    <div className="mt-2 rounded-md bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                      {summary}
                    </div>

                    {/* 发牌方余量 / 商谈金额 */}
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-t-text-2">
                      <div className="flex justify-between">
                        <span>发牌方余量</span>
                        <span className="font-mono text-gray-700 dark:text-t-text">
                          {co.ref_quantity != null && co.ref_filled != null
                            ? `${(co.ref_quantity - co.ref_filled).toLocaleString()} 吨`
                            : "-"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>商谈金额</span>
                        <span className="font-mono text-gray-700 dark:text-t-text">
                          ¥{(co.offer_price * co.offer_quantity).toLocaleString()}
                        </span>
                      </div>
                    </div>

                    {/* 收到的商谈：PENDING 状态显示接受/拒绝按钮 */}
                    {subTab === "received" && co.status === "PENDING" && (
                      <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-t-border">
                        <button
                          onClick={async () => {
                            if (!await confirmDialog({
                              title: "接受商谈",
                              message: "确认接受此商谈？接受后立即成交。",
                              content: (
                                <CounterOfferConfirmSheetFromCo
                                  co={co}
                                  serialLabel={
                                    co.ref_serial_no
                                      ? formatBoardSerial(
                                          co.ref_type === "swap" ? "S" : "L",
                                          co.ref_serial_no,
                                          co.ref_created_at,
                                        )
                                      : undefined
                                  }
                                  intro="请核对以下商谈条款，接受后将立即成交。"
                                  outro="接受后立即成交，此操作不可撤销。"
                                />
                              ),
                              wide: true,
                              variant: "success",
                              icon: "success",
                              confirmText: "接受并成交",
                            })) return;
                            acceptMutation.mutate(co.id);
                          }}
                          disabled={acceptMutation.isPending}
                          className="flex-1 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          接受并成交
                        </button>
                        <button
                          onClick={async () => {
                            if (!await confirmDialog({
                              title: "拒绝商谈",
                              message: "确认拒绝此商谈？",
                              content: (
                                <CounterOfferConfirmSheetFromCo
                                  co={co}
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
                          className="flex-1 py-2 border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50 text-sm font-medium rounded-lg transition-colors"
                        >
                          拒绝
                        </button>
                      </div>
                    )}

                    {/* 收到的商谈：已部分接受，等待议价方确认 */}
                    {subTab === "received" && co.status === "PARTIAL_ACCEPTED" && (
                      <div className="mt-3 pt-3 border-t border-gray-100 dark:border-t-border text-xs text-amber-600 dark:text-amber-400">
                        已部分接受，等待议价方确认成交
                      </div>
                    )}

                    {/* 发出的商谈：PENDING 状态显示撤销按钮 */}
                    {subTab === "sent" && co.status === "PENDING" && (
                      <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-t-border">
                        <button
                          onClick={async () => {
                            if (!await confirmDialog({
                              title: "撤销商谈",
                              message: '确认撤销此商谈？撤销后发牌方将看到"已撤销"状态。',
                              content: (
                                <CounterOfferConfirmSheetFromCo
                                  co={co}
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
                                  outro={'撤销后发牌方将看到"已撤销"状态。'}
                                />
                              ),
                              wide: true,
                              variant: "warning",
                              icon: "warning",
                              confirmText: "撤销商谈",
                            }))
                              return;
                            cancelMutation.mutate(co.id);
                          }}
                          disabled={cancelMutation.isPending}
                          className="flex-1 py-2 border border-gray-300 dark:border-t-border text-gray-600 dark:text-t-text-2 hover:bg-gray-50 dark:hover:bg-t-hover disabled:opacity-50 text-sm font-medium rounded-lg transition-colors"
                        >
                          撤销商谈
                        </button>
                      </div>
                    )}

                    {/* 发出的商谈：发牌方部分接受，需我方二次确认 */}
                    {subTab === "sent" && co.status === "PARTIAL_ACCEPTED" && (
                      <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-t-border">
                        <button
                          onClick={async () => {
                            if (!await confirmDialog({
                              title: "接受部分接受",
                              message: "确认接受发牌方的部分接受？接受后即成交。",
                              content: (
                                <CounterOfferConfirmSheetFromCo
                                  co={co}
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
                                  intro="发牌方已部分接受，请核对条款后确认成交。"
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
                          className="flex-1 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          接受并成交
                        </button>
                        <button
                          onClick={async () => {
                            if (!await confirmDialog({
                              title: "拒绝对方部分接受",
                              message: "确认拒绝对发牌方的部分接受？",
                              content: (
                                <CounterOfferConfirmSheetFromCo
                                  co={co}
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
                                  intro="请核对发牌方部分接受的条款后确认拒绝。"
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
                          className="flex-1 py-2 border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50 text-sm font-medium rounded-lg transition-colors"
                        >
                          拒绝
                        </button>
                      </div>
                    )}

                    {co.status === "REJECTED" && co.rejected_reason && (
                      <div className="mt-2 text-xs text-gray-400 dark:text-t-text-2">
                        拒绝原因：{co.rejected_reason}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
