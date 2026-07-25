import React from "react";
import clsx from "clsx";

interface PanelProps {
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  padding?: boolean;
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  padding = true,
}: PanelProps) {
  return (
    <div className={clsx("bg-t-card border border-t-border rounded-xl", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between px-5 py-4 border-b border-t-border">
          <div>
            {title && (
              <h2 className="text-base font-semibold text-t-text">{title}</h2>
            )}
            {subtitle && (
              <p className="text-xs text-t-muted mt-0.5">{subtitle}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={clsx(padding && "p-5")}>{children}</div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold text-t-text">{title}</h1>
        {description && (
          <p className="text-sm text-t-muted mt-1">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}
