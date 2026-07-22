"use client";

import { type ReactNode } from "react";

/**
 * Panel — 统一面板容器
 * 
 * 提供一致的面板头 + 内容区结构。
 * 所有交易大厅的面板都应使用此组件。
 * 
 * @example
 * <Panel title="盘口" meta="BZ">
 *   <div>content</div>
 * </Panel>
 */
interface PanelProps {
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  noBodyPadding?: boolean;
}

export function Panel({
  title,
  meta,
  actions,
  children,
  className = "",
  bodyClassName = "",
  noBodyPadding = false,
}: PanelProps) {
  return (
    <div className={`h-full flex flex-col overflow-hidden ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between px-3 h-9 border-b shrink-0 bg-t-panel"
          style={{ borderColor: "var(--border-color)" }}
        >
          <div className="flex items-center gap-2 min-w-0">
            {title && (
              <span className="text-xs font-semibold text-t-text truncate">
                {title}
              </span>
            )}
            {meta && (
              <span className="text-[11px] text-t-text-3 shrink-0">
                {meta}
              </span>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-2 shrink-0">
              {actions}
            </div>
          )}
        </div>
      )}
      <div className={`flex-1 min-h-0 overflow-hidden ${noBodyPadding ? "" : ""} ${bodyClassName}`}>
        {children}
      </div>
    </div>
  );
}

/**
 * PanelSection — 面板内的分区
 * 用于在 Panel 内部创建带标题的子区域
 */
interface PanelSectionProps {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}

export function PanelSection({ title, children, className = "", actions }: PanelSectionProps) {
  return (
    <div className={className}>
      {title && (
        <div className="flex items-center justify-between px-3 py-1.5 border-b"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <span className="text-[11px] font-medium text-t-text-2">
            {title}
          </span>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}
