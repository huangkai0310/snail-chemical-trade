"use client";

import { useEffect, useState, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";

// ---------- 全局确认弹框（Promise 风格，可直接替换 window.confirm） ----------

export type EditChangeSide = "sell" | "buy" | "neutral";

export interface EditChangeItem {
  label: string;
  before: string;
  after: string;
  /** 换盘：卖盘绿 / 买盘红；挂盘或其它为中性琥珀 */
  side?: EditChangeSide;
}

export interface ConfirmOptions {
  title?: string;
  /** 纯文本消息（与 content / changes 并存时，优先 content，其次 changes） */
  message: string;
  /** 富文本内容 */
  content?: ReactNode;
  /** 编辑变更列表（高亮展示「字段：旧 → 新」） */
  changes?: EditChangeItem[];
  /** changes 模式的引言 */
  changesIntro?: string;
  /** changes 模式的结尾说明 */
  changesOutro?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "danger" | "warning" | "success";
  icon?: "info" | "warning" | "danger" | "success";
  wide?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

let confirmFn: ((opts: ConfirmOptions) => Promise<boolean>) | null = null;

/**
 * 全局确认弹框 — 用法与 window.confirm 一致，返回 Promise<boolean>
 */
export function confirmDialog(opts: ConfirmOptions | string): Promise<boolean> {
  const options = typeof opts === "string" ? { message: opts } : opts;
  if (!confirmFn) {
    return Promise.resolve(window.confirm(options.message || "确认执行此操作？"));
  }
  return confirmFn(options);
}

const SIDE_STYLES: Record<
  EditChangeSide,
  {
    wrap: string;
    badge: string;
    badgeText: string;
    item: string;
    label: string;
    arrow: string;
    after: string;
  }
> = {
  sell: {
    wrap: "rounded-lg border-2 border-green-500 bg-green-50 dark:bg-green-950/40 px-3 py-3 space-y-2",
    badge: "bg-green-500 text-white",
    badgeText: "卖盘变更",
    item: "rounded-md bg-white/80 dark:bg-black/20 px-2.5 py-2 border border-green-400/50",
    label: "text-[11px] font-bold text-green-700 dark:text-green-300 mb-1",
    arrow: "bg-green-500 text-white",
    after:
      "font-bold text-green-900 dark:text-green-100 bg-green-200/80 dark:bg-green-500/30 px-1.5 py-0.5 rounded",
  },
  buy: {
    wrap: "rounded-lg border-2 border-red-500 bg-red-50 dark:bg-red-950/40 px-3 py-3 space-y-2",
    badge: "bg-red-500 text-white",
    badgeText: "买盘变更",
    item: "rounded-md bg-white/80 dark:bg-black/20 px-2.5 py-2 border border-red-400/50",
    label: "text-[11px] font-bold text-red-700 dark:text-red-300 mb-1",
    arrow: "bg-red-500 text-white",
    after:
      "font-bold text-red-900 dark:text-red-100 bg-red-200/80 dark:bg-red-500/30 px-1.5 py-0.5 rounded",
  },
  neutral: {
    wrap: "rounded-lg border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/40 px-3 py-3 space-y-2",
    badge: "bg-amber-500 text-white",
    badgeText: "已更改",
    item: "rounded-md bg-white/80 dark:bg-black/20 px-2.5 py-2 border border-amber-400/40",
    label: "text-[11px] font-bold text-amber-700 dark:text-amber-300 mb-1",
    arrow: "bg-amber-500 text-white",
    after:
      "font-bold text-amber-900 dark:text-amber-100 bg-amber-200/80 dark:bg-amber-500/30 px-1.5 py-0.5 rounded",
  },
};

function inferSideFromLabel(label: string): EditChangeSide {
  if (label.startsWith("卖盘") || label.startsWith("卖出")) return "sell";
  if (label.startsWith("买盘") || label.startsWith("买入") || label.startsWith("换入")) return "buy";
  return "neutral";
}

function ChangeItemRow({ item }: { item: EditChangeItem }) {
  const side = item.side ?? inferSideFromLabel(item.label);
  const s = SIDE_STYLES[side];
  return (
    <li className={s.item}>
      <div className={s.label}>{item.label}</div>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] break-all">
        <span className="text-t-text-3 line-through opacity-70">{item.before}</span>
        <span
          className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded text-[10px] font-black ${s.arrow}`}
        >
          →
        </span>
        <span className={s.after}>{item.after}</span>
      </div>
    </li>
  );
}

function ChangeSideBlock({
  side,
  items,
}: {
  side: EditChangeSide;
  items: EditChangeItem[];
}) {
  if (items.length === 0) return null;
  const s = SIDE_STYLES[side];
  return (
    <div className={s.wrap}>
      <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-bold ${s.badge}`}>
        {s.badgeText} ({items.length})
      </div>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <ChangeItemRow key={`${item.label}-${i}`} item={{ ...item, side }} />
        ))}
      </ul>
    </div>
  );
}

/** 编辑变更高亮块（也可单独使用） */
export function EditChangesConfirmContent({
  intro,
  changes,
  changeLines,
  outro,
}: {
  intro: string;
  changes?: EditChangeItem[];
  /** @deprecated 兼容旧字符串行 */
  changeLines?: string[];
  outro: string;
}) {
  const items: EditChangeItem[] =
    changes && changes.length > 0
      ? changes
      : (changeLines ?? []).map((line) => {
          const text = line.replace(/^[·•]\s*/, "");
          const m = text.match(/^(.+?)[：:](.+?)\s*→\s*(.+)$/);
          if (!m) return { label: "变更", before: "-", after: text };
          return { label: m[1], before: m[2].trim(), after: m[3].trim() };
        });

  const sellItems = items.filter((it) => (it.side ?? inferSideFromLabel(it.label)) === "sell");
  const buyItems = items.filter((it) => (it.side ?? inferSideFromLabel(it.label)) === "buy");
  const neutralItems = items.filter((it) => (it.side ?? inferSideFromLabel(it.label)) === "neutral");
  const hasSides = sellItems.length > 0 || buyItems.length > 0;

  return (
    <div className="space-y-3 text-sm">
      <p className="text-t-text leading-relaxed font-medium">{intro}</p>
      {items.length === 0 ? (
        <div className={SIDE_STYLES.neutral.wrap}>
          <p className="text-[12px] font-semibold text-amber-800 dark:text-amber-200">已更改部分条款</p>
        </div>
      ) : hasSides ? (
        <div className="space-y-2.5">
          <ChangeSideBlock side="sell" items={sellItems} />
          <ChangeSideBlock side="buy" items={buyItems} />
          <ChangeSideBlock side="neutral" items={neutralItems} />
        </div>
      ) : (
        <ChangeSideBlock side="neutral" items={neutralItems.length ? neutralItems : items} />
      )}
      <p className="text-[11px] text-t-text-3 leading-relaxed">{outro}</p>
    </div>
  );
}

// ---------- 图标 ----------

function ConfirmIcon({ type }: { type: NonNullable<ConfirmOptions["icon"]> }) {
  const iconConfig: Record<string, { color: string; bg: string; path: string }> = {
    info: {
      color: "text-blue-500",
      bg: "bg-blue-500/10",
      path: "M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z",
    },
    warning: {
      color: "text-amber-500",
      bg: "bg-amber-500/10",
      path: "M12 9v3.75m0 3.75h.007M5.987 18.406A9 9 0 1018.405 5.988 9 9 0 005.987 18.406z",
    },
    danger: {
      color: "text-red-500",
      bg: "bg-red-500/10",
      path: "M12 9v3.75m0 3.75h.007M5.987 18.406A9 9 0 1018.405 5.988 9 9 0 005.987 18.406z",
    },
    success: {
      color: "text-green-500",
      bg: "bg-green-500/10",
      path: "M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    },
  };
  const cfg = iconConfig[type] || iconConfig.info;
  return (
    <div className={`w-10 h-10 rounded-full ${cfg.bg} flex items-center justify-center flex-shrink-0`}>
      <svg className={`w-5 h-5 ${cfg.color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d={cfg.path} />
      </svg>
    </div>
  );
}

function getVariantClasses(variant: ConfirmOptions["variant"]): {
  confirm: string;
  cancel: string;
} {
  switch (variant) {
    case "danger":
      return {
        confirm: "bg-red-600 hover:bg-red-700 text-white",
        cancel: "bg-t-hover text-t-text-2 hover:bg-t-border",
      };
    case "warning":
      return {
        confirm: "bg-amber-600 hover:bg-amber-700 text-white",
        cancel: "bg-t-hover text-t-text-2 hover:bg-t-border",
      };
    case "success":
      return {
        confirm: "bg-green-600 hover:bg-green-700 text-white",
        cancel: "bg-t-hover text-t-text-2 hover:bg-t-border",
      };
    default:
      return {
        confirm: "bg-brand-600 hover:bg-brand-700 text-white",
        cancel: "bg-t-hover text-t-text-2 hover:bg-t-border",
      };
  }
}

function inferIcon(variant: ConfirmOptions["variant"]): NonNullable<ConfirmOptions["icon"]> {
  switch (variant) {
    case "danger": return "danger";
    case "warning": return "warning";
    case "success": return "success";
    default: return "info";
  }
}

// ---------- Provider 组件 ----------

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleConfirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setState({ ...opts, resolve });
    });
  }, []);

  useEffect(() => {
    confirmFn = handleConfirm;
    return () => { confirmFn = null; };
  }, [handleConfirm]);

  const handleClose = useCallback((result: boolean) => {
    if (state) {
      state.resolve(result);
      setState(null);
    }
  }, [state]);

  useEffect(() => {
    if (!state) return;
    let armed = false;
    const armTimer = window.setTimeout(() => {
      armed = true;
    }, 350);
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        handleClose(false);
        return;
      }
      if (e.key === "Enter" && armed) {
        e.preventDefault();
        e.stopPropagation();
        handleClose(true);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => {
      window.clearTimeout(armTimer);
      window.removeEventListener("keydown", handler, true);
    };
  }, [state, handleClose]);

  const dialog =
    state && mounted
      ? createPortal(
          (() => {
            const variant = state.variant || "default";
            const icon = state.icon || inferIcon(variant);
            const classes = getVariantClasses(variant);
            const hasChanges = !!(state.changes && state.changes.length > 0);
            const maxW = state.wide ? "max-w-lg" : state.content || hasChanges ? "max-w-md" : "max-w-sm";

            return (
              <div className="fixed inset-0 z-[10050] flex items-center justify-center p-4">
                <div
                  className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                  onClick={() => handleClose(false)}
                />
                <div
                  className={`relative bg-t-panel border border-t-border rounded-2xl shadow-2xl w-full ${maxW} overflow-hidden max-h-[85vh] flex flex-col`}
                  role="alertdialog"
                  aria-modal="true"
                >
                  <div className="p-6 overflow-y-auto min-h-0">
                    <div className="flex items-start gap-4">
                      <ConfirmIcon type={icon} />
                      <div className="flex-1 min-w-0">
                        {state.title && (
                          <h3 className="text-base font-semibold text-t-text mb-2">{state.title}</h3>
                        )}
                        {state.content ? (
                          state.content
                        ) : hasChanges ? (
                          <EditChangesConfirmContent
                            intro={state.changesIntro || state.message}
                            changes={state.changes}
                            outro={state.changesOutro || "请核对后再确认。"}
                          />
                        ) : (
                          <p className="text-sm text-t-text-2 leading-relaxed whitespace-pre-line">
                            {state.message}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-3 px-6 py-4 bg-t-card/50 border-t border-t-border shrink-0">
                    <button
                      type="button"
                      onClick={() => handleClose(false)}
                      className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${classes.cancel}`}
                    >
                      {state.cancelText || "取消"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleClose(true)}
                      className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${classes.confirm}`}
                    >
                      {state.confirmText || "确定"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })(),
          document.body,
        )
      : null;

  return (
    <>
      {children}
      {dialog}
    </>
  );
}
