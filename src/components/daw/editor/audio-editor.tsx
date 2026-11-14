"use client";
// ============================================================
// Audio editor - waveform view + gain / fade / region tools
// for audio regions shown inside the editor panel.
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent as ReactChangeEvent, PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeftRight, Loader2, Play, Repeat, Scissors, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { useDAW } from "@/lib/daw/store";
import { engine } from "@/lib/daw/engine";
import { runCommandById } from "@/lib/daw/commands";
import { computePeaks } from "@/lib/daw/wav";
import { clamp, formatBarsBeats, gainToDb } from "@/lib/daw/utils";
import { findActiveRegion } from "./piano-roll";

const HANDLE_R = 4.5;
const HANDLE_HIT = 9;

const BTN =
  "h-6 px-2 text-[11px] justify-start gap-1 bg-[#2a2a2f] hover:bg-[#34343b] text-zinc-300 border border-black/40 shadow-none";
const BTN_ACTIVE =
  "h-6 px-2 text-[11px] justify-start gap-1 bg-[#ffb648]/20 hover:bg-[#ffb648]/30 text-[#ffb648] border border-[#ffb648]/40 shadow-none";

interface FadeDrag {
  which: "in" | "out";
  startClientX: number;
  startVal: number; // seconds
  width: number; // px of the wave area at drag start
  durSec: number;
}

export function AudioEditor() {
  const region = useDAW((s) =>
    findActiveRegion(s.project, s.ui.editorRegionId, s.ui.selectedRegionIds, s.ui.selectedTrackId)?.region ?? null
  );
  const timeSig = useDAW((s) => s.project.timeSig);

  const [size, setSize] = useState({ w: 0, h: 0 });
  const [fadeHover, setFadeHover] = useState<"in" | "out" | null>(null);
  const [fadeDrag, setFadeDrag] = useState<"in" | "out" | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadTick, setLoadTick] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const fadeDragRef = useRef<FadeDrag | null>(null);
  const gainArmRef = useRef(false);
  const fadeArmRef = useRef(false);

  const bufferId = region?.bufferId;
  // engine cache read, re-evaluated whenever a pending load completes (loadTick bump)
  const stored = useMemo(
    () => (bufferId ? engine.getStoredBuffer(bufferId) : undefined),
    [bufferId, loadTick]
  );

  const sampleStart = region?.sampleStart ?? 0;
  const sampleLength = region?.sampleLength ?? 0;
  const fadeIn = region?.fadeIn ?? 0;
  const fadeOut = region?.fadeOut ?? 0;
  const gain = region?.gain ?? 1;
  const looped = region?.looped ?? false;
  const maxFadeMs = Math.max(0, Math.round((sampleLength / 2) * 1000));

  // ---------- PCM loading ----------

  useEffect(() => {
    if (!bufferId) return;
    if (engine.getStoredBuffer(bufferId)) return;
    void engine
      .ensureBufferLoaded(bufferId)
      .then((b) => {
        if (b) setLoadTick((t) => t + 1);
      })
      .catch(() => {
        /* missing buffer - polling below stops adding work */
      });
    const iv = setInterval(() => {
      if (engine.getStoredBuffer(bufferId)) {
        setLoadTick((t) => t + 1);
        clearInterval(iv);
      }
    }, 300);
    return () => clearInterval(iv);
  }, [bufferId]);

  // ---------- sizing ----------

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---------- waveform peaks ----------

  const peaks = useMemo(() => {
    if (!stored || size.w < 2) return null;
    const sr = stored.sampleRate;
    const total = stored.channels[0]?.length ?? 0;
    const s0 = Math.max(0, Math.floor(sampleStart * sr));
    const s1 = Math.min(total, Math.ceil((sampleStart + sampleLength) * sr));
    if (s1 <= s0) return null;
    return computePeaks(stored.channels, s0, s1, size.w);
  }, [stored, sampleStart, sampleLength, size.w]);

  // ---------- waveform drawing ----------

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const W = size.w;
    const H = size.h;
    if (W < 2 || H < 2) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const pw = Math.round(W * dpr);
    const ph = Math.round(H * dpr);
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // region body (darker blue)
    ctx.fillStyle = "rgba(74,144,217,0.13)";
    ctx.fillRect(0, 0, W, H);

    const mid = Math.round(H / 2) + 0.5;

    // waveform (min/max mirrored around center)
    if (peaks) {
      const amp = H / 2 - 3;
      ctx.fillStyle = "#4a90d9";
      ctx.beginPath();
      ctx.moveTo(0.5, mid);
      for (let x = 0; x < W; x++) {
        const max = peaks[x * 2 + 1] ?? 0;
        ctx.lineTo(x + 0.5, mid - max * amp);
      }
      for (let x = W - 1; x >= 0; x--) {
        const min = peaks[x * 2] ?? 0;
        ctx.lineTo(x + 0.5, mid - min * amp);
      }
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = "rgba(74,144,217,0.3)";
      ctx.fillRect(0, mid - 0.5, W, 1);
    }

    // center line
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(W, mid);
    ctx.stroke();

    // region edges
    ctx.fillStyle = "rgba(74,144,217,0.55)";
    ctx.fillRect(0, 0, 1, H);
    ctx.fillRect(W - 1, 0, 1, H);

    // fades: translucent corner wedges + draggable handles on the top edge
    const dur = Math.max(0.001, sampleLength);
    const fiW = (fadeIn / dur) * W;
    const foW = (fadeOut / dur) * W;
    if (fiW > 0.5) {
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(fiW, 0);
      ctx.lineTo(0, H);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0.5, H);
      ctx.lineTo(fiW, 0.5);
      ctx.stroke();
    }
    if (foW > 0.5) {
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath();
      ctx.moveTo(W - foW, 0);
      ctx.lineTo(W, 0);
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(W - foW, 0.5);
      ctx.lineTo(W - 0.5, H);
      ctx.stroke();
    }
    const handle = (x: number, active: boolean) => {
      ctx.beginPath();
      ctx.arc(x, 7, HANDLE_R, 0, Math.PI * 2);
      ctx.fillStyle = active ? "#ffb648" : "#f4f4f6";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#141419";
      ctx.stroke();
    };
    handle(clamp(fiW, HANDLE_R, W - HANDLE_R), fadeDrag === "in" || fadeHover === "in");
    handle(clamp(W - foW, HANDLE_R, W - HANDLE_R), fadeDrag === "out" || fadeHover === "out");
  }, [peaks, size, fadeIn, fadeOut, sampleLength, fadeHover, fadeDrag]);

  // ---------- playhead ----------

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const el = playheadRef.current;
      if (!el) return;
      const r = region;
      if (!r || size.w < 2) {
        el.style.display = "none";
        return;
      }
      const local = engine.currentTick() - r.start;
      if (local >= 0 && local <= r.length) {
        el.style.display = "block";
        el.style.transform = `translateX(${(local / r.length) * size.w}px)`;
      } else {
        el.style.display = "none";
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [region, size.w]);

  // ---------- waveform pointer interactions ----------

  const onWavePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const r = region;
    if (!r || r.type !== "audio") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const W = rect.width;
    const dur = Math.max(0.001, sampleLength);
    const fiX = (fadeIn / dur) * W;
    const foX = W - (fadeOut / dur) * W;

    if (stored && Math.abs(x - fiX) <= HANDLE_HIT) {
      e.currentTarget.setPointerCapture(e.pointerId);
      fadeDragRef.current = { which: "in", startClientX: e.clientX, startVal: fadeIn, width: W, durSec: dur };
      setFadeDrag("in");
      useDAW.getState().commit(); // one history entry for the whole drag
      return;
    }
    if (stored && Math.abs(x - foX) <= HANDLE_HIT) {
      e.currentTarget.setPointerCapture(e.pointerId);
      fadeDragRef.current = { which: "out", startClientX: e.clientX, startVal: fadeOut, width: W, durSec: dur };
      setFadeDrag("out");
      useDAW.getState().commit();
      return;
    }

    // click anywhere else moves the playhead into the region
    const localTick = (x / W) * r.length;
    engine.setPlayhead(Math.round(r.start + clamp(localTick, 0, r.length)));
  };

  const onWavePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = fadeDragRef.current;
    if (d) {
      const r = region;
      if (!r) return;
      const dx = e.clientX - d.startClientX;
      const sec = clamp(d.startVal + (dx / d.width) * d.durSec, 0, d.durSec / 2);
      useDAW.getState().updateRegion(r.id, d.which === "in" ? { fadeIn: sec } : { fadeOut: sec }, false);
      return;
    }
    const r = region;
    if (!r || !stored) {
      if (fadeHover) setFadeHover(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const W = rect.width;
    const dur = Math.max(0.001, sampleLength);
    const fiX = (fadeIn / dur) * W;
    const foX = W - (fadeOut / dur) * W;
    const hov =
      Math.abs(x - fiX) <= HANDLE_HIT ? "in" : Math.abs(x - foX) <= HANDLE_HIT ? "out" : null;
    if (hov !== fadeHover) setFadeHover(hov);
    e.currentTarget.style.cursor = hov ? "ew-resize" : "default";
  };

  const onWavePointerUp = () => {
    fadeDragRef.current = null;
    setFadeDrag(null);
  };

  // ---------- controls ----------

  const onGainChange = (vals: number[]) => {
    const r = region;
    if (!r) return;
    if (!gainArmRef.current) {
      gainArmRef.current = true;
      useDAW.getState().commit(); // snapshot once per gesture
    }
    useDAW.getState().updateRegion(r.id, { gain: clamp(vals[0] ?? 1, 0, 2) }, false);
  };

  const onGainCommit = () => {
    gainArmRef.current = false;
  };

  const onFadeInput =
    (which: "in" | "out") =>
    (e: ReactChangeEvent<HTMLInputElement>) => {
      const r = region;
      if (!r) return;
      const v = e.target.valueAsNumber;
      if (Number.isNaN(v)) return;
      const ms = clamp(Math.round(v), 0, maxFadeMs);
      if (!fadeArmRef.current) {
        fadeArmRef.current = true;
        useDAW.getState().commit();
      }
      useDAW
        .getState()
        .updateRegion(r.id, which === "in" ? { fadeIn: ms / 1000 } : { fadeOut: ms / 1000 }, false);
    };

  const onFadeBlur = () => {
    fadeArmRef.current = false;
  };

  const onNormalize = () => {
    const r = region;
    if (!r || !stored) return;
    const sr = stored.sampleRate;
    const total = stored.channels[0]?.length ?? 0;
    const s0 = Math.max(0, Math.floor(sampleStart * sr));
    const s1 = Math.min(total, Math.ceil((sampleStart + sampleLength) * sr));
    if (s1 <= s0) return;
    const pk = computePeaks(stored.channels, s0, s1, 1);
    const peak = Math.max(Math.abs(pk[0] ?? 0), Math.abs(pk[1] ?? 0));
    if (peak < 1e-5) return;
    const store = useDAW.getState();
    store.commit();
    store.updateRegion(r.id, { gain: Math.min(1.5, 0.95 / peak) });
  };

  const onReverse = async () => {
    const r = region;
    if (!r || !stored || busy) return;
    setBusy(true);
    try {
      const sr = stored.sampleRate;
      const total = stored.channels[0]?.length ?? 0;
      const s0 = Math.max(0, Math.floor(sampleStart * sr));
      const s1 = Math.min(total, Math.ceil((sampleStart + sampleLength) * sr));
      const len = Math.max(0, s1 - s0);
      if (len === 0) return;
      const channels = stored.channels.map((ch) => {
        const out = new Float32Array(len);
        for (let i = 0; i < len; i++) out[i] = ch[s0 + len - 1 - i] ?? 0;
        return out;
      });
      const newId = `rev-${r.bufferId ?? "buf"}-${Date.now().toString(36)}`;
      await engine.storeBuffer(newId, { sampleRate: sr, channels, name: stored.name });
      const store = useDAW.getState();
      store.commit();
      store.updateRegion(r.id, { bufferId: newId, sampleStart: 0 }, false);
    } finally {
      setBusy(false);
    }
  };

  const onToggleLoop = () => {
    const r = region;
    if (!r) return;
    useDAW.getState().updateRegion(r.id, { looped: !r.looped });
  };

  const onPlayRegion = () => {
    const r = region;
    if (!r) return;
    if (engine.playing) {
      engine.play(r.start);
    } else {
      engine.setPlayhead(r.start);
      engine.play(r.start);
    }
  };

  // ---------- render ----------

  if (!region || region.type !== "audio") {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center text-xs text-zinc-600 select-none">
        No audio region
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex">
      {/* controls column */}
      <aside
        className="w-52 shrink-0 border-r border-black/50 bg-[#1d1d20] flex flex-col gap-2 p-2 text-[11px] overflow-y-auto [scrollbar-width:thin] [scrollbar-color:#3a3a41_transparent] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-sm [&::-webkit-scrollbar-thumb]:bg-[#3a3a41] [&::-webkit-scrollbar-track]:bg-transparent"
        aria-label="Audio region controls"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium text-zinc-300 truncate" title={region.name}>
            {region.name}
          </span>
        </div>
        <div className="flex justify-between text-zinc-500 tabular-nums">
          <span>{sampleLength.toFixed(2)} s</span>
          <span>{formatBarsBeats(region.length, timeSig)}</span>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">Gain</span>
            <span className="tabular-nums text-zinc-300">{gainToDb(gain).toFixed(1)} dB</span>
          </div>
          <Slider
            min={0}
            max={2}
            step={0.01}
            value={[gain]}
            onValueChange={onGainChange}
            onValueCommit={onGainCommit}
            aria-label="Region gain"
          />
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <label className="flex flex-col gap-1">
            <span className="text-zinc-500">Fade In</span>
            <Input
              type="number"
              min={0}
              max={maxFadeMs}
              step={10}
              className="h-6 w-full text-[11px] tabular-nums bg-[#17171a] border-[#3a3a41] text-zinc-200 px-1.5"
              value={Math.round(fadeIn * 1000)}
              onChange={onFadeInput("in")}
              onBlur={onFadeBlur}
              aria-label="Fade in milliseconds"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-zinc-500">Fade Out</span>
            <Input
              type="number"
              min={0}
              max={maxFadeMs}
              step={10}
              className="h-6 w-full text-[11px] tabular-nums bg-[#17171a] border-[#3a3a41] text-zinc-200 px-1.5"
              value={Math.round(fadeOut * 1000)}
              onChange={onFadeInput("out")}
              onBlur={onFadeBlur}
              aria-label="Fade out milliseconds"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            className={BTN}
            onClick={() => runCommandById("region.split")}
            title="Split regions at the playhead"
          >
            <Scissors className="size-3" />
            Split
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className={BTN}
            onClick={onNormalize}
            disabled={!stored}
            title="Normalize peak to about -0.4 dB"
          >
            <Zap className="size-3" />
            Normalize
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className={BTN}
            onClick={onReverse}
            disabled={!stored || busy}
            title="Reverse the audio content"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <ArrowLeftRight className="size-3" />}
            Reverse
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className={looped ? BTN_ACTIVE : BTN}
            onClick={onToggleLoop}
            title="Toggle region looping"
            aria-pressed={looped}
          >
            <Repeat className="size-3" />
            Loop
          </Button>
        </div>

        <Button
          size="sm"
          variant="secondary"
          className={`${BTN} w-full justify-center`}
          onClick={onPlayRegion}
          title="Play this region from its start"
        >
          <Play className="size-3" />
          Play Region
        </Button>

        <p className="mt-auto text-[10px] leading-snug text-zinc-600">
          Click the waveform to move the playhead. Drag the round handles on the top edge to adjust
          fades.
        </p>
      </aside>

      {/* waveform */}
      <div
        ref={containerRef}
        className="relative flex-1 min-w-0 overflow-hidden bg-[#191b20]"
        onPointerDown={onWavePointerDown}
        onPointerMove={onWavePointerMove}
        onPointerUp={onWavePointerUp}
        onPointerCancel={onWavePointerUp}
      >
        <canvas
          ref={canvasRef}
          className="absolute left-0 top-0 block"
          style={{ width: size.w, height: size.h }}
          aria-label="Audio waveform"
        />
        <div
          ref={playheadRef}
          className="absolute top-0 bottom-0 pointer-events-none bg-white/90"
          style={{ width: 1, display: "none" }}
          aria-hidden="true"
        />
        {!stored && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-zinc-500 select-none">
            {bufferId ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Loading audio...
              </>
            ) : (
              "No audio data"
            )}
          </div>
        )}
      </div>
    </div>
  );
}
