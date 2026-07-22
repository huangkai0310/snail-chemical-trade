"use client";

import { useState } from "react";
import type { Product } from "@/lib/types";

interface Props {
  products: Product[];
  activeId: string;
  onSelect: (id: string) => void;
  /** 左侧内容（如侧边栏折叠按钮） */
  leftSlot?: React.ReactNode;
  /** 右侧操作按钮 */
  rightActions?: React.ReactNode;
}

/** 顶部横向品种选择标签 */
export default function ProductTabs({ products, activeId, onSelect, leftSlot, rightActions }: Props) {
  const [overflowOpen, setOverflowOpen] = useState(false);

  // 始终显示所有品种
  const visible = products;
  const overflow = [] as Product[];

  return (
    <nav className="w-full border-b shrink-0"
      style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--bg-secondary)" }}
    >
      <div className="flex items-center gap-0.5 px-2 py-1.5 overflow-x-auto scrollbar-none">
        {leftSlot}
        {visible.map((p) => {
          const isActive = p.id === activeId;
          return (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              className={`whitespace-nowrap px-3 py-1.5 rounded-full text-[13px] font-medium transition-all
                ${isActive
                  ? "shadow-sm"
                  : "text-t-text-2 hover:text-t-text hover:bg-t-hover/60"
                }`}
              style={isActive ? {
                backgroundColor: "var(--bg-primary)",
                color: "var(--accent-color)",
                boxShadow: "var(--shadow-dropdown)",
              } : undefined}
            >
              {p.name}
            </button>
          );
        })}

        {/* 更多下拉（预留，品种多时启用） */}
        {overflow.length > 0 && (
          <div className="relative shrink-0">
            <button
              onClick={() => setOverflowOpen(!overflowOpen)}
              className="whitespace-nowrap px-3 py-1.5 rounded-full text-[13px] font-medium text-t-text-2 hover:bg-t-hover/60 transition-all"
            >
              更多 ▾
            </button>
            {overflowOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOverflowOpen(false)} />
                <div className="absolute right-0 mt-1 z-50 rounded-lg shadow-dropdown border overflow-hidden min-w-[120px]"
                  style={{ backgroundColor: "var(--bg-primary)", borderColor: "var(--border-color)" }}
                >
                  {overflow.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => { onSelect(p.id); setOverflowOpen(false); }}
                      className={`w-full px-4 py-2 text-[13px] text-left transition-colors ${
                        p.id === activeId
                          ? "font-semibold"
                          : "text-t-text-2 hover:bg-t-hover"
                      }`}
                      style={p.id === activeId ? { color: "var(--accent-color)" } : undefined}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
