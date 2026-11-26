"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";

type ResizeAxis = "horizontal" | "vertical";

interface ResizeHandleProps {
  axis: ResizeAxis;
  value: number;
  min: number;
  max: number;
  label: string;
  onChange: (value: number) => void;
  className?: string;
  gridColumn?: number;
}

export function ResizeHandle({
  axis,
  value,
  min,
  max,
  label,
  onChange,
  className = "",
  gridColumn,
}: ResizeHandleProps) {
  const dragStart = useRef<{ pointer: number; value: number } | null>(null);
  const isHorizontal = axis === "horizontal";

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragStart.current = {
      pointer: isHorizontal ? event.clientY : event.clientX,
      value,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    const pointer = isHorizontal ? event.clientY : event.clientX;
    const delta = pointer - dragStart.current.pointer;
    onChange(Math.max(min, Math.min(max, dragStart.current.value + delta)));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const increase = isHorizontal
      ? event.key === "ArrowDown"
      : event.key === "ArrowRight";
    const decrease = isHorizontal
      ? event.key === "ArrowUp"
      : event.key === "ArrowLeft";
    if (!increase && !decrease) return;
    event.preventDefault();
    const step = event.shiftKey ? 40 : 10;
    onChange(Math.max(min, Math.min(max, value + (increase ? step : -step))));
  };

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={axis}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      style={{ gridColumn }}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={() => {
        dragStart.current = null;
      }}
      onPointerCancel={() => {
        dragStart.current = null;
      }}
      onKeyDown={handleKeyDown}
      className={`group relative z-10 flex shrink-0 touch-none items-center justify-center outline-none focus-visible:bg-white/10 ${className} ${
        isHorizontal ? "h-2 w-full cursor-ns-resize" : "h-full w-2 cursor-ew-resize"
      }`}
    >
      <span
        aria-hidden
        className={`rounded-full bg-zinc-600 transition-colors group-hover:bg-zinc-300 group-focus-visible:bg-zinc-200 ${
          isHorizontal ? "h-0.5 w-10" : "h-10 w-0.5"
        }`}
      />
    </div>
  );
}
