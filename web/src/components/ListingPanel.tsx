"use client";

import { useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchListingsPaged, fetchSwaps, cancelListing, cancelSwap, cancelCounterOffer, cancelSwapLock, type SwapMatchLock } from "@/lib/api";
import type { Listing, SwapListing, CounterOffer, Product } from "@/lib/types";
import {
  getSwapLockState,
  SWAP_LOCK_BUY_TOOLTIP,
  SWAP_LOCK_SELL_TOOLTIP,
  swapStatusTooltip,
  swapStatusLabel,
  swapLockBuyDisabledReason,
  swapLockSellDisabledReason,
  swapBothDisabledReason,
  swapFlashDisabledReason,
} from "@/lib/swap-lock";
import { formatListingStatus } from "@/lib/listing-status";
import { entityChanged, findListingInLists, findSwapInList, isListingWithdrawn, isSwapWithdrawn, wasListingActive, wasSwapActive } from "@/lib/query-cache-helpers";
import { describeEntityUpdate, hasEditorialEntityUpdate } from "@/lib/entity-change-summary";
import { suppressOwnListingToast } from "@/lib/listing-toast-suppress";
import { toast } from "./Toast";
import { confirmDialog } from "./ConfirmDialog";
import {
  ListingBoardConfirmSheet,
  SwapBoardConfirmSheet,
  UnlockConfirmSheet,
} from "./PostingConfirmSheet";
import { Tooltip } from "./ui/Tooltip";
import ListingDetailModal from "./ListingDetailModal";
import { formatBoardSerial } from "@/lib/format";
import { formatExpiresAt, formatExpiresAtBadge, formatStartsAt, isExpiringSoon } from "@/lib/expires";

// ============ Excel 风格表头筛选辅助组件 ============

/** 表头下拉箭头按钮 */
function FilterArrow({
  colKey,
  openFilterCol,
  setOpenFilterCol,
  active,
}: {
  colKey: string;
  openFilterCol: string | null;
  setOpenFilterCol: (v: string | null) => void;
  active: boolean;
}) {
  const isOpen = openFilterCol === colKey;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setOpenFilterCol(isOpen ? null : colKey);
      }}
      className={`inline-flex items-center justify-center w-3.5 h-3.5 ml-0.5 rounded-sm transition-colors ${
        active
          ? "text-brand-600 dark:text-brand-400"
          : isOpen
            ? "text-t-text"
            : "text-t-text-3 hover:text-t-text"
      }`}
      title="筛选"
    >
      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );
}

/** 筛选下拉容器（含遮罩点击关闭） */
function FilterDropdown({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="absolute top-full left-1/2 -translate-x-1/2 mt-0.5 z-50 min-w-[140px] max-w-[200px] rounded-lg shadow-dropdown border overflow-hidden px-2.5 py-2"
        style={{ backgroundColor: "var(--bg-secondary)", borderColor: "var(--border-color)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>
  );
}

/** 多选 checkbox 列表 */
function MultiCheckList({
  options,
  selected,
  onToggle,
}: {
  options: string[] | { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  const normalized = options.map((o) =>
    typeof o === "string" ? { value: o, label: o } : o
  );
  if (normalized.length === 0) {
    return <div className="text-[10px] text-t-text-3 py-1 text-center">暂无数据</div>;
  }
  return (
    <div className="max-h-[200px] overflow-y-auto space-y-0.5">
      {normalized.map((opt) => {
        const checked = selected.includes(opt.value);
        return (
          <label
            key={opt.value}
            className="flex items-center gap-1.5 px-1 py-0.5 text-[11px] hover:bg-t-hover cursor-pointer whitespace-nowrap rounded"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(opt.value);
            }}
          >
            <span
              className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                checked ? "bg-t-accent border-t-accent" : "border-t-text-3"
              }`}
            >
              {checked && (
                <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </span>
            <span className="text-t-text">{opt.label}</span>
          </label>
        );
      })}
    </div>
  );
}

interface Props {
  productId: string;
  products?: { id: string; name: string }[];
  unit?: string;
  canTrade?: boolean;
  currentUserId?: string;
  onTake?: (listing: Listing) => void;
  onTakeSwap?: (swap: SwapListing, mode: "sell" | "buy" | "both", flashMatch?: boolean) => void;
  /** 对普通挂牌发起商谈 */
  onCounterOffer?: (listing: Listing) => void;
  /** 当前用户发出的 PENDING 商谈列表（按 ref_id 索引），用于显示「商谈中」按钮 */
  pendingCounterOffers?: CounterOffer[];
  /** 当前用户的单边锁定记录 */
  mySwapLocks?: SwapMatchLock[];
  /** 点击「商谈中」按钮时触发（编辑已有商谈） */
  onEditCounterOffer?: (listing: Listing, co: CounterOffer) => void;
  /** 编辑自己的挂牌 */
  onEditListing?: (listing: Listing) => void;
  /** 编辑自己的换盘 */
  onEditSwap?: (swap: SwapListing) => void;
  /** 对换盘发起商谈（按方向） */
  onCounterOfferSwap?: (swap: SwapListing, mode: "sell" | "buy" | "both") => void;
  /** 点击换盘的「编辑商谈」按钮时触发 */
  onEditCounterOfferSwap?: (swap: SwapListing, co: CounterOffer) => void;
  defaultDeliveryPeriod?: string;
  /** 现货/远期纸货过滤："all" | "spot" | "forward" */
  marketType?: "all" | "spot" | "forward";
  /** 交割期筛选变更回调（同步盘口面板） */
  onDeliveryPeriodChange?: (deliveryPeriod: string) => void;
  /** 收起挂盘列表回调 */
  onCollapse?: () => void;
  /** 详情弹窗打开/关闭通知（用于父组件判断操作弹窗是否需要"返回详情"按钮） */
  onDetailOpenChange?: (open: boolean) => void;
  /** 子操作弹窗打开时暂时隐藏详情弹窗 */
  detailHidden?: boolean;
  /** 递增：子弹窗点「返回」时恢复显示详情 */
  detailRestoreToken?: number;
  /** 递增：子弹窗关闭/操作成功时彻底关掉详情（不回到上一级） */
  detailDismissToken?: number;
}

function fmtDateTime(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${dd} ${hh}:${mm}:${ss}`;
}

/** 状态旁时间标记（仅自己盘子：过期 / 待发布开始时间） */
function StatusExpireCorner({
  children,
  expiresAt,
  startsAt,
  showExpire,
  showStart,
}: {
  children: ReactNode;
  expiresAt?: string | null;
  startsAt?: string | null;
  showExpire: boolean;
  showStart?: boolean;
}) {
  const soon = showExpire && expiresAt ? isExpiringSoon(expiresAt) : false;
  const expireBadge = showExpire && expiresAt ? formatExpiresAtBadge(expiresAt) : "";
  const startLabel = showStart && startsAt ? formatStartsAt(startsAt) : "";
  if (!expireBadge && !startLabel) return <>{children}</>;
  return (
    <span className="inline-flex flex-col items-center gap-0.5">
      {children}
      {startLabel && (
        <span
          className="text-[9px] leading-none font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap bg-sky-500 text-white"
          title={`开始 ${formatStartsAt(startsAt)}`}
        >
          {startLabel}发布
        </span>
      )}
      {expireBadge && (
        <span
          className={`text-[9px] leading-none font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${
            soon ? "bg-status-error text-white" : "bg-amber-500 text-white"
          }`}
          title={`${formatExpiresAt(expiresAt)}到期（${fmtDateTime(expiresAt!)}）`}
          >
          {expireBadge}
        </span>
      )}
    </span>
  );
}

function FillBar({ filled, total, color, status }: { filled: number; total: number; color: string; status?: string }) {
  const safeTotal = total > 0 ? total : 0;
  const safeFilled = Math.max(0, Math.min(filled, safeTotal));
  const remain = safeTotal - safeFilled;
  const remainPct = safeTotal > 0 ? Math.min(100, (remain / safeTotal) * 100) : 0;
  const isFullyDone = status === "FILLED" || status === "MATCHED";

  // 全部成交 → 白色实心条
  if (isFullyDone && remain <= 0) {
    return (
      <div className="w-full h-1.5 rounded overflow-hidden bg-white border border-t-border/30" />
    );
  }

  // 余量用鲜艳色，已成交量用白色
  return (
    <div className="w-full h-1.5 rounded overflow-hidden flex bg-white border border-t-border/20">
      {remainPct < 100 && (
        <div className="h-full bg-white shrink-0" style={{ width: `${100 - remainPct}%` }} />
      )}
      {remainPct > 0 && (
        <div className={`h-full shrink-0 ${color}`} style={{ width: `${remainPct}%` }} />
      )}
    </div>
  );
}

function fmtDeliveryPeriod(period?: string | null): string {
  if (!period || period.trim() === "") return "现货";
  return period;
}

const STATUS_CLS: Record<string, string> = {
  OPEN:      "text-status-info bg-status-info-bg",
  PARTIAL:   "text-status-info bg-status-info-bg",
  FILLED:    "text-t-text-3 bg-t-tertiary",
  CANCELLED: "text-status-error bg-status-error-bg",
  EXPIRED:   "text-status-warning bg-status-warning-bg",
  SCHEDULED: "text-sky-700 bg-sky-500/15 dark:text-sky-300",
};

function isTradeDisabled(status?: string): boolean {
  return status === "FILLED" || status === "CANCELLED" || status === "EXPIRED" || status === "SCHEDULED";
}

export default function ListingPanel({
  productId,
  products = [],
  unit = "吨",
  canTrade = false,
  currentUserId,
  onTake,
  onTakeSwap,
  onCounterOffer,
  pendingCounterOffers,
  mySwapLocks,
  onEditCounterOffer,
  onEditListing,
  onEditSwap,
  onCounterOfferSwap,
  onEditCounterOfferSwap,
  defaultDeliveryPeriod,
  marketType = "all",
  onCollapse,
  onDetailOpenChange,
  detailHidden,
  detailRestoreToken = 0,
  detailDismissToken = 0,
}: Props) {
  const [page, setPage] = useState(1);
  const [deliveryPeriods, setDeliveryPeriods] = useState<string[]>(defaultDeliveryPeriod ? [defaultDeliveryPeriod] : []);
  const [filterTab, setFilterTab] = useState<"buy" | "sell" | "swap">("buy");
  const [swapMenuOpenId, setSwapMenuOpenId] = useState<string | null>(null);
  /** 我要换下拉：fixed 定位，避免表格 overflow 裁切「锁定·卖」等项 */
  const [swapMenuPos, setSwapMenuPos] = useState<{ top: number; left: number; openUp: boolean } | null>(null);
  const [serialNoSearch, setSerialNoSearch] = useState<string>(""); // 发盘号搜索

  // 双击查看详情弹窗状态（数据可保留以便「返回」恢复；是否可见由 detailSuppressed 控制）
  const [detailListing, setDetailListing] = useState<Listing | null>(null);
  const [detailSwap, setDetailSwap] = useState<SwapListing | null>(null);
  /** true=详情不渲染；下级打开 / dismiss 时为 true；仅 restore 时置回 false */
  const [detailSuppressed, setDetailSuppressed] = useState(false);
  const detailOpen = !!detailListing || !!detailSwap;
  useEffect(() => { onDetailOpenChange?.(detailOpen); }, [detailOpen, onDetailOpenChange]);

  // 下级打开：立刻隐藏详情（保持数据，供返回）
  // 下级全部关闭且无待恢复详情时：解除压制，避免「发盘/换盘」后双击永久打不开
  useEffect(() => {
    if (detailHidden) {
      setDetailSuppressed(true);
      return;
    }
    setDetailSuppressed((prev) => {
      if (!detailListing && !detailSwap) return false;
      return prev;
    });
  }, [detailHidden, detailListing, detailSwap]);

  // 子弹窗点「返回」：恢复显示详情
  useEffect(() => {
    if (!detailRestoreToken) return;
    setDetailSuppressed(false);
  }, [detailRestoreToken]);

  /** 从详情点进下级时先本地隐藏详情，再调用外部回调 */
  const withDetailSuppressed = useCallback(
    <A extends unknown[]>(fn?: (...args: A) => void) => {
      if (!fn) return undefined;
      return (...args: A) => {
        setDetailSuppressed(true);
        fn(...args);
      };
    },
    []
  );

  // Excel 风格表头多选筛选状态（每列支持多选）
  const [headerFilters, setHeaderFilters] = useState<{
    priceMin?: string;
    priceMax?: string;
    qtyMin?: string;
    qtyMax?: string;
    deliveryLocation?: string;
    deliveryPeriods?: string[];
    paymentMethods?: string[];
    deliveryMethods?: string[];
    statuses?: string[];
    // 新增5列筛选
    freeStorage?: string[];       // 免仓期：不免仓 / 免仓N天
    specs?: string[];             // 规格：从数据去重
    allowPartial?: string[];      // 数量方式：按份数 / 整单
    minQtyMin?: string;           // 最小量范围-下限
    minQtyMax?: string;           // 最小量范围-上限
    allowCounterOffer?: string[]; // 是否可商谈：可商谈 / 不可商谈
  }>({});

  // 是否进入 Excel 筛选模式（表头出现下拉箭头）
  const [excelFilterMode, setExcelFilterMode] = useState(false);
  // 当前展开的列筛选下拉
  const [openFilterCol, setOpenFilterCol] = useState<string | null>(null);

  const updateMultiFilter = (key: "deliveryPeriods" | "paymentMethods" | "deliveryMethods" | "statuses" | "freeStorage" | "specs" | "allowPartial" | "allowCounterOffer", value: string) => {
    setHeaderFilters((prev) => {
      const arr = prev[key] ?? [];
      const next = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
      return { ...prev, [key]: next.length > 0 ? next : undefined };
    });
    setPage(1);
  };

  const updateRangeFilter = (key: "priceMin" | "priceMax" | "qtyMin" | "qtyMax" | "deliveryLocation" | "minQtyMin" | "minQtyMax", value: string) => {
    setHeaderFilters((prev) => ({ ...prev, [key]: value || undefined }));
    setPage(1);
  };

  const clearFilters = () => {
    setHeaderFilters({});
    setPage(1);
  };

  // 应用表头筛选（支持多选）
  const applyHeaderFilters = (listings: Listing[]): Listing[] => {
    return listings.filter((l) => {
      if (headerFilters.priceMin && l.price < parseFloat(headerFilters.priceMin)) return false;
      if (headerFilters.priceMax && l.price > parseFloat(headerFilters.priceMax)) return false;
      if (headerFilters.qtyMin && l.quantity < parseFloat(headerFilters.qtyMin)) return false;
      if (headerFilters.qtyMax && l.quantity > parseFloat(headerFilters.qtyMax)) return false;
      if (headerFilters.deliveryLocation) {
        const dl = (l.delivery_location || "").toLowerCase();
        if (!dl.includes(headerFilters.deliveryLocation.toLowerCase())) return false;
      }
      if (headerFilters.deliveryPeriods && headerFilters.deliveryPeriods.length > 0) {
        const dp = l.delivery_period || "现货";
        if (!headerFilters.deliveryPeriods.includes(dp)) return false;
      }
      if (headerFilters.paymentMethods && headerFilters.paymentMethods.length > 0) {
        if (!headerFilters.paymentMethods.includes(l.payment_method || "未设置")) return false;
      }
      if (headerFilters.deliveryMethods && headerFilters.deliveryMethods.length > 0) {
        if (!headerFilters.deliveryMethods.includes(l.delivery_method || "未设置")) return false;
      }
      if (headerFilters.statuses && headerFilters.statuses.length > 0) {
        // "商谈中" 是虚拟状态：当当前用户对该挂牌有 PENDING 商谈时匹配
        const selected = headerFilters.statuses;
        const hasNegotiating = selected.includes("商谈中");
        const realStatuses = selected.filter((s) => s !== "商谈中");
        const myPendingCO = pendingCounterOffers?.find(co => co.ref_type === "listing" && co.ref_id === l.id);
        if (myPendingCO) {
          // 该挂牌处于商谈中状态
          if (!hasNegotiating) return false; // 没选"商谈中"则排除
        } else {
          // 非商谈中状态，按实际 status 匹配
          if (realStatuses.length === 0) return false; // 只选了"商谈中"则排除非商谈中
          if (!realStatuses.includes(l.status || "")) return false;
        }
      }
      // 免仓期筛选
      if (headerFilters.freeStorage && headerFilters.freeStorage.length > 0) {
        const fsLabel = l.free_storage_enabled === false
          ? "不免仓"
          : l.free_storage_days && l.free_storage_days > 0
            ? `免仓${l.free_storage_days}天`
            : "未设置";
        if (!headerFilters.freeStorage.includes(fsLabel)) return false;
      }
      // 规格筛选
      if (headerFilters.specs && headerFilters.specs.length > 0) {
        const specVal = (typeof l.specs === "string" && l.specs) ? l.specs : "无";
        if (!headerFilters.specs.includes(specVal)) return false;
      }
      // 数量方式筛选
      if (headerFilters.allowPartial && headerFilters.allowPartial.length > 0) {
        const apLabel = l.allow_partial !== false ? "按份数" : "整单";
        if (!headerFilters.allowPartial.includes(apLabel)) return false;
      }
      // 最小量范围筛选
      if (headerFilters.minQtyMin || headerFilters.minQtyMax) {
        const minQty = l.allow_partial !== false
          ? (l.min_quantity && l.min_quantity > 0 ? l.min_quantity : l.quantity)
          : l.quantity;
        if (headerFilters.minQtyMin && minQty < parseFloat(headerFilters.minQtyMin)) return false;
        if (headerFilters.minQtyMax && minQty > parseFloat(headerFilters.minQtyMax)) return false;
      }
      // 是否可商谈筛选
      if (headerFilters.allowCounterOffer && headerFilters.allowCounterOffer.length > 0) {
        const acoLabel = l.allow_counter_offer !== false ? "可商谈" : "不可商谈";
        if (!headerFilters.allowCounterOffer.includes(acoLabel)) return false;
      }
      return true;
    });
  };

  // 统计活跃筛选条件数
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (headerFilters.priceMin) count++;
    if (headerFilters.priceMax) count++;
    if (headerFilters.qtyMin) count++;
    if (headerFilters.qtyMax) count++;
    if (headerFilters.deliveryLocation) count++;
    if (headerFilters.deliveryPeriods?.length) count++;
    if (headerFilters.paymentMethods?.length) count++;
    if (headerFilters.deliveryMethods?.length) count++;
    if (headerFilters.statuses?.length) count++;
    if (headerFilters.freeStorage?.length) count++;
    if (headerFilters.specs?.length) count++;
    if (headerFilters.allowPartial?.length) count++;
    if (headerFilters.minQtyMin) count++;
    if (headerFilters.minQtyMax) count++;
    if (headerFilters.allowCounterOffer?.length) count++;
    return count;
  }, [headerFilters]);

  const hasActiveFilters = activeFilterCount > 0;

  // 同步外部 defaultDeliveryPeriod（来自自选 品种+交割期）
  useEffect(() => {
    if (defaultDeliveryPeriod !== undefined) {
      setDeliveryPeriods(defaultDeliveryPeriod ? [defaultDeliveryPeriod] : []);
    } else {
      setDeliveryPeriods([]);
    }
    setPage(1);
  }, [defaultDeliveryPeriod]);

  // 自选切换产品时重置分页
  useEffect(() => {
    setPage(1);
  }, [productId]);

  const pageSize = 20;

  // #304：解析序号搜索值
  // 格式：L260719-42 / S260719-42（新）/ L000123（旧）/ 纯数字
  const parsedSerialNo = useMemo(() => {
    const trimmed = serialNoSearch.trim().toUpperCase();
    if (!trimmed) return { serialNo: 0, isSwap: false };
    const dated = trimmed.match(/^([LS])(\d{6})-0*(\d+)$/);
    if (dated) {
      return { serialNo: parseInt(dated[3], 10), isSwap: dated[1] === "S" };
    }
    const lMatch = trimmed.match(/^L0*(\d+)$/);
    if (lMatch) return { serialNo: parseInt(lMatch[1], 10), isSwap: false };
    const sMatch = trimmed.match(/^S0*(\d+)$/);
    if (sMatch) return { serialNo: parseInt(sMatch[1], 10), isSwap: true };
    const numMatch = trimmed.match(/^(\d+)$/);
    if (numMatch) return { serialNo: parseInt(numMatch[1], 10), isSwap: filterTab === "swap" };
    return { serialNo: 0, isSwap: false };
  }, [serialNoSearch, filterTab]);

  // 多选交割期：传给 API 的值（空数组=不筛选，单选=传该值，多选=不传，客户端过滤）
  const apiDeliveryPeriod = deliveryPeriods.length === 1 ? deliveryPeriods[0] : undefined;

  const buyQuery = useQuery({
    queryKey: ["listingsFiltered", productId, "BUY", page, pageSize, deliveryPeriods, parsedSerialNo.serialNo],
    queryFn: () =>
      fetchListingsPaged({
        productId: parsedSerialNo.serialNo > 0 ? "" : productId,
        side: parsedSerialNo.serialNo > 0 ? undefined : "BUY",
        page,
        pageSize,
        deliveryPeriod: parsedSerialNo.serialNo > 0 ? undefined : apiDeliveryPeriod,
        serialNo: parsedSerialNo.serialNo > 0 ? parsedSerialNo.serialNo : undefined,
      }),
    staleTime: 3_000,
    refetchInterval: 15_000,
    enabled: canTrade,
  });

  const sellQuery = useQuery({
    queryKey: ["listingsFiltered", productId, "SELL", page, pageSize, deliveryPeriods, parsedSerialNo.serialNo],
    queryFn: () =>
      fetchListingsPaged({
        productId: parsedSerialNo.serialNo > 0 ? "" : productId,
        side: parsedSerialNo.serialNo > 0 ? undefined : "SELL",
        page,
        pageSize,
        deliveryPeriod: parsedSerialNo.serialNo > 0 ? undefined : apiDeliveryPeriod,
        serialNo: parsedSerialNo.serialNo > 0 ? parsedSerialNo.serialNo : undefined,
      }),
    staleTime: 3_000,
    refetchInterval: 15_000,
    enabled: canTrade,
  });

  const swapQuery = useQuery({
    queryKey: ["swaps", productId, page, pageSize, parsedSerialNo.serialNo, parsedSerialNo.isSwap],
    queryFn: () => fetchSwaps({
      productId: parsedSerialNo.serialNo > 0 && parsedSerialNo.isSwap ? "" : productId,
      page,
      pageSize,
      serialNo: parsedSerialNo.serialNo > 0 && parsedSerialNo.isSwap ? parsedSerialNo.serialNo : undefined,
    }),
    staleTime: 5_000,
    refetchInterval: 15_000,
    enabled: canTrade,
  });

  const buyListings = buyQuery.data?.data ?? [];
  const sellListings = sellQuery.data?.data ?? [];
  const swapListings = (swapQuery.data?.data ?? []).filter(
    (s) => s.status === "OPEN" || s.status === "MATCHED"
  );
  const buyTotal = buyQuery.data?.total ?? 0;
  const sellTotal = sellQuery.data?.total ?? 0;
  const swapTotal = swapQuery.data?.total ?? 0;

  // 统一数据更新时间 + 手动刷新
  const listUpdatedAt = Math.max(
    buyQuery.dataUpdatedAt || 0,
    sellQuery.dataUpdatedAt || 0,
    swapQuery.dataUpdatedAt || 0
  );
  const isListRefreshing =
    buyQuery.isFetching || sellQuery.isFetching || (filterTab === "swap" && swapQuery.isFetching);
  const handleManualRefresh = useCallback(() => {
    void buyQuery.refetch();
    void sellQuery.refetch();
    void swapQuery.refetch();
  }, [buyQuery, sellQuery, swapQuery]);

  const fmtListUpdatedAt = (ts: number) => {
    if (!ts) return "—";
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  // #685 弹窗内实时更新：当列表数据刷新后，自动用最新数据替换弹窗中的快照
  const [detailUpdated, setDetailUpdated] = useState(false);
  const [detailUpdateMessage, setDetailUpdateMessage] = useState<string | null>(null);
  const [detailWithdrawn, setDetailWithdrawn] = useState(false);

  // 子弹窗点关闭 / 操作成功：彻底关掉详情栈
  useEffect(() => {
    if (!detailDismissToken) return;
    setDetailListing(null);
    setDetailSwap(null);
    setDetailSuppressed(false);
    setDetailUpdated(false);
    setDetailUpdateMessage(null);
    setDetailWithdrawn(false);
  }, [detailDismissToken]);

  useEffect(() => {
    setDetailUpdated(false);
    setDetailUpdateMessage(null);
    setDetailWithdrawn(false);
  }, [detailListing?.id, detailSwap?.id]);

  useEffect(() => {
    if (!detailListing) return;
    const isMine = !!currentUserId && detailListing.user_id === currentUserId;
    const updated = findListingInLists([buyListings, sellListings], detailListing.id);
    if (!updated && wasListingActive(detailListing)) {
      // 列表中消失：默认列表不含 CANCELLED，视为撤盘；已成交仍会留在列表里
      if (!isMine) setDetailWithdrawn(true);
      return;
    }
    if (updated) {
      if (!isMine && isListingWithdrawn(updated)) {
        setDetailListing(updated);
        setDetailWithdrawn(true);
        setDetailUpdated(false);
      } else if (entityChanged(detailListing, updated)) {
        // 已成交等：静默同步状态，不弹「对方已撤盘」
        if (!isMine && hasEditorialEntityUpdate(detailListing, updated)) {
          setDetailUpdateMessage(describeEntityUpdate(detailListing, updated));
          setDetailUpdated(true);
        }
        setDetailListing(updated);
        if (updated.status === "FILLED") setDetailWithdrawn(false);
      }
    }
  }, [buyListings, sellListings]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!detailSwap) return;
    const isMine = !!currentUserId && detailSwap.user_id === currentUserId;
    const updated = findSwapInList(swapListings, detailSwap.id);
    if (!updated && wasSwapActive(detailSwap)) {
      if (!isMine) setDetailWithdrawn(true);
      return;
    }
    if (updated) {
      if (!isMine && isSwapWithdrawn(updated)) {
        setDetailSwap(updated);
        setDetailWithdrawn(true);
        setDetailUpdated(false);
      } else if (entityChanged(detailSwap, updated)) {
        if (!isMine && hasEditorialEntityUpdate(detailSwap, updated)) {
          setDetailUpdateMessage(describeEntityUpdate(detailSwap, updated));
          setDetailUpdated(true);
        }
        setDetailSwap(updated);
        if (updated.status === "MATCHED") setDetailWithdrawn(false);
      }
    }
  }, [swapListings]); // eslint-disable-line react-hooks/exhaustive-deps

  // 从当前列表数据中提取每列的去重值（用于 Excel 筛选下拉选项）
  const filterOptions = useMemo(() => {
    const source = filterTab === "buy" ? buyListings : sellListings;
    const periods = new Set<string>();
    const payments = new Set<string>();
    const deliveries = new Set<string>();
    const statuses = new Set<string>();
    const freeStorages = new Set<string>();
    const specsSet = new Set<string>();
    const allowPartials = new Set<string>();
    const allowCounterOffers = new Set<string>();
    let hasNegotiating = false;
    source.forEach((l) => {
      if (l.delivery_period) periods.add(l.delivery_period); else periods.add("现货");
      if (l.payment_method) payments.add(l.payment_method); else payments.add("未设置");
      if (l.delivery_method) deliveries.add(l.delivery_method); else deliveries.add("未设置");
      if (l.status) statuses.add(l.status);
      // 商谈中虚拟状态：当列表中存在有 PENDING 商谈的挂牌时，加入选项
      if (pendingCounterOffers?.some(co => co.ref_type === "listing" && co.ref_id === l.id)) {
        hasNegotiating = true;
      }
      // 免仓期
      if (l.free_storage_enabled === false) freeStorages.add("不免仓");
      else if (l.free_storage_days && l.free_storage_days > 0) freeStorages.add(`免仓${l.free_storage_days}天`);
      else freeStorages.add("未设置");
      // 规格
      if (typeof l.specs === "string" && l.specs) specsSet.add(l.specs); else specsSet.add("无");
      // 数量方式
      allowPartials.add(l.allow_partial !== false ? "按份数" : "整单");
      // 可商谈
      allowCounterOffers.add(l.allow_counter_offer !== false ? "可商谈" : "不可商谈");
    });
    if (hasNegotiating) statuses.add("商谈中");
    return {
      deliveryPeriods: Array.from(periods).sort(),
      paymentMethods: Array.from(payments).sort(),
      deliveryMethods: Array.from(deliveries).sort(),
      statuses: Array.from(statuses).sort(),
      freeStorage: Array.from(freeStorages).sort(),
      specs: Array.from(specsSet).sort(),
      allowPartial: Array.from(allowPartials).sort(),
      allowCounterOffer: Array.from(allowCounterOffers).sort(),
    };
  }, [filterTab, buyListings, sellListings, pendingCounterOffers]);

  // marketType 过滤辅助函数（定义在前，供 filteredSwapListings 和 renderEntries 使用）
  const isSpotListing = useCallback((l: Listing) => !l.delivery_period || l.delivery_period.trim() === "" || l.delivery_period === "现货", []);
  const isForwardListing = useCallback((l: Listing) => l.delivery_period && l.delivery_period.trim() !== "" && l.delivery_period !== "现货", []);
  const isSpotSwap = useCallback((s: SwapListing) => {
    const sdp = s.sell_delivery_period || "";
    const bdp = s.buy_delivery_period || "";
    return (!sdp || sdp.trim() === "" || sdp === "现货") && (!bdp || bdp.trim() === "" || bdp === "现货");
  }, []);
  const isForwardSwap = useCallback((s: SwapListing) => {
    const sdp = s.sell_delivery_period || "";
    const bdp = s.buy_delivery_period || "";
    return (sdp && sdp.trim() !== "" && sdp !== "现货") || (bdp && bdp.trim() !== "" && bdp !== "现货");
  }, []);

  // 换盘按交割期前端过滤 + marketType 过滤
  const filteredSwapListings = useMemo(() => {
    let filtered = swapListings;
    if (deliveryPeriods.length > 0) {
      filtered = filtered.filter(
        (s) =>
          (s.sell_delivery_period && deliveryPeriods.includes(s.sell_delivery_period)) ||
          (s.buy_delivery_period && deliveryPeriods.includes(s.buy_delivery_period))
      );
    }
    if (marketType === "spot") filtered = filtered.filter(isSpotSwap);
    if (marketType === "forward") filtered = filtered.filter(isForwardSwap);
    return filtered;
  }, [swapListings, deliveryPeriods, marketType, isSpotSwap, isForwardSwap]);

  const filteredBuyTotal = filterTab === "buy" ? buyTotal : 0;
  const filteredSellTotal = filterTab === "sell" ? sellTotal : 0;
  const filteredSwapTotal = filterTab === "swap"
    ? filteredSwapListings.length
    : 0;

  const maxPages = (() => {
    if (filterTab === "buy") return Math.max(1, buyQuery.data?.total_page ?? 1);
    if (filterTab === "sell") return Math.max(1, sellQuery.data?.total_page ?? 1);
    return Math.max(1, swapQuery.data?.total_page ?? 1);
  })();

  const currentTotal =
    filterTab === "buy" ? buyTotal : filterTab === "sell" ? sellTotal : swapTotal;

  // 总数变少时把当前页钳回合法范围
  useEffect(() => {
    if (page > maxPages) setPage(maxPages);
  }, [page, maxPages]);

  const renderEntries = useMemo(() => {
    const items: { type: "swap" | "buy" | "sell"; item: Listing | SwapListing; createdAt: string }[] = [];
    if (filterTab === "swap") {
      filteredSwapListings.forEach((s) => items.push({ type: "swap", item: s, createdAt: s.created_at }));
    }
    if (filterTab === "buy") {
      let buys = buyListings;
      // 多选交割期时，API 返回全部数据，客户端过滤
      if (deliveryPeriods.length > 1) {
        buys = buys.filter((l) => {
          const dp = l.delivery_period || "现货";
          return deliveryPeriods.includes(dp);
        });
      }
      if (marketType === "spot") buys = buys.filter(isSpotListing);
      if (marketType === "forward") buys = buys.filter(isForwardListing);
      buys = applyHeaderFilters(buys);
      buys.forEach((l) => items.push({ type: "buy", item: l, createdAt: l.created_at }));
    }
    if (filterTab === "sell") {
      let sells = sellListings;
      // 多选交割期时，API 返回全部数据，客户端过滤
      if (deliveryPeriods.length > 1) {
        sells = sells.filter((l) => {
          const dp = l.delivery_period || "现货";
          return deliveryPeriods.includes(dp);
        });
      }
      if (marketType === "spot") sells = sells.filter(isSpotListing);
      if (marketType === "forward") sells = sells.filter(isForwardListing);
      sells = applyHeaderFilters(sells);
      sells.forEach((l) => items.push({ type: "sell", item: l, createdAt: l.created_at }));
    }
    // 排序：挂盘中(OPEN/PARTIAL) 优先，再按时间倒序
    const statusWeight = (it: Listing | SwapListing): number => {
      const s = (it as Listing).status;
      if (!s) return 0; // 换盘无 status 权重，排最前
      return s === "OPEN" ? 0 : s === "PARTIAL" ? 1 : 2;
    };
    items.sort((a, b) => {
      const wa = statusWeight(a.item);
      const wb = statusWeight(b.item);
      if (wa !== wb) return wa - wb;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return items;
  }, [filterTab, filteredSwapListings, buyListings, sellListings, deliveryPeriods, marketType, isSpotListing, isForwardListing, headerFilters, pendingCounterOffers]);

  const queryClient = useQueryClient();

  const handleCancel = async (listingId: string) => {
    const listing =
      buyListings.find((l) => l.id === listingId) ||
      sellListings.find((l) => l.id === listingId) ||
      (detailListing?.id === listingId ? detailListing : null);
    const productName = listing
      ? products.find((p) => p.id === listing.product_id)?.name ?? listing.product_id
      : "";
    const ok = await confirmDialog({
      title: "确认撤盘",
      message: "确定撤销此挂牌？",
      content: listing ? (
        <ListingBoardConfirmSheet
          listing={listing}
          productName={productName}
          serialLabel={formatBoardSerial("L", listing.serial_no, listing.created_at)}
          intro="请核对以下挂牌后确认撤盘。"
          outro="撤盘后未成交部分将从市场撤下，已成交部分保留。此操作不可撤销。"
        />
      ) : undefined,
      wide: !!listing,
      variant: "danger",
      icon: "danger",
      confirmText: "确认撤盘",
      cancelText: "再想想",
    });
    if (!ok) return;
    try {
      suppressOwnListingToast();
      await cancelListing(listingId);
      toast("撤盘成功", "success");
      queryClient.getQueryCache().findAll({ queryKey: ["listingsFiltered"] }).forEach((entry) => {
        queryClient.setQueryData(entry.queryKey as any, (old: any) => {
          if (!old || !old.data) return old;
          return { ...old, data: old.data.filter((l: Listing) => l.id !== listingId) };
        });
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "撤盘失败";
      toast(msg, "error");
    }
  };

  const handleCancelSwap = async (swapId: string) => {
    const swap =
      swapListings.find((s) => s.id === swapId) ||
      filteredSwapListings.find((s) => s.id === swapId) ||
      (detailSwap?.id === swapId ? detailSwap : null);
    const sellProductName = swap
      ? products.find((p) => p.id === swap.sell_product_id)?.name ?? swap.sell_product_id
      : "";
    const buyProductName = swap
      ? products.find((p) => p.id === swap.buy_product_id)?.name ?? swap.buy_product_id
      : "";
    const ok = await confirmDialog({
      title: "确认撤销换盘",
      message: "确定撤销此换盘？",
      content: swap ? (
        <SwapBoardConfirmSheet
          swap={swap}
          sellProductName={sellProductName}
          buyProductName={buyProductName}
          serialLabel={formatBoardSerial("S", swap.serial_no, swap.created_at)}
          intro="请核对以下换盘后确认撤销。"
          outro="撤销后未成交部分将从市场撤下，已成交部分保留。此操作不可撤销。"
        />
      ) : undefined,
      wide: !!swap,
      variant: "danger",
      icon: "danger",
      confirmText: "确认撤销",
      cancelText: "再想想",
    });
    if (!ok) return;
    try {
      suppressOwnListingToast();
      await cancelSwap(swapId);
      toast("撤销换盘成功", "success");
      queryClient.getQueryCache().findAll({ queryKey: ["swaps"] }).forEach((entry) => {
        queryClient.setQueryData(entry.queryKey as any, (old: any) => {
          if (!old || !old.data) return old;
          return { ...old, data: old.data.filter((s: SwapListing) => s.id !== swapId) };
        });
      });
      queryClient.invalidateQueries({ queryKey: ["swaps"] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "撤销换盘失败";
      toast(msg, "error");
    }
  };

  /** 渲染普通挂牌单行（简化：时间|类型|方向|价格|数量|交割期|状态|操作） */
  const renderListingRow = (listing: Listing, isBuy: boolean, rowNo: number) => {
    const remaining = Math.max(0, listing.quantity - listing.filled);
    const canPartial = listing.allow_partial !== false;
    const dirLabel = isBuy ? "买" : "卖";
    const dirClass = isBuy ? "bg-trade-up-bg text-trade-up-text" : "bg-trade-down-bg text-trade-down-text";
    const btnLabel = isBuy ? "卖出" : "买入";
    const btnBg = isBuy ? "bg-trade-down hover:opacity-90 text-white" : "bg-trade-up hover:opacity-90 text-white";
    const priceColor = isBuy ? "text-trade-up-text" : "text-trade-down-text";
    const isMyListing = !!currentUserId && listing.user_id === currentUserId;
    const isBlocked = !!listing.is_blocked;
    const isSpot = !listing.delivery_period || listing.delivery_period.trim() === "" || listing.delivery_period === "现货";

    // 查找当前用户对该挂牌的 PENDING 商谈
    const myPendingCO = pendingCounterOffers?.find(co => co.ref_type === "listing" && co.ref_id === listing.id);

    return (
      <tr
        key={listing.id}
        className="transition-colors border-b hover:bg-t-active cursor-pointer"
        style={{ borderColor: "var(--border-color)" }}
        onDoubleClick={() => {
          setDetailSuppressed(false);
          setDetailListing(listing);
        }}
      >
        <td className="px-1 py-1 text-center text-[11px] tabular-nums text-t-text-3 whitespace-nowrap">{rowNo}</td>
        <td className="px-1 py-1 text-center text-[11px] font-mono text-t-text-3 whitespace-nowrap">{formatBoardSerial("L", listing.serial_no, listing.created_at)}</td>
        <td className="px-1.5 py-1 text-center text-[11px] text-t-text-3 whitespace-nowrap">{fmtDateTime(listing.created_at)}</td>
        <td className="px-1.5 py-1 text-center">
          <div className="flex items-center justify-center gap-1">
            <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${dirClass}`}>{dirLabel}</span>
            {isMyListing && <span className="text-[10px] px-1 py-0.5 rounded font-bold bg-status-warning-bg text-status-warning whitespace-nowrap">我的</span>}
            {isBlocked && (
              <Tooltip content="已拉黑：双方互不可见发盘且无法成交">
                <span className="text-[10px] px-1 py-0.5 rounded font-bold bg-status-error-bg text-status-error whitespace-nowrap cursor-help">已拉黑</span>
              </Tooltip>
            )}
          </div>
        </td>
        <td className="px-1.5 py-1 text-center"><span className={`font-mono text-sm font-medium ${priceColor}`}>¥{listing.price.toFixed(1)}</span></td>
        <td className="px-1.5 py-1 text-center font-mono text-sm text-t-text">
          <div className="flex flex-col items-center gap-0.5">
            <div>{Math.floor(remaining)}{listing.filled > 0 && listing.allow_partial !== false && <span className="text-[10px] text-t-text-3 ml-1">/{Math.floor(listing.quantity)}</span>}</div>
            {listing.filled > 0 && <FillBar filled={listing.filled} total={listing.quantity} color={isBuy ? "bg-trade-up" : "bg-trade-down"} status={listing.status} />}
          </div>
        </td>
        <td className="px-1.5 py-1 text-center"><span className="text-[11px] px-1.5 py-0.5 rounded bg-t-hover text-t-text-2">{listing.delivery_period || "现货"}</span></td>
        {/* 交割地 */}
        <td className="px-1.5 py-1 text-center text-[11px] text-t-text-3 whitespace-nowrap">
          {listing.delivery_location || "-"}
        </td>
        {/* 付款方式 */}
        <td className="px-1.5 py-1 text-center text-[11px] text-t-text-2 whitespace-nowrap">
          {listing.payment_method ? (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-brand-600/10 text-brand-600 dark:text-brand-400 whitespace-nowrap">{listing.payment_method}</span>
          ) : (
            <span className="text-t-text-3">-</span>
          )}
        </td>
        {/* 交割方式 */}
        <td className="px-1.5 py-1 text-center text-[11px] text-t-text-2 whitespace-nowrap">
          {listing.delivery_method ? (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-t-hover text-t-text-2 whitespace-nowrap">{listing.delivery_method}</span>
          ) : (
            <span className="text-t-text-3">-</span>
          )}
        </td>
        {/* 免仓期 */}
        <td className="px-1.5 py-1 text-center text-[11px] whitespace-nowrap">
          {listing.free_storage_enabled === false ? (
            <span className="text-t-text-3">不免仓</span>
          ) : listing.free_storage_days && listing.free_storage_days > 0 ? (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-status-success-bg text-status-success whitespace-nowrap">免仓{listing.free_storage_days}天</span>
          ) : (
            <span className="text-t-text-3">-</span>
          )}
        </td>
        {/* 规格 */}
        <td className="px-1.5 py-1 text-center text-[11px] text-t-text-2 whitespace-nowrap">
          {typeof listing.specs === "string" && listing.specs ? listing.specs : "-"}
        </td>
        {/* 数量方式 */}
        <td className="px-1.5 py-1 text-center text-[11px] whitespace-nowrap">
          {listing.allow_partial !== false ? (
            <span className="text-trade-down-text">按份数</span>
          ) : (
            <span className="text-t-text-3">整单</span>
          )}
        </td>
        {/* 每份数量 */}
        <td className="px-1.5 py-1 text-center text-[11px] whitespace-nowrap">
          <span className="font-mono text-t-text">
            {Math.floor(
              listing.allow_partial !== false
                ? (listing.min_quantity && listing.min_quantity > 0
                    ? listing.min_quantity
                    : listing.quantity)
                : listing.quantity
            )}
          </span>
        </td>
        {/* 是否可议价 */}
        <td className="px-1.5 py-1 text-center text-[11px] whitespace-nowrap">
          {listing.allow_counter_offer !== false ? (
            <Tooltip content="可商谈：允许对方就价格、数量、交割条件等条款进行协商。">
              <span className="text-brand-600 dark:text-brand-400 cursor-help">可商谈</span>
            </Tooltip>
          ) : (
            <Tooltip content="不可商谈：对方只能直接摘盘成交，无法发起商谈。">
              <span className="text-t-text-3 cursor-help">不可商谈</span>
            </Tooltip>
          )}
        </td>
        <td className="px-1.5 py-1 text-center whitespace-nowrap">
          <StatusExpireCorner
            expiresAt={listing.expires_at}
            startsAt={listing.starts_at}
            showExpire={isMyListing && (listing.status === "OPEN" || listing.status === "PARTIAL")}
            showStart={isMyListing && listing.status === "SCHEDULED"}
          >
            {myPendingCO ? (
              <span className="text-[11px] px-1.5 py-0.5 rounded font-medium text-amber-600 dark:text-amber-400 bg-amber-500/15">商谈中</span>
            ) : (
              <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${STATUS_CLS[listing.status] ?? STATUS_CLS.OPEN}`}>{formatListingStatus(listing.status, listing.filled)}</span>
            )}
          </StatusExpireCorner>
        </td>
        {canTrade && (
          <td className="px-1.5 py-1 text-center whitespace-nowrap">
            <div className="flex items-center justify-center gap-0.5 flex-wrap">
              <button
                onClick={() => !isMyListing && !isBlocked && !isTradeDisabled(listing.status) && onTake?.(listing)}
                disabled={isMyListing || isBlocked || isTradeDisabled(listing.status)}
                title={isBlocked ? "已拉黑该用户，无法摘盘" : isMyListing ? "这是您自己的挂牌" : isTradeDisabled(listing.status) ? "该挂牌已不可交易" : undefined}
                className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors border ${isMyListing || isBlocked || isTradeDisabled(listing.status) ? "bg-t-tertiary text-t-text-3 border-t-text-3/20 cursor-not-allowed opacity-60" : `${btnBg} border-transparent`}`}
              >{btnLabel}</button>
              {isMyListing && (listing.status === "OPEN" || listing.status === "PARTIAL" || listing.status === "SCHEDULED") && (
                <>
                  {onEditListing && (
                    <button
                      onClick={() => onEditListing(listing)}
                      title="编辑挂盘"
                      className="px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors bg-violet-500/15 text-violet-600 dark:text-violet-400 border border-violet-500/30 hover:bg-violet-500/25"
                    >编</button>
                  )}
                  <button onClick={() => handleCancel(listing.id)} className="px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors bg-status-error-bg text-status-error border border-status-error/30 hover:bg-status-error hover:text-white">撤</button>
                </>
              )}
              {/* 当前用户对该挂牌有 PENDING 商谈时显示「编辑商谈」按钮 */}
              {myPendingCO && !isMyListing && onEditCounterOffer && (
                <>
                  <button
                    onClick={() => onEditCounterOffer(listing, myPendingCO)}
                    title="查看/修改正在进行的商谈"
                    className="px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30 hover:bg-blue-500/25"
                  >编辑商谈</button>
                  <button
                    onClick={async () => {
                      try {
                        await cancelCounterOffer(myPendingCO.id);
                        toast("商谈已取消", "success");
                        // 从 sent/received pending 缓存中移除
                        queryClient.setQueryData<CounterOffer[]>(["counterOffers", "sent", "pending"], (old) =>
                          (old ?? []).filter((co) => co.id !== myPendingCO.id)
                        );
                        queryClient.setQueryData<CounterOffer[]>(["counterOffers", "received", "pending"], (old) =>
                          (old ?? []).filter((co) => co.id !== myPendingCO.id)
                        );
                        queryClient.invalidateQueries({ queryKey: ["counterOffers"] });
                      } catch {
                        toast("取消商谈失败", "error");
                      }
                    }}
                    title="取消该商谈"
                    className="px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors bg-status-error-bg text-status-error border border-status-error/30 hover:bg-status-error hover:text-white"
                  >取消</button>
                </>
              )}
            </div>
          </td>
        )}
      </tr>
    );
  };

  /** 渲染换盘单行（买/卖同行，⇄ 隔开，操作栏一个"我要换"下拉按钮） */
  const renderSwapRow = (swap: SwapListing, rowNo: number) => {
    const sellFilled = swap.sell_filled ?? 0;
    const buyFilled  = swap.buy_filled ?? 0;
    const isMySwap    = !!currentUserId && swap.user_id === currentUserId;
    const isBlocked   = !!swap.is_blocked;
    const isSpot      = (!swap.sell_delivery_period || swap.sell_delivery_period.trim() === "" || swap.sell_delivery_period === "现货")
                      && (!swap.buy_delivery_period  || swap.buy_delivery_period.trim() === ""  || swap.buy_delivery_period === "现货");
    // 查找当前用户对该换盘的 PENDING 商谈
    const myPendingCO = pendingCounterOffers?.find(co => co.ref_type === "swap" && co.ref_id === swap.id);
    const myLocksOnSwap = mySwapLocks?.filter((l) => l.swap_id === swap.id) ?? [];
    const lockState = getSwapLockState(swap);
    const { sellRemain, buyRemain } = lockState;
    const lockBuyDisabled = swapLockBuyDisabledReason(swap, sellRemain);
    const lockSellDisabled = swapLockSellDisabledReason(swap, buyRemain);
    const bothDisabled = swapBothDisabledReason(sellRemain, buyRemain);
    const flashDisabled = swapFlashDisabledReason(lockState);
    // #694: 换盘商谈中时也禁用摘盘和商谈入口
    const isDisabled  = isMySwap || isBlocked || swap.status !== "OPEN" || !!myPendingCO;

    // 最小单量（两侧分别计算）
    const sellMinQty = swap.sell_allow_partial !== false
      ? (swap.sell_min_quantity && swap.sell_min_quantity > 0 ? swap.sell_min_quantity : swap.sell_quantity)
      : swap.sell_quantity;
    const buyMinQty = swap.buy_allow_partial !== false
      ? (swap.buy_min_quantity && swap.buy_min_quantity > 0 ? swap.buy_min_quantity : swap.buy_quantity)
      : swap.buy_quantity;

    return (
      <tr
        key={`swap-${swap.id}`}
        className="transition-colors border-b hover:bg-t-active cursor-pointer"
        style={{ borderColor: "var(--border-color)" }}
        onDoubleClick={() => {
          setDetailSuppressed(false);
          setDetailSwap(swap);
        }}
      >
        {/* 序号（分页顺序） */}
        <td className="px-1 py-1.5 text-center text-[11px] tabular-nums text-t-text-3 whitespace-nowrap">{rowNo}</td>
        {/* 发盘号 */}
        <td className="px-1 py-1.5 text-center text-[11px] font-mono text-t-text-3 whitespace-nowrap">{formatBoardSerial("S", swap.serial_no, swap.created_at)}</td>
        {/* 时间 */}
        <td className="px-1.5 py-1.5 text-center text-[11px] text-t-text-3 whitespace-nowrap">{fmtDateTime(swap.created_at)}</td>

        {/* 卖 方向 */}
        <td className="px-1 py-1.5 text-center whitespace-nowrap">
          <div className="flex items-center justify-center gap-1">
            <span className="text-[11px] px-1.5 py-0.5 rounded font-medium bg-trade-down-bg text-trade-down-text">卖</span>
            {isMySwap && <span className="text-[10px] px-1 py-0.5 rounded font-bold bg-status-warning-bg text-status-warning whitespace-nowrap">我的</span>}
            {isBlocked && (
              <Tooltip content="已拉黑：双方互不可见发盘且无法成交">
                <span className="text-[10px] px-1 py-0.5 rounded font-bold bg-status-error-bg text-status-error whitespace-nowrap cursor-help">已拉黑</span>
              </Tooltip>
            )}
          </div>
        </td>
        {/* 卖 价格 */}
        <td className="px-1 py-1.5 text-center whitespace-nowrap">
          <span className="font-mono text-sm font-medium text-trade-down-text">¥{swap.sell_price.toFixed(0)}</span>
        </td>
        {/* 卖 数量 */}
        <td className="px-1 py-1.5 text-center">
          <div className="flex flex-col items-center gap-0.5">
            <span className="font-mono text-sm text-t-text">{sellRemain}{swap.sell_allow_partial !== false && <span className="text-[10px] text-t-text-3">/{Math.floor(swap.sell_quantity)}</span>}</span>
            {(sellFilled > 0 || swap.sell_allow_partial !== false) && sellFilled > 0 && (
              <div className="w-full max-w-[50px]"><FillBar filled={sellFilled} total={swap.sell_quantity} color="bg-trade-down" status={swap.status} /></div>
            )}
          </div>
        </td>
        {/* 卖 交割地 */}
        <td className="px-1 py-1.5 text-center text-[11px] text-t-text-3">
          {swap.sell_delivery_location || "-"}
        </td>
        {/* 卖 交割期 */}
        <td className="px-1 py-1.5 text-center text-[11px]">
          <span className={`px-1.5 py-0.5 rounded ${
            !swap.sell_delivery_period || swap.sell_delivery_period.trim() === "" || swap.sell_delivery_period === "现货"
              ? "bg-status-warning-bg text-status-warning"
              : "bg-status-info-bg text-status-info"
          }`}>
            {swap.sell_delivery_period || "现货"}
          </span>
        </td>
        {/* 卖 付款方式 */}
        <td className="px-1 py-1.5 text-center text-[11px] text-t-text-2">
          {swap.sell_payment_method ? (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-brand-600/10 text-brand-600 dark:text-brand-400 whitespace-nowrap">{swap.sell_payment_method}</span>
          ) : (<span className="text-t-text-3">-</span>)}
        </td>
        {/* 卖 交割方式 */}
        <td className="px-1 py-1.5 text-center text-[11px] text-t-text-2">
          {swap.sell_delivery_method ? (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-t-hover text-t-text-2 whitespace-nowrap">{swap.sell_delivery_method}</span>
          ) : (<span className="text-t-text-3">-</span>)}
        </td>
        {/* 卖 免仓期 */}
        <td className="px-1 py-1.5 text-center text-[11px]">
          {swap.sell_free_storage_enabled === false ? (
            <span className="text-t-text-3">不免仓</span>
          ) : swap.sell_free_storage_days && swap.sell_free_storage_days > 0 ? (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-status-success-bg text-status-success whitespace-nowrap">免仓{swap.sell_free_storage_days}天</span>
          ) : (<span className="text-t-text-3">-</span>)}
        </td>
        {/* 卖 规格 */}
        <td className="px-1 py-1.5 text-center text-[11px] text-t-text-2 max-w-[120px] truncate" title={typeof swap.sell_specs === "string" ? swap.sell_specs : undefined}>
          {typeof swap.sell_specs === "string" && swap.sell_specs ? swap.sell_specs : "-"}
        </td>
        {/* 卖 数量方式 */}
        <td className="px-1 py-1.5 text-center text-[11px]">
          <span className={swap.sell_allow_partial !== false ? "text-trade-down-text" : "text-t-text-3"}>
            {swap.sell_allow_partial !== false ? "按份数" : "整单"}
          </span>
        </td>
        {/* 卖 每份 */}
        <td className="px-1 py-1.5 text-center text-[11px] font-mono text-t-text">
          {Math.floor(sellMinQty)}
        </td>

        {/* 交换图标 */}
        <td className="px-0 py-1.5 text-center">
          <span className="text-blue-500 font-bold text-sm">换</span>
        </td>

        {/* 买 方向 */}
        <td className="px-1 py-1.5 text-center whitespace-nowrap">
          <div className="flex items-center justify-center gap-1">
            <span className="text-[11px] px-1.5 py-0.5 rounded font-medium bg-trade-up-bg text-trade-up-text">买</span>
          </div>
        </td>
        {/* 买 价格 */}
        <td className="px-1 py-1.5 text-center whitespace-nowrap">
          <span className="font-mono text-sm font-medium text-trade-up-text">¥{swap.buy_price.toFixed(0)}</span>
        </td>
        {/* 买 数量 */}
        <td className="px-1 py-1.5 text-center">
          <div className="flex flex-col items-center gap-0.5">
            <span className="font-mono text-sm text-t-text">{buyRemain}{swap.buy_allow_partial !== false && <span className="text-[10px] text-t-text-3">/{Math.floor(swap.buy_quantity)}</span>}</span>
            {(buyFilled > 0 || swap.buy_allow_partial !== false) && buyFilled > 0 && (
              <div className="w-full max-w-[50px]"><FillBar filled={buyFilled} total={swap.buy_quantity} color="bg-trade-up" status={swap.status} /></div>
            )}
          </div>
        </td>
        {/* 买 交割地 */}
        <td className="px-1 py-1.5 text-center text-[11px] text-t-text-3">
          {swap.buy_delivery_location || "-"}
        </td>
        {/* 买 交割期 */}
        <td className="px-1 py-1.5 text-center text-[11px]">
          <span className={`px-1.5 py-0.5 rounded ${
            !swap.buy_delivery_period || swap.buy_delivery_period.trim() === "" || swap.buy_delivery_period === "现货"
              ? "bg-status-warning-bg text-status-warning"
              : "bg-status-info-bg text-status-info"
          }`}>
            {swap.buy_delivery_period || "现货"}
          </span>
        </td>
        {/* 买 付款方式 */}
        <td className="px-1 py-1.5 text-center text-[11px] text-t-text-2">
          {swap.buy_payment_method ? (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-brand-600/10 text-brand-600 dark:text-brand-400 whitespace-nowrap">{swap.buy_payment_method}</span>
          ) : (<span className="text-t-text-3">-</span>)}
        </td>
        {/* 买 交割方式 */}
        <td className="px-1 py-1.5 text-center text-[11px] text-t-text-2">
          {swap.buy_delivery_method ? (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-t-hover text-t-text-2 whitespace-nowrap">{swap.buy_delivery_method}</span>
          ) : (<span className="text-t-text-3">-</span>)}
        </td>
        {/* 买 免仓期 */}
        <td className="px-1 py-1.5 text-center text-[11px]">
          {swap.buy_free_storage_enabled === false ? (
            <span className="text-t-text-3">不免仓</span>
          ) : swap.buy_free_storage_days && swap.buy_free_storage_days > 0 ? (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-status-success-bg text-status-success whitespace-nowrap">免仓{swap.buy_free_storage_days}天</span>
          ) : (<span className="text-t-text-3">-</span>)}
        </td>
        {/* 买 规格 */}
        <td className="px-1 py-1.5 text-center text-[11px] text-t-text-2 max-w-[120px] truncate" title={typeof swap.buy_specs === "string" ? swap.buy_specs : undefined}>
          {typeof swap.buy_specs === "string" && swap.buy_specs ? swap.buy_specs : "-"}
        </td>
        {/* 买 数量方式 */}
        <td className="px-1 py-1.5 text-center text-[11px]">
          <span className={swap.buy_allow_partial !== false ? "text-trade-down-text" : "text-t-text-3"}>
            {swap.buy_allow_partial !== false ? "按份数" : "整单"}
          </span>
        </td>
        {/* 买 每份 */}
        <td className="px-1 py-1.5 text-center text-[11px] font-mono text-t-text">
          {Math.floor(buyMinQty)}
        </td>

        {/* 可商谈 */}
        <td className="px-1 py-1.5 text-center text-[11px]">
          {(() => {
            const sellCO = (swap.sell_allow_counter_offer ?? swap.allow_counter_offer) !== false;
            const buyCO = (swap.buy_allow_counter_offer ?? swap.allow_counter_offer) !== false;
            if (sellCO && buyCO) {
              return (
                <Tooltip content="双边可商谈：卖出方和买入方都允许对方就价格、数量、交割条件等条款进行协商。">
                  <span className="text-brand-600 dark:text-brand-400 cursor-help">双边可商谈</span>
                </Tooltip>
              );
            } else if (buyCO) {
              return (
                <Tooltip content="单买可商谈：仅买入方允许对方就价格、数量、交割条件等条款进行协商。">
                  <span className="text-brand-600 dark:text-brand-400 cursor-help">单买可商谈</span>
                </Tooltip>
              );
            } else if (sellCO) {
              return (
                <Tooltip content="单卖可商谈：仅卖出方允许对方就价格、数量、交割条件等条款进行协商。">
                  <span className="text-brand-600 dark:text-brand-400 cursor-help">单卖可商谈</span>
                </Tooltip>
              );
            } else {
              return (
                <Tooltip content="不可商谈：对方只能直接摘盘成交，无法发起商谈。">
                  <span className="text-t-text-3 cursor-help">不可商谈</span>
                </Tooltip>
              );
            }
          })()}
        </td>

        {/* 单边交易 */}
        <td className="px-1 py-1.5 text-center text-[11px]">
          <Tooltip
            content={
              !swap.allow_single_side || swap.single_side_mode === "none"
                ? "仅双边：对方只能与你整体互换，不能只做单边。"
                : "可单边：对方既可单买你的卖盘，也可单卖你的买盘，也可整体互换。"
            }
          >
            <span className={`inline-flex items-center gap-0.5 cursor-help ${
              (!swap.allow_single_side || swap.single_side_mode === "none")
                ? "text-t-text-3"
                : "text-brand-600 dark:text-brand-400"
            }`}>
              {!swap.allow_single_side || swap.single_side_mode === "none" ? (
                "仅双边"
              ) : (
                "可单边"
              )}
            </span>
          </Tooltip>
        </td>

        {/* 状态 */}
        <td className="px-1.5 py-1.5 text-center whitespace-nowrap">
          <StatusExpireCorner
            expiresAt={swap.expires_at}
            startsAt={swap.starts_at}
            showExpire={isMySwap && swap.status === "OPEN"}
            showStart={isMySwap && swap.status === "SCHEDULED"}
          >
            <Tooltip content={swapStatusTooltip(swap.status, lockState, !!myPendingCO, sellFilled, buyFilled)}>
              <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium cursor-help ${
                myPendingCO
                  ? "text-blue-600 dark:text-blue-400 bg-blue-500/15"
                  : swap.status === "MATCHED"
                    ? "text-t-text-3 bg-t-tertiary"
                    : swap.status === "SCHEDULED"
                      ? "text-sky-700 bg-sky-500/15 dark:text-sky-300"
                      : swap.status === "EXPIRED"
                        ? "text-status-warning bg-status-warning-bg"
                      : lockState.anySingleSideLock
                        ? "text-amber-600 dark:text-amber-400 bg-amber-500/15"
                        : "text-status-info bg-status-info-bg"
              }`}>
                {swapStatusLabel(swap.status, lockState, !!myPendingCO, sellFilled, buyFilled)}
              </span>
            </Tooltip>
          </StatusExpireCorner>
        </td>

        {/* 操作：我要换（下拉菜单；不可用项置灰常驻） */}
        {canTrade && (
          <td className="px-1.5 py-1.5 text-center whitespace-nowrap relative">
            <div className="relative inline-flex items-center gap-0.5">
              {isMySwap && (swap.status === "OPEN" || swap.status === "SCHEDULED") ? (
                <>
                  {onEditSwap && (
                    <button
                      onClick={() => onEditSwap(swap)}
                      title="编辑换盘"
                      className="px-1.5 py-1 rounded text-[10px] font-medium transition-colors bg-violet-500/15 text-violet-600 dark:text-violet-400 border border-violet-500/30 hover:bg-violet-500/25"
                    >
                      编
                    </button>
                  )}
                  <button
                    onClick={() => handleCancelSwap(swap.id)}
                    className="px-1.5 py-1 rounded text-[10px] font-medium transition-colors bg-status-error-bg text-status-error border border-status-error/30 hover:bg-status-error hover:text-white"
                  >
                    撤
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={(e) => {
                      if (isDisabled) {
                        setSwapMenuOpenId(null);
                        setSwapMenuPos(null);
                        return;
                      }
                      if (swapMenuOpenId === swap.id) {
                        setSwapMenuOpenId(null);
                        setSwapMenuPos(null);
                        return;
                      }
                      const rect = e.currentTarget.getBoundingClientRect();
                      const menuH = 200;
                      const openUp = window.innerHeight - rect.bottom < menuH && rect.top > menuH;
                      setSwapMenuPos({
                        top: openUp ? rect.top - 4 : rect.bottom + 4,
                        left: rect.right,
                        openUp,
                      });
                      setSwapMenuOpenId(swap.id);
                    }}
                    disabled={isDisabled}
                    className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors border ${
                      isDisabled
                        ? "bg-t-tertiary text-t-text-3 border-t-text-3/20 cursor-not-allowed opacity-60"
                        : "bg-blue-600 hover:bg-blue-700 text-white border-transparent"
                    }`}
                  >
                    我要换 ▾
                  </button>
                  {/* 当前用户对该换盘有 PENDING 商谈时显示「编辑商谈」和「取消」按钮 */}
                  {myPendingCO && onEditCounterOfferSwap && (
                    <>
                      <button
                        onClick={() => onEditCounterOfferSwap(swap, myPendingCO)}
                        title="查看/修改正在进行的商谈"
                        className="px-1.5 py-1 rounded text-[10px] font-medium transition-colors bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30 hover:bg-blue-500/25"
                      >
                        编辑商谈
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            await cancelCounterOffer(myPendingCO.id);
                            toast("商谈已取消", "success");
                            queryClient.setQueryData<CounterOffer[]>(["counterOffers", "sent", "pending"], (old) =>
                              (old ?? []).filter((co) => co.id !== myPendingCO.id)
                            );
                            queryClient.setQueryData<CounterOffer[]>(["counterOffers", "received", "pending"], (old) =>
                              (old ?? []).filter((co) => co.id !== myPendingCO.id)
                            );
                            queryClient.invalidateQueries({ queryKey: ["counterOffers"] });
                          } catch {
                            toast("取消商谈失败", "error");
                          }
                        }}
                        title="取消该商谈"
                        className="px-1.5 py-1 rounded text-[10px] font-medium transition-colors bg-status-error-bg text-status-error border border-status-error/30 hover:bg-status-error hover:text-white"
                      >
                        取消
                      </button>
                    </>
                  )}
                  {!isDisabled && swapMenuOpenId === swap.id && swapMenuPos && typeof document !== "undefined" && createPortal(
                    <>
                      <div
                        className="fixed inset-0 z-[80]"
                        onClick={() => { setSwapMenuOpenId(null); setSwapMenuPos(null); }}
                      />
                      <div
                        className="fixed z-[90] rounded-lg shadow-dropdown overflow-hidden min-w-[128px] border"
                        style={{
                          top: swapMenuPos.top,
                          left: swapMenuPos.left,
                          transform: swapMenuPos.openUp
                            ? "translate(-100%, -100%)"
                            : "translateX(-100%)",
                          backgroundColor: "var(--bg-secondary)",
                          borderColor: "var(--border-color)",
                        }}
                      >
                        <button
                          type="button"
                          disabled={!!lockBuyDisabled}
                          title={lockBuyDisabled ?? SWAP_LOCK_BUY_TOOLTIP}
                          onClick={() => {
                            if (lockBuyDisabled) return;
                            onTakeSwap?.(swap, "sell");
                            setSwapMenuOpenId(null);
                            setSwapMenuPos(null);
                          }}
                          className={`w-full px-3 py-1.5 text-[11px] text-left transition-colors flex items-center gap-1.5 ${
                            lockBuyDisabled
                              ? "text-t-text-3/50 cursor-not-allowed"
                              : "text-trade-up hover:bg-t-hover"
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${lockBuyDisabled ? "bg-t-text-3/40" : "bg-trade-up"}`}></span>
                          锁定·买
                        </button>
                        <button
                          type="button"
                          disabled={!!lockSellDisabled}
                          title={lockSellDisabled ?? SWAP_LOCK_SELL_TOOLTIP}
                          onClick={() => {
                            if (lockSellDisabled) return;
                            onTakeSwap?.(swap, "buy");
                            setSwapMenuOpenId(null);
                            setSwapMenuPos(null);
                          }}
                          className={`w-full px-3 py-1.5 text-[11px] text-left transition-colors flex items-center gap-1.5 ${
                            lockSellDisabled
                              ? "text-t-text-3/50 cursor-not-allowed"
                              : "text-trade-down hover:bg-t-hover"
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${lockSellDisabled ? "bg-t-text-3/40" : "bg-trade-down"}`}></span>
                          锁定·卖
                        </button>
                        <button
                          type="button"
                          disabled={!!bothDisabled}
                          title={bothDisabled ?? "同时接受买卖两侧"}
                          onClick={() => {
                            if (bothDisabled) return;
                            onTakeSwap?.(swap, "both");
                            setSwapMenuOpenId(null);
                            setSwapMenuPos(null);
                          }}
                          className={`w-full px-3 py-1.5 text-[11px] text-left transition-colors flex items-center gap-1.5 font-medium ${
                            bothDisabled
                              ? "text-t-text-3/50 cursor-not-allowed"
                              : "text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10"
                          }`}
                        >
                          <span>⇄</span> 双向摘盘
                        </button>
                        <button
                          type="button"
                          disabled={!!flashDisabled}
                          title={flashDisabled ?? "与已有单边锁定闪拼成交"}
                          onClick={() => {
                            if (flashDisabled || !lockState.flashMode) return;
                            onTakeSwap?.(swap, lockState.flashMode, true);
                            setSwapMenuOpenId(null);
                            setSwapMenuPos(null);
                          }}
                          className={`w-full px-3 py-1.5 text-[11px] text-left transition-colors flex items-center gap-1.5 font-medium border-t ${
                            flashDisabled
                              ? "text-t-text-3/50 cursor-not-allowed"
                              : "text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10"
                          }`}
                          style={{ borderColor: "var(--border-color)" }}
                        >
                          <span>⚡</span> 闪拼
                        </button>
                      </div>
                    </>,
                    document.body
                  )}
                  {myLocksOnSwap.length > 0 && (
                    <button
                      onClick={async () => {
                        const locks = [...myLocksOnSwap];
                        const serialLabel = formatBoardSerial("S", swap.serial_no, swap.created_at);
                        const ok = await confirmDialog({
                          title: "确认解锁",
                          message: "确认解锁？",
                          content: (
                            <UnlockConfirmSheet
                              serialLabel={serialLabel}
                              locks={locks}
                              unit="吨"
                            />
                          ),
                          wide: true,
                          variant: "warning",
                          icon: "warning",
                          confirmText: "确认解锁",
                          cancelText: "再想想",
                        });
                        if (!ok) return;
                        try {
                          for (const lock of locks) {
                            await cancelSwapLock(lock.id);
                          }
                          toast("已取消锁定", "success");
                          queryClient.invalidateQueries({ queryKey: ["swapLocks", "mine"] });
                          queryClient.invalidateQueries({ queryKey: ["swaps"] });
                        } catch {
                          toast("取消锁定失败", "error");
                          queryClient.invalidateQueries({ queryKey: ["swapLocks", "mine"] });
                          queryClient.invalidateQueries({ queryKey: ["swaps"] });
                        }
                      }}
                      title="取消我在该换盘上的单边锁定"
                      className="px-1.5 py-1 rounded text-[10px] font-medium transition-colors bg-orange-500/15 text-orange-600 dark:text-orange-400 border border-orange-500/30 hover:bg-orange-500/25"
                    >
                      解锁
                    </button>
                  )}
                </>
              )}
            </div>
          </td>
        )}
      </tr>
    );
  };

  const swapTotalCols = canTrade ? 29 : 28;
  const normalTotalCols = canTrade ? 17 : 16;
  const totalCols = filterTab === "swap" ? swapTotalCols : normalTotalCols;
  const isLoading = canTrade && (buyQuery.isLoading || sellQuery.isLoading || (filterTab === "swap" && swapQuery.isLoading));
  const isEmpty =
    filterTab === "swap" ? filteredSwapListings.length === 0 :
    filterTab === "buy" ? buyListings.length === 0 :
    sellListings.length === 0;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 标题栏：放大/窄屏时换行，避免品种标签与「更新」时间重叠 */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 min-h-9 py-1 border-b shrink-0 bg-t-panel" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs font-semibold text-t-text shrink-0">今日挂盘列表</span>
            <span
              className="px-1.5 py-0.5 text-[11px] font-semibold rounded whitespace-nowrap shrink-0 bg-t-accent-bg text-t-accent border border-t-accent/25"
              title="由左侧自选决定：品种 + 交割期"
            >
              {(products.find((p) => p.id === productId)?.name ?? productId)
                + (defaultDeliveryPeriod ? ` · ${defaultDeliveryPeriod}` : "")}
            </span>
          </div>
          <span className="text-[10px] text-t-text-3 tabular-nums whitespace-nowrap shrink-0" title="列表最近一次从服务器获取的时间">
            更新 {fmtListUpdatedAt(listUpdatedAt)}
          </span>
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={!canTrade || isListRefreshing}
            title="手动刷新挂盘列表"
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded border transition-colors disabled:opacity-40 shrink-0 bg-t-input text-t-text-2 border-t-text-3/20 hover:border-t-accent hover:text-t-text"
            style={{ borderColor: "var(--border-color)" }}
          >
            <svg
              className={`w-3 h-3 ${isListRefreshing ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            刷新
          </button>
          <div className="flex items-center gap-0.5 rounded p-0.5 bg-t-tertiary shrink-0">
            {(["buy", "sell", "swap"] as const).map((tab) => {
              const active = filterTab === tab;
              const label = tab === "buy" ? "买" : tab === "sell" ? "卖" : "换盘";
              const colorCls = tab === "buy" ? "text-trade-up-text" : tab === "sell" ? "text-trade-down-text" : "text-status-info";
              const count = tab === "buy" ? buyTotal : tab === "sell" ? sellTotal : swapTotal;
              return (
                <button key={tab} onClick={() => { setFilterTab(tab); setPage(1); }} className={`px-2 py-0.5 text-[11px] rounded transition-colors whitespace-nowrap ${active ? "bg-t-accent text-white" : `${colorCls} hover:text-t-text"`}`}>{label} <span className="opacity-60">{count}</span></button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* #304 序号搜索框 */}
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={serialNoSearch}
              onChange={(e) => { setSerialNoSearch(e.target.value); setPage(1); }}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setSerialNoSearch(""); setPage(1); }
              }}
              placeholder="发盘号 L/S…"
              className="w-[96px] px-1.5 py-0.5 text-[11px] bg-t-input border rounded focus:outline-none focus:border-t-accent text-t-text"
              style={{ borderColor: "var(--border-color)" }}
              title="按发盘号查询"
            />
            {serialNoSearch && (
              <button
                onClick={() => { setSerialNoSearch(""); setPage(1); }}
                className="text-[10px] text-t-text-3 hover:text-status-error px-1"
                title="清除搜索"
              >✕</button>
            )}
          </div>
          {/* Excel 风格筛选按钮（仅买/卖 Tab 显示） */}
          {filterTab !== "swap" && (
            <button
              onClick={() => { setExcelFilterMode(v => !v); setOpenFilterCol(null); }}
              title="列筛选"
              className={`flex items-center gap-1 px-2 py-0.5 text-[11px] rounded border transition-colors ${
                excelFilterMode || hasActiveFilters
                  ? "bg-brand-600/15 text-brand-600 dark:text-brand-400 border-brand-600/30"
                  : "bg-t-input text-t-text-2 border-t-text-3/20 hover:border-t-accent"
              }`}
              style={{ borderColor: (excelFilterMode || hasActiveFilters) ? undefined : "var(--border-color)" }}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4.5h18M6 12h12M10 19.5h4" />
              </svg>
              <span>筛选</span>
              {hasActiveFilters && (
                <span className="ml-0.5 px-1 rounded-full bg-brand-600 text-white text-[9px] leading-tight">
                  {activeFilterCount}
                </span>
              )}
            </button>
          )}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-t-text-3 tabular-nums whitespace-nowrap">
              共 {currentTotal} 条
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-1.5 py-0.5 text-[11px] rounded border border-t-text-3/20 text-t-text-3 hover:text-t-text hover:border-t-accent disabled:opacity-30"
            >
              ◀
            </button>
            <span className="text-[11px] text-t-text-3 self-center tabular-nums">{page}/{maxPages}</span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(maxPages, p + 1))}
              disabled={page >= maxPages}
              className="px-1.5 py-0.5 text-[11px] rounded border border-t-text-3/20 text-t-text-3 hover:text-t-text hover:border-t-accent disabled:opacity-30"
            >
              ▶
            </button>
          </div>
          {/* 收起挂盘按钮 — 标题栏最右侧，与分页控件用分隔线隔开 */}
          {onCollapse && (
            <button
              onClick={onCollapse}
              className="ml-1 w-6 h-6 flex items-center justify-center rounded-md bg-t-hover/80 text-t-text-2 hover:text-t-text hover:bg-t-hover transition-all"
              title="收起挂盘列表"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7M19 15l-7 7-7-7" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 表格 — 固定最小宽度强制横向滚动条 */}
      <div className="flex-1 overflow-x-auto bg-t-tertiary">
        <table className={`table-auto text-[11px] ${filterTab === "swap" ? "min-w-[1800px]" : "min-w-[1200px]"} w-full`}>
          {/* 换盘模式：卖出整列浅红、买入整列浅绿，增强买/卖区分度（表头与内容同步） */}
          {filterTab === "swap" && (
            <colgroup>
              <col />
              <col />
              <col />
              {Array.from({ length: 11 }).map((_, i) => (
                <col key={`sc-${i}`} className="bg-[var(--color-up-bg)]" />
              ))}
              <col />
              {Array.from({ length: 11 }).map((_, i) => (
                <col key={`bc-${i}`} className="bg-[var(--color-down-bg)]" />
              ))}
              <col />
              <col />
              {canTrade && <col />}
            </colgroup>
          )}
          <thead className="sticky top-0 z-10">
            <tr className="bg-t-panel text-[11px] text-t-text-3 border-b" style={{ borderColor: "var(--border-color)" }}>
              <th className="text-center px-1 py-1 font-medium whitespace-nowrap">序号</th>
              <th className="text-center px-1 py-1 font-medium whitespace-nowrap">发盘号</th>
              <th className="text-center px-1.5 py-1 font-medium whitespace-nowrap">时间</th>
              {filterTab === "swap" ? (
                <>
                  {/* 卖 列 */}
                  <th className="text-center px-1 py-1 font-medium whitespace-nowrap">方向</th>
                  <th className="text-center px-1 py-1 font-medium whitespace-nowrap">价格</th>
                  <th className="text-center px-1 py-1 font-medium whitespace-nowrap">数量</th>
                  <th className="text-center px-1 py-1 font-medium whitespace-nowrap">交割地</th>
                  <th className="text-center px-1 py-1 font-medium whitespace-nowrap">交割期</th>
                  <th className="text-center px-1 py-1 font-medium whitespace-nowrap">
                    <Tooltip content="结算方式：款到发货/货到付款/预收保证金等"><span className="inline-flex items-center gap-0.5">付款方式</span></Tooltip>
                  </th>
                  <th className="text-center px-1 py-1 font-medium whitespace-nowrap">
                    <Tooltip content="货物交付方式：混罐货转/货转/自提/送到"><span className="inline-flex items-center gap-0.5">交割方式</span></Tooltip>
                  </th>
                  <th className="text-center px-1 py-1 font-medium whitespace-nowrap">
                    <Tooltip content="成交后免费存储天数"><span className="inline-flex items-center gap-0.5">免仓期</span></Tooltip>
                  </th>
                  <th className="text-center px-1 py-1 font-medium whitespace-nowrap">规格</th>
                  <th className="text-center px-1 py-1 font-medium whitespace-nowrap">
                    <Tooltip content="整单须一次成交；按份数可按每份数量成交"><span className="inline-flex items-center gap-0.5">数量方式</span></Tooltip>
                  </th>
                  <th className="text-center px-1 py-1 font-medium whitespace-nowrap">
                    <Tooltip content="按份数时为每份数量；整单时等于总量"><span className="inline-flex items-center gap-0.5">每份</span></Tooltip>
                  </th>
                  {/* 交换标记 */}
                  <th className="text-center px-0 py-1 font-medium whitespace-nowrap">
                    <span className="text-blue-500 text-sm">换</span>
                  </th>
                  {/* 买 列 */}
                  <th className="text-center px-1 py-1 font-medium whitespace-nowrap">方向</th>
                  <th className="text-center px-1 py-1 font-medium whitespace-nowrap">价格</th>
                  <th className="text-center px-1 py-1 font-medium whitespace-nowrap">数量</th>
                  <th className="text-center px-1 py-1 font-medium whitespace-nowrap">交割地</th>
                  <th className="text-center px-1 py-1 font-medium whitespace-nowrap">交割期</th>
                  <th className="text-center px-1 py-1 font-medium whitespace-nowrap">
                    <Tooltip content="结算方式：款到发货/货到付款/预收保证金等"><span className="inline-flex items-center gap-0.5">付款方式</span></Tooltip>
                  </th>
                  <th className="text-center px-1 py-1 font-medium whitespace-nowrap">
                    <Tooltip content="货物交付方式：混罐货转/货转/自提/送到"><span className="inline-flex items-center gap-0.5">交割方式</span></Tooltip>
                  </th>
                  <th className="text-center px-1 py-1 font-medium whitespace-nowrap">
                    <Tooltip content="成交后免费存储天数"><span className="inline-flex items-center gap-0.5">免仓期</span></Tooltip>
                  </th>
                  <th className="text-center px-1 py-1 font-medium whitespace-nowrap">规格</th>
                  <th className="text-center px-1 py-1 font-medium whitespace-nowrap">
                    <Tooltip content="整单须一次成交；按份数可按每份数量成交"><span className="inline-flex items-center gap-0.5">数量方式</span></Tooltip>
                  </th>
                  <th className="text-center px-1 py-1 font-medium whitespace-nowrap">
                    <Tooltip content="按份数时为每份数量；整单时等于总量"><span className="inline-flex items-center gap-0.5">每份</span></Tooltip>
                  </th>
                  {/* 可商谈 */}
                  <th className="text-center px-1 py-1 font-medium whitespace-nowrap">
                    <Tooltip content="是否允许对方商谈"><span className="inline-flex items-center gap-0.5">可商谈</span></Tooltip>
                  </th>
                  {/* 单边交易 */}
                  <th className="text-center px-1 py-1 font-medium whitespace-nowrap">
                    <Tooltip content="是否允许对方只做单边（单买你的卖盘 或 单卖你的买盘）；关闭则对方只能与你整体互换。">
                      <span className="inline-flex items-center gap-0.5">单边交易</span>
                    </Tooltip>
                  </th>
                </>
              ) : (
                <>
                  <th className="text-center px-1.5 py-1 font-medium whitespace-nowrap">方向</th>
                  {/* 价格 — 可筛选（范围） */}
                  <th className="text-center px-1.5 py-1 font-medium whitespace-nowrap relative">
                    <span className="inline-flex items-center gap-0.5">价格</span>
                    {excelFilterMode && (
                      <FilterArrow colKey="price" openFilterCol={openFilterCol} setOpenFilterCol={setOpenFilterCol} active={!!(headerFilters.priceMin || headerFilters.priceMax)} />
                    )}
                    {excelFilterMode && openFilterCol === "price" && (
                      <FilterDropdown onClose={() => setOpenFilterCol(null)}>
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1">
                            <input type="number" placeholder="最低" value={headerFilters.priceMin || ""} onChange={(e) => updateRangeFilter("priceMin", e.target.value)} className="w-full px-1.5 py-0.5 text-[11px] rounded border bg-t-input outline-none focus:border-t-accent" style={{ borderColor: "var(--border-color)" }} />
                            <span className="text-t-text-3 text-[10px]">~</span>
                            <input type="number" placeholder="最高" value={headerFilters.priceMax || ""} onChange={(e) => updateRangeFilter("priceMax", e.target.value)} className="w-full px-1.5 py-0.5 text-[11px] rounded border bg-t-input outline-none focus:border-t-accent" style={{ borderColor: "var(--border-color)" }} />
                          </div>
                          <button onClick={() => { updateRangeFilter("priceMin", ""); updateRangeFilter("priceMax", ""); }} className="text-[10px] text-t-text-3 hover:text-status-error">清除</button>
                        </div>
                      </FilterDropdown>
                    )}
                  </th>
                  {/* 数量 — 可筛选（范围） */}
                  <th className="text-center px-1.5 py-1 font-medium whitespace-nowrap relative">
                    <span className="inline-flex items-center gap-0.5">数量</span>
                    {excelFilterMode && (
                      <FilterArrow colKey="qty" openFilterCol={openFilterCol} setOpenFilterCol={setOpenFilterCol} active={!!(headerFilters.qtyMin || headerFilters.qtyMax)} />
                    )}
                    {excelFilterMode && openFilterCol === "qty" && (
                      <FilterDropdown onClose={() => setOpenFilterCol(null)}>
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1">
                            <input type="number" placeholder="最低" value={headerFilters.qtyMin || ""} onChange={(e) => updateRangeFilter("qtyMin", e.target.value)} className="w-full px-1.5 py-0.5 text-[11px] rounded border bg-t-input outline-none focus:border-t-accent" style={{ borderColor: "var(--border-color)" }} />
                            <span className="text-t-text-3 text-[10px]">~</span>
                            <input type="number" placeholder="最高" value={headerFilters.qtyMax || ""} onChange={(e) => updateRangeFilter("qtyMax", e.target.value)} className="w-full px-1.5 py-0.5 text-[11px] rounded border bg-t-input outline-none focus:border-t-accent" style={{ borderColor: "var(--border-color)" }} />
                          </div>
                          <button onClick={() => { updateRangeFilter("qtyMin", ""); updateRangeFilter("qtyMax", ""); }} className="text-[10px] text-t-text-3 hover:text-status-error">清除</button>
                        </div>
                      </FilterDropdown>
                    )}
                  </th>
                  {/* 交割期 — 可筛选（多选） */}
                  <th className="text-center px-1.5 py-1 font-medium whitespace-nowrap relative">
                    <span className="inline-flex items-center gap-0.5">交割期</span>
                    {excelFilterMode && (
                      <FilterArrow colKey="deliveryPeriods" openFilterCol={openFilterCol} setOpenFilterCol={setOpenFilterCol} active={!!headerFilters.deliveryPeriods?.length} />
                    )}
                    {excelFilterMode && openFilterCol === "deliveryPeriods" && (
                      <FilterDropdown onClose={() => setOpenFilterCol(null)}>
                        <MultiCheckList options={filterOptions.deliveryPeriods} selected={headerFilters.deliveryPeriods ?? []} onToggle={(v) => updateMultiFilter("deliveryPeriods", v)} />
                      </FilterDropdown>
                    )}
                  </th>
                  {/* 交割地 — 可筛选（关键词） */}
                  <th className="text-center px-1.5 py-1 font-medium whitespace-nowrap relative">
                    <Tooltip content="实物交割的实际交货地点"><span className="inline-flex items-center gap-0.5">交割地</span></Tooltip>
                    {excelFilterMode && (
                      <FilterArrow colKey="deliveryLocation" openFilterCol={openFilterCol} setOpenFilterCol={setOpenFilterCol} active={!!headerFilters.deliveryLocation} />
                    )}
                    {excelFilterMode && openFilterCol === "deliveryLocation" && (
                      <FilterDropdown onClose={() => setOpenFilterCol(null)}>
                        <input type="text" placeholder="关键词" value={headerFilters.deliveryLocation || ""} onChange={(e) => updateRangeFilter("deliveryLocation", e.target.value)} className="w-full px-1.5 py-0.5 text-[11px] rounded border bg-t-input outline-none focus:border-t-accent" style={{ borderColor: "var(--border-color)" }} />
                      </FilterDropdown>
                    )}
                  </th>
                  {/* 付款方式 — 可筛选（多选） */}
                  <th className="text-center px-1.5 py-1 font-medium whitespace-nowrap relative">
                    <Tooltip content="结算方式：款到发货/货到付款/预收保证金等"><span className="inline-flex items-center gap-0.5">付款方式</span></Tooltip>
                    {excelFilterMode && (
                      <FilterArrow colKey="paymentMethods" openFilterCol={openFilterCol} setOpenFilterCol={setOpenFilterCol} active={!!headerFilters.paymentMethods?.length} />
                    )}
                    {excelFilterMode && openFilterCol === "paymentMethods" && (
                      <FilterDropdown onClose={() => setOpenFilterCol(null)}>
                        <MultiCheckList options={filterOptions.paymentMethods} selected={headerFilters.paymentMethods ?? []} onToggle={(v) => updateMultiFilter("paymentMethods", v)} />
                      </FilterDropdown>
                    )}
                  </th>
                  {/* 交割方式 — 可筛选（多选） */}
                  <th className="text-center px-1.5 py-1 font-medium whitespace-nowrap relative">
                    <Tooltip content="货物交付方式：混罐货转/货转/自提/送到"><span className="inline-flex items-center gap-0.5">交割方式</span></Tooltip>
                    {excelFilterMode && (
                      <FilterArrow colKey="deliveryMethods" openFilterCol={openFilterCol} setOpenFilterCol={setOpenFilterCol} active={!!headerFilters.deliveryMethods?.length} />
                    )}
                    {excelFilterMode && openFilterCol === "deliveryMethods" && (
                      <FilterDropdown onClose={() => setOpenFilterCol(null)}>
                        <MultiCheckList options={filterOptions.deliveryMethods} selected={headerFilters.deliveryMethods ?? []} onToggle={(v) => updateMultiFilter("deliveryMethods", v)} />
                      </FilterDropdown>
                    )}
                  </th>
                  {/* 免仓期 — 可筛选（多选） */}
                  <th className="text-center px-1.5 py-1 font-medium whitespace-nowrap relative">
                    <Tooltip content="成交后免费存储天数"><span className="inline-flex items-center gap-0.5">免仓期</span></Tooltip>
                    {excelFilterMode && (
                      <FilterArrow colKey="freeStorage" openFilterCol={openFilterCol} setOpenFilterCol={setOpenFilterCol} active={!!headerFilters.freeStorage?.length} />
                    )}
                    {excelFilterMode && openFilterCol === "freeStorage" && (
                      <FilterDropdown onClose={() => setOpenFilterCol(null)}>
                        <MultiCheckList options={filterOptions.freeStorage} selected={headerFilters.freeStorage ?? []} onToggle={(v) => updateMultiFilter("freeStorage", v)} />
                      </FilterDropdown>
                    )}
                  </th>
                  {/* 规格 — 可筛选（多选） */}
                  <th className="text-center px-1.5 py-1 font-medium whitespace-nowrap relative">
                    <span className="inline-flex items-center gap-0.5">规格</span>
                    {excelFilterMode && (
                      <FilterArrow colKey="specs" openFilterCol={openFilterCol} setOpenFilterCol={setOpenFilterCol} active={!!headerFilters.specs?.length} />
                    )}
                    {excelFilterMode && openFilterCol === "specs" && (
                      <FilterDropdown onClose={() => setOpenFilterCol(null)}>
                        <MultiCheckList options={filterOptions.specs} selected={headerFilters.specs ?? []} onToggle={(v) => updateMultiFilter("specs", v)} />
                      </FilterDropdown>
                    )}
                  </th>
                  {/* 数量方式 — 可筛选（多选） */}
                  <th className="text-center px-1.5 py-1 font-medium whitespace-nowrap relative">
                    <Tooltip content="整单须一次成交；按份数可按每份数量成交"><span className="inline-flex items-center gap-0.5">数量方式</span></Tooltip>
                    {excelFilterMode && (
                      <FilterArrow colKey="allowPartial" openFilterCol={openFilterCol} setOpenFilterCol={setOpenFilterCol} active={!!headerFilters.allowPartial?.length} />
                    )}
                    {excelFilterMode && openFilterCol === "allowPartial" && (
                      <FilterDropdown onClose={() => setOpenFilterCol(null)}>
                        <MultiCheckList options={filterOptions.allowPartial} selected={headerFilters.allowPartial ?? []} onToggle={(v) => updateMultiFilter("allowPartial", v)} />
                      </FilterDropdown>
                    )}
                  </th>
                  {/* 每份 — 可筛选（范围） */}
                  <th className="text-center px-1.5 py-1 font-medium whitespace-nowrap relative">
                    <Tooltip content="按份数时为每份数量；整单时等于总量"><span className="inline-flex items-center gap-0.5">每份</span></Tooltip>
                    {excelFilterMode && (
                      <FilterArrow colKey="minQty" openFilterCol={openFilterCol} setOpenFilterCol={setOpenFilterCol} active={!!(headerFilters.minQtyMin || headerFilters.minQtyMax)} />
                    )}
                    {excelFilterMode && openFilterCol === "minQty" && (
                      <FilterDropdown onClose={() => setOpenFilterCol(null)}>
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1">
                            <input type="number" placeholder="最低" value={headerFilters.minQtyMin || ""} onChange={(e) => updateRangeFilter("minQtyMin", e.target.value)} className="w-full px-1.5 py-0.5 text-[11px] rounded border bg-t-input outline-none focus:border-t-accent" style={{ borderColor: "var(--border-color)" }} />
                            <span className="text-t-text-3 text-[10px]">~</span>
                            <input type="number" placeholder="最高" value={headerFilters.minQtyMax || ""} onChange={(e) => updateRangeFilter("minQtyMax", e.target.value)} className="w-full px-1.5 py-0.5 text-[11px] rounded border bg-t-input outline-none focus:border-t-accent" style={{ borderColor: "var(--border-color)" }} />
                          </div>
                          <button onClick={() => { updateRangeFilter("minQtyMin", ""); updateRangeFilter("minQtyMax", ""); }} className="text-[10px] text-t-text-3 hover:text-status-error">清除</button>
                        </div>
                      </FilterDropdown>
                    )}
                  </th>
                  {/* 是否可商谈 — 可筛选（多选） */}
                  <th className="text-center px-1.5 py-1 font-medium whitespace-nowrap relative">
                    <Tooltip content="是否允许对方商谈"><span className="inline-flex items-center gap-0.5">可商谈</span></Tooltip>
                    {excelFilterMode && (
                      <FilterArrow colKey="allowCounterOffer" openFilterCol={openFilterCol} setOpenFilterCol={setOpenFilterCol} active={!!headerFilters.allowCounterOffer?.length} />
                    )}
                    {excelFilterMode && openFilterCol === "allowCounterOffer" && (
                      <FilterDropdown onClose={() => setOpenFilterCol(null)}>
                        <MultiCheckList options={filterOptions.allowCounterOffer} selected={headerFilters.allowCounterOffer ?? []} onToggle={(v) => updateMultiFilter("allowCounterOffer", v)} />
                      </FilterDropdown>
                    )}
                  </th>
                </>
              )}
              {/* 状态 — 可筛选（多选） */}
              <th className="text-center px-1.5 py-1 font-medium whitespace-nowrap relative">
                <Tooltip content="挂牌当前交易进度"><span className="inline-flex items-center gap-0.5">状态</span></Tooltip>
                {excelFilterMode && filterTab !== "swap" && (
                  <FilterArrow colKey="statuses" openFilterCol={openFilterCol} setOpenFilterCol={setOpenFilterCol} active={!!headerFilters.statuses?.length} />
                )}
                {excelFilterMode && openFilterCol === "statuses" && filterTab !== "swap" && (
                  <FilterDropdown onClose={() => setOpenFilterCol(null)}>
                    <MultiCheckList
                      options={filterOptions.statuses.map((s) => ({
                        value: s,
                        label: s === "OPEN" ? "挂盘中" : s === "PARTIAL" ? "部分成交" : s === "FILLED" ? "已成交" : s === "CANCELLED" ? "已撤" : s,
                      }))}
                      selected={headerFilters.statuses ?? []}
                      onToggle={(v) => updateMultiFilter("statuses", v)}
                    />
                  </FilterDropdown>
                )}
              </th>
              {canTrade && <th className="text-center px-1.5 py-1 font-medium whitespace-nowrap">操作</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={totalCols} className="px-4 py-6 text-center text-[11px] text-t-text-3">加载中...</td></tr>
            ) : !canTrade ? (
              <tr><td colSpan={totalCols} className="px-4 py-6 text-center text-[11px] text-t-text-3">登录后查看挂盘信息</td></tr>
            ) : isEmpty ? (
              <tr><td colSpan={totalCols} className="px-4 py-6 text-center text-[11px] text-t-text-3">{`暂无${filterTab === "buy" ? "买盘" : filterTab === "sell" ? "卖盘" : "换盘"}挂盘`}</td></tr>
            ) : (
              renderEntries.map((entry, idx) => {
                const rowNo = (page - 1) * pageSize + idx + 1;
                if (entry.type === "swap") return renderSwapRow(entry.item as SwapListing, rowNo);
                return renderListingRow(entry.item as Listing, entry.type === "buy", rowNo);
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 底部分页 */}
      {canTrade && (
        <div
          className="flex items-center justify-between gap-2 px-3 py-1.5 border-t shrink-0 bg-t-panel"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <span className="text-[11px] text-t-text-3 tabular-nums">
            共 {currentTotal} 条 · 每页 {pageSize} 条 · 第 {Math.min(page, maxPages)} / {maxPages} 页
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage(1)}
              disabled={page <= 1}
              className="px-2 py-1 text-[11px] rounded border border-t-border text-t-text-2 hover:bg-t-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              首页
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-2.5 py-1 text-[11px] rounded border border-t-border text-t-text-2 hover:bg-t-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              上一页
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(maxPages, p + 1))}
              disabled={page >= maxPages}
              className="px-2.5 py-1 text-[11px] rounded border border-t-border text-t-text-2 hover:bg-t-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              下一页
            </button>
            <button
              type="button"
              onClick={() => setPage(maxPages)}
              disabled={page >= maxPages}
              className="px-2 py-1 text-[11px] rounded border border-t-border text-t-text-2 hover:bg-t-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              末页
            </button>
          </div>
        </div>
      )}

      {/* 详情必须 portal 到 body，避免被挂盘列表 overflow/relative 裁切，导致下级打开后仍“看得见”详情 */}
      {typeof document !== "undefined" &&
        createPortal(
          <ListingDetailModal
            open={!!(detailListing || detailSwap) && !detailSuppressed}
            listing={detailListing}
            swap={detailSwap}
            products={products as Product[]}
            currentUserId={currentUserId}
            canTrade={canTrade}
            onClose={() => {
              setDetailListing(null);
              setDetailSwap(null);
              setDetailSuppressed(false);
              setDetailUpdated(false);
              setDetailUpdateMessage(null);
              setDetailWithdrawn(false);
            }}
            onTake={withDetailSuppressed(onTake)}
            onCounterOffer={withDetailSuppressed(onCounterOffer)}
            onCancel={handleCancel}
            onEdit={withDetailSuppressed(onEditListing)}
            myPendingCO={!!(detailListing && pendingCounterOffers?.find(co => co.ref_type === "listing" && co.ref_id === detailListing.id))}
            onEditCounterOffer={withDetailSuppressed((l: Listing) => {
              const co = pendingCounterOffers?.find(c => c.ref_type === "listing" && c.ref_id === l.id);
              if (co && onEditCounterOffer) onEditCounterOffer(l, co);
            })}
            onCancelCounterOffer={async (l) => {
              const co = pendingCounterOffers?.find(c => c.ref_type === "listing" && c.ref_id === l.id);
              if (co) {
                try {
                  await cancelCounterOffer(co.id);
                  toast("商谈已取消", "success");
                  queryClient.setQueryData<CounterOffer[]>(["counterOffers", "sent", "pending"], (old) =>
                    (old ?? []).filter((c) => c.id !== co.id)
                  );
                  queryClient.setQueryData<CounterOffer[]>(["counterOffers", "received", "pending"], (old) =>
                    (old ?? []).filter((c) => c.id !== co.id)
                  );
                  queryClient.invalidateQueries({ queryKey: ["counterOffers"] });
                } catch {
                  toast("取消商谈失败", "error");
                }
              }
            }}
            onTakeSwap={withDetailSuppressed(onTakeSwap)}
            onCancelSwap={handleCancelSwap}
            onEditSwap={withDetailSuppressed(onEditSwap)}
            onCounterOfferSwap={withDetailSuppressed(onCounterOfferSwap)}
            mySwapPendingCO={!!(detailSwap && pendingCounterOffers?.find(co => co.ref_type === "swap" && co.ref_id === detailSwap.id))}
            onEditSwapCounterOffer={withDetailSuppressed(() => {
              if (!detailSwap) return;
              const co = pendingCounterOffers?.find(c => c.ref_type === "swap" && c.ref_id === detailSwap.id);
              if (co && onEditCounterOfferSwap) onEditCounterOfferSwap(detailSwap, co);
            })}
            onCancelSwapCounterOffer={async () => {
              if (!detailSwap) return;
              const co = pendingCounterOffers?.find(c => c.ref_type === "swap" && c.ref_id === detailSwap.id);
              if (co) {
                try {
                  await cancelCounterOffer(co.id);
                  toast("商谈已取消", "success");
                  queryClient.setQueryData<CounterOffer[]>(["counterOffers", "sent", "pending"], (old) =>
                    (old ?? []).filter((c) => c.id !== co.id)
                  );
                  queryClient.setQueryData<CounterOffer[]>(["counterOffers", "received", "pending"], (old) =>
                    (old ?? []).filter((c) => c.id !== co.id)
                  );
                  queryClient.invalidateQueries({ queryKey: ["counterOffers"] });
                } catch {
                  toast("取消商谈失败", "error");
                }
              }
            }}
            mySwapLocks={mySwapLocks}
            detailUpdated={detailUpdated}
            detailUpdateMessage={detailUpdateMessage ?? undefined}
            onDismissDetailUpdate={() => { setDetailUpdated(false); setDetailUpdateMessage(null); }}
            detailWithdrawn={detailWithdrawn}
            onDismissDetailWithdrawn={() => setDetailWithdrawn(false)}
          />,
          document.body
        )}
    </div>
  );
}
