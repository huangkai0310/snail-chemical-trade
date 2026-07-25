"use client";

import { useCallback, useEffect, useRef } from "react";

type Axis = "x" | "y";

interface Props {
  axis: Axis;
  /** 拖动时累计位移（px）；x 向右为正，y 向下为正 */
  onDrag: (delta: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  className?: string;
  title?: string;
}

/**
 * 面板分隔条：按住拖动调整相邻面板尺寸。
 * 使用 pointer capture，避免拖出元素后丢失事件。
 */
export default function PanelResizeHandle({
  axis,
  onDrag,
  onDragStart,
  onDragEnd,
  className = "",
  title,
}: Props) {
  const dragging = useRef(false);
  const lastPos = useRef(0);
  const onDragRef = useRef(onDrag);
  const onDragStartRef = useRef(onDragStart);
  const onDragEndRef = useRef(onDragEnd);

  useEffect(() => {
    onDragRef.current = onDrag;
  }, [onDrag]);
  useEffect(() => {
    onDragStartRef.current = onDragStart;
  }, [onDragStart]);
  useEffect(() => {
    onDragEndRef.current = onDragEnd;
  }, [onDragEnd]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      dragging.current = true;
      lastPos.current = axis === "x" ? e.clientX : e.clientY;
      e.currentTarget.setPointerCapture(e.pointerId);
      onDragStartRef.current?.();
      document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [axis],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      const pos = axis === "x" ? e.clientX : e.clientY;
      const delta = pos - lastPos.current;
      if (delta === 0) return;
      lastPos.current = pos;
      onDragRef.current(delta);
    },
    [axis],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    onDragEndRef.current?.();
  }, []);

  const isX = axis === "x";

  return (
    <div
      role="separator"
      aria-orientation={isX ? "vertical" : "horizontal"}
      title={title ?? (isX ? "拖动调整宽度" : "拖动调整高度")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={[
        "group/resize relative z-20 shrink-0 touch-none",
        isX
          ? "w-1.5 -mx-0.5 cursor-col-resize"
          : "h-1.5 -my-0.5 cursor-row-resize",
        "flex items-center justify-center",
        className,
      ].join(" ")}
    >
      <div
        className={[
          "rounded-full transition-colors",
          isX ? "h-8 w-0.5" : "w-8 h-0.5",
          "bg-t-border group-hover/resize:bg-t-accent group-active/resize:bg-t-accent",
        ].join(" ")}
      />
    </div>
  );
}
