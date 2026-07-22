"use client";

import { useState } from "react";

interface Props {
  /** 展示名称（公司名优先） */
  displayName: string;
  /** 确认拉黑回调；返回 Promise，成功后由父组件关闭 */
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

/**
 * 拉黑确认弹窗：拉黑后双方互相看不到发盘，且无法成交。
 */
export default function BlockUserModal({ displayName, onConfirm, onCancel }: Props) {
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-[420px] max-w-[92vw] rounded-xl shadow-2xl border overflow-hidden"
        style={{ backgroundColor: "var(--bg-panel)", borderColor: "var(--border-color)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-5 pt-5 pb-3">
          <div className="w-10 h-10 rounded-full bg-status-error-bg flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-status-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-t-text">确认拉黑</h3>
            <p className="mt-1 text-xs text-t-text-2 leading-relaxed">
              确定将「{displayName || "该用户"}」加入黑名单？
            </p>
          </div>
        </div>

        <div className="px-5 pb-3">
          <div className="rounded-lg bg-status-warning-bg px-3 py-2.5 text-[11px] text-status-warning leading-relaxed space-y-1.5">
            <p>
              拉黑后<strong className="font-semibold">双方都看不到对方的发盘</strong>
              （行情列表与详情均不可见）。
            </p>
            <p>
              同时<strong className="font-semibold">无法与对方成交</strong>
              （摘盘、议价、自动撮合均不可）。
            </p>
            <p className="text-status-warning/90">
              若对方将您移出黑名单或您主动移除，关系解除后恢复可见与可成交。
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: "var(--border-subtle)" }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="px-4 py-2 text-xs rounded-md bg-t-hover text-t-text-2 hover:bg-t-active disabled:opacity-50 transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="px-4 py-2 text-xs font-medium rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? "拉黑中..." : "确认拉黑"}
          </button>
        </div>
      </div>
    </div>
  );
}
