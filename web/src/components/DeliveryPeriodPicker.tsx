"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  badgeForCalendarDay,
  dateFromDeliveryPeriod,
  deliveryPeriodFromDate,
  formatDeliveryPeriodDisplay,
} from "@/lib/delivery-period";
import {
  dayKind,
  formatYMD,
  holidayName,
  isBeforeToday,
  isWorkday,
  sameDay,
  todayStart,
} from "@/lib/china-calendar";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** 是否禁用过去日期，默认 true */
  disablePast?: boolean;
  className?: string;
  placeholder?: string;
}

export default function DeliveryPeriodPicker({
  value,
  onChange,
  disablePast = true,
  className = "",
  placeholder = "选择交割期",
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selectedDate = useMemo(() => dateFromDeliveryPeriod(value, false), [value]);
  const today = useMemo(() => todayStart(), []);

  const [viewYear, setViewYear] = useState(() => (selectedDate ?? today).getFullYear());
  const [viewMonth, setViewMonth] = useState(() => (selectedDate ?? today).getMonth());

  useEffect(() => {
    if (!open) return;
    const base = selectedDate && !isBeforeToday(selectedDate, today) ? selectedDate : today;
    setViewYear(base.getFullYear());
    setViewMonth(base.getMonth());
  }, [open, selectedDate, today]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const cells = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const startPad = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const list: (Date | null)[] = [];
    for (let i = 0; i < startPad; i++) list.push(null);
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(viewYear, viewMonth, day);
      d.setHours(0, 0, 0, 0);
      list.push(d);
    }
    while (list.length % 7 !== 0) list.push(null);
    return list;
  }, [viewYear, viewMonth]);

  const canGoPrevMonth = useMemo(() => {
    if (!disablePast) return true;
    // 不允许翻到「整月都在今天之前」的月份
    const lastOfPrev = new Date(viewYear, viewMonth, 0);
    lastOfPrev.setHours(0, 0, 0, 0);
    return lastOfPrev.getTime() >= today.getTime();
  }, [disablePast, viewYear, viewMonth, today]);

  const shiftMonth = (delta: number) => {
    if (delta < 0 && !canGoPrevMonth) return;
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const pick = (d: Date) => {
    if (disablePast && isBeforeToday(d, today)) return;
    if (!isWorkday(d)) return;
    const info = deliveryPeriodFromDate(d);
    onChange(info.value);
    setOpen(false);
  };

  const display = value?.trim() || "";

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2.5 border border-t-border rounded-lg text-sm text-left bg-t-panel text-t-text flex items-center justify-between focus:ring-2 focus:ring-brand-500 outline-none"
      >
        <span className={display ? "text-t-text tabular-nums" : "text-t-text-3"}>
          {display ? formatDeliveryPeriodDisplay(display) : placeholder}
        </span>
        <svg
          className={`w-4 h-4 text-t-text-3 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-[min(100vw-2rem,320px)] left-0 bg-t-panel border border-t-border rounded-lg shadow-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              disabled={!canGoPrevMonth}
              className={`p-1.5 rounded text-t-text-2 ${
                canGoPrevMonth ? "hover:bg-t-hover" : "opacity-30 cursor-not-allowed"
              }`}
              aria-label="上一月"
            >
              ‹
            </button>
            <div className="text-sm font-medium text-t-text tabular-nums">
              {viewYear}年{viewMonth + 1}月
            </div>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="p-1.5 rounded hover:bg-t-hover text-t-text-2"
              aria-label="下一月"
            >
              ›
            </button>
          </div>

          <div className="flex flex-wrap gap-2 mb-2 text-[10px] text-t-text-3">
            <span className="inline-flex items-center gap-1">
              <i className="w-3.5 h-3.5 rounded bg-status-warning/20 text-status-warning text-[9px] font-semibold inline-flex items-center justify-center not-italic">
                现
              </i>
              现货
            </span>
            <span className="inline-flex items-center gap-1">
              <i className="w-3.5 h-3.5 rounded bg-blue-500/15 text-blue-400 text-[9px] font-semibold inline-flex items-center justify-center not-italic">
                中
              </i>
              月中工作日
            </span>
            <span className="inline-flex items-center gap-1">
              <i className="w-3.5 h-3.5 rounded bg-brand-500/15 text-brand-500 text-[9px] font-semibold inline-flex items-center justify-center not-italic">
                下
              </i>
              月下
            </span>
            <span className="inline-flex items-center gap-1 text-t-text-3/80">
              仅工作日可选
            </span>
            <span className="inline-flex items-center gap-1">
              <i className="w-3.5 h-3.5 rounded bg-red-500/15 text-red-400 text-[9px] font-semibold inline-flex items-center justify-center not-italic">
                休
              </i>
              节假日
            </span>
            <span className="inline-flex items-center gap-1">
              <i className="w-3.5 h-3.5 rounded bg-emerald-500/15 text-emerald-500 text-[9px] font-semibold inline-flex items-center justify-center not-italic">
                班
              </i>
              调休上班
            </span>
          </div>

          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {WEEKDAYS.map((w) => (
              <div key={w} className="text-center text-[10px] text-t-text-3 py-1">
                {w}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((d, i) => {
              if (!d) return <div key={`e-${i}`} className="h-10" />;
              const past = disablePast && isBeforeToday(d, today);
              const workday = isWorkday(d);
              const disabled = past || !workday;
              const isToday = sameDay(d, today);
              const isSelected =
                !!selectedDate && sameDay(d, selectedDate) && !!value?.trim() && !disabled;
              const badge = badgeForCalendarDay(d);
              const info = deliveryPeriodFromDate(d);
              const kind = dayKind(d);
              const hName = holidayName(d);
              const isHolidayDay = kind === "holiday";
              const isMakeup = kind === "makeup";

              let title: string;
              if (past) title = "当前日期之前不可选为交割期";
              else if (!workday) {
                title = hName
                  ? `${hName}（休）· 非工作日不可选`
                  : "非工作日不可选为交割期";
              } else if (isMakeup) title = `调休上班 · ${info.hint}`;
              else title = info.hint;

              return (
                <button
                  key={formatYMD(d)}
                  type="button"
                  disabled={disabled}
                  title={title}
                  onClick={() => pick(d)}
                  className={`relative h-10 rounded text-xs transition-colors ${
                    disabled
                      ? "bg-t-hover/40 text-t-text-3/35 cursor-not-allowed"
                      : isSelected
                        ? "bg-brand-600 text-white"
                        : isToday
                          ? "bg-status-warning/15 text-t-text hover:bg-status-warning/25 ring-1 ring-status-warning/40"
                          : "text-t-text hover:bg-t-hover"
                  }`}
                >
                  <span className={`tabular-nums ${disabled ? "opacity-50" : ""}`}>
                    {d.getDate()}
                  </span>

                  {/* 左下：节假日/调休标记（非工作日也显示「休」，调休「班」可选） */}
                  {(isHolidayDay || isMakeup) && (
                    <span
                      className={`absolute bottom-0.5 left-0.5 leading-none text-[8px] font-semibold ${
                        isSelected
                          ? "text-white/90"
                          : disabled
                            ? "text-red-400/50"
                            : isHolidayDay
                              ? "text-red-400"
                              : "text-emerald-500"
                      }`}
                    >
                      {isHolidayDay ? "休" : "班"}
                    </span>
                  )}

                  {/* 右上：交割期角标（仅可选日） */}
                  {badge && !disabled && (
                    <span
                      className={`absolute top-0.5 right-0.5 leading-none text-[8px] font-semibold ${
                        isSelected
                          ? "text-white/90"
                          : badge === "现货"
                            ? "text-status-warning"
                            : badge === "中"
                              ? "text-blue-400"
                              : "text-brand-500"
                      }`}
                    >
                      {badge === "现货" ? "现" : badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {value?.trim() && (
            <div className="mt-2 pt-2 border-t border-t-border text-[11px] text-t-text-2">
              已选：<span className="font-medium text-t-text tabular-nums">{formatDeliveryPeriodDisplay(value)}</span>
              {selectedDate && (
                <span className="text-t-text-3">（{formatYMD(selectedDate)}）</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
