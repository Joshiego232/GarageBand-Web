"use client";

// ============================================================
// Timeline workspace: ruler + track headers + region canvas
// The GarageBand-style main edit view
// ============================================================

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MousePointer2, Pencil, ZoomIn, ZoomOut, Maximize } from "lucide-react";
import { useDAW } from "@/lib/daw/store";
import { engine } from "@/lib/daw/engine";
import {
  PPQ,
  trackRowHeight,
  uid,
  type Region,
  type Track,
  type SnapMode,
  getRegionPlaybackBufferId,
} from "@/lib/daw/types";
import {
  snapTicks,
  snapTick,
  barTicks,
  clamp,
  secToTick,
  projectLengthTicks,
} from "@/lib/daw/utils";
import { computePeaks } from "@/lib/daw/wav";
import { LOOPS, loopToRegion } from "@/lib/daw/loops";
import { TrackHeaders } from "./track-headers";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { mixHex, hexToRgba } from "@/lib/daw/colors";
import { analyzeMidiNotesByBar } from "@/lib/daw/ChordDetector";
import { importMidiFiles, isMidiFileForImport } from "@/lib/daw/midi-import";
import { GlobalChordTrack, extractChordRegions } from "./GlobalChordTrack";
import { AutomationLaneOverlay } from "./AutomationLaneOverlay";

const HEADER_W = 212;
const RULER_H = 28;
const SCROLL_PAD_X = 400;
const SCROLL_PAD_Y = 90;

// waveform peaks cache: bufferId -> { peaks, duration }
const peaksCache = new Map<string, { peaks: Float32Array; duration: number }>();
function getPeaks(bufferId?: string) {
  if (!bufferId) return null;
  const cached = peaksCache.get(bufferId);
  if (cached) return cached;
  const stored = engine.getStoredBuffer(bufferId);
  if (!stored) return null;
  const RES = 5000;
  const peaks = computePeaks(stored.channels, 0, stored.channels[0].length, RES);
  const duration = stored.channels[0].length / stored.sampleRate;
  const entry = { peaks, duration };
  peaksCache.set(bufferId, entry);
  return entry;
}

interface DragState {
  mode: "move" | "resize-l" | "resize-r" | "marquee" | "cycle";
  startX: number;
  startY: number;
  moved: boolean;
  altCopy: boolean;
  regionIds: string[];
  orig: { id: string; trackId: string; start: number; length: number }[];
  deltaTick: number;
  toRow: number;
  marquee: { x0: number; y0: number; x1: number; y1: number } | null;
}

export function TimelineWorkspace() {
  const contentRef = useRef<HTMLDivElement>(null);
  const headersScrollRef = useRef<HTMLDivElement>(null);
  const rulerCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playheadOverlayRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const dirtyRef = useRef(true);
  const viewportRef = useRef({ w: 800, h: 400 });
  const scrollRef = useRef({ x: 0, y: 0 });
  const [viewSize, setViewSize] = useState({ w: 800, h: 400 });
  const [headerScrollY, setHeaderScrollY] = useState(0);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; regionId: string } | null>(null);
  const [dropHint, setDropHint] = useState<string | null>(null);
  const [scrollX, setScrollX] = useState(0);

  const project = useDAW((s) => s.project);
  const ui = useDAW((s) => s.ui);
  const playing = useDAW((s) => s.transport.playing);
  const recording = useDAW((s) => s.transport.recording);
  const automationView = useDAW((s) => s.ui.automationView);
  const showMasterTrack = useDAW((s) => s.ui.showMasterTrack);

  const pxPerTick = ui.zoom / PPQ;
  const snapGrid = snapTicks(ui.snap, ui.zoom, project.timeSig);
  const bt = barTicks(project.timeSig);
  const visibleTracks = useMemo(() => {
    const collapsedFolderIds = new Set(
      project.tracks
        .filter((track) => track.role === "folder" && track.collapsed)
        .map((track) => track.id)
    );
    return project.tracks.filter(
      (track) =>
        track.role !== "aux" &&
        track.role !== "vca" &&
        (!track.parentTrackId || !collapsedFolderIds.has(track.parentTrackId))
    );
  }, [project.tracks]);

  // content size
  let contentEndTick = 0;
  for (const t of project.tracks) {
    for (const r of t.regions) contentEndTick = Math.max(contentEndTick, r.start + r.length);
  }
  const minTicks = bt * 16;
  const projectEndTick = projectLengthTicks(project);
  const contentTicks = Math.max(
    projectEndTick + bt * 4,
    contentEndTick + bt * 4,
    minTicks,
    engine.currentTick() + bt * 4,
  );
  const contentW = Math.max(contentTicks * pxPerTick + SCROLL_PAD_X, viewSize.w + HEADER_W);
  const masterRowHeight = showMasterTrack ? (automationView ? 94 : 38) : 0;
  const tracksHeight = visibleTracks.reduce(
    (height, track) => height + trackRowHeight(track, ui.trackSize) + (automationView ? 56 : 0),
    0
  );
  const contentH = tracksHeight + masterRowHeight + SCROLL_PAD_Y;

  const tickToX = useCallback((tick: number) => tick * pxPerTick, [pxPerTick]);
  const xToTick = useCallback((x: number) => x / pxPerTick, [pxPerTick]);

  const rowLayout = useCallback(() => {
    const rows: { track: Track; y: number; h: number }[] = [];
    let y = 0;
    for (const t of visibleTracks) {
      const h = trackRowHeight(t, ui.trackSize) + (automationView ? 56 : 0);
      rows.push({ track: t, y, h });
      y += h;
    }
    return rows;
  }, [visibleTracks, ui.trackSize, automationView]);

  // ---------- redraw machinery ----------

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ruler = rulerCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = viewportRef.current;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scroll = scrollRef.current;
    const sx = scroll.x;
    const sy = scroll.y;

    // background
    ctx.fillStyle = "#1d1d20";
    ctx.fillRect(0, 0, w, h);

    const rows = rowLayout();
    const beatTicks = (PPQ * 4) / project.timeSig[1];
    const subTicks = beatTicks / 4;

    // rows + grid
    const firstBar = Math.floor(sx / (bt * pxPerTick));
    const lastBar = Math.ceil((sx + w) / (bt * pxPerTick));
    const selectedTrackId = ui.selectedTrackId;

    for (const row of rows) {
      const y = row.y - sy;
      if (y + row.h < 0 || y > h) continue;
      // row bg
      ctx.fillStyle = row.track.id === selectedTrackId
        ? hexToRgba(row.track.color, 0.11)
        : "#222227";
      ctx.fillRect(0, y, w, row.h);
      // horizontal separator
      ctx.fillStyle = "#161619";
      ctx.fillRect(0, y + row.h - 1, w, 1);
    }
    if (showMasterTrack) {
      const y = rows.reduce((bottom, row) => Math.max(bottom, row.y + row.h), 0) - sy;
      ctx.fillStyle = "rgba(45,105,125,.18)";
      ctx.fillRect(0, y, w, masterRowHeight);
      ctx.fillStyle = "rgba(100,210,235,.25)";
      ctx.fillRect(0, y + masterRowHeight - 1, w, 1);
    }

    // grid lines
    const drawGridLine = (tick: number, color: string) => {
      const x = tickToX(tick) - sx;
      if (x < -1 || x > w + 1) return;
      ctx.fillStyle = color;
      ctx.fillRect(x, 0, 1, h);
    };
    for (let bar = firstBar; bar <= lastBar; bar++) {
      drawGridLine(bar * bt, "#3d3d44");
      if (pxPerTick * beatTicks > 14) {
        for (let b = 1; b < project.timeSig[0]; b++) {
          drawGridLine(bar * bt + b * beatTicks, "#2c2c31");
        }
        if (pxPerTick * subTicks > 9) {
          for (let b = 0; b < project.timeSig[0]; b++) {
            for (let s = 1; s < 4; s++) {
              drawGridLine(bar * bt + b * beatTicks + s * subTicks, "#242427");
            }
          }
        }
      }
    }

    // cycle tint in content
    if (project.cycleOn) {
      const cx0 = tickToX(project.cycleStart) - sx;
      const cx1 = tickToX(project.cycleEnd) - sx;
      ctx.fillStyle = "rgba(255,182,72,0.05)";
      ctx.fillRect(cx0, 0, cx1 - cx0, h);
    }

    // Arrangement end marker. Regions can remain beyond it, but playback/export stop here.
    const projectEndX = tickToX(projectLengthTicks(project)) - sx;
    if (projectEndX >= -1 && projectEndX <= w + 1) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,182,72,0.65)";
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(projectEndX + 0.5, 0);
      ctx.lineTo(projectEndX + 0.5, h);
      ctx.stroke();
      ctx.restore();
    }

    // regions
    const selected = new Set(ui.selectedRegionIds);
    const drag = dragRef.current;
    const dragOffsets =
      drag && drag.mode === "move" && drag.moved
        ? new Map(drag.orig.map((o) => [o.id, { start: o.start + drag.deltaTick, trackIndex: drag.toRow }]))
        : null;

    rows.forEach((row, rowIndex) => {
      const y = row.y - sy;
      if (y + row.h < 0 || y > h) return;
      for (const region of row.track.regions) {
        // dragged regions are drawn from ghost positions
        if (dragOffsets?.has(region.id)) continue;
        drawRegion(ctx, region, row, y, sx, w, selected.has(region.id), project.tempo);
      }
      if (row.track.role === "folder" && row.track.collapsed) {
        const stack = project.stacks?.find((item) => item.folderTrackId === row.track.id);
        const children = project.tracks.filter((track) => stack?.trackIds.includes(track.id));
        if (children.length) {
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(2, y + 3, Math.max(0, w - 4), Math.max(0, row.h - 7), 3);
          ctx.clip();
          ctx.fillStyle = "rgba(0,0,0,.24)";
          ctx.fillRect(2, y + 3, w - 4, row.h - 7);
          const bandHeight = Math.max(2, (row.h - 8) / Math.min(children.length, 6));
          children.slice(0, 6).forEach((child, childIndex) => {
            for (const region of child.regions) {
              const x = region.start * pxPerTick - sx;
              const width = Math.max(2, region.length * pxPerTick);
              if (x + width < 0 || x > w) continue;
              ctx.fillStyle = hexToRgba(child.color, 0.9);
              ctx.fillRect(x, y + 4 + childIndex * bandHeight, width, Math.max(1, bandHeight - 1));
            }
          });
          ctx.restore();
        }
      }
    });

    // draw moved ghosts
    if (dragOffsets) {
      const origById = new Map(drag!.orig.map((o) => [o.id, o]));
      const origTrackById = new Map(project.tracks.flatMap((t) => t.regions.map((r) => [r.id, t] as const)));
      const rowIndexById = new Map(visibleTracks.map((t, i) => [t.id, i] as const));
      for (const [regionId, ghost] of dragOffsets) {
        const o = origById.get(regionId);
        if (!o) continue;
        const origTrack = origTrackById.get(regionId);
        if (!origTrack) continue;
        const targetIndex = ghost.trackIndex;
        const targetTrack = visibleTracks[targetIndex] ?? origTrack;
        const canMove = targetTrack.type === origTrack.type || targetTrack.type === "midi";
        const row2 = rows[canMove ? targetIndex : rowIndexById.get(origTrack.id) ?? 0];
        if (!row2) continue;
        const fake: Region = { ...origTrack.regions.find((r) => r.id === regionId)!, start: ghost.start };
        drawRegion(ctx, fake, row2, row2.y - sy, sx, w, true, project.tempo, 0.75);
      }
    }

    // marquee
    if (drag?.mode === "marquee" && drag.marquee) {
      const m = drag.marquee;
      const x = Math.min(m.x0, m.x1) - sx;
      const y = Math.min(m.y0, m.y1) - sy;
      ctx.fillStyle = "rgba(255,182,72,0.08)";
      ctx.fillRect(x, y, Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
      ctx.strokeStyle = "rgba(255,182,72,0.7)";
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
      ctx.setLineDash([]);
    }

    // playhead
    const pt = engine.currentTick();
    const px = tickToX(pt) - sx;
    if (recording) {
      ctx.fillStyle = "rgba(229,72,77,0.06)";
      ctx.fillRect(0, 0, px, h);
    }

    // ---------- ruler ----------
    if (ruler) {
      const rctx = ruler.getContext("2d");
      if (rctx) {
        if (ruler.width !== Math.round(viewportRef.current.w * dpr) || ruler.height !== Math.round(RULER_H * dpr)) {
          ruler.width = Math.round(viewportRef.current.w * dpr);
          ruler.height = Math.round(RULER_H * dpr);
        }
        rctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        rctx.fillStyle = "#26262b";
        rctx.fillRect(0, 0, viewportRef.current.w, RULER_H);
        rctx.fillStyle = "#161619";
        rctx.fillRect(0, RULER_H - 1, viewportRef.current.w, 1);

        // cycle band
        if (project.cycleOn) {
          const cx0 = tickToX(project.cycleStart) - sx;
          const cx1 = tickToX(project.cycleEnd) - sx;
          rctx.fillStyle = "rgba(255,182,72,0.28)";
          rctx.fillRect(cx0, 3, Math.max(2, cx1 - cx0), RULER_H - 8);
          rctx.fillStyle = "#ffb648";
          rctx.fillRect(cx0, 3, 2, RULER_H - 8);
          rctx.fillRect(cx1 - 2, 3, 2, RULER_H - 8);
        }

        // bar numbers + ticks
        rctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
        rctx.textBaseline = "top";
        for (let bar = firstBar; bar <= lastBar; bar++) {
          const x = tickToX(bar * bt) - sx;
          if (x < -30 || x > viewportRef.current.w + 30) continue;
          rctx.fillStyle = "#71717a";
          rctx.fillRect(x, RULER_H - 9, 1, 9);
          if (pxPerTick * bt > 34) {
            rctx.fillStyle = "#a1a1aa";
            rctx.fillText(String(bar + 1), x + 4, 3);
          }
          if (pxPerTick * beatTicks > 10) {
            for (let b = 1; b < project.timeSig[0]; b++) {
              const bx = tickToX(bar * bt + b * beatTicks) - sx;
              rctx.fillStyle = "#4a4a52";
              rctx.fillRect(bx, RULER_H - 6, 1, 6);
            }
          }
        }

        // playhead marker in ruler
        if (px >= -2 && px <= viewportRef.current.w + 2) {
          rctx.fillStyle = recording ? "#e5484d" : "#f2f2f5";
          rctx.fillRect(px, RULER_H - 12, 1.5, 12);
          rctx.beginPath();
          rctx.moveTo(px - 6, RULER_H - 12);
          rctx.lineTo(px + 6, RULER_H - 12);
          rctx.lineTo(px, RULER_H - 3);
          rctx.closePath();
          rctx.fill();
        }
      }
    }
  }, [project, ui, pxPerTick, bt, tickToX, recording, rowLayout, snapGrid, showMasterTrack, masterRowHeight]);

  // rAF loop
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const playhead = playheadOverlayRef.current;
      if (playhead) {
        const x = engine.currentTick() * pxPerTick - (contentRef.current?.scrollLeft ?? 0);
        playhead.style.transform = `translateX(${x}px)`;
        playhead.style.backgroundColor = engine.recording ? "#e5484d" : "#f2f2f5";
        playhead.style.opacity = x >= -2 && x <= viewportRef.current.w + 2 ? "1" : "0";
      }
      if (engine.playing || dragRef.current) dirtyRef.current = true;
      if (dirtyRef.current) {
        dirtyRef.current = false;
        draw();
      }
      // follow playhead
      if (engine.playing && useDAW.getState().ui.followPlayhead) {
        const el = contentRef.current;
        if (el) {
          const px = engine.currentTick() * pxPerTick;
          const view = el.clientWidth;
          if (px < el.scrollLeft + 40 || px > el.scrollLeft + view - 80) {
            el.scrollLeft = Math.max(0, px - view * 0.25);
          }
          if (el.scrollHeight > el.clientHeight) {
            // keep visible rows in range during recording on hidden track - skip
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [draw, pxPerTick]);

  // redraw on state changes
  useEffect(() => {
    markDirty();
  }, [project, ui, markDirty]);

  // ---------- sizing ----------

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth - 0;
      const h = el.clientHeight;
      viewportRef.current = { w: Math.max(50, w), h: Math.max(50, h) };
      setViewSize({ w: Math.max(50, w), h: Math.max(50, h) });
      markDirty();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [markDirty]);

  // ---------- scroll sync ----------

  const onScroll = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    scrollRef.current = { x: el.scrollLeft, y: el.scrollTop };
    setScrollX(el.scrollLeft);
    if (headersScrollRef.current) {
      headersScrollRef.current.scrollTop = el.scrollTop;
    }
    setHeaderScrollY(el.scrollTop);
    markDirty();
  }, [markDirty]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    onScroll();
  }, [onScroll, contentH, contentW]);

  // ---------- pointer: content canvas ----------

  const hitTest = useCallback(
    (contentX: number, contentY: number) => {
      const rows = rowLayout();
      let rowIndex = -1;
      for (let i = 0; i < rows.length; i++) {
        if (contentY >= rows[i].y && contentY < rows[i].y + rows[i].h) {
          rowIndex = i;
          break;
        }
      }
      if (rowIndex < 0) return null;
      const row = rows[rowIndex];
      // iterate regions in reverse (topmost last drawn = last in array)
      for (let r = row.track.regions.length - 1; r >= 0; r--) {
        const region = row.track.regions[r];
        const x0 = tickToX(region.start);
        const x1 = tickToX(region.start + region.length);
        if (contentX >= x0 && contentX <= x1) {
          const nearLeft = contentX - x0 < 7;
          const nearRight = x1 - contentX < 7;
          return { region, row, rowIndex, nearLeft, nearRight };
        }
      }
      return { region: null, row, rowIndex, nearLeft: false, nearRight: false };
    },
    [rowLayout, tickToX]
  );

  const contentPointerPos = (e: React.PointerEvent | React.MouseEvent) => {
    const el = contentRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left + scrollRef.current.x,
      y: e.clientY - rect.top + scrollRef.current.y,
    };
  };

  const onCanvasPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    setContextMenu(null);
    const pos = contentPointerPos(e);
    const hit = hitTest(pos.x, pos.y);
    const st = useDAW.getState();

    // selecting a track by clicking its row
    if (hit) st.selectTrack(hit.row.track.id);

    if (hit?.region) {
      const region = hit.region;
      const alreadySelected = st.ui.selectedRegionIds.includes(region.id);
      let ids = st.ui.selectedRegionIds;
      if (e.shiftKey) {
        st.selectRegion(region.id, true);
        ids = useDAW.getState().ui.selectedRegionIds;
      } else if (!alreadySelected) {
        st.selectRegion(region.id);
        ids = [region.id];
      }
      const orig = project.tracks
        .flatMap((t) => t.regions)
        .filter((r) => ids.includes(r.id))
        .map((r) => ({ id: r.id, trackId: r.trackId, start: r.start, length: r.length }));
      const rowIndexById = new Map(visibleTracks.map((t, i) => [t.id, i] as const));
      dragRef.current = {
        mode: hit.nearRight ? "resize-r" : hit.nearLeft ? "resize-l" : "move",
        startX: pos.x,
        startY: pos.y,
        moved: false,
        altCopy: e.altKey,
        regionIds: ids,
        orig,
        deltaTick: 0,
        toRow: rowIndexById.get(region.trackId) ?? 0,
        marquee: null,
      };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } else {
      // marquee
      st.selectRegion(null);
      dragRef.current = {
        mode: "marquee",
        startX: pos.x,
        startY: pos.y,
        moved: false,
        altCopy: false,
        regionIds: [],
        orig: [],
        deltaTick: 0,
        toRow: 0,
        marquee: { x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y },
      };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    }
    markDirty();
  };

  const onCanvasPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const pos = contentPointerPos(e);
    if (Math.abs(pos.x - drag.startX) > 3 || Math.abs(pos.y - drag.startY) > 3) drag.moved = true;
    if (!drag.moved) return;

    if (drag.mode === "move") {
      const dTick = pos.x - drag.startX;
      const snapped = snapTick(dTick, snapGrid) - (snapTick(drag.orig[0].start, snapGrid) - drag.orig[0].start);
      drag.deltaTick = snapped;
      // vertical target row
      const rows = rowLayout();
      let row = 0;
      for (let i = 0; i < rows.length; i++) {
        if (pos.y >= rows[i].y && pos.y < rows[i].y + rows[i].h) row = i;
      }
      drag.toRow = clamp(row, 0, rows.length - 1);
    } else if (drag.mode === "resize-r") {
      drag.deltaTick = Math.max(PPQ / 8, snapTick(pos.x - drag.startX, snapGrid));
    } else if (drag.mode === "resize-l") {
      drag.deltaTick = snapTick(pos.x - drag.startX, snapGrid);
    } else if (drag.mode === "marquee" && drag.marquee) {
      drag.marquee.x1 = pos.x;
      drag.marquee.y1 = pos.y;
    }
    markDirty();
  };

  const onCanvasPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !drag.moved) {
      markDirty();
      return;
    }
    const st = useDAW.getState();

    if (drag.mode === "move") {
      if (drag.altCopy) {
        // copy regions to new position
        const copies: Region[] = [];
        for (const o of drag.orig) {
          const src = project.tracks.flatMap((t) => t.regions).find((r) => r.id === o.id);
          if (!src) continue;
          const copy: Region = JSON.parse(JSON.stringify(src));
          copy.id = uid();
          copy.start = Math.max(0, o.start + drag.deltaTick);
          if (copy.notes) copy.notes = copy.notes.map((n) => ({ ...n, id: uid() }));
          const targetTrack = visibleTracks[drag.toRow];
          if (targetTrack && targetTrack.role !== "folder" && targetTrack.role !== "vca" && targetTrack.role !== "aux" && (targetTrack.type === "midi") === (src.type === "midi")) {
            copy.trackId = targetTrack.id;
          }
          copies.push(copy);
        }
        if (copies.length) st.addRegions(copies);
      } else {
        const targetTrack = visibleTracks[drag.toRow];
        const anyAudio = drag.orig.some((o) => {
          const src = project.tracks.flatMap((t) => t.regions).find((r) => r.id === o.id);
          return src?.type === "audio";
        });
        const toTrackId =
          targetTrack && targetTrack.role !== "folder" && targetTrack.role !== "vca" && targetTrack.role !== "aux" && (targetTrack.type === "audio") === anyAudio ? targetTrack.id : undefined;
        st.moveRegions(drag.regionIds, drag.deltaTick, toTrackId);
      }
    } else if (drag.mode === "resize-r") {
      st.commit();
      for (const o of drag.orig) {
        st.updateRegion(o.id, { length: Math.max(PPQ / 8, o.length + drag.deltaTick) }, false);
      }
    } else if (drag.mode === "resize-l") {
      st.commit();
      const secPerTick = 60 / project.tempo / PPQ;
      for (const o of drag.orig) {
        const src = project.tracks.flatMap((t) => t.regions).find((r) => r.id === o.id);
        if (!src) continue;
        const newStart = clamp(o.start + drag.deltaTick, 0, o.start + o.length - PPQ / 8);
        const dStart = newStart - o.start;
        const newLength = o.length - dStart;
        if (src.type === "midi" && src.notes) {
          const shift = -dStart;
          st.updateRegion(o.id, {
            start: newStart,
            length: newLength,
            notes: src.notes.map((n) => ({
              ...n,
              start: n.start + (o.start - newStart) + shift - (o.start - newStart),
            })),
          }, false);
        } else if (src.type === "audio") {
          const dSec = dStart * secPerTick;
          const newSampleStart = clamp((src.sampleStart ?? 0) + dSec, 0, Infinity);
          st.updateRegion(o.id, {
            start: newStart,
            length: newLength,
            sampleStart: newSampleStart,
            sampleLength: Math.max(0.01, (src.sampleLength ?? 0) - dSec),
          }, false);
        } else {
          st.updateRegion(o.id, { start: newStart, length: newLength }, false);
        }
      }
    } else if (drag.mode === "marquee" && drag.marquee) {
      const m = drag.marquee;
      const x0 = Math.min(m.x0, m.x1);
      const x1 = Math.max(m.x0, m.x1);
      const y0 = Math.min(m.y0, m.y1);
      const y1 = Math.max(m.y0, m.y1);
      if (x1 - x0 > 4 && y1 - y0 > 4) {
        const ids: string[] = [];
        for (const row of rowLayout()) {
          if (row.y + row.h < y0 || row.y > y1) continue;
          for (const r of row.track.regions) {
            const rx0 = tickToX(r.start);
            const rx1 = tickToX(r.start + r.length);
            if (rx1 > x0 && rx0 < x1) ids.push(r.id);
          }
        }
        st.selectRegions(ids);
      }
    }
    markDirty();
  };

  const onCanvasDoubleClick = (e: React.MouseEvent) => {
    const pos = contentPointerPos(e);
    const hit = hitTest(pos.x, pos.y);
    if (hit?.region) {
      useDAW.getState().openRegionInEditor(hit.region.id);
      return;
    }
    if (hit && hit.row.track.type === "midi") {
      // create empty 4-bar MIDI region
      const st = useDAW.getState();
      const start = Math.max(0, snapTick(xToTick(pos.x), snapGrid));
      st.addRegion({
        id: uid(),
        trackId: hit.row.track.id,
        type: "midi",
        name: "MIDI Region",
        start,
        length: bt * 4,
        notes: [],
      });
    }
  };

  const onCanvasContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const pos = contentPointerPos(e);
    const hit = hitTest(pos.x, pos.y);
    if (hit?.region) {
      const st = useDAW.getState();
      if (!st.ui.selectedRegionIds.includes(hit.region.id)) st.selectRegion(hit.region.id);
      setContextMenu({ x: e.clientX, y: e.clientY, regionId: hit.region.id });
    }
  };

  // ---------- ruler pointer ----------

  const rulerPointer = (e: React.PointerEvent) => {
    const canvas = rulerCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    let mode: "click" | "cycle" = "click";
    (e.currentTarget as Element).setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent) => {
      const x = ev.clientX - rect.left;
      if (mode === "click" && Math.abs(x - startX) > 5) mode = "cycle";
      if (mode === "cycle") {
        const t0 = snapTick(xToTick(Math.min(startX, x) + scrollRef.current.x), snapGrid);
        const t1 = snapTick(xToTick(Math.max(startX, x) + scrollRef.current.x), snapGrid);
        useDAW.getState().setCycle(true, Math.min(t0, t1), Math.max(Math.max(t0, t1), Math.min(t0, t1) + snapGrid));
        markDirty();
      }
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const x = ev.clientX - rect.left;
      if (mode === "click") {
        engine.setPlayhead(Math.max(0, xToTick(x + scrollRef.current.x)));
        markDirty();
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ---------- wheel ----------

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.002);
      useDAW.getState().setZoom(ui.zoom * factor);
      markDirty();
    }
  };

  // ---------- drag & drop ----------

  const onDragOver = (e: React.DragEvent) => {
    const hasLoop = e.dataTransfer.types.includes("application/x-webband-loop");
    const hasFiles = Array.from(e.dataTransfer.types).includes("Files");
    if (hasLoop || hasFiles) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDropHint(hasFiles ? "Drop to import audio or MIDI" : "Drop to add loop");
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    setDropHint(null);
    const loopId = e.dataTransfer.getData("application/x-webband-loop");
    const files = Array.from(e.dataTransfer.files ?? []);
    const pos = contentPointerPos(e as unknown as React.MouseEvent);
    const dropTick = snapTick(xToTick(pos.x), snapGrid);
    const st = useDAW.getState();

    if (loopId) {
      e.preventDefault();
      const def = LOOPS.find((l) => l.id === loopId);
      if (!def) return;
      const hit = hitTest(pos.x, pos.y);
      if (hit && hit.row.track.type === "midi") {
        st.addRegion(loopToRegion(def, hit.row.track.id, dropTick, project));
      } else {
        // create a new track for the loop
        st.addTrack({ type: "midi", instrument: def.instrument, name: def.name });
        const newTrack = useDAW.getState().project.tracks.slice(-1)[0];
        useDAW.getState().addRegion(loopToRegion(def, newTrack.id, dropTick, useDAW.getState().project));
      }
      toast.success(`Added "${def.name}"`);
      return;
    }

    if (files.length) {
      e.preventDefault();
      for (const file of files) {
        if (isMidiFileForImport(file)) {
          await importMidiFiles([file], dropTick);
          continue;
        }
        try {
          const stored = await engine.decodeAudioFile(file);
          const bufferId = uid();
          await engine.storeBuffer(bufferId, stored);
          const lengthTicks = Math.ceil(secToTick(stored.channels[0].length / stored.sampleRate, project.tempo));
          const hit = hitTest(pos.x, pos.y);
          let trackId: string;
          if (hit && hit.row.track.type === "audio") {
            trackId = hit.row.track.id;
          } else {
            useDAW.getState().addTrack({
              type: "audio",
              name: stored.name.replace(/\.[^.]+$/, "").slice(0, 22) || "Audio",
              icon: "mic",
            });
            trackId = useDAW.getState().project.tracks.slice(-1)[0].id;
          }
          useDAW.getState().addRegion({
            id: uid(),
            trackId,
            type: "audio",
            name: stored.name.replace(/\.[^.]+$/, "").slice(0, 22) || "Audio",
            start: Math.max(0, dropTick),
            length: Math.max(bt, lengthTicks),
            bufferId,
            sampleStart: 0,
            sampleLength: stored.channels[0].length / stored.sampleRate,
            gain: 1,
            fadeIn: 0.005,
            fadeOut: 0.01,
          });
          toast.success(`Imported "${stored.name}"`);
        } catch {
          toast.error(`Could not import ${file.name}`);
        }
      }
    }
  };

  // ---------- context menu actions ----------
  const runContextAction = (action: string) => {
    if (!contextMenu) return;
    const regionId = contextMenu.regionId;
    setContextMenu(null);
    const st = useDAW.getState();
    const region = project.tracks.flatMap((t) => t.regions).find((r) => r.id === regionId);
    if (!region) return;
    switch (action) {
      case "edit":
        st.openRegionInEditor(regionId);
        break;
      case "denoise":
        if (region.type !== "audio") break;
        st.openRegionInEditor(regionId);
        st.commit();
        st.updateRegion(regionId, {
          originalAudioBufferId: region.originalAudioBufferId ?? region.bufferId,
          denoiseEnabled: true,
          denoiseAmount: 50,
          denoiseHighPass: true,
          denoisedAudioBufferId: undefined,
          denoiseCacheKey: undefined,
        }, false);
        break;
      case "split":
        st.splitRegionsAt(engine.currentTick());
        break;
      case "loop":
        st.toggleRegionLoop([regionId]);
        break;
      case "duplicate":
        st.duplicateRegions([regionId]);
        break;
      case "delete":
        st.removeRegions([regionId]);
        break;
      case "rename": {
        const name = window.prompt("Region name", region.name);
        if (name) st.updateRegion(regionId, { name });
        break;
      }
      case "solo":
        engine.stop();
        engine.setPlayhead(region.start);
        st.setCycle(true, region.start, region.start + region.length);
        engine.play(region.start);
        break;
      case "analyze-chords": {
        if (region.type !== "midi" || !region.notes?.length) {
          toast.error("This MIDI region has no notes to analyze.");
          break;
        }
        const extracted = analyzeMidiNotesByBar(
          region.notes,
          region.start,
          region.length,
          bt,
          { tonic: project.keyTonic, mode: project.keyMode },
        );
        if (!extracted.length) {
          toast.error("No chords could be identified in this region.");
          break;
        }
        st.setChordRegions(
          extractChordRegions(st.project.chordRegions ?? [], extracted, region.id),
        );
        toast.success(`Extracted ${extracted.length} chord${extracted.length === 1 ? "" : "s"} to the Chord Track.`);
        break;
      }
    }
    markDirty();
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 relative" data-testid="timeline">
      {/* top row: corner toolbar + ruler */}
      <div className="flex shrink-0 border-b border-black/60">
        <div className="w-[212px] shrink-0 h-[28px] bg-[#232327] border-r border-black/60 flex items-center px-2 gap-1.5">
          <button
            title="Pointer tool"
            onClick={() => useDAW.getState().setTool("pointer")}
            className={cn(
              "size-[19px] rounded flex items-center justify-center border",
              ui.tool === "pointer"
                ? "bg-[#ffb648]/20 border-[#ffb648]/50 text-[#ffb648]"
                : "border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
            )}
          >
            <MousePointer2 className="size-3" />
          </button>
          <button
            title="Pencil tool - draw notes in the editor"
            onClick={() => useDAW.getState().setTool("pencil")}
            className={cn(
              "size-[19px] rounded flex items-center justify-center border",
              ui.tool === "pencil"
                ? "bg-[#ffb648]/20 border-[#ffb648]/50 text-[#ffb648]"
                : "border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
            )}
          >
            <Pencil className="size-3" />
          </button>
          <div className="w-px h-3.5 bg-black/50 mx-0.5" />
          <select
            title="Snap"
            value={ui.snap}
            onChange={(e) => useDAW.getState().setSnap(e.target.value as SnapMode)}
            className="bg-[#2a2a2f] border border-black/50 rounded text-[10px] text-zinc-300 px-1 py-0.5 outline-none cursor-pointer"
          >
            <option value="smart">Snap: Smart</option>
            <option value="bar">Snap: Bar</option>
            <option value="beat">Snap: Beat</option>
            <option value="8th">Snap: 1/8</option>
            <option value="16th">Snap: 1/16</option>
            <option value="off">Snap: Off</option>
          </select>
          <div className="ml-auto flex items-center gap-0.5">
            <button
              title="Zoom out timeline (Ctrl/Cmd+-)"
              aria-label="Zoom out timeline"
              onClick={() => useDAW.getState().setZoom(ui.zoom / 1.35)}
              className="size-[19px] rounded flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
            >
              <ZoomOut className="size-3.5" />
            </button>
            <span className="w-8 text-center text-[9px] font-mono tabular-nums text-zinc-600">
              {Math.round((ui.zoom / 56) * 100)}%
            </span>
            <button
              title="Zoom in timeline (Ctrl/Cmd+=)"
              aria-label="Zoom in timeline"
              onClick={() => useDAW.getState().setZoom(ui.zoom * 1.35)}
              className="size-[19px] rounded flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
            >
              <ZoomIn className="size-3.5" />
            </button>
            <button
              title="Zoom to fit (Ctrl/Cmd+0)"
              onClick={() => {
                const len = Math.max(projectLengthTicks(project), contentEndTick, bt * 8);
                useDAW.getState().setZoom((viewSize.w - 40) / (len / PPQ));
              }}
              className="size-[19px] rounded flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
            >
              <Maximize className="size-3" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden h-[28px] relative bg-[#26262b]">
          <canvas
            ref={rulerCanvasRef}
            className="absolute inset-0 cursor-pointer"
            style={{ width: "100%", height: RULER_H }}
            onPointerDown={rulerPointer}
          />
          <div className="absolute right-2 top-1 z-10 flex h-6 items-center gap-1 rounded border border-black/60 bg-[#1d1d21]/95 px-1.5 shadow">
            <span className="text-[8px] font-semibold uppercase tracking-wider text-zinc-500">
              Bars
            </span>
            <button
              type="button"
              aria-label="Shorten project by one bar"
              title="Shorten project by one bar"
              disabled={Math.round(projectLengthTicks(project) / bt) <= 1}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => useDAW.getState().setProjectLengthBars(projectLengthTicks(project) / bt - 1)}
              className="flex size-4 items-center justify-center rounded text-zinc-400 hover:bg-white/10 hover:text-zinc-100 disabled:opacity-30"
            >
              −
            </button>
            <input
              type="number"
              aria-label="Project length in bars"
              title="Project length in bars"
              min={1}
              max={999}
              step={1}
              value={Math.round(projectLengthTicks(project) / bt)}
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (event.target.value && Number.isFinite(value)) {
                  useDAW.getState().setProjectLengthBars(value);
                }
              }}
              className="w-10 bg-transparent text-center font-mono text-[10px] text-zinc-200 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <button
              type="button"
              aria-label="Extend project by one bar"
              title="Extend project by one bar"
              disabled={Math.round(projectLengthTicks(project) / bt) >= 999}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => useDAW.getState().setProjectLengthBars(projectLengthTicks(project) / bt + 1)}
              className="flex size-4 items-center justify-center rounded text-zinc-400 hover:bg-white/10 hover:text-zinc-100 disabled:opacity-30"
            >
              +
            </button>
          </div>
        </div>
      </div>

      <GlobalChordTrack
        scrollX={scrollX}
        pxPerTick={pxPerTick}
        contentW={contentW}
        ticksPerBar={bt}
      />

      {/* main row: headers + content */}
      <div className="flex-1 grid min-h-0" style={{ gridTemplateColumns: "212px minmax(0, 1fr)" }}>
        <div className="border-r border-black/60 bg-[#242429] flex flex-col min-w-0">
          <div ref={headersScrollRef} className="flex-1 overflow-hidden">
            <TrackHeaders scrollTop={headerScrollY} width={HEADER_W} size={ui.trackSize} />
          </div>
        </div>
        <div
          ref={contentRef}
          className="flex-1 overflow-auto relative"
          onScroll={onScroll}
          onWheel={onWheel}
          onDragOver={onDragOver}
          onDragLeave={() => setDropHint(null)}
          onDrop={onDrop}
        >
          <div
            className="sticky top-0 left-0 z-10"
            style={{ width: viewSize.w, height: viewSize.h }}
          >
            <canvas
              ref={canvasRef}
              className="absolute inset-0"
              style={{ width: viewSize.w, height: viewSize.h, cursor: dropHint ? "copy" : undefined }}
              onPointerDown={onCanvasPointerDown}
              onPointerMove={onCanvasPointerMove}
              onPointerUp={onCanvasPointerUp}
              onPointerCancel={onCanvasPointerUp}
              onDoubleClick={onCanvasDoubleClick}
              onContextMenu={onCanvasContextMenu}
            />
            <AutomationLaneOverlay
              tracks={visibleTracks}
              rows={rowLayout().map((row) => {
                const stack = project.stacks?.find((item) => item.folderTrackId === row.track.id);
                return {
                  trackId: row.track.id,
                  ownerId: stack?.type === "summing" && stack.busTrackId ? stack.busTrackId : row.track.id,
                  y: row.y,
                  height: row.h,
                };
              })}
              width={viewSize.w}
              height={viewSize.h}
              scrollX={scrollX}
              scrollY={headerScrollY}
              pxPerTick={pxPerTick}
              snapGrid={snapGrid}
              timeSig={project.timeSig}
              masterTop={showMasterTrack ? tracksHeight : undefined}
              masterHeight={masterRowHeight}
            />
            <div
              ref={playheadOverlayRef}
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 z-20 w-[1.5px] will-change-transform"
            >
              <span
                className="absolute -left-[4.25px] top-0 size-0 border-x-[5px] border-t-[7px] border-x-transparent"
                style={{ borderTopColor: recording ? "#e5484d" : "#f2f2f5" }}
              />
            </div>
          </div>
          {/* drop hint */}
          {dropHint && (
            <div className="sticky top-2 left-0 z-20 pointer-events-none flex justify-center">
              <div className="bg-[#ffb648]/90 text-[#19191b] text-[11px] font-medium px-3 py-1 rounded-full shadow-lg">
                {dropHint}
              </div>
            </div>
          )}
          <div style={{ width: contentW, height: contentH }} className="relative" />
          {/* context menu */}
          {contextMenu && (
            <>
              <div className="fixed inset-0 z-40" onPointerDown={() => setContextMenu(null)} onContextMenu={(e) => e.preventDefault()} />
              <div
                className="fixed z-50 min-w-[170px] bg-[#26262b] border border-black/70 rounded-md shadow-2xl py-1 text-[11px]"
                style={{ left: contextMenu.x, top: contextMenu.y }}
              >
                {[
                  ["edit", "Open in Editor"],
                  ["denoise", "Denoise Audio..."],
                  ["analyze-chords", "Analyze & Extract Chords to Chord Track"],
                  ["split", "Split at Playhead"],
                  ["loop", "Loop On/Off"],
                  ["duplicate", "Duplicate"],
                  ["solo", "Play Region Solo"],
                  ["rename", "Rename"],
                  ["delete", "Delete"],
                ].map(([action, label]) => (
                  action === "analyze-chords" &&
                  !project.tracks.flatMap((track) => track.regions).some((item) => item.id === contextMenu.regionId && item.type === "midi")
                    ? null :
                  action === "denoise" &&
                  !project.tracks.flatMap((track) => track.regions).some((item) => item.id === contextMenu.regionId && item.type === "audio")
                    ? null :
                  <button
                    key={action}
                    onClick={() => runContextAction(action)}
                    className={cn(
                      "w-full text-left px-3 py-1.5 hover:bg-[#3a3a41] text-zinc-300",
                      action === "delete" && "text-[#e5484d] hover:bg-[#e5484d]/10"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Region painting
// ============================================================

function drawRegion(
  ctx: CanvasRenderingContext2D,
  region: Region,
  row: { track: Track; y: number; h: number },
  rowY: number,
  scrollX: number,
  viewW: number,
  selected: boolean,
  tempo: number,
  alpha = 1
) {
  const pxPerTick = useDAW.getState().ui.zoom / PPQ;
  const x = region.start * pxPerTick - scrollX;
  const w = region.length * pxPerTick;
  if (x + w < 0 || x > viewW) return;
  const y = rowY + 1;
  const h = row.h - 3;
  const headerH = 12;
  const isMidi = region.type === "midi";
  const trackColor = row.track.color;
  const clipX0 = Math.max(x, -2);
  const clipW = Math.min(w, viewW + 2 - clipX0);

  ctx.save();
  ctx.globalAlpha = alpha * (region.muted ? 0.35 : 1);

  // body gradient
  const grad = ctx.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, mixHex(trackColor, "#ffffff", 0.22));
  grad.addColorStop(1, mixHex(trackColor, "#000000", 0.22));
  // clip rounded region
  ctx.beginPath();
  const r = 3;
  ctx.roundRect(clipX0, y, clipW, h, r);
  ctx.fillStyle = grad;
  ctx.fill();

  // header strip
  ctx.save();
  ctx.clip();
  ctx.fillStyle = mixHex(trackColor, "#000000", 0.34);
  ctx.fillRect(clipX0, y, clipW, headerH);
  // name
  ctx.fillStyle = "#eaf3e4";
  ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textBaseline = "top";
  if (clipW > 34) {
    ctx.fillText(region.name.slice(0, Math.floor(clipW / 6)), clipX0 + 4, y + 2);
  }

  // content
  if (isMidi) {
    drawMidiContent(ctx, region, x, clipX0, y + headerH, clipW, h - headerH, pxPerTick, trackColor);
  } else {
    drawAudioContent(ctx, region, clipX0, y + headerH, clipW, h - headerH, pxPerTick, tempo);
  }

  // loop repetition lines
  if (region.looped && region.coreLength) {
    const period = region.coreLength * pxPerTick;
    if (period > 12) {
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 1;
      for (let lx = x + period; lx < x + w; lx += period) {
        if (lx < clipX0 || lx > clipX0 + clipW) continue;
        ctx.beginPath();
        ctx.moveTo(lx + 0.5, y);
        ctx.lineTo(lx + 0.5, y + h);
        ctx.stroke();
      }
    }
  }
  ctx.restore();

  // border
  ctx.strokeStyle = selected ? "#ffffff" : "rgba(0,0,0,0.55)";
  ctx.lineWidth = selected ? 1.5 : 1;
  ctx.beginPath();
  ctx.roundRect(clipX0 + 0.5, y + 0.5, clipW - 1, h - 1, r);
  ctx.stroke();

  // resize affordances
  if (selected && clipW > 20) {
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillRect(clipX0 + 2, y + h - 5, 3, 3);
    ctx.fillRect(clipX0 + clipW - 5, y + h - 5, 3, 3);
  }
  ctx.restore();
}

function drawMidiContent(
  ctx: CanvasRenderingContext2D,
  region: Region,
  regionX: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  pxPerTick: number,
  trackColor: string
) {
  const notes = region.notes ?? [];
  if (!notes.length || h < 4) return;
  let lo = 127;
  let hi = 0;
  for (const n of notes) {
    lo = Math.min(lo, n.pitch);
    hi = Math.max(hi, n.pitch);
  }
  if (hi - lo < 12) {
    const mid = (hi + lo) / 2;
    lo = Math.floor(mid - 6);
    hi = Math.ceil(mid + 6);
  }
  const range = hi - lo + 1;
  const noteH = Math.max(1.5, h / range);
  const period = region.looped && region.coreLength ? region.coreLength : 0;
  const reps = period ? Math.ceil(region.length / period) : 1;
  for (let k = 0; k < reps; k++) {
    for (const n of notes) {
      const drawX = regionX + (k * period + n.start) * pxPerTick;
      const nw = Math.max(1.5, n.length * pxPerTick);
      if (drawX + nw < x0 || drawX > x0 + w) continue;
      const ny = y0 + h - ((n.pitch - lo + 1) / range) * h;
      ctx.fillStyle = mixHex(trackColor, "#ffffff", 0.42 + (n.velocity / 127) * 0.4);
      ctx.fillRect(drawX, ny, Math.min(nw, x0 + w - drawX), Math.max(1.5, noteH - 0.5));
    }
  }
}

function drawAudioContent(
  ctx: CanvasRenderingContext2D,
  region: Region,
  x0: number,
  y0: number,
  w: number,
  h: number,
  pxPerTick: number,
  tempo: number
) {
  const entry = getPeaks(getRegionPlaybackBufferId(region));
  const mid = y0 + h / 2;
  if (!entry) {
    // placeholder stripes
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 1;
    for (let gx = 4; gx < w; gx += 7) {
      ctx.beginPath();
      ctx.moveTo(x0 + gx, mid - h * 0.2);
      ctx.lineTo(x0 + gx, mid + h * 0.2);
      ctx.stroke();
    }
    return;
  }
  const RES = entry.peaks.length / 2;
  const contentSec = region.sampleLength ?? entry.duration;
  const periodTicks = region.looped ? secToTick(contentSec, tempo) : 0;
  const reps = periodTicks ? Math.ceil(region.length / periodTicks) : 1;

  ctx.fillStyle = "rgba(255,255,255,0.78)";
  for (let k = 0; k < reps; k++) {
    const repX = x0 + k * periodTicks * pxPerTick;
    if (repX > x0 + w) break;
    const b0 = ((region.sampleStart ?? 0) / entry.duration) * RES;
    const b1 = ((region.sampleStart ?? 0) + contentSec) / entry.duration * RES;
    const repW = Math.min((periodTicks || region.length) * pxPerTick, x0 + w - repX);
    const steps = Math.max(2, Math.floor(repW));
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const bi = Math.floor(b0 + t * (b1 - b0));
      if (bi < 0 || bi >= RES) continue;
      const min = entry.peaks[bi * 2];
      const max = entry.peaks[bi * 2 + 1];
      const px = repX + t * repW;
      const yTop = mid - max * (h / 2) * 0.92;
      const yBot = mid - min * (h / 2) * 0.92;
      ctx.fillRect(px, yTop, 1, Math.max(1, yBot - yTop));
    }
  }
}
