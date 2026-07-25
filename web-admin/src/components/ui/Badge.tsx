import React from "react";
import clsx from "clsx";

interface BadgeProps {
  variant?: "info" | "success" | "warning" | "error" | "default";
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant = "default", children, className }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
        {
          info: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
          success: "bg-green-500/10 text-green-600 dark:text-green-400",
          warning: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
          error: "bg-red-500/10 text-red-600 dark:text-red-400",
          default: "bg-t-hover text-t-secondary",
        }[variant],
        className
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ active, label }: { active: boolean; label?: string }) {
  return (
    <span className={clsx("status-badge", active ? "on" : "off")}>
      {label || (active ? "启用" : "停用")}
    </span>
  );
}
