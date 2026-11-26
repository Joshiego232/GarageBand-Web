"use client";
// ============================================================
// Piano Roll - canvas MIDI editor shown inside the editor panel.
// Notes use region-relative ticks (PPQ = 960 ticks per beat).
// Full 88-key range (21..108), 13px rows, grid + playhead +
// pencil / marquee / move / resize / delete interactions.
// ============================================================

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useDAW } from "@/lib/daw/store";
import { engine } from "@/lib/daw/engine";
import { PPQ, type Note, type Project, type Region, type Track } from "@/lib/daw/types";
import { barTicks, clamp, isBlackKey, noteName, snapTick, snapTicks } from "@/lib/daw/utils";
import { mixHex } from "@/lib/daw/colors";
import { detectChord } from "@/lib/daw/ChordDetector";

// ---------- constants ----------

const PITCH_MIN = 21;
const PITCH_MAX = 108;
const ROWS = PITCH_MAX - PITCH_MIN + 1; // 88 keys
const ROW_H = 13;
const KEYS_W = 56;
const CONTENT_H = ROWS * ROW_H; // 1144 px
const MIN_NOTE_TICKS = Math.round(PPQ / 8); // 1/32 note = 120 ticks
const MAX_CANVAS_W = 16000;
const EMPTY_NOTES: Note[] = [];

const TOOL_BTN =
  "h-6 px-2 text-[11px] bg-[#2a2a2f] hover:bg-[#34343b] text-zinc-300 border border-black/40 shadow-none";

/**
 * Resolve which region the editor panel should edit:
 * explicit ui.editorRegionId, else first selected region,
 * else the first region of the selected track.
 */
export function findActiveRegion(
  project: Project,
  editorRegionId: string | null,
  selectedRegionIds: string[],
  selectedTrackId: string | null
): { track: Track; region: Region } | null {
  const byId = (id: string | null): { track: Track; region: Region } | null => {
    if (!id) return null;
    for (const t of project.tracks) {
      const r = t.regions.find((x) => x.id === id);
      if (r) return { track: t, region: r };
    }
    return null;
  };
  const direct = byId(editorRegionId);
  if (direct) return direct;
  for (const id of selectedRegionIds) {
    const found = byId(id);
    if (found) return found;
  }
  if (selectedTrackId) {
    const t = project.tracks.find((x) => x.id === selectedTrackId);
    const r = t?.regions[0];
    if (t && r) return { track: t, region: r };
  }
  return null;
}

// ---------- local types ----------

interface RollState {
  region: Region | null;
  track: Track | null;
  notes: Note[];
  selectedNoteIds: string[];
  pxPerTick: number;
  grid: number;
  tool: "pointer" | "pencil";
  timeSig: [number, number];
  contentW: number;
}

type DragState =
  | {
      kind: "move";
      ids: string[];
      originals: Note[];
      grabbed: Note;
      startTick: number;
      startPitch: number;
      deltaTick: number;
      deltaPitch: number;
      moved: boolean;
    }
  | { kind: "resize"; id: string; original: Note; newLength: number; moved: boolean }
  | { kind: "create"; pitch: number; start: number; length: number; moved: boolean }
  | { kind: "marquee"; x0: number; y0: number; x1: number; y1: number; additive: boolean; moved: boolean };

// ---------- helpers ----------

function pitchToY(pitch: number): number {
  return (PITCH_MAX - pitch) * ROW_H;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

function hitNoteAt(
  notes: Note[],
  pxPerTick: number,
  x: number,
  pitch: number
): { note: Note; startX: number; endX: number } | null {
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    if (n.pitch !== pitch) continue;
    const startX = n.start * pxPerTick;
    const endX = startX + Math.max(3, n.length * pxPerTick);
    if (x >= startX && x <= endX) return { note: n, startX, endX };
  }
  return null;
}

// ---------- component ----------

export function PianoRoll() {
  const region = useDAW((s) =>
    findActiveRegion(s.project, s.ui.editorRegionId, s.ui.selectedRegionIds, s.ui.selectedTrackId)?.region ?? null
  );
  const track = useDAW((s) =>
    findActiveRegion(s.project, s.ui.editorRegionId, s.ui.selectedRegionIds, s.ui.selectedTrackId)?.track ?? null
  );
  const notes = useDAW((s) =>
    findActiveRegion(s.project, s.ui.editorRegionId, s.ui.selectedRegionIds, s.ui.selectedTrackId)?.region?.notes ??
    EMPTY_NOTES
  );
  const selectedNoteIds = useDAW((s) => s.ui.selectedNoteIds);
  const tool = useDAW((s) => s.ui.tool);
  const zoom = useDAW((s) => s.ui.zoom);
  const snap = useDAW((s) => s.ui.snap);
  const timeSig = useDAW((s) => s.project.timeSig);
  const keyTonic = useDAW((s) => s.project.keyTonic);
  const keyMode = useDAW((s) => s.project.keyMode);

  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const keysRef = useRef<HTMLCanvasElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const keysDownRef = useRef<{ pitch: number } | null>(null);
  const velArmRef = useRef(false);
  const lastRegionIdRef = useRef<string | null>(null);

  const pxPerTick = zoom / PPQ;
  const grid = snapTicks(snap, zoom, timeSig);
  const contentW = region
    ? Math.max(160, Math.min(MAX_CANVAS_W, Math.ceil(region.length * pxPerTick) + 40))
    : 160;
  const chordBars = useMemo(() => {
    if (!region || region.type !== "midi") return [];
    const ticksPerBar = barTicks(timeSig);
    const count = Math.ceil(region.length / ticksPerBar);
    return Array.from({ length: count }, (_, bar) => {
      const start = bar * ticksPerBar;
      const notesInBar = notes.filter(
        (note) => note.start < start + ticksPerBar && note.start + note.length > start,
      );
      return {
        bar,
        chord: detectChord(notesInBar.map((note) => note.pitch), { tonic: keyTonic, mode: keyMode }),
      };
    });
  }, [keyMode, keyTonic, notes, region, timeSig]);

  // Latest-state ref read by the draw loop and pointer handlers.
  const stateRef = useRef<RollState>({
    region: null,
    track: null,
    notes: EMPTY_NOTES,
    selectedNoteIds: [],
    pxPerTick,
    grid,
    tool,
    timeSig,
    contentW,
  });
  // keep the mirror current after paint (never during render)
  useEffect(() => {
    stateRef.current = { region, track, notes, selectedNoteIds, pxPerTick, grid, tool, timeSig, contentW };
  });

  const selSet = useMemo(() => new Set(selectedNoteIds), [selectedNoteIds]);
  const selectedNotes = useMemo(() => notes.filter((n) => selSet.has(n.id)), [notes, selSet]);
  const hasSelection = selectedNotes.length > 0;
  const velocity = hasSelection
    ? Math.round(selectedNotes.reduce((a, n) => a + n.velocity, 0) / selectedNotes.length)
    : 96;

  // ---------- drawing ----------

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const st = stateRef.current;
    const reg = st.region;
    if (!reg) return;

    const cssW = st.contentW;
    // keep memory sane for very wide rolls
    const dpr = cssW > 4000 ? 1 : Math.min(window.devicePixelRatio || 1, 2.5);
    const pw = Math.round(cssW * dpr);
    const ph = Math.round(CONTENT_H * dpr);
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, CONTENT_H);

    // --- pitch rows ---
    for (let i = 0; i < ROWS; i++) {
      const pitch = PITCH_MAX - i;
      ctx.fillStyle = pitch % 12 === 0 ? "#222226" : isBlackKey(pitch) ? "#19191c" : "#1d1d20";
      ctx.fillRect(0, i * ROW_H, cssW, ROW_H);
    }
    ctx.fillStyle = "#131316";
    for (let i = 1; i < ROWS; i++) ctx.fillRect(0, i * ROW_H, cssW, 1);

    // --- vertical grid ---
    const bar = barTicks(st.timeSig);
    const beat = PPQ * (4 / st.timeSig[1]);
    const sub = beat / 4;
    const len = reg.length;
    const vline = (tick: number, color: string) => {
      const x = Math.round(tick * st.pxPerTick) + 0.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CONTENT_H);
      ctx.stroke();
    };
    if (sub * st.pxPerTick >= 5) {
      for (let t = 0; t <= len; t += sub) if (t % beat !== 0) vline(t, "#232327");
    }
    if (beat * st.pxPerTick >= 4) {
      for (let t = 0; t <= len; t += beat) if (t % bar !== 0) vline(t, "#2c2c31");
    }
    for (let t = 0; t <= len; t += bar) vline(t, "#3f3f46");
    vline(len, "rgba(255,255,255,0.16)"); // region end edge

    // bar numbers (absolute timeline bar count)
    ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "#6e6e78";
    ctx.textBaseline = "top";
    for (let b = 0; b * bar <= len; b++) {
      const absBar = Math.floor((reg.start + b * bar) / bar) + 1;
      ctx.fillText(String(absBar), b * bar * st.pxPerTick + 3, 2);
    }

    // loop core marker
    if (reg.looped && reg.coreLength && reg.coreLength > 0 && reg.coreLength < len) {
      const x = Math.round(reg.coreLength * st.pxPerTick) + 0.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = "rgba(255,182,72,0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CONTENT_H);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // --- notes ---
    const sel = new Set(st.selectedNoteIds);
    const drag = dragRef.current;
    const moveIds = drag && drag.kind === "move" ? new Set(drag.ids) : null;
    for (const n of st.notes) {
      let start = n.start;
      let length = n.length;
      let pitch = n.pitch;
      let ghost = false;
      if (drag && drag.kind === "move" && moveIds?.has(n.id)) {
        start += drag.deltaTick;
        pitch = clamp(pitch + drag.deltaPitch, PITCH_MIN, PITCH_MAX);
        ghost = true;
      } else if (drag && drag.kind === "resize" && drag.id === n.id) {
        length = drag.newLength;
        ghost = true;
      }
      const x = start * st.pxPerTick;
      const w = Math.max(3, length * st.pxPerTick);
      const y = pitchToY(clamp(pitch, PITCH_MIN, PITCH_MAX)) + 1;
      const h = ROW_H - 2;
      const selected = sel.has(n.id);
      const noteColor = st.track?.color ?? "#28B463";
      ctx.fillStyle = selected
        ? mixHex(noteColor, "#ffffff", 0.4)
        : mixHex(noteColor, "#ffffff", 0.16 + (n.velocity / 127) * 0.28);
      roundRectPath(ctx, x, y, w, h, 2.5);
      ctx.fill();
      if (selected) {
        ctx.strokeStyle = "#dff0d0";
        ctx.lineWidth = 1.5;
        roundRectPath(ctx, x + 0.75, y + 0.75, Math.max(1.5, w - 1.5), h - 1.5, 1.75);
        ctx.stroke();
      } else {
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.lineWidth = 1;
        roundRectPath(ctx, x + 0.5, y + 0.5, Math.max(2, w - 1), h - 1, 2);
        ctx.stroke();
      }
      if (ghost) {
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = 1;
        roundRectPath(ctx, x + 0.5, y + 0.5, Math.max(2, w - 1), h - 1, 2);
        ctx.stroke();
      }
    }

    // note-create preview
    if (drag && drag.kind === "create") {
      const x = drag.start * st.pxPerTick;
      const w = Math.max(3, drag.length * st.pxPerTick);
      const y = pitchToY(drag.pitch) + 1;
      ctx.fillStyle = mixHex(st.track?.color ?? "#28B463", "#ffffff", 0.36);
      roundRectPath(ctx, x, y, w, ROW_H - 2, 2.5);
      ctx.fill();
      ctx.setLineDash([3, 2]);
      ctx.strokeStyle = "rgba(255,255,255,0.65)";
      ctx.lineWidth = 1;
      roundRectPath(ctx, x + 0.5, y + 0.5, Math.max(2, w - 1), ROW_H - 3, 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // marquee band
    if (drag && drag.kind === "marquee" && drag.moved) {
      const x0 = Math.min(drag.x0, drag.x1);
      const x1 = Math.max(drag.x0, drag.x1);
      const y0 = Math.min(drag.y0, drag.y1);
      const y1 = Math.max(drag.y0, drag.y1);
      ctx.fillStyle = "rgba(255,182,72,0.07)";
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = "#ffb648";
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
      ctx.setLineDash([]);
    }
  }, []);

  const drawKeys = useCallback(() => {
    const canvas = keysRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(KEYS_W * dpr);
    canvas.height = Math.round(CONTENT_H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, KEYS_W, CONTENT_H);
    for (let i = 0; i < ROWS; i++) {
      const pitch = PITCH_MAX - i;
      const y = i * ROW_H;
      ctx.fillStyle = "#d7d7dc"; // white key base
      ctx.fillRect(0, y, KEYS_W, ROW_H);
      if (isBlackKey(pitch)) {
        ctx.fillStyle = "#222228";
        roundRectPath(ctx, 0.5, y + 1, KEYS_W * 0.62, ROW_H - 2, 2);
        ctx.fill();
      }
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.fillRect(0, y, KEYS_W, 1);
      if (pitch % 12 === 0) {
        ctx.fillStyle = "#44444d";
        ctx.font = "8px ui-sans-serif, system-ui, sans-serif";
        ctx.textBaseline = "middle";
        ctx.fillText(noteName(pitch), KEYS_W * 0.68, y + ROW_H / 2 + 0.5);
      }
    }
    ctx.fillStyle = "#0c0c0f";
    ctx.fillRect(KEYS_W - 1, 0, 1, CONTENT_H);
  }, []);

  // redraw on every store-driven render (drags redraw imperatively)
  useEffect(() => {
    draw();
  });

  useEffect(() => {
    drawKeys();
  }, [drawKeys]);

  // playhead line (white, moved via rAF transform)
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const el = playheadRef.current;
      if (!el) return;
      const st = stateRef.current;
      const reg = st.region;
      if (!reg) {
        el.style.display = "none";
        return;
      }
      const local = engine.currentTick() - reg.start;
      if (local >= 0 && local <= reg.length) {
        el.style.display = "block";
        el.style.transform = `translateX(${local * st.pxPerTick}px)`;
      } else {
        el.style.display = "none";
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Escape cancels an active drag (no store mutation has happened yet)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dragRef.current) {
        dragRef.current = null;
        draw();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draw]);

  // auto-scroll to the average pitch of the region's notes
  useEffect(() => {
    if (!region) {
      lastRegionIdRef.current = null;
      return;
    }
    if (lastRegionIdRef.current === region.id) return;
    lastRegionIdRef.current = region.id;
    const el = scrollRef.current;
    if (!el) return;
    const avg = notes.length ? notes.reduce((a, n) => a + n.pitch, 0) / notes.length : 66;
    const target = pitchToY(avg) + ROW_H / 2 - el.clientHeight / 2;
    el.scrollTop = clamp(target, 0, Math.max(0, CONTENT_H - el.clientHeight));
    el.scrollLeft = 0;
  }, [region, notes]);

  // ---------- pointer interactions ----------

  const pointerPos = (e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const st = stateRef.current;
    const reg = st.region;
    if (!reg || reg.type !== "midi" || e.button !== 0) return;
    e.preventDefault();
    const { x, y } = pointerPos(e);
    const tick = x / st.pxPerTick;
    const pitch = PITCH_MAX - Math.floor(y / ROW_H);
    if (pitch < PITCH_MIN || pitch > PITCH_MAX) return;
    const hit = hitNoteAt(st.notes, st.pxPerTick, x, pitch);
    const store = useDAW.getState();

    // alt-click deletes a note
    if (hit && e.altKey) {
      store.commit();
      store.removeNotes(reg.id, [hit.note.id]);
      return;
    }

    // pencil / ctrl+click on empty space starts note creation
    if (!hit && (st.tool === "pencil" || e.ctrlKey || e.metaKey)) {
      const start = clamp(snapTick(tick, st.grid), 0, Math.max(0, reg.length - MIN_NOTE_TICKS));
      dragRef.current = { kind: "create", pitch, start, length: MIN_NOTE_TICKS, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
      if (st.track && st.track.type === "midi") engine.auditionNote(st.track.instrument, pitch, 100);
      draw();
      return;
    }

    if (hit) {
      const noteW = hit.endX - hit.startX;
      const resizeZone = Math.min(6, Math.max(2, Math.floor(noteW / 2)));
      if (x >= hit.endX - resizeZone) {
        // resize from the right edge
        if (!e.shiftKey && !st.selectedNoteIds.includes(hit.note.id)) store.selectNote(hit.note.id, false);
        dragRef.current = {
          kind: "resize",
          id: hit.note.id,
          original: { ...hit.note },
          newLength: hit.note.length,
          moved: false,
        };
      } else {
        // select + group move
        let ids: string[];
        if (e.shiftKey) {
          store.selectNote(hit.note.id, true);
          const now = useDAW.getState().ui.selectedNoteIds;
          if (!now.includes(hit.note.id)) {
            draw(); // toggled out of the selection - no drag
            return;
          }
          ids = now;
        } else if (st.selectedNoteIds.includes(hit.note.id)) {
          ids = st.selectedNoteIds;
        } else {
          store.selectNote(hit.note.id, false);
          ids = [hit.note.id];
        }
        const idSet = new Set(ids);
        const originals = st.notes.filter((n) => idSet.has(n.id)).map((n) => ({ ...n }));
        dragRef.current = {
          kind: "move",
          ids,
          originals,
          grabbed: { ...hit.note },
          startTick: tick,
          startPitch: pitch,
          deltaTick: 0,
          deltaPitch: 0,
          moved: false,
        };
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      draw();
      return;
    }

    // empty space with pointer tool: rubber-band marquee
    if (!e.shiftKey) store.selectNote(null);
    dragRef.current = { kind: "marquee", x0: x, y0: y, x1: x, y1: y, additive: e.shiftKey, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    draw();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const st = stateRef.current;
    const drag = dragRef.current;
    const { x, y } = pointerPos(e);

    if (!drag) {
      // hover cursor feedback
      if (!st.region) return;
      const pitch = PITCH_MAX - Math.floor(y / ROW_H);
      const hit =
        pitch >= PITCH_MIN && pitch <= PITCH_MAX ? hitNoteAt(st.notes, st.pxPerTick, x, pitch) : null;
      let cursor = "default";
      if (hit) {
        const noteW = hit.endX - hit.startX;
        const resizeZone = Math.min(6, Math.max(2, Math.floor(noteW / 2)));
        cursor = x >= hit.endX - resizeZone ? "ew-resize" : st.tool === "pencil" ? "cell" : "grab";
      } else {
        cursor = st.tool === "pencil" ? "crosshair" : "default";
      }
      e.currentTarget.style.cursor = cursor;
      return;
    }

    const tick = x / st.pxPerTick;
    const pitch = clamp(PITCH_MAX - Math.floor(y / ROW_H), PITCH_MIN, PITCH_MAX);

    switch (drag.kind) {
      case "move": {
        const rawDelta = tick - drag.startTick;
        let dTick = snapTick(drag.grabbed.start + rawDelta, st.grid) - drag.grabbed.start;
        const minStart = drag.originals.reduce((m, n) => Math.min(m, n.start), Infinity);
        if (minStart !== Infinity) dTick = Math.max(dTick, -minStart);
        const minP = drag.originals.reduce((m, n) => Math.min(m, n.pitch), Infinity);
        const maxP = drag.originals.reduce((m, n) => Math.max(m, n.pitch), -Infinity);
        const dPitch = clamp(pitch - drag.startPitch, PITCH_MIN - minP, PITCH_MAX - maxP);
        if (dPitch !== drag.deltaPitch && st.track && st.track.type === "midi") {
          engine.auditionNote(
            st.track.instrument,
            clamp(drag.grabbed.pitch + dPitch, PITCH_MIN, PITCH_MAX),
            Math.max(20, drag.grabbed.velocity)
          );
        }
        if (dTick !== drag.deltaTick || dPitch !== drag.deltaPitch) {
          drag.deltaTick = dTick;
          drag.deltaPitch = dPitch;
          drag.moved = true;
          draw();
        }
        break;
      }
      case "resize": {
        const len = Math.max(MIN_NOTE_TICKS, snapTick(tick, st.grid) - drag.original.start);
        if (len !== drag.newLength) {
          drag.newLength = len;
          drag.moved = true;
          draw();
        }
        break;
      }
      case "create": {
        const len = Math.max(MIN_NOTE_TICKS, snapTick(tick, st.grid) - drag.start);
        if (len !== drag.length) {
          drag.length = len;
          drag.moved = true;
          draw();
        }
        break;
      }
      case "marquee": {
        const moved = Math.abs(x - drag.x0) > 2 || Math.abs(y - drag.y0) > 2;
        if (x !== drag.x1 || y !== drag.y1 || moved !== drag.moved) {
          drag.x1 = x;
          drag.y1 = y;
          drag.moved = moved;
          draw();
        }
        break;
      }
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const st = stateRef.current;
    const drag = dragRef.current;
    dragRef.current = null;
    const reg = st.region;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    if (!drag || !reg || reg.type !== "midi") {
      draw();
      return;
    }
    const store = useDAW.getState();

    switch (drag.kind) {
      case "move": {
        if (drag.moved && (drag.deltaTick !== 0 || drag.deltaPitch !== 0)) {
          store.commit();
          store.moveNotes(reg.id, drag.ids, drag.deltaTick, drag.deltaPitch);
        } else {
          draw();
        }
        break;
      }
      case "resize": {
        if (drag.moved && drag.newLength !== drag.original.length) {
          store.commit();
          store.updateNotes(reg.id, [drag.id], { length: drag.newLength });
        } else {
          draw();
        }
        break;
      }
      case "create": {
        const len = drag.moved ? drag.length : Math.max(MIN_NOTE_TICKS, st.grid);
        store.commit();
        store.addNote(reg.id, { pitch: drag.pitch, velocity: 90, start: drag.start, length: len });
        break;
      }
      case "marquee": {
        if (drag.moved) {
          const x0 = Math.min(drag.x0, drag.x1);
          const x1 = Math.max(drag.x0, drag.x1);
          const y0 = Math.min(drag.y0, drag.y1);
          const y1 = Math.max(drag.y0, drag.y1);
          const hitIds = st.notes
            .filter((n) => {
              const ny = pitchToY(n.pitch);
              const nx = n.start * st.pxPerTick;
              const nw = Math.max(3, n.length * st.pxPerTick);
              return ny < y1 && ny + ROW_H > y0 && nx < x1 && nx + nw > x0;
            })
            .map((n) => n.id);
          const base = drag.additive ? useDAW.getState().ui.selectedNoteIds : [];
          const finalIds = Array.from(new Set([...base, ...hitIds]));
          store.selectNote(null);
          for (const id of finalIds) store.selectNote(id, true);
        }
        draw();
        break;
      }
    }
  };

  const onPointerCancel = () => {
    dragRef.current = null;
    draw();
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const st = stateRef.current;
    const reg = st.region;
    if (!reg || reg.type !== "midi" || st.tool === "pencil") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pitch = PITCH_MAX - Math.floor(y / ROW_H);
    if (pitch < PITCH_MIN || pitch > PITCH_MAX) return;
    if (hitNoteAt(st.notes, st.pxPerTick, x, pitch)) return;
    const store = useDAW.getState();
    store.commit();
    store.addNote(reg.id, {
      pitch,
      velocity: 90,
      start: clamp(snapTick(x / st.pxPerTick, st.grid), 0, Math.max(0, reg.length - MIN_NOTE_TICKS)),
      length: Math.max(MIN_NOTE_TICKS, st.grid),
    });
    if (st.track && st.track.type === "midi") engine.auditionNote(st.track.instrument, pitch, 100);
  };

  const onContextMenu = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const st = stateRef.current;
    const reg = st.region;
    if (!reg || reg.type !== "midi") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pitch = PITCH_MAX - Math.floor(y / ROW_H);
    const hit =
      pitch >= PITCH_MIN && pitch <= PITCH_MAX ? hitNoteAt(st.notes, st.pxPerTick, x, pitch) : null;
    if (hit) {
      const store = useDAW.getState();
      store.commit();
      store.removeNotes(reg.id, [hit.note.id]);
    }
  };

  // ---------- keys column ----------

  const keysPitch = (e: ReactPointerEvent<HTMLCanvasElement>): number => {
    const rect = e.currentTarget.getBoundingClientRect();
    return clamp(PITCH_MAX - Math.floor((e.clientY - rect.top) / ROW_H), PITCH_MIN, PITCH_MAX);
  };

  const onKeysPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const st = stateRef.current;
    if (!st.track || st.track.type !== "midi") return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const pitch = keysPitch(e);
    keysDownRef.current = { pitch };
    engine.auditionNote(st.track.instrument, pitch, 100);
  };

  const onKeysPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const down = keysDownRef.current;
    const st = stateRef.current;
    if (!down || !st.track || st.track.type !== "midi") return;
    const pitch = keysPitch(e);
    if (pitch !== down.pitch) {
      down.pitch = pitch;
      engine.auditionNote(st.track.instrument, pitch, 100);
    }
  };

  const onKeysPointerUp = () => {
    keysDownRef.current = null;
  };

  // ---------- toolbar actions ----------

  const onQuantize = () => {
    const st = stateRef.current;
    const reg = st.region;
    if (!reg || reg.type !== "midi" || st.notes.length === 0) return;
    const ids = st.selectedNoteIds.length ? st.selectedNoteIds : st.notes.map((n) => n.id);
    const store = useDAW.getState();
    store.commit();
    store.quantizeNotes(reg.id, ids, st.grid);
  };

  const onVelocityChange = (vals: number[]) => {
    const st = stateRef.current;
    const reg = st.region;
    if (!reg || reg.type !== "midi" || st.selectedNoteIds.length === 0) return;
    if (!velArmRef.current) {
      velArmRef.current = true;
      useDAW.getState().commit(); // snapshot pre-change state once per gesture
    }
    useDAW.getState().updateNotes(reg.id, st.selectedNoteIds, { velocity: Math.round(vals[0] ?? 1) });
  };

  const onVelocityCommitEnd = () => {
    velArmRef.current = false;
  };

  const onTranspose = (d: number) => {
    const st = stateRef.current;
    const reg = st.region;
    if (!reg || reg.type !== "midi" || st.selectedNoteIds.length === 0) return;
    const idSet = new Set(st.selectedNoteIds);
    const sel = st.notes.filter((n) => idSet.has(n.id));
    if (sel.length === 0) return;
    const minP = Math.min(...sel.map((n) => n.pitch));
    const maxP = Math.max(...sel.map((n) => n.pitch));
    const dd = clamp(d, PITCH_MIN - minP, PITCH_MAX - maxP);
    if (dd === 0) return;
    const store = useDAW.getState();
    store.commit();
    store.moveNotes(reg.id, st.selectedNoteIds, 0, dd);
  };

  // ---------- render ----------

  if (!region || region.type !== "midi") {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center text-xs text-zinc-600 select-none">
        No MIDI region
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1 overflow-x-auto border-b border-black/50 bg-[#191a1e] px-2">
        <span className="mr-1 shrink-0 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">Chord Banner</span>
        {chordBars.map(({ bar, chord }) => (
          <span
            key={bar}
            title={`Bar ${bar + 1}`}
            className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] ${chord ? "border-cyan-300/15 bg-cyan-300/[.07] text-cyan-100" : "border-white/[.04] text-zinc-700"}`}
          >
            {bar + 1}: {chord?.name ?? "—"}
          </span>
        ))}
        <span className="ml-auto shrink-0 text-[8px] text-zinc-600">Updates with MIDI edits</span>
      </div>
      {/* toolbar */}
      <div className="h-8 shrink-0 flex items-center gap-2 px-2 bg-[#202024] border-b border-black/40">
        <Button
          size="sm"
          variant="secondary"
          className={TOOL_BTN}
          onClick={onQuantize}
          disabled={notes.length === 0}
          title="Quantize selected notes (all notes when nothing is selected)"
        >
          Quantize
        </Button>
        <div className="w-px h-4 bg-black/40" aria-hidden="true" />
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-zinc-500">Vel</span>
          <Slider
            className="w-28"
            min={1}
            max={127}
            step={1}
            value={[velocity]}
            disabled={!hasSelection}
            onValueChange={onVelocityChange}
            onValueCommit={onVelocityCommitEnd}
            aria-label="Note velocity"
          />
          <span className="w-6 text-[10px] tabular-nums text-zinc-400">
            {hasSelection ? velocity : "--"}
          </span>
        </div>
        <div className="w-px h-4 bg-black/40" aria-hidden="true" />
        <div className="hidden sm:flex items-center gap-1">
          <span className="text-[10px] text-zinc-500">Transpose</span>
          {([-12, -1, 1, 12] as const).map((d) => (
            <Button
              key={d}
              size="sm"
              variant="secondary"
              className={`${TOOL_BTN} w-8 px-0 tabular-nums`}
              disabled={!hasSelection}
              onClick={() => onTranspose(d)}
              title={
                d > 0
                  ? `Transpose up ${d} semitone${d > 1 ? "s" : ""}`
                  : `Transpose down ${-d} semitone${d < -1 ? "s" : ""}`
              }
            >
              {d > 0 ? `+${d}` : String(d)}
            </Button>
          ))}
        </div>
        <div className="ml-auto text-[10px] text-zinc-500 tabular-nums whitespace-nowrap">
          {notes.length} {notes.length === 1 ? "note" : "notes"}
          {hasSelection ? ` · ${selectedNoteIds.length} selected` : ""}
        </div>
      </div>

      {/* scrollable roll: sticky keys column + note canvas */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-auto bg-[#161619] [scrollbar-width:thin] [scrollbar-color:#3a3a41_transparent] [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-thumb]:rounded-sm [&::-webkit-scrollbar-thumb]:bg-[#3a3a41] [&::-webkit-scrollbar-track]:bg-transparent"
      >
        <div className="relative" style={{ width: KEYS_W + contentW, height: CONTENT_H }}>
          <canvas
            ref={canvasRef}
            className="block absolute select-none"
            style={{
              left: KEYS_W,
              top: 0,
              width: contentW,
              height: CONTENT_H,
              touchAction: "none",
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onDoubleClick={onDoubleClick}
            onContextMenu={onContextMenu}
          />
          <div
            ref={playheadRef}
            className="absolute top-0 bottom-0 pointer-events-none bg-white/90"
            style={{ left: KEYS_W, width: 1, zIndex: 5, display: "none" }}
            aria-hidden="true"
          />
          <canvas
            ref={keysRef}
            className="block select-none"
            style={{
              position: "sticky",
              left: 0,
              width: KEYS_W,
              height: CONTENT_H,
              zIndex: 10,
              touchAction: "none",
              cursor: "pointer",
            }}
            onPointerDown={onKeysPointerDown}
            onPointerMove={onKeysPointerMove}
            onPointerUp={onKeysPointerUp}
            onPointerCancel={onKeysPointerUp}
            aria-label="Piano keys - click to audition notes"
          />
        </div>
      </div>
    </div>
  );
}
