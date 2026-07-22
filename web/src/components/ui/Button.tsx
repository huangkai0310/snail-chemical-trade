"use client";

import { type ButtonHTMLAttributes, type ReactNode } from "react";

/**
 * Button — 统一按钮组件
 * 
 * 替代各组件中手写的 px-3 py-1 bg-brand-600 等碎片化样式。
 * 
 * @example
 * <Button variant="primary" size="sm">挂牌</Button>
 * <Button variant="ghost" size="xs">更多</Button>
 */

type ButtonVariant =
  | "primary"    // 红色实心（主操作）
  | "secondary"  // 灰色实心
  | "ghost"      // 透明背景
  | "outline"    // 描边
  | "danger"     // 红色实心（危险操作）
  | "success";   // 绿色实心

type ButtonSize = "xs" | "sm" | "md";

const VARIANT_STYLES: Record<ButtonVariant, string> = {
  primary: "bg-t-accent hover:bg-t-accent-hover text-white",
  secondary: "bg-t-tertiary hover:bg-t-hover text-t-text",
  ghost: "bg-transparent hover:bg-t-hover text-t-text-2",
  outline: "bg-transparent border border-t-border hover:bg-t-hover text-t-text",
  danger: "bg-status-error hover:opacity-90 text-white",
  success: "bg-[var(--color-success)] hover:opacity-90 text-white",
};

const SIZE_STYLES: Record<ButtonSize, string> = {
  xs: "text-[11px] px-2 py-0.5 rounded",
  sm: "text-xs px-2.5 py-1 rounded",
  md: "text-sm px-3 py-1.5 rounded-md",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "sm",
  children,
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center font-medium transition-colors duration-150 select-none ${
        VARIANT_STYLES[variant]
      } ${SIZE_STYLES[size]} ${
        disabled ? "opacity-40 cursor-not-allowed pointer-events-none" : ""
      } ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
