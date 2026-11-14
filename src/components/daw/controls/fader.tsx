"use client";

// ============================================================
// Vertical channel-strip fader (GarageBand style)
// ============================================================

import { useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { volumeToSlider, sliderToVolume, gainToDb } from "@/lib/daw/utils";

interface FaderProps {
  value: number; // 0..1.25 linear gain
  onChange: (v: number) => void;
  onCommitStart?: () => void;
  onCommitEnd?: () => void;
  height?: number;
  disabled?: boolean;
}

export function Fader({ value, onChange, onCommitStart, onCommitEnd, height = 140, disabled }: FaderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const sliderVal = volumeToSlider(value); // 0..~1.07

  const valueFromEvent = useCallback((clientY: number) => {
    const el = trackRef.current;
    if (!el) return value;
    const rect = el.getBoundingClientRect();
    const t = 1 - (clientY - rect.top) / rect.height;
    return sliderToVolume(Math.min(1, Math.max(0, t)));
  }, [value]);

  return (
    <div className={cn("flex flex-col items-center gap-1 select-none touch-none", disabled && "opacity-40 pointer-events-none")}>
      <span className="text-[9px] font-mono text-zinc-500 w-9 text-center">
        {gainToDb(value) <= -60 ? "-\u221e" : `${gainToDb(value).toFixed(1)}`}
      </span>
      <div
        ref={trackRef}
        className="relative w-[18px] rounded-sm cursor-ns-resize bg-[#101013] border border-black/60 shadow-inner"
        style={{ height }}
        onPointerDown={(e) => {
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          setDragging(true);
          onCommitStart?.();
          onChange(valueFromEvent(e.clientY));
        }}
        onPointerMove={(e) => {
          if (!dragging) return;
          onChange(valueFromEvent(e.clientY));
        }}
        onPointerUp={() => {
          setDragging(false);
          onCommitEnd?.();
        }}
        onDoubleClick={() => onChange(0.9)}
      >
        {/* slot */}
        <div className="absolute left-1/2 top-1 bottom-1 w-[3px] -translate-x-1/2 rounded bg-black/80" />
        {/* cap */}
        <div
          className={cn(
            "absolute left-1/2 -translate-x-1/2 -translate-y-1/2 w-[16px] h-[22px] rounded-[3px] border border-black/70 shadow-md",
            dragging ? "bg-[#5b5b64]" : "bg-[#48484f]"
          )}
          style={{ top: `${(1 - sliderVal) * 100}%` }}
        >
          <div className="absolute left-1 right-1 top-1/2 h-[2px] -translate-y-1/2 rounded bg-zinc-300/80" />
        </div>
      </div>
      <span className="text-[9px] text-zinc-500">dB</span>
    </div>
  );
}
