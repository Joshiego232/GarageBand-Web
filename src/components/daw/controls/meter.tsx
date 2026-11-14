"use client";

// ============================================================
// Level meter - canvas bar with peak hold
// ============================================================

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface MeterProps {
  getLevel: () => number;
  vertical?: boolean;
  className?: string;
  width?: number;
  height?: number;
}

export function Meter({ getLevel, vertical = false, className, width = 8, height = 120 }: MeterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const peakRef = useRef(0);
  const peakAgeRef = useRef(0);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const dpr = window.devicePixelRatio || 1;
          const w = width;
          const h = height;
          if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
            canvas.width = w * dpr;
            canvas.height = h * dpr;
          }
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, w, h);
          // background
          ctx.fillStyle = "#131316";
          ctx.fillRect(0, 0, w, h);
          const level = Math.min(1.2, getLevel());
          // db-ish scale
          const norm = Math.pow(level, 0.5);
          // peak hold decay
          if (level >= peakRef.current) {
            peakRef.current = level;
            peakAgeRef.current = 0;
          } else {
            peakAgeRef.current++;
            if (peakAgeRef.current > 30) peakRef.current = Math.max(0, peakRef.current - 0.02);
          }
          const peakNorm = Math.pow(Math.min(1.2, peakRef.current), 0.5);
          const segs = 14;
          for (let i = 0; i < segs; i++) {
            const segNorm = (i + 1) / segs;
            const lit = norm >= segNorm - 1 / segs;
            const isPeakSeg = Math.abs(peakNorm - segNorm) < 1 / segs;
            let color = "#3a3a41";
            if (lit) color = segNorm > 0.92 ? "#e5484d" : segNorm > 0.75 ? "#e8c355" : "#4ec24a";
            else if (isPeakSeg) color = peakRef.current > 0.92 ? "#a93a3e" : peakRef.current > 0.75 ? "#a98b3e" : "#3a7a38";
            if (vertical) {
              const y = h - (i + 1) * (h / segs);
              ctx.fillStyle = color;
              ctx.fillRect(1, y + 0.5, w - 2, h / segs - 1);
            } else {
              ctx.fillStyle = color;
              ctx.fillRect(i * (w / segs) + 0.5, 1, w / segs - 1, h - 2);
            }
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [getLevel, vertical, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className={cn("rounded-sm overflow-hidden", className)}
      style={{ width, height }}
      aria-hidden
    />
  );
}
