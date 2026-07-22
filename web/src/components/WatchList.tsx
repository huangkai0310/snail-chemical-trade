"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Product, LatestPriceResponse } from "@/lib/types";
import { fetchLatestPrice } from "@/lib/api";
import { useFavorites } from "@/lib/use-favorites";
import { persistWatchlistTab } from "@/components/PreferencesSync";
import ProductDetailModal from "@/components/ProductDetailModal";

interface Props {
  products: Product[];
  selectedId: string;
  selectedDeliveryPeriod?: string;
  onSelect: (id: string, deliveryPeriod?: string) => void;
  onShowDetail?: (id: string) => void;
  onShowProductView?: (id: string) => void;
  onCollapse?: () => void;
}

type Tab = "favorites" | "overview";

const WL_TAB_KEY = "wl_tab";

function loadTab(): Tab {
  if (typeof window === "undefined") return "overview";
  const v = localStorage.getItem(WL_TAB_KEY);
  return v === "favorites" || v === "overview" ? v : "overview";
}

/** 产品缩写符号表 */
const PRODUCT_SYMBOLS: Record<string, string> = {
  methanol: "MA", pta: "TA", styrene: "SM", meg: "EG", pp: "PP",
  benzene: "BZ", propylene: "PL", phenol: "PH", acetone: "AC",
  isopropanol: "IPA", mibk: "MIBK", toluene: "TL", xylene: "XL",
};

function getSymbol(product: Product): string {
  return PRODUCT_SYMBOLS[product.id] ?? product.name_en ?? product.id.toUpperCase();
}

/** 子类别映射 */
const SUB_CATEGORIES: Record<string, string[]> = {
  "芳烃": ["benzene", "toluene", "xylene", "styrene"],
  "烯烃": ["propylene", "meg", "pp"],
  "酚类": ["phenol", "isopropanol"],
  "酮类": ["acetone", "mibk"],
  "醇类": ["methanol"],
};

// ─── 通用数据行（只显示价格+涨跌幅） ───
function DataRow({
  product, selectedId, selectedDeliveryPeriod, isFav, onOpenDetail, onSelect, onToggleFav, onShowDetail,
  showStar = false,
  cardMode = false,
  deliveryPeriod = "现货",
}: {
  product: Product;
  selectedId: string;
  selectedDeliveryPeriod?: string;
  isFav: (dp: string) => boolean;
  onOpenDetail: (product: Product) => void;
  onSelect: (id: string, dp?: string) => void;
  onToggleFav: (key: string) => void;
  onShowDetail?: (id: string) => void;
  showStar?: boolean;
  cardMode?: boolean;
  deliveryPeriod?: string;
}) {
  // 选中判断：cardMode（自选）时按 productId + deliveryPeriod 精确匹配
  // 品种总览模式按 productId 匹配（总览行无交割期概念）
  const isSelected = cardMode
    ? product.id === selectedId && deliveryPeriod === (selectedDeliveryPeriod ?? "现货")
    : product.id === selectedId;

  const { data: latest } = useQuery<LatestPriceResponse>({
    queryKey: ["latestPrice", product.id, deliveryPeriod],
    queryFn: () => fetchLatestPrice(product.id, deliveryPeriod),
    staleTime: 5_000,
    refetchInterval: 10_000,
  });

  const priceVal = latest?.latest ?? 0;
  const prevClose = latest?.prev_settle ?? latest?.prev_24h ?? priceVal;
  const isUp = priceVal >= prevClose;
  const changePct = prevClose > 0 ? ((priceVal - prevClose) / prevClose) * 100 : 0;
  const changeAmt = priceVal - prevClose;

  const upColor = "text-trade-up-text";
  const downColor = "text-trade-down-text";
  const colorClass = isUp ? upColor : downColor;
  const bgClass = isUp ? "bg-trade-up-bg" : "bg-trade-down-bg";

  return (
    <div
      className={`group border-b transition-colors cursor-pointer ${
        isSelected ? "bg-t-accent-bg" : "hover:bg-t-accent/15"
      }`}
      style={{ borderColor: "var(--border-subtle)" }}
      onClick={() => onShowDetail ? onShowDetail(product.id) : onSelect(product.id, deliveryPeriod)}
    >
      {cardMode ? (
        /* 自选卡片模式：两行布局（按品种+交割期粒度） */
        <div className="px-2.5 py-2 flex items-center gap-1.5">
          {/* 左侧星标 */}
          {showStar && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleFav(`${product.id}:${deliveryPeriod}`); }}
              title={isFav(deliveryPeriod) ? "取消自选" : "添加自选"}
              className={`shrink-0 transition-colors ${
                isFav(deliveryPeriod)
                  ? "text-status-warning"
                  : "text-t-text-3 opacity-30 group-hover:opacity-60"
              }`}
            >
              <svg className="w-4 h-4" fill={isFav(deliveryPeriod) ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            </button>
          )}
          {/* 中间：名称上 + 代码·交割期 下 */}
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium text-t-text truncate leading-tight">{product.name}</div>
            <div className="text-[10px] font-mono mt-0.5">
              <span className="text-t-text-3">{getSymbol(product)}</span>
              <span className="text-t-text-3 mx-0.5">·</span>
              <span className={`font-semibold ${deliveryPeriod === "现货" ? "text-status-warning" : "text-blue-400"}`}>{deliveryPeriod}</span>
            </div>
          </div>
          {/* 右侧：价格 + 涨跌幅 */}
          <div className="text-right shrink-0">
            <div className={`text-[14px] font-bold font-mono tabular-nums ${priceVal > 0 ? colorClass : "text-t-text-3"}`}>
              {priceVal > 0 ? priceVal.toFixed(1) : "-"}
            </div>
            <div className={`text-[11px] font-mono tabular-nums mt-0.5 ${priceVal > 0 ? colorClass : "text-t-text-3"}`}>
              {priceVal > 0 ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%` : "-"}
            </div>
          </div>
        </div>
      ) : (
        /* 品种总览模式：代码 + 名称 + 价格 + 涨跌幅 紧凑单行（同花顺风格） */
        <div className="flex items-center px-2 py-1 gap-1">
          <span className="text-[10px] font-mono font-bold text-t-accent w-7 shrink-0 tabular-nums text-center">
            {getSymbol(product)}
          </span>
          <span className={`text-[13px] font-bold truncate flex-1 min-w-0 ${isSelected ? "text-t-accent" : "text-t-text"}`}>
            {product.name}
          </span>
          <span className={`text-[13px] font-bold font-mono tabular-nums shrink-0 text-right w-12 ${priceVal > 0 ? colorClass : "text-t-text-3"}`}>
            {priceVal > 0 ? priceVal.toFixed(0) : "-"}
          </span>
          <span className={`text-[11px] font-bold font-mono tabular-nums shrink-0 text-right w-12 px-1 py-0.5 rounded ${priceVal > 0 ? `${colorClass} ${bgClass}` : "text-t-text-3"}`}>
            {priceVal > 0 ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%` : "-"}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── 表头（品种总览：代码+名称+现价+涨跌幅） ───
function ColumnHeader() {
  return (
    <div className="flex items-center px-2 py-1 text-[10px] text-t-text-3 border-b gap-1"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      <span className="w-7 shrink-0 text-center">代码</span>
      <span className="flex-1 min-w-0">名称</span>
      <span className="text-right shrink-0 w-12">现价</span>
      <span className="text-right shrink-0 w-12">涨跌幅</span>
    </div>
  );
}

// ─── 自选：排序按钮组 ───
type SortKey = "default" | "name" | "price" | "changePct";

// ─── 主组件 ───
export default function WatchList({ products, selectedId, selectedDeliveryPeriod, onSelect, onShowDetail, onShowProductView, onCollapse }: Props) {
  const [tab, setTab] = useState<Tab>(loadTab);

  const changeTab = (t: Tab) => {
    setTab(t);
    persistWatchlistTab(t);
  };

  useEffect(() => {
    const apply = () => setTab(loadTab());
    window.addEventListener("wl-tab-changed", apply);
    return () => window.removeEventListener("wl-tab-changed", apply);
  }, []);

  const { favorites, favCount, toggleFavorite, reorderFavorites, isFav } = useFavorites();
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  // 品种总览：分类折叠状态（集合内的分类=已折叠；默认全部折叠）
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    () => new Set(Object.keys(SUB_CATEGORIES))
  );
  // 自选：排序
  const [favSort, setFavSort] = useState<SortKey>("default");
  // 拖拽状态
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const productsMap = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  /** 大盘：按子分类分组 */
  const boardGroups = useMemo(() => {
    const assigned = new Set<string>();
    const result: { subName: string; items: Product[] }[] = [];

    for (const [subName, productIds] of Object.entries(SUB_CATEGORIES)) {
      const group: Product[] = [];
      for (const pid of productIds) {
        const p = productsMap.get(pid);
        if (p && !assigned.has(pid)) {
          group.push(p);
          assigned.add(pid);
        }
      }
      if (group.length > 0) {
        group.sort((a, b) => a.sort_order - b.sort_order);
        result.push({ subName, items: group });
      }
    }

    const remaining: Product[] = [];
    for (const p of products) {
      if (!assigned.has(p.id)) remaining.push(p);
    }
    if (remaining.length > 0) {
      remaining.sort((a, b) => a.sort_order - b.sort_order);
      result.push({ subName: "其他", items: remaining });
    }

    return result;
  }, [products, productsMap]);

  // 首次挂载时把动态分类（如「其他」）也纳入折叠集合，确保「品种总览」默认全部折叠
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      for (const g of boardGroups) next.add(g.subName);
      return next;
    });
  }, [boardGroups]);

  // 自选列表：按 productId + deliveryPeriod 为最小粒度渲染
  // 产品列表尚未加载时仍显示自选项，避免「登录后自选短暂/持续消失」
  const favEntries = useMemo(() => {
    const entries = favorites.map((f) => {
      const product =
        productsMap.get(f.productId) ??
        ({
          id: f.productId,
          name: f.productId,
          unit: "吨",
          sort_order: 0,
          active: true,
          created_at: "",
        } satisfies Product);
      return { f, product };
    });

    if (favSort === "name") {
      entries.sort((a, b) => a.product.name.localeCompare(b.product.name, "zh"));
    }
    return entries;
  }, [favorites, productsMap, favSort]);

  const openDetail = useCallback((p: Product) => setDetailProduct(p), []);
  const closeDetail = useCallback(() => setDetailProduct(null), []);

  // 所有分类名 + 品种数映射
  const categoryCountMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const g of boardGroups) m[g.subName] = g.items.length;
    return m;
  }, [boardGroups]);

  // 切换分类折叠
  const toggleCategory = useCallback((name: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  // 全部展开/折叠
  const allExpanded = expandedCategories.size === 0;
  const toggleAllCategories = useCallback(() => {
    if (allExpanded) {
      // 当前全部展开 → 折叠全部
      setExpandedCategories(new Set(boardGroups.map(g => g.subName)));
    } else {
      // 当前有折叠 → 全部展开
      setExpandedCategories(new Set());
    }
  }, [allExpanded, boardGroups]);

  // 排序切换
  const cycleSort = () => {
    const keys: SortKey[] = ["default", "name", "changePct"];
    const idx = keys.indexOf(favSort);
    setFavSort(keys[(idx + 1) % keys.length]);
  };

  const sortLabel: Record<SortKey, string> = {
    default: "默认",
    name: "名称",
    changePct: "涨幅",
    price: "现价",
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-t-panel">
      {/* ── Tab 栏 ── */}
      <div className="flex items-center border-b shrink-0 h-9"
        style={{ borderColor: "var(--border-color)" }}
      >
        {/* 自选 Tab */}
        <button
          onClick={() => changeTab("favorites")}
          className={`px-3 h-full text-xs font-medium transition-colors relative flex items-center gap-1.5 ${
            tab === "favorites" ? "text-t-text" : "text-t-text-3 hover:text-t-text-2"
          }`}
        >
          自选
          {favCount > 0 && (
            <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${
              tab === "favorites"
                ? "bg-t-accent-bg text-t-accent"
                : "bg-t-tertiary text-t-text-3"
            }`}>
              {favCount}
            </span>
          )}
          {tab === "favorites" && <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-t-accent rounded-full" />}
        </button>

        {/* 大盘 Tab */}
        <button
          onClick={() => changeTab("overview")}
          className={`px-3 h-full text-xs font-medium transition-colors relative ${
            tab === "overview" ? "text-t-text" : "text-t-text-3 hover:text-t-text-2"
          }`}
        >
          品种总览
          {tab === "overview" && <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-t-accent rounded-full" />}
        </button>

        {/* 自选排序 */}
        {tab === "favorites" && favCount > 0 && (
          <button
            onClick={cycleSort}
            className="ml-auto mr-1 text-[11px] text-t-text-3 hover:text-t-text-2 transition-colors flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
            </svg>
            {sortLabel[favSort]}
          </button>
        )}
        {/* 非自选 tab 时，用 ml-auto 撑开，让收起按钮始终在最右侧 */}
        {tab !== "favorites" && <span className="ml-auto" />}
        {/* 收起按钮 — Tab 栏最右侧 */}
        {onCollapse && (
          <button
            onClick={onCollapse}
            className="mr-0.5 w-6 h-7 flex items-center justify-center rounded-md text-t-text-3 hover:text-t-text hover:bg-t-hover transition-all shrink-0"
            title="收起品种栏"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 19l-7-7 7-7M18 19l-7-7 7-7" />
            </svg>
          </button>
        )}
      </div>

      {/* ── 品种总览：展开/折叠控制 ── */}
      {tab === "overview" && (
        <div className="flex items-center justify-end px-2 py-0.5 border-b shrink-0"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <button
            onClick={toggleAllCategories}
            className="text-[10px] text-t-text-3 hover:text-t-text-2 transition-colors flex items-center gap-0.5"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d={allExpanded ? "M19 9l-7 7-7-7" : "M5 15l7-7 7 7"} />
            </svg>
            {allExpanded ? "全部折叠" : "全部展开"}
          </button>
        </div>
      )}

      {/* ── 内容区 ── */}
      <div className="flex-1 overflow-auto">
        {/* ═══ 自选 Tab ═══ */}
        {tab === "favorites" && (
          <div>
            {favCount === 0 ? (
              /* 空状态 */
              <div className="flex flex-col items-center justify-center py-12 px-4">
                <div className="w-14 h-14 rounded-full bg-t-tertiary flex items-center justify-center mb-3">
                  <svg className="w-6 h-6 text-t-text-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                </div>
                <p className="text-sm text-t-text-3 mb-1">暂无自选品种</p>
                <p className="text-[11px] text-t-text-3 mb-3">切换到「品种总览」点击星标添加</p>
                <button
                  onClick={() => changeTab("overview")}
                  className="text-[11px] px-4 py-1.5 rounded bg-t-accent-bg text-t-accent hover:bg-t-accent hover:text-white transition-colors"
                >
                  去添加
                </button>
              </div>
            ) : (
              <div>
                {favEntries.map(({ f, product }) => (
                  <div
                    key={f.key}
                    draggable={favSort === "default"}
                    onDragStart={(e) => {
                      setDraggedKey(f.key);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      setDraggedKey(null);
                      setDragOverKey(null);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (dragOverKey !== f.key) setDragOverKey(f.key);
                    }}
                    onDragLeave={() => {
                      if (dragOverKey === f.key) setDragOverKey(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (draggedKey && draggedKey !== f.key) {
                        reorderFavorites(draggedKey, f.key);
                      }
                      setDraggedKey(null);
                      setDragOverKey(null);
                    }}
                    className={`transition-opacity ${draggedKey === f.key ? "opacity-40" : ""} ${
                      dragOverKey === f.key && draggedKey !== f.key ? "border-t-2 border-t-blue-400" : ""
                    }`}
                  >
                    <DataRow
                      product={product}
                      selectedId={selectedId}
                      selectedDeliveryPeriod={selectedDeliveryPeriod}
                      isFav={isFav(product.id)}
                      onOpenDetail={openDetail}
                      onSelect={onSelect}
                      onToggleFav={toggleFavorite}
                      onShowDetail={onShowDetail}
                      showStar
                      cardMode
                      deliveryPeriod={f.deliveryPeriod}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══ 品种总览 Tab ═══ */}
        {tab === "overview" && (
          <div>
            {/* 表头 */}
            <div className="sticky top-0 z-10 bg-t-panel">
              <ColumnHeader />
            </div>

            {boardGroups.map(({ subName, items }) => {
              const isExpanded = !expandedCategories.has(subName);
              return (
                <div key={subName}>
                  {/* 分类标题 — 可折叠树节点 */}
                  <button
                    onClick={() => toggleCategory(subName)}
                    className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold text-t-text-3 bg-t-tertiary border-b sticky top-[28px] z-[5] hover:bg-t-hover transition-colors"
                    style={{ borderColor: "var(--border-subtle)" }}
                  >
                    <svg className={`w-3 h-3 shrink-0 transition-transform ${isExpanded ? "" : "-rotate-90"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                    </svg>
                    <span className="flex-1 text-left">{subName}</span>
                    <span className="text-[10px] font-normal text-t-text-3 mr-1">{items.length}</span>
                  </button>

                  {/* 品种行（展开时显示） */}
                  {isExpanded && items.map(p => (
                    <DataRow
                      key={p.id}
                      product={p}
                      selectedId={selectedId}
                      selectedDeliveryPeriod={selectedDeliveryPeriod}
                      isFav={isFav(p.id)}
                      onOpenDetail={openDetail}
                      onSelect={onSelect}
                      onToggleFav={toggleFavorite}
                      onShowDetail={(id: string) => {
                        const product = productsMap.get(id);
                        if (product) openDetail(product);
                      }}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 产品详情弹窗 ── */}
      {detailProduct && (
        <ProductDetailModal
          open={true}
          product={detailProduct}
          onClose={closeDetail}
          onSelect={onSelect}
          onToggleFav={toggleFavorite}
          isFav={isFav(detailProduct.id)}
        />
      )}
    </div>
  );
}
