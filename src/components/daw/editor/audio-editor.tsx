"use client";
// ============================================================
// Audio editor - waveform view + gain / fade / region tools
// for audio regions shown inside the editor panel.
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent as ReactChangeEvent, PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeftRight, Layers3, Loader2, Music2, Play, Repeat, Scissors, Wand2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { useDAW } from "@/lib/daw/store";
import { engine } from "@/lib/daw/engine";
import { runCommandById } from "@/lib/daw/commands";
import { computePeaks } from "@/lib/daw/wav";
import { detectTransientCuts } from "@/lib/daw/audio-slicing";
import { barTicks, clamp, formatBarsBeats, gainToDb, noteName, secToTick, tickToSec } from "@/lib/daw/utils";
import { PPQ, uid } from "@/lib/daw/types";
import {
  applyMonophonicPitchCorrection,
  detectMonophonicPitchSegments,
  snapMidiPitchToScale,
  type DetectedPitchSegment,
} from "@/lib/daw/pitch-correction";
import { toast } from "sonner";
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
  const tempo = useDAW((s) => s.project.tempo);
  const keyTonic = useDAW((s) => s.project.keyTonic);
  const keyMode = useDAW((s) => s.project.keyMode);
  const track = useDAW((s) =>
    findActiveRegion(s.project, s.ui.editorRegionId, s.ui.selectedRegionIds, s.ui.selectedTrackId)?.track ?? null
  );
  const createAudioComp = useDAW((s) => s.createAudioComp);

  const [showComping, setShowComping] = useState(false);
  const [compSourceByBar, setCompSourceByBar] = useState<Record<number, string>>({});
  const [pitchSegments, setPitchSegments] = useState<DetectedPitchSegment[]>([]);
  const [pitchSegmentsRegionId, setPitchSegmentsRegionId] = useState<string | null>(null);
  const [pitchStrength, setPitchStrength] = useState(0.85);
  const [vibratoPreservation, setVibratoPreservation] = useState(1);
  const [analyzingPitch, setAnalyzingPitch] = useState(false);
  const [applyingPitch, setApplyingPitch] = useState(false);

  const [size, setSize] = useState({ w: 0, h: 0 });
  const [fadeHover, setFadeHover] = useState<"in" | "out" | null>(null);
  const [fadeDrag, setFadeDrag] = useState<"in" | "out" | null>(null);
  const [busy, setBusy] = useState(false);
  const [silenceThreshold, setSilenceThreshold] = useState(-48);
  const [sliceSensitivity, setSliceSensitivity] = useState(-18);
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
  const playbackRate = region?.playbackRate ?? 1;
  const looped = region?.looped ?? false;
  const maxFadeMs = Math.max(0, Math.round((sampleLength / 2) * 1000));
  const takeCandidates = useMemo(() => {
    if (!track || !region || region.type !== "audio") return [];
    const regionEnd = region.start + region.length;
    return track.regions
      .filter((item) =>
        item.type === "audio" &&
        item.id !== region.id &&
        item.start <= region.start + 1 &&
        item.start + item.length >= regionEnd - 1
      )
      .sort((a, b) => a.start - b.start);
  }, [track, region]);

  const compSources = region && region.type === "audio"
    ? [region, ...takeCandidates]
    : [];
  const compBarTicks = barTicks(timeSig);
  const compBarCount = region?.type === "audio"
    ? Math.min(16, Math.max(1, Math.ceil(region.length / compBarTicks)))
    : 0;

  const commitQuickComp = () => {
    if (!region || region.type !== "audio" || !track || compSources.length < 2) return;
    const takeIds = compSources.map((take) => take.id);
    const secPerTick = 60 / tempo / PPQ;
    const segments = Array.from({ length: compBarCount }, (_, index) => {
      const offsetTicks = index * compBarTicks;
      const lengthTicks = Math.min(compBarTicks, region.length - offsetTicks);
      const chosenId = compSourceByBar[index] ?? region.id;
      const source = compSources.find((take) => take.id === chosenId) ?? region;
      const sourceOffsetSec = Math.max(0, (region.start + offsetTicks - source.start) * secPerTick);
      const sourceLength = source.sampleLength ?? sampleLength;
      const availableSec = Math.max(0, sourceLength - sourceOffsetSec);
      const segmentDuration = Math.min(tickToSec(lengthTicks, tempo), availableSec);
      return {
        ...source,
        id: uid(),
        name: `${region.name} Comp ${index + 1}`,
        trackId: track.id,
        start: region.start + offsetTicks,
        length: Math.max(1, Math.round(segmentDuration / secPerTick)),
        looped: false,
        coreLength: undefined,
        sampleStart: (source.sampleStart ?? 0) + sourceOffsetSec,
        sampleLength: segmentDuration,
        fadeIn: source.fadeIn ?? 0.005,
        fadeOut: source.fadeOut ?? 0.01,
      };
    }).filter((segment) => segment.sampleLength > 0.01);

    if (!segments.length) {
      toast.error("No usable audio segments were found in these takes");
      return;
    }
    createAudioComp(track.id, takeIds, segments);
    setShowComping(false);
    setCompSourceByBar({});
    toast.success(`Created a ${segments.length}-section comp from ${compSources.length} takes`);
  };

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

  const onVarispeedChange = (values: number[]) => {
    const r = region;
    const nextRate = clamp(values[0] ?? 1, 0.5, 2);
    if (!r || r.type !== "audio" || Math.abs(nextRate - playbackRate) < 0.001) return;
    const store = useDAW.getState();
    store.commit();
    store.updateRegion(
      r.id,
      {
        playbackRate: nextRate,
        length: Math.max(1, Math.round(r.length * playbackRate / nextRate)),
      },
      false
    );
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

  const onBakeEdits = async () => {
    const r = region;
    if (!r || !stored || busy) return;
    setBusy(true);
    try {
      const sr = stored.sampleRate;
      const total = stored.channels[0]?.length ?? 0;
      const s0 = Math.max(0, Math.floor(sampleStart * sr));
      const s1 = Math.min(total, Math.ceil((sampleStart + sampleLength) * sr));
      if (s1 <= s0) {
        toast.error("The selected audio range is empty");
        return;
      }

      // Create a new PCM asset containing only this region's sample-accurate
      // range, with the current region gain baked in. The source asset remains
      // untouched so other regions that share it are safe.
      const channels = stored.channels.map((channel) => {
        const result = channel.slice(s0, s1);
        for (let index = 0; index < result.length; index++) {
          result[index] = (result[index] ?? 0) * gain;
        }
        return result;
      });
      const newId = `edit-${r.bufferId ?? "buf"}-${Date.now().toString(36)}`;
      await engine.storeBuffer(newId, {
        sampleRate: sr,
        channels,
        name: stored.name,
      });
      const store = useDAW.getState();
      store.commit();
      store.updateRegion(
        r.id,
        {
          bufferId: newId,
          sampleStart: 0,
          sampleLength: (s1 - s0) / sr,
          gain: 1,
        },
        false
      );
      setLoadTick((tick) => tick + 1);
      toast.success("Audio edits baked into a new sample");
    } catch (error) {
      console.error("Bake audio edits failed", error);
      toast.error("Could not bake these audio edits");
    } finally {
      setBusy(false);
    }
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

  const onSliceAtTransients = () => {
    const r = region;
    if (!r || !stored || busy) return;
    setBusy(true);
    try {
      const cuts = detectTransientCuts(
        stored.channels,
        stored.sampleRate,
        sampleStart,
        sampleLength,
        sliceSensitivity
      );
      if (!cuts.length) {
        toast.warning("No clear transients found. Try a lower sensitivity value or use a sharper recording.");
        return;
      }

      const boundaries = [0, ...cuts, sampleLength];
      const usableBoundaries = boundaries.filter((value, index) =>
        index === 0 ||
        index === boundaries.length - 1 ||
        boundaries[index + 1] - value >= 0.07
      );
      if (usableBoundaries.length < 3) {
        toast.warning("Not enough separate transients were found to create useful slices");
        return;
      }

      const project = useDAW.getState().project;
      const rate = clamp(r.playbackRate ?? 1, 0.5, 2);
      const segments = usableBoundaries.slice(0, -1).map((offsetSec, index) => {
        const endSec = usableBoundaries[index + 1];
        const sliceDuration = endSec - offsetSec;
        const startTick = Math.round(secToTick(offsetSec / rate, project.tempo));
        const endTick = Math.round(secToTick(endSec / rate, project.tempo));
        const isFirst = index === 0;
        const isLast = index === usableBoundaries.length - 2;
        return {
          ...r,
          id: uid(),
          name: `${r.name} Slice ${index + 1}`,
          start: r.start + startTick,
          length: Math.max(1, endTick - startTick),
          looped: false,
          coreLength: undefined,
          sampleStart: sampleStart + offsetSec,
          sampleLength: sliceDuration,
          fadeIn: isFirst ? r.fadeIn ?? 0 : 0.004,
          fadeOut: isLast ? r.fadeOut ?? 0 : 0.006,
        };
      }).filter((segment) => segment.sampleLength >= 0.04);

      if (segments.length < 2) {
        toast.warning("Not enough usable transients were found to create separate slices");
        return;
      }

      useDAW.getState().replaceRegionWithSegments(r.id, segments);
      toast.success(`Slicing created ${segments.length} separate audio regions`);
    } catch (error) {
      console.error("Transient slicing failed", error);
      toast.error("Could not slice this audio region");
    } finally {
      setBusy(false);
    }
  };

  const onStripSilence = () => {
    const r = region;
    if (!r || !stored || busy) return;
    setBusy(true);
    try {
      const sr = stored.sampleRate;
      const total = stored.channels[0]?.length ?? 0;
      const startFrame = Math.max(0, Math.floor(sampleStart * sr));
      const endFrame = Math.min(total, Math.ceil((sampleStart + sampleLength) * sr));
      if (endFrame <= startFrame) return;

      const windowFrames = Math.max(128, Math.floor(sr * 0.01));
      const threshold = Math.pow(10, silenceThreshold / 20);
      const activeWindows: { start: number; end: number }[] = [];

      for (let frame = startFrame; frame < endFrame; frame += windowFrames) {
        const end = Math.min(endFrame, frame + windowFrames);
        let sumSquares = 0;
        let sampleCount = 0;
        for (const channel of stored.channels) {
          for (let i = frame; i < end; i += 2) {
            const sample = channel[i] ?? 0;
            sumSquares += sample * sample;
            sampleCount++;
          }
        }
        const rms = sampleCount ? Math.sqrt(sumSquares / sampleCount) : 0;
        if (rms >= threshold) activeWindows.push({ start: frame, end });
      }

      if (!activeWindows.length) {
        toast.error("No audio found above this silence threshold");
        return;
      }

      // Merge brief dips so breaths and natural note decays are not chopped up.
      const minGapFrames = Math.floor(sr * 0.16);
      const minActiveFrames = Math.floor(sr * 0.075);
      const ranges: { start: number; end: number }[] = [];
      for (const window of activeWindows) {
        const previous = ranges[ranges.length - 1];
        if (previous && window.start - previous.end <= minGapFrames) {
          previous.end = window.end;
        } else {
          ranges.push({ ...window });
        }
      }

      const usefulRanges = ranges.filter((range) => range.end - range.start >= minActiveFrames);
      if (!usefulRanges.length) {
        toast.error("The selected threshold removed all audio");
        return;
      }

      const project = useDAW.getState().project;
      const sourceStart = r.sampleStart ?? 0;
      const segments = usefulRanges.map((range, index) => {
        const offsetSec = (range.start - startFrame) / sr;
        const durationSec = (range.end - range.start) / sr;
        const startTick = Math.round(secToTick(offsetSec, project.tempo));
        const lengthTicks = Math.max(1, Math.round(secToTick(durationSec, project.tempo)));
        const isFirst = index === 0;
        const isLast = index === usefulRanges.length - 1;
        return {
          ...r,
          id: uid(),
          name: usefulRanges.length > 1 ? `${r.name} ${index + 1}` : r.name,
          start: r.start + startTick,
          length: lengthTicks,
          looped: false,
          coreLength: undefined,
          sampleStart: sourceStart + offsetSec,
          sampleLength: durationSec,
          fadeIn: isFirst ? r.fadeIn ?? 0 : 0.008,
          fadeOut: isLast ? r.fadeOut ?? 0 : 0.008,
        };
      });

      useDAW.getState().replaceRegionWithSegments(r.id, segments);
      toast.success(`Strip Silence created ${segments.length} audio region${segments.length === 1 ? "" : "s"}`);
    } catch (error) {
      console.error("Strip Silence failed", error);
      toast.error("Could not strip silence from this region");
    } finally {
      setBusy(false);
    }
  };

  const activePitchSegments = pitchSegmentsRegionId === region?.id ? pitchSegments : [];

  const onAnalyzePitch = () => {
    if (!stored || !region || analyzingPitch) return;
    setAnalyzingPitch(true);
    try {
      const detected = detectMonophonicPitchSegments(
        stored.channels,
        stored.sampleRate,
        sampleStart,
        sampleLength
      );
      setPitchSegments(detected);
      setPitchSegmentsRegionId(region.id);
      if (!detected.length) {
        toast.warning("No stable monophonic notes were detected. Try a clear, single-note vocal recording.");
      } else {
        toast.success(`Detected ${detected.length} vocal note segment${detected.length === 1 ? "" : "s"}`);
      }
    } catch (error) {
      console.error("Flex Pitch analysis failed", error);
      toast.error("Could not analyze this recording");
    } finally {
      setAnalyzingPitch(false);
    }
  };

  const onSnapPitchToKey = () => {
    setPitchSegments((current) => current.map((segment) => ({
      ...segment,
      targetMidi: snapMidiPitchToScale(segment.detectedPitch, keyTonic, keyMode),
    })));
  };

  const onApplyPitchCorrection = async () => {
    const r = region;
    if (!r || !stored || !activePitchSegments.length || pitchSegmentsRegionId !== r.id || applyingPitch) return;
    setApplyingPitch(true);
    try {
      const correctedChannels = applyMonophonicPitchCorrection(
        stored.channels,
        stored.sampleRate,
        sampleStart,
        sampleLength,
        activePitchSegments,
        pitchStrength,
        vibratoPreservation
      );
      const newId = `flex-pitch-${uid()}`;
      const duration = correctedChannels[0]?.length
        ? correctedChannels[0].length / stored.sampleRate
        : 0;
      if (!duration || correctedChannels.some((channel) => channel.length !== correctedChannels[0].length)) {
        throw new Error("Pitch correction returned an invalid audio range");
      }
      await engine.storeBuffer(newId, {
        sampleRate: stored.sampleRate,
        channels: correctedChannels,
        name: `${stored.name} - Pitch Corrected`,
      });
      const store = useDAW.getState();
      store.commit();
      store.updateRegion(
        r.id,
        {
          bufferId: newId,
          sampleStart: 0,
          sampleLength: duration,
          playbackRate: 1,
        },
        false
      );
      setPitchSegments([]);
      setPitchSegmentsRegionId(null);
      setLoadTick((tick) => tick + 1);
      toast.success("Pitch-corrected audio copy created");
    } catch (error) {
      console.error("Flex Pitch correction failed", error);
      toast.error(error instanceof Error ? error.message : "Could not apply pitch correction");
    } finally {
      setApplyingPitch(false);
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

        <div className="flex flex-col gap-1 rounded border border-black/40 bg-[#19191c] p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-zinc-400">Varispeed</span>
            <span className="font-mono text-[10px] text-zinc-300">{playbackRate.toFixed(2)}×</span>
          </div>
          <Slider
            min={0.5}
            max={2}
            step={0.01}
            value={[playbackRate]}
            onValueChange={onVarispeedChange}
            aria-label="Audio varispeed"
          />
          <p className="text-[9px] leading-snug text-zinc-600">
            Changes speed, pitch and region duration together. This is varispeed, not pitch-preserving Flex Time.
          </p>
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

        <div className="flex flex-col gap-2 rounded border border-[#60a5fa]/30 bg-[#60a5fa]/[0.05] p-2">
          <div className="flex items-center gap-2">
            <Music2 size={12} className="text-[#8fc4f1]" />
            <span className="text-[9px] uppercase tracking-wider text-[#a8cdef]">Flex Pitch · Monophonic</span>
            <span className="ml-auto text-[8px] text-zinc-600">{activePitchSegments.length} notes</span>
          </div>
          <p className="text-[9px] leading-snug text-zinc-500">
            Detects one voice or instrument at a time. It will not separate overlapping vocals or polyphonic chords. Pitch correction creates a new audio copy; the source file stays unchanged.
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              className={BTN}
              onClick={onAnalyzePitch}
              disabled={!stored || analyzingPitch || applyingPitch}
            >
              {analyzingPitch ? <Loader2 className="size-3 animate-spin" /> : <Music2 className="size-3" />}
              {analyzingPitch ? "Analyzing…" : "Analyze Voice"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className={BTN}
              onClick={onSnapPitchToKey}
              disabled={!activePitchSegments.length || applyingPitch}
              title={`Snap detected notes to ${keyMode} in ${noteName(60 + keyTonic)}`}
            >
              <Wand2 className="size-3" /> Snap to Key
            </Button>
          </div>
          {activePitchSegments.length > 0 && (
            <>
              <label className="flex items-center gap-2">
                <span className="text-[9px] text-zinc-500 shrink-0">Correction</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={pitchStrength}
                  onChange={(event) => setPitchStrength(Number(event.target.value))}
                  aria-label="Pitch correction strength"
                  className="min-w-0 flex-1 accent-[#60a5fa]"
                />
                <span className="w-8 text-right font-mono text-[9px] text-zinc-300">{Math.round(pitchStrength * 100)}%</span>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-[9px] text-zinc-500 shrink-0">Vibrato</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={vibratoPreservation}
                  onChange={(event) => setVibratoPreservation(Number(event.target.value))}
                  aria-label="Natural vibrato preservation"
                  className="min-w-0 flex-1 accent-[#60a5fa]"
                />
                <span className="w-8 text-right font-mono text-[9px] text-zinc-300">
                  {Math.round(vibratoPreservation * 100)}%
                </span>
              </label>
              <p className="text-[8px] text-zinc-600">
                100% preserves the original pitch movement; lower values smooth vibrato towards the target note.
              </p>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {activePitchSegments.map((segment) => (
                  <div key={segment.id} className="grid grid-cols-[42px_1fr_1fr] gap-1.5 items-center rounded border border-black/30 bg-[#19191d] px-1.5 py-1">
                    <span className="text-[8px] tabular-nums text-zinc-600">
                      {segment.startSec.toFixed(1)}s
                    </span>
                    <span className="min-w-0 truncate text-[9px] text-zinc-300">
                      {noteName(segment.detectedMidi)}
                      <span className="ml-1 text-[8px] text-zinc-600">
                        {Math.round((segment.detectedPitch - segment.detectedMidi) * 100)}¢
                      </span>
                    </span>
                    <select
                      value={segment.targetMidi}
                      onChange={(event) => setPitchSegments((current) => current.map((item) =>
                        item.id === segment.id ? { ...item, targetMidi: Number(event.target.value) } : item
                      ))}
                      aria-label={`Target pitch for detected ${noteName(segment.detectedMidi)}`}
                      className="h-6 w-full rounded bg-[#2a2a30] px-1 text-[9px] text-[#b9dcfb]"
                    >
                      {Array.from({ length: 49 }, (_, index) => index + 36).map((pitch) => (
                        <option key={pitch} value={pitch}>{noteName(pitch)}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  className={BTN}
                  onClick={() => {
                    setPitchSegments([]);
                    setPitchSegmentsRegionId(null);
                  }}
                  disabled={applyingPitch}
                >
                  Clear Notes
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className={BTN_ACTIVE}
                  onClick={() => void onApplyPitchCorrection()}
                  disabled={applyingPitch || !stored}
                >
                  {applyingPitch ? <Loader2 className="size-3 animate-spin" /> : <Wand2 className="size-3" />}
                  {applyingPitch ? "Correcting…" : "Apply Flex Pitch"}
                </Button>
              </div>
            </>
          )}
        </div>

        {takeCandidates.length > 0 && (
          <div className="flex flex-col gap-2 rounded border border-[#8c75c8]/35 bg-[#8c75c8]/[0.07] p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[9px] uppercase tracking-wider text-[#bba8ed]">Quick Swipe Comp</span>
              <span className="text-[9px] text-zinc-500">{takeCandidates.length + 1} takes</span>
            </div>
            <p className="text-[9px] leading-snug text-zinc-500">
              Choose the take used for each bar, then commit the comp. Other overlapping takes on this track will be removed from the arrangement.
            </p>
            {showComping ? (
              <>
                <div className="max-h-36 overflow-y-auto space-y-1">
                  {Array.from({ length: compBarCount }, (_, index) => (
                    <label key={index} className="flex items-center gap-2">
                      <span className="w-12 shrink-0 text-[9px] text-zinc-500">Bar {index + 1}</span>
                      <select
                        value={compSourceByBar[index] ?? region?.id ?? ""}
                        onChange={(event) => setCompSourceByBar((current) => ({
                          ...current,
                          [index]: event.target.value,
                        }))}
                        className="h-7 min-w-0 flex-1 rounded border border-black/50 bg-[#232327] px-1.5 text-[9px] text-zinc-200"
                      >
                        {compSources.map((take, takeIndex) => (
                          <option key={take.id} value={take.id}>
                            {takeIndex === 0 ? `Current · ${take.name}` : `Take ${takeIndex + 1} · ${take.name}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <Button size="sm" variant="secondary" className={BTN} onClick={() => setShowComping(false)}>Cancel</Button>
                  <Button size="sm" variant="secondary" className={BTN_ACTIVE} onClick={commitQuickComp}>
                    <Layers3 className="size-3" /> Create Comp
                  </Button>
                </div>
              </>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                className={BTN}
                onClick={() => {
                  setCompSourceByBar({});
                  setShowComping(true);
                }}
                title="Choose the best take for each bar"
              >
                <Layers3 className="size-3" /> Choose Comp Phrases
              </Button>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 rounded border border-[#d6a85f]/25 bg-[#d6a85f]/[0.04] p-2">
          <div className="flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-wider text-[#d8b779]">Transient Slicing</span>
            <span className="text-[9px] font-mono text-zinc-400 tabular-nums">{sliceSensitivity} dB</span>
          </div>
          <input
            type="range"
            min={-36}
            max={-6}
            step={1}
            value={sliceSensitivity}
            onChange={(event) => setSliceSensitivity(Number(event.target.value))}
            aria-label="Transient detection sensitivity"
            className="w-full h-1.5 accent-[#d6a85f]"
          />
          <Button
            size="sm"
            variant="secondary"
            className={BTN}
            onClick={onSliceAtTransients}
            disabled={!stored || busy}
            title="Detect transient attacks and split the audio into separate regions"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Scissors className="size-3" />}
            Slice at Transients
          </Button>
          <p className="text-[8px] text-zinc-600">
            Creates separate regions using the original audio source. Move and rearrange slices on the timeline.
          </p>
        </div>

        <div className="flex flex-col gap-1 rounded border border-black/40 bg-[#19191c] p-2">
          <div className="flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-wider text-zinc-500">Strip Silence</span>
            <span className="text-[9px] font-mono text-zinc-400 tabular-nums">{silenceThreshold} dB</span>
          </div>
          <input
            type="range"
            min={-72}
            max={-24}
            step={1}
            value={silenceThreshold}
            onChange={(event) => setSilenceThreshold(Number(event.target.value))}
            aria-label="Strip silence threshold in decibels"
            className="w-full h-1.5 accent-[#a4c66d]"
          />
          <Button
            size="sm"
            variant="secondary"
            className={BTN}
            onClick={onStripSilence}
            disabled={!stored || busy}
            title="Split the recording around quiet sections while preserving the source audio"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Scissors className="size-3" />}
            Strip Silence
          </Button>
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
            className={BTN}
            onClick={onBakeEdits}
            disabled={!stored || busy}
            title="Destructively crop to the region boundaries and apply region gain to a new sample; shared source audio is preserved"
          >
            <Zap className="size-3" />
            Bake Edits
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
