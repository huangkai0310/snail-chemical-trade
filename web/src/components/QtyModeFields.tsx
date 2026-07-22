"use client";

import { Tooltip } from "./ui/Tooltip";
import type { QtyMode } from "@/lib/qty-mode";
import { computeSharesTotal } from "@/lib/qty-mode";

interface Props {
  mode: QtyMode;
  unit?: string;
  /** 整单数量 */
  quantity: string;
  perShare: string;
  shareCount: string;
  onModeChange: (mode: QtyMode) => void;
  onQuantityChange: (v: string) => void;
  onPerShareChange: (v: string) => void;
  onShareCountChange: (v: string) => void;
  error?: string;
  /** 紧凑布局（换盘双列） */
  compact?: boolean;
  labelAccent?: string;
}

/**
 * 发盘数量：整单 / 按份数
 * 整单 = 不可拆；按份数 = 可拆（每份=最小成交量）
 */
export default function QtyModeFields({
  mode,
  unit = "吨",
  quantity,
  perShare,
  shareCount,
  onModeChange,
  onQuantityChange,
  onPerShareChange,
  onShareCountChange,
  error,
  compact = false,
  labelAccent,
}: Props) {
  const total = mode === "shares" ? computeSharesTotal(perShare, shareCount) : Math.floor(Number(quantity) || 0);
  const labelCls = labelAccent ?? "text-sm font-medium text-t-text-2";
  const inputCls = compact
    ? "w-full px-2 py-1.5 border border-t-border rounded-lg text-xs bg-t-panel text-t-text focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
    : "w-full px-3 py-2.5 border border-t-border rounded-lg text-sm bg-t-panel text-t-text focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none";

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={compact ? "text-xs font-medium text-t-text-3" : labelCls}>数量方式</span>
        <Tooltip content="整单：一次性全部成交，不可拆。按份数：填写每份数量与份数，可按份成交（每份即最小成交量）。">
          <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-t-text-3 text-white text-[9px] cursor-help">?</span>
        </Tooltip>
        <div className="flex rounded-lg border border-t-border overflow-hidden text-xs">
          <button
            type="button"
            onClick={() => onModeChange("whole")}
            className={`px-2.5 py-1 transition-colors ${
              mode === "whole"
                ? "bg-brand-600 text-white"
                : "bg-t-panel text-t-text-2 hover:bg-t-hover"
            }`}
          >
            整单
          </button>
          <button
            type="button"
            onClick={() => onModeChange("shares")}
            className={`px-2.5 py-1 transition-colors border-l border-t-border ${
              mode === "shares"
                ? "bg-brand-600 text-white"
                : "bg-t-panel text-t-text-2 hover:bg-t-hover"
            }`}
          >
            按份数
          </button>
        </div>
      </div>

      {mode === "whole" ? (
        <div>
          <label className={`block mb-1 ${compact ? "text-[10px] text-t-text-3" : "text-xs text-t-text-3"}`}>
            整单数量 ({unit})
          </label>
          <input
            type="number"
            inputMode="numeric"
            value={quantity}
            onChange={(e) => onQuantityChange(e.target.value)}
            placeholder="如 1000"
            min="1"
            step="1"
            className={inputCls}
          />
        </div>
      ) : (
        <div className={`grid gap-2 ${compact ? "grid-cols-1" : "grid-cols-2"}`}>
          <div>
            <label className={`block mb-1 ${compact ? "text-[10px] text-t-text-3" : "text-xs text-t-text-3"}`}>
              每份数量 ({unit})
            </label>
            <input
              type="number"
              inputMode="numeric"
              value={perShare}
              onChange={(e) => onPerShareChange(e.target.value)}
              placeholder="如 100"
              min="1"
              step="1"
              className={inputCls}
            />
          </div>
          <div>
            <label className={`block mb-1 ${compact ? "text-[10px] text-t-text-3" : "text-xs text-t-text-3"}`}>
              一共几份
            </label>
            <input
              type="number"
              inputMode="numeric"
              value={shareCount}
              onChange={(e) => onShareCountChange(e.target.value)}
              placeholder="如 10"
              min="1"
              step="1"
              className={inputCls}
            />
          </div>
          <div className={compact ? "" : "col-span-2"}>
            <p className="text-xs text-t-text-3">
              整单数量：{" "}
              <span className="font-mono font-medium text-t-text">
                {total > 0 ? `${total.toLocaleString()} ${unit}` : "—"}
              </span>
              {perShare && shareCount && Number(perShare) > 0 && Number(shareCount) > 0 && (
                <span className="ml-1">（每份 {Math.floor(Number(perShare))} × {Math.floor(Number(shareCount))} 份）</span>
              )}
            </p>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-status-error">{error}</p>}
    </div>
  );
}
