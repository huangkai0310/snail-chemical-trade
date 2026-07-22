"use client";

import { type ReactNode } from "react";

/**
 * Badge — 统一状态标签
 * 
 * 语义化颜色，替代各组件中手写的 bg-red-500/15 text-red-400 等碎片化样式。
 * 
 * @example
 * <Badge variant="up">买</Badge>
 * <Badge variant="info">挂盘中</Badge>
 */

type BadgeVariant =
  | "up"        // 红色（涨/买）
  | "down"      // 绿色（跌/卖）
  | "info"      // 蓝色（信息/挂牌中）
  | "warning"   // 橙色（警告/过期）
  | "success"   // 绿色（成功）
  | "error"     // 红色（错误）
  | "neutral"   // 灰色（中性）
  | "muted";    // 暗灰（禁用）

const VARIANT_STYLES: Record<BadgeVariant, string> = {
  up: "text-trade-up bg-trade-up-bg",
  down: "text-trade-down bg-trade-down-bg",
  info: "text-status-info bg-status-info-bg",
  warning: "text-status-warning bg-status-warning-bg",
  success: "text-status-success bg-status-success-bg",
  error: "text-status-error bg-status-error-bg",
  neutral: "text-t-text-2 bg-t-hover",
  muted: "text-t-text-3 bg-t-tertiary",
};

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
  size?: "sm" | "md";
}

export function Badge({
  variant = "neutral",
  children,
  className = "",
  size = "sm",
}: BadgeProps) {
  const sizeClass = size === "sm"
    ? "text-[11px] px-1.5 py-0.5"
    : "text-xs px-2 py-1";

  return (
    <span
      className={`inline-flex items-center rounded font-medium whitespace-nowrap ${VARIANT_STYLES[variant]} ${sizeClass} ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * DirectionBadge — 交易方向标签
 * 买=红色, 卖=绿色, 换盘=蓝紫渐变
 */
interface DirectionBadgeProps {
  direction: "buy" | "sell" | "swap";
  label?: string;
  size?: "sm" | "md";
}

export function DirectionBadge({ direction, label, size = "sm" }: DirectionBadgeProps) {
  const text = label ?? (direction === "buy" ? "买" : direction === "sell" ? "卖" : "换盘");
  const variant: BadgeVariant = direction === "buy" ? "up" : direction === "sell" ? "down" : "info";
  return <Badge variant={variant} size={size}>{text}</Badge>;
}
