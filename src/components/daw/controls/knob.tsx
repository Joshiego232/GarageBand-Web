"use client";

// ============================================================
// Rotary knob (SVG) - drag vertically to change value
// ============================================================

import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface KnobProps {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  onCommitStart?: () => void;
  onCommitEnd?: () => void;
  label?: string;
  size?: number;
  unit?: string;
  format?: (v: number) => string;
  curve?: "lin" | "log";
  color?: string;
  disabled?: boolean;
}

export function Knob({
  value,
  min,
  max,
  onChange,
  onCommitStart,
  onCommitEnd,
  label,
  size = 44,
  unit,
  format,
  curve = "lin",
  color = "#ffb648",
  disabled,
}: KnobProps) {
  const dragRef = useRef<{ y: number; v: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const toNorm = useCallback(
    (v: number) => {
      if (curve === "log") {
        const lo = Math.log(Math.max(min, 1e-6));
        const hi = Math.log(Math.max(max, 1e-6));
        return (Math.log(Math.max(v, 1e-6)) - lo) / (hi - lo);
      }
      return (v - min) / (max - min);
    },
    [min, max, curve]
  );
  const fromNorm = useCallback(
    (n: number) => {
      const c = Math.min(1, Math.max(0, n));
      if (curve === "log") {
        const lo = Math.log(Math.max(min, 1e-6));
        const hi = Math.log(Math.max(max, 1e-6));
        return Math.exp(lo + c * (hi - lo));
      }
      return min + c * (max - min);
    },
    [min, max, curve]
  );

  const norm = toNorm(value);
  const angle = -135 + norm * 270;
  const r = size / 2 - 4;
  const cx = size / 2;
  const cy = size / 2;
  const arcPath = (from: number, to: number) => {
    const a1 = ((from - 90) * Math.PI) / 180;
    const a2 = ((to - 90) * Math.PI) / 180;
    const large = Math.abs(to - from) > 180 ? 1 : 0;
    const sweep = to > from ? 1 : 0;
    return `M ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)} A ${r} ${r} 0 ${large} ${sweep} ${cx + r * Math.cos(a2)} ${cy + r * Math.sin(a2)}`;
  };

  const display = format ? format(value) : `${Math.round(value * 100) / 100}${unit ?? ""}`;

  return (
    <div className={cn("flex flex-col items-center gap-0.5 select-none", disabled && "opacity-40 pointer-events-none")}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="cursor-ns-resize touch-none"
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          dragRef.current = { y: e.clientY, v: norm };
          setDragging(true);
          onCommitStart?.();
          e.preventDefault();
        }}
        onPointerMove={(e) => {
          if (!dragRef.current) return;
          const dy = dragRef.current.y - e.clientY;
          const speed = e.shiftKey ? 400 : 150;
          const next = Math.min(1, Math.max(0, dragRef.current.v + dy / speed));
          onChange(fromNorm(next));
        }}
        onPointerUp={() => {
          dragRef.current = null;
          setDragging(false);
          onCommitEnd?.();
        }}
        onDoubleClick={() => {
          // reset to middle
          onChange(fromNorm(0.5));
        }}
      >
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#3a3a41" strokeWidth="3" strokeDasharray="none" opacity="0.6"
          strokeDashoffset={0} />
        {/* track arc */}
        <path d={arcPath(-135, 135)} fill="none" stroke="#3a3a41" strokeWidth="3" strokeLinecap="round" opacity="0.8" />
        {/* value arc */}
        <path d={arcPath(-135, Math.max(-134.5, angle))} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
        {/* pointer */}
        <line
          x1={cx}
          y1={cy}
          x2={cx + (r - 6) * Math.sin((angle * Math.PI) / 180)}
          y2={cy - (r - 6) * Math.cos((angle * Math.PI) / 180)}
          stroke="#e8e8ec"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r={4} fill={dragging ? color : "#5a5a62"} />
      </svg>
      {label && <span className="text-[9px] text-zinc-400 leading-none">{label}</span>}
      <span className="text-[9px] text-zinc-500 font-mono leading-none">{display}</span>
    </div>
  );
}
