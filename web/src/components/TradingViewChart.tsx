"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
} from "lightweight-charts";
import type {
  IChartApi,
  ISeriesApi,
  CandlestickData,
  HistogramData,
  LineData,
  MouseEventParams,
  Time,
} from "lightweight-charts";
import { Tooltip } from "./ui/Tooltip";

interface Props {
  productId: string;
  productName: string;
  data: CandlestickData[];
  volumeData: HistogramData[];
  ma5Data: LineData[];
  ma10Data: LineData[];
  ma20Data: LineData[];
  ma30Data: LineData[];
  turnoverData?: LineData[];
  /** 分时线模式：当 chartType="line" 时显示折线图而非 K 线 */
  chartType?: "candle" | "line";
  loading?: boolean;
}

const CHART_COLORS = {
  background: "transparent",
  text: "#8b949e",
  grid: "rgba(255,255,255,0.04)",
  border: "#2d3748",
  up: "#ef4444",
  down: "#22c55e",
  ma5: "#f5a623",
  ma10: "#4a90d9",
  ma20: "#e040fb",
  ma30: "#26a69a",
  volume: "#6bb3e0",
};

  /** 十字光标悬停数据 */
  interface CrosshairData {
    time: string;
    weekday: string;
    /** 鼠标 Y 轴对应的实时价格（优先），若无则用收盘价 */
    price: number | null;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    volume: number | null;
    turnover: number | null;
    change: number | null;
    changePercent: number | null;
    amplitude: number | null;
    ma5: number | null;
    ma10: number | null;
    ma20: number | null;
    ma30: number | null;
  }

/** 面板锚点方向 */
type PanelSide = "left" | "right";

/** 面板宽度（px） */
const PANEL_WIDTH = 165;
/** 切换防抖间隔（ms）：鼠标在面板区域内持续超过此时间才触发切换 */
const SIDE_SWITCH_DELAY = 200;

export default function TradingViewChart({
  productId,
  productName,
  data,
  volumeData,
  ma5Data,
  ma10Data,
  ma20Data,
  ma30Data,
  turnoverData = [],
  chartType = "candle",
  loading,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ma5SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ma10SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ma20SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ma30SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const [chartReady, setChartReady] = useState(false);

  const [crosshair, setCrosshair] = useState<CrosshairData | null>(null);
  const [panelSide, setPanelSide] = useState<PanelSide>("right");

  // 用 ref 追踪 panelSide 实时值，避免 useCallback 闭包过期问题
  const panelSideRef = useRef<PanelSide>("right");
  // 防抖计时器
  const sideSwitchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 上一次触发切换检查的鼠标位置（避免原地不动也触发）
  const lastMouseXRef = useRef<number>(0);
  // 面板区域检测状态：鼠标是否在当前面板区域内
  const mouseInPanelRef = useRef<boolean>(false);

  // 同步 state → ref
  useEffect(() => {
    panelSideRef.current = panelSide;
  }, [panelSide]);

  const findCandleByTime = useCallback((time: Time): CandlestickData | undefined => {
    return data.find((d) => d.time === time);
  }, [data]);

  const findVolumeByTime = useCallback((time: Time): HistogramData | undefined => {
    return volumeData.find((d) => d.time === time);
  }, [volumeData]);

  const findMAByTime = useCallback((time: Time, maData: LineData[]): number | null => {
    const item = maData.find((d) => d.time === time);
    return item ? item.value : null;
  }, []);

  /** 判断鼠标是否在面板区域内 */
  const isMouseInPanelArea = useCallback((mouseX: number, containerW: number, side: PanelSide): boolean => {
    if (side === "left") {
      return mouseX <= PANEL_WIDTH;
    } else {
      return mouseX >= containerW - PANEL_WIDTH;
    }
  }, []);

  const handleCrosshairMove = useCallback(
    (param: MouseEventParams) => {
      if (!param.time || !data || data.length === 0) {
        setCrosshair(null);
        return;
      }

      const candle = findCandleByTime(param.time);
      const vol = findVolumeByTime(param.time);

      if (!candle) {
        setCrosshair(null);
        return;
      }

      const change = candle.close - candle.open;
      const changePercent = candle.open !== 0
        ? ((candle.close - candle.open) / candle.open) * 100
        : 0;
      const amplitude = candle.low !== 0
        ? ((candle.high - candle.low) / candle.low) * 100
        : 0;

      let timeStr = "";
      let weekdayStr = "";
      const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

      if (typeof param.time === "number") {
        const dt = new Date(param.time * 1000);
        const y = dt.getFullYear();
        const m = String(dt.getMonth() + 1).padStart(2, "0");
        const d = String(dt.getDate()).padStart(2, "0");
        timeStr = `${y}${m}${d}`;
        weekdayStr = weekdays[dt.getDay()];
      } else if (typeof param.time === "string") {
        timeStr = param.time;
        weekdayStr = "";
      } else if (param.time && typeof param.time === "object" && "year" in param.time) {
        const t = param.time as { year: number; month: number; day: number };
        timeStr = `${t.year}${String(t.month).padStart(2, "0")}${String(t.day).padStart(2, "0")}`;
        const dt = new Date(t.year, t.month - 1, t.day);
        weekdayStr = weekdays[dt.getDay()];
      }

      const mouseX = param.point?.x ?? 0;
      const containerW = containerRef.current?.clientWidth ?? 600;

      // 尝试获取鼠标 Y 轴对应的实时价格（十字光标所在价格）
      let crossPrice: number | null = candle.close; // fallback：用收盘价
      try {
        if (
          candleSeriesRef.current &&
          param.point?.y != null &&
          typeof (candleSeriesRef.current as any).coordinateToPrice === "function"
        ) {
          const price = (candleSeriesRef.current as any).coordinateToPrice(param.point.y);
          if (price != null && Number.isFinite(price)) {
            crossPrice = price;
          }
        }
      } catch (_) {
        crossPrice = candle.close;
      }

      // 更新数据
      setCrosshair({
        time: timeStr,
        weekday: weekdayStr,
        price: crossPrice,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: vol?.value ?? null,
        turnover: findMAByTime(param.time, turnoverData),
        change,
        changePercent,
        amplitude,
        ma5: findMAByTime(param.time, ma5Data),
        ma10: findMAByTime(param.time, ma10Data),
        ma20: findMAByTime(param.time, ma20Data),
        ma30: findMAByTime(param.time, ma30Data),
      });

      // 面板遮挡检测（使用 ref 读取最新 panelSide，避免闭包过期）
      const currentSide = panelSideRef.current;
      const currentlyInPanel = isMouseInPanelArea(mouseX, containerW, currentSide);

      // 鼠标移出面板区域 → 重置状态
      if (!currentlyInPanel) {
        mouseInPanelRef.current = false;
        if (sideSwitchTimerRef.current) {
          clearTimeout(sideSwitchTimerRef.current);
          sideSwitchTimerRef.current = null;
        }
        return;
      }

      // 鼠标在面板区域内：防抖切换
      // 如果之前不在面板内（刚进入），记录状态并启动计时器
      if (!mouseInPanelRef.current) {
        mouseInPanelRef.current = true;
        lastMouseXRef.current = mouseX;
        // 清除旧的计时器
        if (sideSwitchTimerRef.current) {
          clearTimeout(sideSwitchTimerRef.current);
        }
        // 启动防抖计时器
        sideSwitchTimerRef.current = setTimeout(() => {
          // 防抖结束，切换面板方向
          setPanelSide((prev) => {
            const next = prev === "right" ? "left" : "right";
            panelSideRef.current = next;
            return next;
          });
          mouseInPanelRef.current = false;
          sideSwitchTimerRef.current = null;
        }, SIDE_SWITCH_DELAY);
      }
    },
    [data, volumeData, turnoverData, ma5Data, ma10Data, ma20Data, ma30Data, findCandleByTime, findVolumeByTime, findMAByTime, isMouseInPanelArea]
  );

  const initChart = useCallback(() => {
    if (!containerRef.current) return;

    if (chartRef.current) {
      try { chartRef.current.remove(); } catch (_) {}
      chartRef.current = null;
    }

    const container = containerRef.current;
    const w = container.clientWidth || 600;
    const h = container.clientHeight || 400;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: CHART_COLORS.background },
        textColor: CHART_COLORS.text,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: CHART_COLORS.grid },
        horzLines: { color: CHART_COLORS.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(120, 140, 180, 0.5)",
          style: 2,
          width: 1,
          labelBackgroundColor: "rgba(30, 40, 60, 0.85)",
          labelVisible: false,
        },
        horzLine: {
          color: "rgba(120, 140, 180, 0.5)",
          style: 2,
          width: 1,
          labelVisible: false,
        },
      },
      rightPriceScale: {
        borderColor: CHART_COLORS.border,
        scaleMargins: { top: 0.1, bottom: 0.2 },
      },
      timeScale: {
        borderColor: CHART_COLORS.border,
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 12,
        minBarSpacing: 6,
        rightOffset: 4,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      width: w,
      height: h,
    });

    let candleSeries: ISeriesApi<"Candlestick"> | null = null;
    let lineSeries: ISeriesApi<"Line"> | null = null;

    if (chartType === "candle") {
      candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: CHART_COLORS.up,
        downColor: CHART_COLORS.down,
        borderUpColor: CHART_COLORS.up,
        borderDownColor: CHART_COLORS.down,
        wickUpColor: CHART_COLORS.up,
        wickDownColor: CHART_COLORS.down,
        priceFormat: {
          type: "custom",
          formatter: (price: number) => price.toFixed(0),
          minMove: 1,
        },
      });
    } else if (chartType === "line") {
      lineSeries = chart.addSeries(LineSeries, {
        color: "#4a90d9",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 3,
        priceFormat: {
          type: "custom",
          formatter: (price: number) => price.toFixed(1),
          minMove: 1,
        },
      });
    }

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: CHART_COLORS.volume,
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    const ma5 = chart.addSeries(LineSeries, {
      color: CHART_COLORS.ma5,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const ma10 = chart.addSeries(LineSeries, {
      color: CHART_COLORS.ma10,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const ma20 = chart.addSeries(LineSeries, {
      color: CHART_COLORS.ma20,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const ma30 = chart.addSeries(LineSeries, {
      color: CHART_COLORS.ma30,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chart.subscribeCrosshairMove(handleCrosshairMove);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    lineSeriesRef.current = lineSeries;
    volumeSeriesRef.current = volumeSeries;
    ma5SeriesRef.current = ma5;
    ma10SeriesRef.current = ma10;
    ma20SeriesRef.current = ma20;
    ma30SeriesRef.current = ma30;
    setChartReady(true);
  }, [handleCrosshairMove, chartType]);

  useEffect(() => {
    const timer = setTimeout(() => initChart(), 0);
    return () => {
      clearTimeout(timer);
      if (sideSwitchTimerRef.current) {
        clearTimeout(sideSwitchTimerRef.current);
      }
      if (chartRef.current) {
        try { chartRef.current.remove(); } catch (_) {}
        chartRef.current = null;
      }
      setChartReady(false);
      setCrosshair(null);
    };
  }, [initChart]);

  useEffect(() => {
    if (!chartReady || !volumeSeriesRef.current) return;
    try {
      volumeSeriesRef.current.setData(volumeData.length > 0 ? volumeData : []);

      // 根据图表类型设置主图数据
      if (chartType === "candle") {
        if (candleSeriesRef.current) {
          candleSeriesRef.current.setData(data.length > 0 ? data : []);
        }
        if (lineSeriesRef.current) {
          lineSeriesRef.current.setData([]);
        }
      } else {
        if (candleSeriesRef.current) {
          candleSeriesRef.current.setData([]);
        }
        if (lineSeriesRef.current && data.length > 0) {
          // 分时线：用 close 值生成 LineData
          const lineData = data.map((d) => ({
            time: d.time,
            value: d.close,
          }));
          lineSeriesRef.current.setData(lineData);
        }
      }

      if (ma5SeriesRef.current) ma5SeriesRef.current.setData(ma5Data.length > 0 ? ma5Data : []);
      if (ma10SeriesRef.current) ma10SeriesRef.current.setData(ma10Data.length > 0 ? ma10Data : []);
      if (ma20SeriesRef.current) ma20SeriesRef.current.setData(ma20Data.length > 0 ? ma20Data : []);
      if (ma30SeriesRef.current) ma30SeriesRef.current.setData(ma30Data.length > 0 ? ma30Data : []);

      if (data.length > 0 && chartRef.current) {
        // 使用 setVisibleRange 替代 fitContent，避免 200 根 K 线被过度压缩导致重叠
        const visibleCount = Math.min(40, data.length);
        try {
          const timePoints = data.map(d => d.time);
          chartRef.current.timeScale().setVisibleRange({
            from: timePoints[timePoints.length - visibleCount] as Time,
            to: timePoints[timePoints.length - 1] as Time,
          });
        } catch (_) {
          chartRef.current.timeScale().fitContent();
        }
      }
    } catch (e) {
      console.error("[TradingViewChart] setData error:", e);
      if (chartRef.current) {
        try { chartRef.current.remove(); } catch (_) {}
        chartRef.current = null;
        setChartReady(false);
        setTimeout(() => initChart(), 50);
      }
    }
  }, [data, volumeData, ma5Data, ma10Data, ma20Data, ma30Data, chartReady, initChart, chartType]);

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        try {
          chartRef.current.applyOptions({
            width: containerRef.current.clientWidth,
            height: containerRef.current.clientHeight,
          });
        } catch (_) {}
      }
    };

    const observer = new ResizeObserver(handleResize);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [chartReady]);

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* 标题栏 */}
      <div className="px-3 py-1.5 border-b border-t-border shrink-0 bg-t-panel">
        <div className="flex items-center justify-end">
          <div className="flex items-center gap-3 text-[10px]">
            <MALabel name="MA5"  color={CHART_COLORS.ma5}  maData={ma5Data}  hoveredValue={crosshair?.ma5  ?? null} />
            <MALabel name="MA10" color={CHART_COLORS.ma10} maData={ma10Data} hoveredValue={crosshair?.ma10 ?? null} />
            <MALabel name="MA20" color={CHART_COLORS.ma20} maData={ma20Data} hoveredValue={crosshair?.ma20 ?? null} />
            <MALabel name="MA30" color={CHART_COLORS.ma30} maData={ma30Data} hoveredValue={crosshair?.ma30 ?? null} />
          </div>
        </div>
      </div>

      {/* 图表区域容器 */}
      <div className="flex-1 min-h-0 relative">
        {/* 悬浮详情面板 */}
        {crosshair && (
          <div
            className="absolute top-2 z-20 w-[165px] text-[11px] pointer-events-none"
            style={{
              [panelSide === "right" ? "right" : "left"]: "0.5rem",
              background: "var(--bg-panel, rgba(16,20,28,0.95))",
              backdropFilter: "blur(8px)",
              border: "1px solid var(--border-color, rgba(60,70,90,0.5))",
              borderRadius: "4px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
              color: "var(--text-primary, #e6edf3)",
            }}
          >
            {/* 标题栏 */}
            <div className="flex items-center justify-between px-2 py-1 border-b border-t-border">
              <span className="font-medium" style={{ color: "var(--text-primary)" }}>{crosshair.time}</span>
              <span style={{ color: "var(--text-muted)" }}>{crosshair.weekday}</span>
            </div>

            {/* 数据行 */}
            <div className="px-2 py-1">
              {/* 第一组：数值、开盘、收盘、最高、最低 */}
              <InfoRow
                label="数值"
                value={crosshair.price != null ? crosshair.price.toFixed(0) : undefined}
                valueClass={getValueColor(crosshair.change)}
              />
              <InfoRow
                label="开盘"
                value={crosshair.open != null ? crosshair.open.toFixed(0) : undefined}
                valueClass={getValueColor(crosshair.change)}
              />
              <InfoRow
                label="收盘"
                value={crosshair.close != null ? crosshair.close.toFixed(0) : undefined}
                valueClass={getValueColor(crosshair.change)}
              />
              <InfoRow
                label="最高"
                value={crosshair.high != null ? crosshair.high.toFixed(0) : undefined}
                valueClass="text-trade-up"
              />
              <InfoRow
                label="最低"
                value={crosshair.low != null ? crosshair.low.toFixed(0) : undefined}
                valueClass="text-trade-down"
              />

              <div className="my-1 border-t border-t-border opacity-30" />

              {/* 第二组：涨跌、涨幅、振幅 */}
              <InfoRow
                label="涨跌"
                value={
                  crosshair.change != null
                    ? `${(crosshair.change ?? 0) >= 0 ? "+" : ""}${crosshair.change.toFixed(0)}`
                    : undefined
                }
                valueClass={getValueColor(crosshair.change)}
              />
              <InfoRow
                label="涨幅"
                value={
                  crosshair.changePercent != null
                    ? `${(crosshair.changePercent ?? 0) >= 0 ? "+" : ""}${crosshair.changePercent.toFixed(2)}%`
                    : undefined
                }
                valueClass={getValueColor(crosshair.changePercent)}
              />
              <InfoRow
                label="振幅"
                value={crosshair.amplitude != null ? `${crosshair.amplitude.toFixed(2)}%` : undefined}
                valueClass="text-trade-up"
              />

              <div className="my-1 border-t border-t-border opacity-30" />

              {/* 第三组：MA5/MA10/MA20/MA30 */}
              <InfoRow
                label="MA5"
                value={crosshair.ma5 != null ? crosshair.ma5.toFixed(0) : "—"}
                valueClass="text-[#f5a623]"
              />
              <InfoRow
                label="MA10"
                value={crosshair.ma10 != null ? crosshair.ma10.toFixed(0) : "—"}
                valueClass="text-[#4a90d9]"
              />
              <InfoRow
                label="MA20"
                value={crosshair.ma20 != null ? crosshair.ma20.toFixed(0) : "—"}
                valueClass="text-[#e040fb]"
              />
              <InfoRow
                label="MA30"
                value={crosshair.ma30 != null ? crosshair.ma30.toFixed(0) : "—"}
                valueClass="text-[#26a69a]"
              />

              <div className="my-1 border-t border-t-border opacity-30" />

              {/* 第四组：成交量、成交额 */}
              <InfoRow
                label="成交量"
                value={crosshair.volume != null ? formatVolume(crosshair.volume) : "—"}
                valueClass="text-[#6bb3e0]"
              />
              <InfoRow
                label="成交额"
                value={crosshair.turnover != null ? formatAmount(crosshair.turnover) : "—"}
                valueClass="text-[#6bb3e0]"
              />
            </div>
          </div>
        )}

        {/* 图表容器 */}
        <div ref={containerRef} className="w-full h-full min-h-0">
          {(loading || (!loading && data.length === 0)) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-sm text-t-text-3 bg-t-bg z-10">
              {loading ? (
                <div className="animate-pulse">加载走势数据...</div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <span>暂无成交数据</span>
                  <span className="text-[10px]">请选择其他品种或等待数据更新</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 获取数值颜色 */
function getValueColor(change: number | null): string {
  if (change === null) return "text-t-text-2";
  return change >= 0 ? "text-trade-up" : "text-trade-down";
}

/** 格式化成交量 */
function formatVolume(vol: number): string {
  if (vol >= 10000) {
    return (vol / 10000).toFixed(2) + "万";
  }
  return vol.toString();
}

/** 格式化成交额（元 → 万元） */
function formatAmount(val: number): string {
  if (val >= 100000000) {
    return (val / 100000000).toFixed(2) + "亿";
  }
  if (val >= 10000) {
    return (val / 10000).toFixed(2) + "万";
  }
  return val.toFixed(2);
}

/** 信息行组件 */
function InfoRow({ label, value, valueClass = "text-t-text-2" }: {
  label: string;
  value: string | undefined;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <span className={valueClass}>{value ?? "—"}</span>
    </div>
  );
}

/** 判断 MA 趋势：上涨 / 下跌 / 走平 */
function getMATrend(maData: LineData[]): { direction: "up" | "down" | "flat"; value: number | null } {
  if (maData.length < 2) return { direction: "flat", value: maData[maData.length - 1]?.value ?? null };
  const cur = maData[maData.length - 1].value;
  const prev = maData[maData.length - 2].value;
  if (cur > prev) return { direction: "up", value: cur };
  if (cur < prev) return { direction: "down", value: cur };
  return { direction: "flat", value: cur };
}

/** MA 均线说明 */
const MA_TOOLTIPS: Record<string, string> = {
  MA5: "MA5（5日均线）：最近5个交易日收盘价的平均值，反映短期价格趋势，变化较快，常用于判断短期买卖信号。",
  MA10: "MA10（10日均线）：最近10个交易日收盘价的平均值，反映中短期价格趋势，是短线交易的重要参考线。",
  MA20: "MA20（20日均线）：最近20个交易日收盘价的平均值，反映中期价格趋势，常作为波段操作的支撑/压力线。",
  MA30: "MA30（30日均线）：最近30个交易日收盘价的平均值，反映中长期价格趋势，是判断大势方向的重要均线。",
};

/** MA 图例标签：名称 + 当前最新值 + 趋势箭头，鼠标悬停时显示当前 K 线对应的 MA 值 */
function MALabel({
  name,
  color,
  maData,
  hoveredValue,
}: {
  name: string;
  color: string;
  maData: LineData[];
  hoveredValue: number | null;
}) {
  const trend = getMATrend(maData);
  const value = hoveredValue ?? trend.value;
  const arrow = trend.direction === "up" ? "↑" : trend.direction === "down" ? "↓" : "—";
  const valueClass =
    trend.direction === "up"
      ? "text-trade-up"
      : trend.direction === "down"
      ? "text-trade-down"
      : "text-t-text-3";

  return (
    <Tooltip content={MA_TOOLTIPS[name] ?? `${name} 均线指标`}>
      <span className="flex items-center gap-1 cursor-help">
        <span className="w-2 h-2 rounded-full" style={{ background: color }} />
        <span className="text-t-text-3">{name}</span>
        {value != null && (
          <span className={`font-medium ${valueClass}`}>
            {value.toFixed(0)}{arrow}
          </span>
        )}
      </span>
    </Tooltip>
  );
}
