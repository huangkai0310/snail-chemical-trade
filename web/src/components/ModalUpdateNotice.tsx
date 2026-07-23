"use client";

import { useEffect } from "react";

interface Props {
  show?: boolean;
  /** updated=信息更新；withdrawn=对方撤盘 */
  variant?: "updated" | "withdrawn";
  message?: string;
  /** 对方修改的具体条款（高亮展示） */
  changedTerms?: string[];
  onDismiss?: () => void;
  /** 自动消失毫秒数；默认 5s，传 0 则需手动关闭 */
  autoDismissMs?: number;
}

function parseChangedTerms(message?: string): string[] {
  if (!message) return [];
  const m = message.match(/^对方已修改：(.+)$/);
  if (!m) return [];
  return m[1].split("、").filter(Boolean);
}

const DEFAULT_AUTO_DISMISS_MS = 5000;

export default function ModalUpdateNotice({
  show,
  variant = "updated",
  message,
  changedTerms,
  onDismiss,
  autoDismissMs = DEFAULT_AUTO_DISMISS_MS,
}: Props) {
  const isWithdrawn = variant === "withdrawn";
  const terms = changedTerms ?? (isWithdrawn ? [] : parseChangedTerms(message));

  useEffect(() => {
    if (!show || !onDismiss) return;
    if (autoDismissMs <= 0) return;
    const t = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(t);
  }, [show, onDismiss, autoDismissMs]);

  if (!show) return null;

  const text =
    message ??
    (isWithdrawn ? "对方已撤盘，无法继续操作" : "盘子信息已更新，请查看最新数据");

  return (
    <div
      className={
        isWithdrawn
          ? "px-4 py-2.5 text-[12px] font-bold text-red-700 dark:text-red-300 bg-red-500/15 border-b-2 border-red-500/50 flex items-center justify-between gap-2 animate-pulse"
          : "px-4 py-2.5 text-[12px] font-bold text-blue-700 dark:text-blue-200 bg-blue-500/15 border-b-2 border-blue-500/50 flex items-center justify-between gap-2 animate-pulse"
      }
    >
      <div className="flex items-start gap-1.5 min-w-0 flex-wrap">
        {isWithdrawn ? (
          <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        ) : (
          <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        )}
        {terms.length > 0 ? (
          <span className="leading-relaxed">
            <span>对方已修改：</span>
            {terms.map((term, i) => (
              <span key={term}>
                {i > 0 && "、"}
                <span className="text-amber-600 dark:text-amber-300 underline decoration-2 underline-offset-2">
                  {term}
                </span>
              </span>
            ))}
            <span className="font-normal text-blue-600/80 dark:text-blue-300/80 ml-1">（请查看最新数据）</span>
          </span>
        ) : (
          <span>{text}</span>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className={`shrink-0 w-5 h-5 flex items-center justify-center rounded transition-colors ${
            isWithdrawn
              ? "hover:bg-red-500/20 text-red-700 dark:text-red-300"
              : "hover:bg-blue-500/25 text-blue-700 dark:text-blue-200"
          }`}
          title="关闭提示"
        >
          ✕
        </button>
      )}
    </div>
  );
}
