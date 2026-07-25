"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  dayKind,
  formatYMD,
  holidayName,
  isBeforeToday,
  isWorkday,
  nextWorkday,
  sameDay,
  todayStart,
} from "@/lib/china-calendar";
import { toDatetimeLocalValue } from "@/lib/expires";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const TIME_PRESETS = ["09:00", "12:00", "15:00", "18:00"];

type Accent = "sky" | "amber" | "neutral";

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** 允许空值（立即发布），默认 false */
  allowEmpty?: boolean;
  emptyLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  accent?: Accent;
  /** 选中日期时默认时分 */
  defaultTime?: string; // "HH:mm"
  /** 过去日期不可选，默认 true */
  disablePast?: boolean;
}

function parseLocal(value: string): Date | null {
  if (!value?.trim()) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function hmOf(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function combine(day: Date, hm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  const h = m ? Math.min(23, Math.max(0, Number(m[1]))) : 18;
  const min = m ? Math.min(59, Math.max(0, Number(m[2]))) : 0;
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, min, 0, 0);
  return toDatetimeLocalValue(d);
}

function displayLabel(value: string, emptyLabel: string): string {
  if (!value?.trim()) return emptyLabel;
  const d = parseLocal(value);
  if (!d) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const accentTrigger: Record<Accent, string> = {
  sky: "border-sky-400/60 bg-sky-50/50 dark:bg-sky-950/20 focus:ring-sky-400",
  amber: "border-amber-400/60 bg-amber-50/50 dark:bg-amber-950/20 focus:ring-amber-400",
  neutral: "border-t-border bg-t-panel focus:ring-brand-500",
};

export default function WorkdayDateTimePicker({
  value,
  onChange,
  allowEmpty = false,
  emptyLabel = "立即发布",
  placeholder = "选择时间",
  disabled = false,
  className = "",
  accent = "neutral",
  defaultTime = "18:00",
  disablePast = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => parseLocal(value), [value]);
  const today = useMemo(() => todayStart(), []);
  const todayIsWorkday = useMemo(() => isWorkday(today), [today]);

  const [viewYear, setViewYear] = useState(() => (selected ?? today).getFullYear());
  const [viewMonth, setViewMonth] = useState(() => (selected ?? today).getMonth());
  const [time, setTime] = useState(() => (selected ? hmOf(selected) : defaultTime));

  useEffect(() => {
    if (!open) return;
    const base =
      selected && !(disablePast && isBeforeToday(selected, today))
        ? selected
        : nextWorkday(today);
    setViewYear(base.getFullYear());
    setViewMonth(base.getMonth());
    setTime(selected ? hmOf(selected) : defaultTime);
  }, [open, selected, today, disablePast, defaultTime]);

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

  const applyDay = (d: Date) => {
    if (disablePast && isBeforeToday(d, today)) return;
    if (!isWorkday(d)) return;
    onChange(combine(d, time));
  };

  const applyTime = (hm: string) => {
    setTime(hm);
    if (selected) {
      onChange(combine(selected, hm));
    } else {
      // 尚未选日：落到最近工作日
      onChange(combine(nextWorkday(today), hm));
    }
  };

  const display = value?.trim()
    ? displayLabel(value, emptyLabel)
    : allowEmpty
      ? emptyLabel
      : "";

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={`w-full px-3 py-2.5 border rounded-lg text-sm text-left flex items-center justify-between focus:ring-2 outline-none disabled:opacity-50 ${accentTrigger[accent]}`}
      >
        <span className={display ? "text-t-text tabular-nums" : "text-t-text-3"}>
          {display || placeholder}
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

      {open && !disabled && (
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
            <span className="inline-flex items-center gap-1 text-t-text-3/80">仅工作日可选</span>
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
              const dayDisabled = past || !workday;
              const isToday = sameDay(d, today);
              const isSelected = !!selected && sameDay(d, selected) && !!value?.trim();
              const kind = dayKind(d);
              const hName = holidayName(d);
              const isHolidayDay = kind === "holiday";
              const isMakeup = kind === "makeup";

              let title: string;
              if (past) title = "过去日期不可选";
              else if (!workday) {
                title = hName ? `${hName}（休）· 非工作日不可选` : "非工作日不可选";
              } else if (isMakeup) title = "调休上班";
              else title = formatYMD(d);

              return (
                <button
                  key={formatYMD(d)}
                  type="button"
                  disabled={dayDisabled}
                  title={title}
                  onClick={() => applyDay(d)}
                  className={`relative h-10 rounded text-xs transition-colors ${
                    dayDisabled
                      ? "bg-t-hover/40 text-t-text-3/35 cursor-not-allowed"
                      : isSelected
                        ? "bg-brand-600 text-white"
                        : isToday
                          ? "bg-status-warning/15 text-t-text hover:bg-status-warning/25 ring-1 ring-status-warning/40"
                          : "text-t-text hover:bg-t-hover"
                  }`}
                >
                  <span className={`tabular-nums ${dayDisabled ? "opacity-50" : ""}`}>
                    {d.getDate()}
                  </span>
                  {(isHolidayDay || isMakeup) && (
                    <span
                      className={`absolute bottom-0.5 left-0.5 leading-none text-[8px] font-semibold ${
                        isSelected
                          ? "text-white/90"
                          : dayDisabled
                            ? "text-red-400/50"
                            : isHolidayDay
                              ? "text-red-400"
                              : "text-emerald-500"
                      }`}
                    >
                      {isHolidayDay ? "休" : "班"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-2 pt-2 border-t border-t-border">
            <div className="text-[10px] text-t-text-3 mb-1.5">时间</div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {TIME_PRESETS.map((hm) => (
                <button
                  key={hm}
                  type="button"
                  onClick={() => applyTime(hm)}
                  className={`text-[11px] px-2 py-1 rounded border tabular-nums ${
                    time === hm
                      ? "border-brand-500 bg-brand-500/10 text-brand-600"
                      : "border-t-border text-t-text-2 hover:bg-t-hover"
                  }`}
                >
                  {hm}
                </button>
              ))}
              <input
                type="time"
                value={time}
                onChange={(e) => applyTime(e.target.value || defaultTime)}
                className="text-[11px] px-2 py-1 rounded border border-t-border bg-t-panel text-t-text tabular-nums outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>

            {allowEmpty && (
              <button
                type="button"
                disabled={!todayIsWorkday}
                title={
                  todayIsWorkday
                    ? "清空为立即发布"
                    : "今日非工作日，不可立即挂盘，请选择下一工作日"
                }
                onClick={() => {
                  if (!todayIsWorkday) return;
                  onChange("");
                  setOpen(false);
                }}
                className={`w-full text-xs py-1.5 rounded border ${
                  todayIsWorkday
                    ? "border-sky-400/50 text-sky-800 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/40"
                    : "border-t-border text-t-text-3/50 cursor-not-allowed"
                }`}
              >
                {emptyLabel}
                {!todayIsWorkday && "（今日休市）"}
              </button>
            )}

            {value?.trim() && (
              <div className="mt-2 text-[11px] text-t-text-2">
                已选：
                <span className="font-medium text-t-text tabular-nums">
                  {displayLabel(value, emptyLabel)}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
