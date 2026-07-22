"use client";

import { type ReactNode, useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";

/** 浮层自动消失时间（毫秒）：解决触屏/点击后提示常驻不消失的问题 */
const AUTO_DISMISS_MS = 4000;

/**
 * Tooltip — Portal 渲染的浮层提示
 *
 * 使用 createPortal 渲染到 document.body，解决表格 overflow-auto 裁剪问题。
 * 鼠标悬停时在触发元素上方显示自定义气泡，跟随滚动/缩放实时定位。
 *
 * @example
 * <Tooltip content="是否允许部分成交"><span>可拆</span></Tooltip>
 */
interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  /** 自定义额外 class */
  className?: string;
  /** 触发元素 class */
  triggerClassName?: string;
}

export function Tooltip({
  content,
  children,
  className = "",
  triggerClassName = "",
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, below: false });
  const triggerRef = useRef<HTMLSpanElement>(null);

  const updateCoords = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    // 默认在触发元素上方
    let top = rect.top - 8;
    let below = false;
    // 如果上方空间不足，放到下方
    if (top < 40) {
      top = rect.bottom + 8;
      below = true;
    }
    // 水平边界检测：防止溢出左右屏幕
    let left = rect.left + rect.width / 2;
    const tooltipWidth = 260; // 与 maxWidth 保持一致
    const minLeft = tooltipWidth / 2 + 8;
    const maxLeft = window.innerWidth - tooltipWidth / 2 - 8;
    left = Math.max(minLeft, Math.min(maxLeft, left));
    setCoords({
      top,
      left,
      below,
    });
  }, []);

  const handleEnter = () => {
    updateCoords();
    setOpen(true);
  };

  // 自动消失 + 点击外部关闭：避免提示常驻界面不消失
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => setOpen(false), AUTO_DISMISS_MS);
    const onDocMouseDown = (e: MouseEvent) => {
      if (triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", onDocMouseDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleScroll = () => updateCoords();
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", updateCoords);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", updateCoords);
    };
  }, [open, updateCoords]);

  return (
    <>
      <span
        ref={triggerRef}
        className={`inline-flex items-center cursor-help ${triggerClassName}`}
        onMouseEnter={handleEnter}
        onMouseLeave={() => setOpen(false)}
        onFocus={handleEnter}
        onBlur={() => setOpen(false)}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div
            role="tooltip"
            className={`fixed z-[9999] px-2 py-1 text-[11px] leading-snug rounded shadow-dropdown pointer-events-none ${className}`}
            style={{
              top: coords.top,
              left: coords.left,
              transform: coords.below ? "translate(-50%, 0)" : "translate(-50%, -100%)",
              backgroundColor: "var(--bg-elevated, #374151)",
              color: "var(--text-primary, #e5e7eb)",
              border: "1px solid var(--border-color, #4b5563)",
              maxWidth: "260px",
              wordBreak: "break-word",
              whiteSpace: "normal",
            }}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
}
