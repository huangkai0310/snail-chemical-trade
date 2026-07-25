"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDeliveryPeriodDisplay, sortDeliveryPeriods } from "@/lib/delivery-period";
import { fetchProductContracts } from "@/lib/api";

interface ProductOpt {
  id: string;
  name: string;
}

interface Props {
  products: ProductOpt[];
  productId: string;
  deliveryPeriod: string;
  onProductChange: (productId: string) => void;
  onDeliveryPeriodChange: (deliveryPeriod: string) => void;
  className?: string;
}

/** 品种 + 交割期紧凑选择器（今日挂盘列表标题旁） */
export default function ContractSelector({
  products,
  productId,
  deliveryPeriod,
  onProductChange,
  onDeliveryPeriodChange,
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const productName = products.find((p) => p.id === productId)?.name ?? productId;
  const label = `${productName}${deliveryPeriod ? ` · ${formatDeliveryPeriodDisplay(deliveryPeriod)}` : ""}`;

  const contractsQuery = useQuery({
    queryKey: ["contracts", productId],
    queryFn: () => fetchProductContracts(productId),
    staleTime: 30_000,
    enabled: open && !!productId,
  });

  const periods = useMemo(() => {
    const raw = contractsQuery.data ?? [];
    const seen = new Set<string>();
    const list: string[] = [];
    const push = (dp: string) => {
      if (!dp || seen.has(dp)) return;
      seen.add(dp);
      list.push(dp);
    };
    push("现货");
    for (const c of raw) push(c.delivery_period);
    if (deliveryPeriod) push(deliveryPeriod);
    return sortDeliveryPeriods(list).map((delivery_period) => ({ delivery_period }));
  }, [contractsQuery.data, deliveryPeriod]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="px-1.5 py-0.5 text-[11px] font-semibold rounded whitespace-nowrap shrink-0 bg-t-accent-bg text-t-accent border border-t-accent/25 hover:border-t-accent inline-flex items-center gap-1"
        title="选择品种与交割期"
      >
        {label}
        <svg
          className={`w-3 h-3 opacity-70 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 w-[280px] bg-t-panel border border-t-border rounded-lg shadow-xl p-2">
          <div className="text-[10px] text-t-text-3 mb-1 px-1">品种</div>
          <div className="max-h-36 overflow-y-auto mb-2 grid grid-cols-2 gap-0.5">
            {products.map((p) => {
              const active = p.id === productId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onProductChange(p.id);
                    // 切品种时默认现货；合约列表加载后再由用户改
                    if (p.id !== productId) onDeliveryPeriodChange("现货");
                  }}
                  className={`text-left text-[11px] px-2 py-1.5 rounded truncate ${
                    active
                      ? "bg-brand-600 text-white"
                      : "text-t-text hover:bg-t-hover"
                  }`}
                >
                  {p.name}
                </button>
              );
            })}
          </div>

          <div className="text-[10px] text-t-text-3 mb-1 px-1 border-t border-t-border pt-2">
            交割期
            <span className="ml-1 text-t-text-3/70">（已建立合约）</span>
          </div>
          <div className="max-h-40 overflow-y-auto flex flex-wrap gap-1">
            {contractsQuery.isLoading ? (
              <span className="text-[11px] text-t-text-3 px-1 py-1">加载中…</span>
            ) : (
              periods.map((c) => {
                const active = c.delivery_period === deliveryPeriod;
                const isSpot = c.delivery_period === "现货";
                return (
                  <button
                    key={c.delivery_period}
                    type="button"
                    onClick={() => {
                      onDeliveryPeriodChange(c.delivery_period);
                      setOpen(false);
                    }}
                    className={`text-[11px] px-2 py-1 rounded border tabular-nums ${
                      active
                        ? "border-brand-500 bg-brand-500/15 text-brand-600 font-semibold"
                        : isSpot
                          ? "border-status-warning/40 text-status-warning hover:bg-status-warning/10"
                          : "border-t-border text-t-text-2 hover:bg-t-hover"
                    }`}
                  >
                    {formatDeliveryPeriodDisplay(c.delivery_period)}
                  </button>
                );
              })
            )}
          </div>
          <p className="mt-2 px-1 text-[10px] text-t-text-3 leading-relaxed">
            新交割期由用户首次发盘时建立；发盘后即可在此选择。
          </p>
        </div>
      )}
    </div>
  );
}
