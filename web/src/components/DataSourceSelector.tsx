"use client";

import { DATA_SOURCES, type DataSource } from "@/lib/types";

interface Props {
  value: DataSource;
  onChange: (v: DataSource) => void;
  className?: string;
}

/** 数据源选择器：实时行情 vs 历史仓库 */
export default function DataSourceSelector({ value, onChange, className = "" }: Props) {
  return (
    <div
      className={`flex items-center gap-0.5 rounded border overflow-hidden ${className}`}
      style={{ borderColor: "var(--border-color)" }}
      title="切换K线数据来源"
    >
      {DATA_SOURCES.map((ds) => (
        <button
          key={ds.key}
          type="button"
          onClick={() => onChange(ds.key)}
          className={`px-2 py-1 text-[11px] transition-colors whitespace-nowrap ${
            value === ds.key
              ? "bg-t-hover text-t-text font-medium"
              : "text-t-text-2 hover:text-t-text hover:bg-t-hover/60"
          }`}
          title={ds.description}
        >
          {ds.label}
        </button>
      ))}
    </div>
  );
}
