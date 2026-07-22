"use client";

import { useState, useEffect, useRef } from "react";
import { sanitizeText } from "@/lib/validate";

/** 可输入 + 可下拉的 Combobox */
export default function Combobox({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  readOnly,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = filter
    ? options.filter((opt) => opt.toLowerCase().includes(filter.toLowerCase()))
    : options;

  const locked = disabled || readOnly;

  return (
    <div className="relative" ref={ref}>
      <input
        type="text"
        value={open ? filter : value}
        onChange={(e) => {
          if (locked) return;
          const v = sanitizeText(e.target.value);
          setFilter(v);
          onChange(v);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          if (locked) return;
          setFilter(value);
          setOpen(true);
        }}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        className={className}
      />
      {open && !locked && filtered.length > 0 && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 max-h-40 overflow-y-auto bg-t-panel border border-t-border rounded-lg shadow-lg">
          {filtered.map((opt) => (
            <button
              key={opt}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(opt);
                setOpen(false);
                setFilter("");
              }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-brand-600/10 transition-colors ${
                value === opt ? "bg-brand-600/10 text-brand-500 font-medium" : "text-t-text"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
