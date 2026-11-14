"use client";

// ============================================================
// Visual EQ - interactive 3-band EQ editor in a popover plus
// the mini EQ thumbnail used on the mixer channel strips.
// Magnitude response is computed with the standard RBJ biquad
// formulas (lowshelf / peaking / highshelf) and summed in dB.
// ============================================================

import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, ReactElement } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { RotateCcw } from "lucide-react";
import { Knob } from "@/components/daw/controls/knob";
import { useDAW } from "@/lib/daw/store";
import { DEFAULT_EQ, type EqSettings, type Track } from "@/lib/daw/types";
import { clamp } from "@/lib/daw/utils";

// ---------------- RBJ biquad math ----------------

const FS = 44100;
const F_MIN = 20;
const F_MAX = 20000;
const DB_RANGE = 15; // +/- 15 dB view range

type FilterKind = "lowshelf" | "peaking" | "highshelf";

interface Coeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** Normalized biquad coefficients (a0 = 1) per the RBJ audio cookbook. */
function rbjCoeffs(kind: FilterKind, freq: number, q: number, gainDb: number): Coeffs {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * freq) / FS;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  if (kind === "peaking") {
    const alpha = sw / (2 * Math.max(q, 0.1));
    const a0 = 1 + alpha / A;
    return {
      b0: (1 + alpha * A) / a0,
      b1: (-2 * cw) / a0,
      b2: (1 - alpha * A) / a0,
      a1: (-2 * cw) / a0,
      a2: (1 - alpha / A) / a0,
    };
  }
  const alpha = (sw / 2) * Math.SQRT2; // shelf slope S = 1
  const sq = 2 * Math.sqrt(A) * alpha;
  if (kind === "lowshelf") {
    const a0 = A + 1 + (A - 1) * cw + sq;
    return {
      b0: (A * (A + 1 - (A - 1) * cw + sq)) / a0,
      b1: (2 * A * (A - 1 - (A + 1) * cw)) / a0,
      b2: (A * (A + 1 - (A - 1) * cw - sq)) / a0,
      a1: (-2 * (A - 1 + (A + 1) * cw)) / a0,
      a2: (A + 1 + (A - 1) * cw - sq) / a0,
    };
  }
  const a0 = A + 1 - (A - 1) * cw + sq;
  return {
    b0: (A * (A + 1 + (A - 1) * cw + sq)) / a0,
    b1: (-2 * A * (A - 1 + (A + 1) * cw)) / a0,
    b2: (A * (A + 1 + (A - 1) * cw - sq)) / a0,
    a1: (2 * (A - 1 - (A + 1) * cw)) / a0,
    a2: (A + 1 - (A - 1) * cw - sq) / a0,
  };
}

/** Magnitude of one biquad at frequency f, in dB. */
function magnitudeDb(c: Coeffs, f: number): number {
  const th = (2 * Math.PI * f) / FS;
  const ct = Math.cos(th);
  const st = Math.sin(th);
  const c2t = Math.cos(2 * th);
  const s2t = Math.sin(2 * th);
  const nRe = c.b0 + c.b1 * ct + c.b2 * c2t;
  const nIm = -(c.b1 * st + c.b2 * s2t);
  const dRe = 1 + c.a1 * ct + c.a2 * c2t;
  const dIm = -(c.a1 * st + c.a2 * s2t);
  const num = Math.sqrt(nRe * nRe + nIm * nIm);
  const den = Math.sqrt(dRe * dRe + dIm * dIm);
  return 20 * Math.log10(Math.max(num / Math.max(den, 1e-9), 1e-9));
}

/** Combined 3-band EQ magnitude in dB at frequency f. */
export function eqResponseDb(eq: EqSettings, f: number): number {
  return (
    magnitudeDb(rbjCoeffs("lowshelf", eq.lowFreq, 0.707, eq.lowGain), f) +
    magnitudeDb(rbjCoeffs("peaking", eq.midFreq, eq.midQ, eq.midGain), f) +
    magnitudeDb(rbjCoeffs("highshelf", eq.highFreq, 0.707, eq.highGain), f)
  );
}

// ---------------- axis mapping ----------------

export function freqToX(f: number, w: number): number {
  const t = Math.log(Math.max(f, F_MIN) / F_MIN) / Math.log(F_MAX / F_MIN);
  return t * w;
}

export function xToFreq(x: number, w: number): number {
  const t = clamp(x / Math.max(w, 1), 0, 1);
  return F_MIN * Math.pow(F_MAX / F_MIN, t);
}

function dbToY(db: number, h: number): number {
  const c = h / 2;
  return c - (clamp(db, -DB_RANGE, DB_RANGE) / DB_RANGE) * c;
}

function yToDb(y: number, h: number): number {
  return ((h / 2 - y) / (h / 2)) * DB_RANGE;
}

// ---------------- band definitions ----------------

interface BandDef {
  key: "low" | "mid" | "high";
  freqKey: "lowFreq" | "midFreq" | "highFreq";
  gainKey: "lowGain" | "midGain" | "highGain";
  min: number;
  max: number;
  color: string;
}

const BANDS: BandDef[] = [
  { key: "low", freqKey: "lowFreq", gainKey: "lowGain", min: 20, max: 400, color: "#e08e3c" },
  { key: "mid", freqKey: "midFreq", gainKey: "midGain", min: 100, max: 6000, color: "#ffb648" },
  { key: "high", freqKey: "highFreq", gainKey: "highGain", min: 1500, max: 18000, color: "#e8e8ec" },
];

function hitBand(eq: EqSettings, x: number, y: number, w: number, h: number): BandDef | null {
  let best: BandDef | null = null;
  let bestDist = 16;
  for (const band of BANDS) {
    const dx = x - freqToX(eq[band.freqKey], w);
    const dy = y - dbToY(eq[band.gainKey], h);
    const d = Math.hypot(dx, dy);
    if (d < bestDist) {
      bestDist = d;
      best = band;
    }
  }
  return best;
}

// ---------------- mini EQ thumbnail (channel strip) ----------------

export function EqMiniDisplay({
  eq,
  width = 60,
  height = 22,
}: {
  eq: EqSettings;
  width?: number;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
    if (canvas.height !== Math.round(height * dpr)) canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = "#101013";
    ctx.fillRect(0, 0, width, height);

    // 0 dB line
    ctx.strokeStyle = "rgba(232,232,236,0.10)";
    ctx.lineWidth = 1;
    const y0 = Math.round(height / 2) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y0);
    ctx.lineTo(width, y0);
    ctx.stroke();

    const flat =
      Math.abs(eq.lowGain) < 0.05 && Math.abs(eq.midGain) < 0.05 && Math.abs(eq.highGain) < 0.05;

    ctx.beginPath();
    for (let x = 0; x <= width; x += 1) {
      const y = dbToY(eqResponseDb(eq, xToFreq(x, width)), height);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = flat ? "#5a5a62" : "#ffb648";
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.stroke();
  }, [eq, width, height]);

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      style={{ width, height }}
      className="block"
      aria-hidden="true"
    />
  );
}

// ---------------- full editor canvas ----------------

function drawEqGraph(ctx: CanvasRenderingContext2D, w: number, h: number, eq: EqSettings) {
  ctx.fillStyle = "#101013";
  ctx.fillRect(0, 0, w, h);

  // frequency grid
  const gridFreqs = [30, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
  ctx.lineWidth = 1;
  for (const f of gridFreqs) {
    const major = f === 100 || f === 1000 || f === 10000;
    ctx.strokeStyle = major ? "rgba(232,232,236,0.10)" : "rgba(232,232,236,0.045)";
    const x = Math.round(freqToX(f, w)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  // dB grid
  for (const db of [-10, -5, 5, 10]) {
    ctx.strokeStyle = "rgba(232,232,236,0.045)";
    const y = Math.round(dbToY(db, h)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  // 0 dB center line
  ctx.strokeStyle = "rgba(232,232,236,0.16)";
  const y0 = Math.round(h / 2) + 0.5;
  ctx.beginPath();
  ctx.moveTo(0, y0);
  ctx.lineTo(w, y0);
  ctx.stroke();

  // labels
  ctx.fillStyle = "#6b6b73";
  ctx.font = "8px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const labeled: ReadonlyArray<readonly [number, string]> = [
    [100, "100"],
    [1000, "1k"],
    [10000, "10k"],
  ];
  for (const [f, label] of labeled) {
    ctx.fillText(label, freqToX(f, w), h - 3);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("+15", 3, 7);
  ctx.fillText("0", 3, h / 2);
  ctx.fillText("-15", 3, h - 7);

  // response curve points
  const pts: Array<[number, number]> = [];
  for (let x = 0; x <= w; x += 2) {
    pts.push([x, dbToY(eqResponseDb(eq, xToFreq(x, w)), h)]);
  }

  // subtle fill under the curve
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  for (const [x, y] of pts) ctx.lineTo(x, y);
  ctx.lineTo(w, h / 2);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,182,72,0.06)";
  ctx.fill();

  // curve
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#ffb648";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.stroke();

  // band dots
  for (const band of BANDS) {
    const x = freqToX(eq[band.freqKey], w);
    const y = dbToY(eq[band.gainKey], h);
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = band.color;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#101013";
    ctx.stroke();
  }
}

function EqEditor({ track }: { track: Track }) {
  const commit = useDAW((s) => s.commit);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<BandDef | null>(null);

  const updateEq = useCallback(
    (patch: Partial<EqSettings>) => {
      const t = useDAW.getState().project.tracks.find((x) => x.id === track.id);
      if (!t) return;
      useDAW.getState().updateTrack(track.id, { eq: { ...t.eq, ...patch } }, false);
    },
    [track.id]
  );

  // redraw whenever the EQ settings change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.clientWidth || 276;
    const h = canvas.clientHeight || 144;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawEqGraph(ctx, w, h, track.eq);
  }, [track.eq]);

  const toLocal = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const w = canvas.clientWidth || 276;
    const h = canvas.clientHeight || 144;
    const kx = rect.width > 0 ? w / rect.width : 1;
    const ky = rect.height > 0 ? h / rect.height : 1;
    return { x: (e.clientX - rect.left) * kx, y: (e.clientY - rect.top) * ky, w, h };
  };

  const applyDrag = (band: BandDef, x: number, y: number, w: number, h: number) => {
    const f = clamp(xToFreq(x, w), band.min, band.max);
    const g = clamp(yToDb(y, h), -12, 12);
    const patch: Partial<EqSettings> = {};
    patch[band.freqKey] = f;
    patch[band.gainKey] = g;
    updateEq(patch);
  };

  return (
    <div>
      <div className="flex items-baseline justify-between pb-1.5">
        <span className="text-[10px] font-semibold tracking-wide text-zinc-300">Channel EQ</span>
        <span className="text-[9px] text-zinc-600">Drag the dots to shape the sound</span>
      </div>
      <canvas
        ref={canvasRef}
        aria-label={`EQ curve for ${track.name}`}
        className="block w-full h-36 rounded border border-black/60 bg-[#101013] touch-none cursor-crosshair"
        onPointerDown={(e) => {
          const p = toLocal(e);
          if (!p) return;
          const band = hitBand(track.eq, p.x, p.y, p.w, p.h);
          if (!band) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          dragRef.current = band;
          e.currentTarget.style.cursor = "grabbing";
          commit();
          applyDrag(band, p.x, p.y, p.w, p.h);
        }}
        onPointerMove={(e) => {
          const p = toLocal(e);
          if (!p) return;
          const drag = dragRef.current;
          if (drag) {
            applyDrag(drag, p.x, p.y, p.w, p.h);
          } else {
            const canvas = canvasRef.current;
            if (canvas) {
              canvas.style.cursor = hitBand(track.eq, p.x, p.y, p.w, p.h) ? "grab" : "crosshair";
            }
          }
        }}
        onPointerUp={(e) => {
          dragRef.current = null;
          const canvas = canvasRef.current;
          if (canvas) canvas.style.cursor = "crosshair";
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          const canvas = canvasRef.current;
          if (canvas) canvas.style.cursor = "crosshair";
        }}
        onDoubleClick={(e) => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          const rect = canvas.getBoundingClientRect();
          const w = canvas.clientWidth || 276;
          const h = canvas.clientHeight || 144;
          const kx = rect.width > 0 ? w / rect.width : 1;
          const ky = rect.height > 0 ? h / rect.height : 1;
          const band = hitBand(track.eq, (e.clientX - rect.left) * kx, (e.clientY - rect.top) * ky, w, h);
          if (band) {
            commit();
            const patch: Partial<EqSettings> = {};
            patch[band.gainKey] = 0;
            updateEq(patch);
          }
        }}
      />
      <div className="flex items-center justify-between gap-2 pt-2">
        <button
          type="button"
          onClick={() => {
            commit();
            useDAW.getState().updateTrack(track.id, { eq: { ...DEFAULT_EQ } });
          }}
          className="h-6 px-2 inline-flex items-center gap-1.5 rounded-md border border-black/50 bg-[#26262b] hover:bg-[#2f2f34] text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <RotateCcw size={10} />
          Reset
        </button>
        <Knob
          size={28}
          label="Q"
          min={0.3}
          max={8}
          value={track.eq.midQ}
          onChange={(v) => updateEq({ midQ: v })}
          onCommitStart={commit}
          format={(v) => v.toFixed(1)}
        />
      </div>
    </div>
  );
}

// ---------------- popover wrapper ----------------

/**
 * Wraps any trigger element in a popover that opens the visual EQ
 * editor for the given track.
 */
export function VisualEQ({ trackId, children }: { trackId: string; children: ReactElement }) {
  const track = useDAW((s) => s.project.tracks.find((t) => t.id === trackId) ?? null);
  if (!track) return <>{children}</>;
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={6}
        collisionPadding={12}
        className="w-[300px] p-3 rounded-lg bg-[#232327] border-black/60 shadow-2xl"
      >
        <EqEditor track={track} />
      </PopoverContent>
    </Popover>
  );
}
