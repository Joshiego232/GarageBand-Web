"use client";

// ============================================================
// Track headers column (left of the timeline canvas)
// ============================================================

import { useState, type PointerEvent } from "react";
import { ChevronDown, ChevronRight, CloudOff, Copy, LoaderCircle, Trash2, Volume2 } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { useDAW } from "@/lib/daw/store";
import { trackRowHeight, type Track, type TrackSize } from "@/lib/daw/types";
import { gainToDb } from "@/lib/daw/utils";
import { TrackIcon } from "@/components/daw/mixer/mixer-panel";
import { trackPatch } from "@/lib/daw/instruments";
import { cn } from "@/lib/utils";
import { TRACK_COLOR_PALETTE, hexToRgba } from "@/lib/daw/colors";
import { engine } from "@/lib/daw/engine";
import { useSoundFontStatus } from "@/hooks/use-soundfont-status";
import { AutomationTrackHeader } from "./AutomationTrackHeader";

interface TrackHeadersProps {
  scrollTop: number;
  width: number;
  size: TrackSize;
}

export function TrackHeaders({ scrollTop, width, size }: TrackHeadersProps) {
  const project = useDAW((s) => s.project);
  const automationView = useDAW((s) => s.ui.automationView);
  const showMasterTrack = useDAW((s) => s.ui.showMasterTrack);
  const collapsedFolderIds = new Set(
    project.tracks
      .filter((track) => track.role === "folder" && track.collapsed)
      .map((track) => track.id)
  );
  const tracks = project.tracks.filter(
    (track) =>
      track.role !== "aux" &&
      track.role !== "vca" &&
      (!track.parentTrackId || !collapsedFolderIds.has(track.parentTrackId))
  );
  const selectedTrackId = useDAW((s) => s.ui.selectedTrackId);
  const selectedTrackIds = useDAW((s) => s.ui.selectedTrackIds);
  const selectTrack = useDAW((s) => s.selectTrack);
  const toggleTrackMute = useDAW((s) => s.toggleTrackMute);
  const toggleTrackSolo = useDAW((s) => s.toggleTrackSolo);
  const updateTrack = useDAW((s) => s.updateTrack);
  const commit = useDAW((s) => s.commit);
  const duplicateTrack = useDAW((s) => s.duplicateTrack);
  const removeTrack = useDAW((s) => s.removeTrack);
  const setModal = useDAW((s) => s.setModal);
  const toggleTrackStack = useDAW((s) => s.toggleTrackStack);
  const createTrackStack = useDAW((s) => s.createTrackStack);
  const [stackDialogOpen, setStackDialogOpen] = useState(false);

  const { positionedTracks, totalHeight } = tracks.reduce<{
    positionedTracks: { track: Track; top: number; height: number }[];
    totalHeight: number;
  }>(
    (layout, track) => {
      const height = trackRowHeight(track, size) + (automationView ? 56 : 0);
      return {
        positionedTracks: [
          ...layout.positionedTracks,
          { track, top: layout.totalHeight, height },
        ],
        totalHeight: layout.totalHeight + height,
      };
    },
    { positionedTracks: [], totalHeight: 0 }
  );
  const masterHeight = showMasterTrack ? (automationView ? 94 : 38) : 0;

  return (
    <div className="relative h-full overflow-hidden" data-testid="track-headers">
      <div
        className="absolute inset-x-0 top-0 will-change-transform"
        style={{ height: totalHeight + 40, transform: `translateY(${-scrollTop}px)` }}
      >
        {positionedTracks.map(({ track, top, height }, i) => (
          <TrackHeader
            key={track.id}
            track={track}
            index={i}
            top={top}
            height={height}
            width={width}
            selected={selectedTrackIds.length
              ? selectedTrackIds.includes(track.id)
              : track.id === selectedTrackId}
            size={size}
            automationView={automationView}
            onSelect={(event) => {
              const additive = event.metaKey || event.ctrlKey;
              if (event.shiftKey && selectedTrackId) {
                const anchor = tracks.findIndex((item) => item.id === selectedTrackId);
                const target = tracks.findIndex((item) => item.id === track.id);
                const from = Math.min(anchor, target);
                const to = Math.max(anchor, target);
                selectTrack(track.id, false, tracks.slice(from, to + 1).map((item) => item.id));
              } else {
                selectTrack(track.id, additive);
              }
            }}
            onMute={() => toggleTrackMute(track.id)}
            onSolo={() => toggleTrackSolo(track.id)}
            onVolume={(v) => updateTrack(track.id, { volume: v }, false)}
            onCommitStart={commit}
            onPan={(v) => updateTrack(track.id, { pan: v }, false)}
            onArm={() => updateTrack(track.id, { armed: !track.armed }, false)}
            onMonitor={() => {
              const enabled = !track.inputMonitor;
              updateTrack(track.id, { inputMonitor: enabled }, false);
              if (track.type === "audio" && track.role === "track") {
                engine.setTrackInputMonitor(track.id, enabled);
              }
            }}
            onRename={(name) => {
              const stack = project.stacks?.find((item) => item.folderTrackId === track.id);
              if (stack) useDAW.getState().renameTrackStack(stack.id, name);
              else updateTrack(track.id, { name }, false);
            }}
            onDuplicate={() => duplicateTrack(track.id)}
            onDelete={() => removeTrack(track.id)}
            folderChildCount={project.stacks?.find((stack) => stack.folderTrackId === track.id)?.trackIds.length ?? 0}
            folderCollapsed={!!track.collapsed}
            collapsed={track.role !== "folder" && !!track.collapsed}
            onToggleTrackCollapse={() => updateTrack(track.id, { collapsed: !track.collapsed }, false)}
            onToggleCollapse={() => {
              const stack = project.stacks?.find((item) => item.folderTrackId === track.id);
              if (stack) toggleTrackStack(stack.id);
            }}
          />
        ))}
        {showMasterTrack && (
          <div
            className="absolute inset-x-0 flex flex-col justify-center border-b border-black/50 bg-[#202c35] px-2.5"
            style={{ top: totalHeight, height: masterHeight, width: "100%" }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-2 text-[10px] font-semibold text-cyan-100">
              <span className="size-5 rounded border border-cyan-300/30 bg-cyan-400/10 text-cyan-200 flex items-center justify-center">M</span>
              Master Output
              <span className="ml-auto text-[8px] uppercase tracking-wider text-cyan-300/50">Entire Project</span>
            </div>
            {automationView && <AutomationTrackHeader ownerId="master" master />}
          </div>
        )}
        {/* add track button */}
        <button
          onClick={() => setModal("addTrack")}
          className="flex w-[104px] items-center gap-2 px-3 text-[11px] text-zinc-500 hover:text-[#ffb648] transition-colors py-2"
          style={{ position: "absolute", top: totalHeight + masterHeight, left: 0 }}
        >
          <span className="size-5 rounded-full border border-dashed border-zinc-600 flex items-center justify-center text-sm leading-none">+</span>
          Add Track
        </button>
        <button
          type="button"
          disabled={selectedTrackIds.length < 2}
          title={selectedTrackIds.length < 2 ? "Select at least two tracks (Shift-click or Cmd/Ctrl-click)" : "Create Track Stack"}
          onClick={() => setStackDialogOpen(true)}
          className="absolute left-[104px] flex items-center gap-1.5 px-2 py-2 text-[10px] text-zinc-500 hover:text-[#ffb648] disabled:opacity-30 disabled:hover:text-zinc-500"
          style={{ top: totalHeight + masterHeight }}
        >
          <span className="size-5 rounded border border-dashed border-zinc-600 flex items-center justify-center text-xs">▤</span>
          Stack ({selectedTrackIds.length})
        </button>
      </div>
      {stackDialogOpen && (
        <TrackStackDialog
          onClose={() => setStackDialogOpen(false)}
          onCreate={(name, type) => {
            const id = createTrackStack(name, type, selectedTrackIds);
            if (id) setStackDialogOpen(false);
          }}
        />
      )}
    </div>
  );
}

interface TrackHeaderProps {
  track: Track;
  index: number;
  top: number;
  height: number;
  width: number;
  selected: boolean;
  size: TrackSize;
  automationView: boolean;
  onSelect: (event: PointerEvent<HTMLDivElement>) => void;
  onMute: () => void;
  onSolo: () => void;
  onVolume: (v: number) => void;
  onCommitStart: () => void;
  onPan: (v: number) => void;
  onArm: () => void;
  onMonitor: () => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  folderChildCount: number;
  folderCollapsed: boolean;
  collapsed: boolean;
  onToggleTrackCollapse: () => void;
  onToggleCollapse: () => void;
}

function TrackHeader(p: TrackHeaderProps) {
  const { track, height, selected, size } = p;
  const automationView = p.automationView;
  const collapsed = p.collapsed && !automationView;
  const [editing, setEditing] = useState(false);
  const [hover, setHover] = useState(false);
  const [name, setName] = useState(track.name);
  const [colorPaletteOpen, setColorPaletteOpen] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const patch = trackPatch(track);
  const soundFontStatus = useSoundFontStatus(track.id);
  const updateTrack = useDAW((s) => s.updateTrack);
  const commit = useDAW((s) => s.commit);
  const project = useDAW((s) => s.project);
  const setTrackStackColor = useDAW((s) => s.setTrackStackColor);
  const removeTrackStack = useDAW((s) => s.removeTrackStack);
  const stack = track.role === "folder"
    ? project.stacks?.find((item) => item.folderTrackId === track.id)
    : undefined;
  const automationTrack = stack?.type === "summing" && stack.busTrackId
    ? project.tracks.find((item) => item.id === stack.busTrackId) ?? track
    : track;

  const assignColor = (color: string) => {
    if (stack) setTrackStackColor(stack.id, color);
    else {
      commit();
      updateTrack(track.id, { color }, false);
    }
    setColorPaletteOpen(false);
    setContextMenuOpen(false);
  };

  return (
    <div
      className={cn(
        "absolute inset-x-0 border-b border-black/40 cursor-pointer group transition-colors",
        collapsed ? "flex items-center px-2" : "flex flex-col justify-center px-2.5",
        selected ? "bg-[#2c2c33]" : "bg-[#242429] hover:bg-[#28282e]",
        track.parentTrackId && "pl-7",
        track.role === "folder" && "bg-[#292e37]"
      )}
      style={{
        top: p.top,
        height,
        width: "100%",
        backgroundColor: hexToRgba(track.color, selected ? 0.13 : 0.055),
      }}
      onPointerDown={p.onSelect}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        const file = [...event.dataTransfer.files].find((item) => /\.sf[23]$/i.test(item.name));
        if (!file) return;
        event.preventDefault();
        event.stopPropagation();
        window.dispatchEvent(new CustomEvent("webband:import-soundfont", {
          detail: { file, trackId: track.id },
        }));
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        setContextMenuOpen(true);
        setColorPaletteOpen(false);
      }}
      onDoubleClick={(e) => {
        if (e.target instanceof HTMLInputElement) return;
        setEditing(true);
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-testid={`track-header-${track.name}`}
    >
      <button
        type="button"
        aria-label={`Assign color to ${track.name}`}
        title="Assign Track Color..."
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setColorPaletteOpen((open) => !open);
          setContextMenuOpen(false);
        }}
        className="absolute left-0 top-0 z-10 h-full w-[5px] cursor-pointer border-r border-black/35 transition-[width,filter] hover:w-2 hover:brightness-125 focus-visible:w-2 focus-visible:outline-none"
        style={{ backgroundColor: track.color }}
      />
      {contextMenuOpen && (
        <div
          role="menu"
          className="absolute left-2 top-7 z-40 min-w-40 rounded-md border border-white/10 bg-[#29292d] p-1 shadow-xl"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setContextMenuOpen(false);
              setColorPaletteOpen(true);
            }}
            className="w-full rounded px-2.5 py-1.5 text-left text-[11px] text-zinc-200 hover:bg-white/10"
          >
            Assign Track Color...
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setContextMenuOpen(false);
              window.dispatchEvent(new CustomEvent("webband:save-user-patch", { detail: { trackId: track.id } }));
            }}
            className="w-full rounded px-2.5 py-1.5 text-left text-[11px] text-zinc-200 hover:bg-white/10"
          >
            Save as User Patch...
          </button>
          {stack && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setContextMenuOpen(false);
                  setEditing(true);
                }}
                className="w-full rounded px-2.5 py-1.5 text-left text-[11px] text-zinc-200 hover:bg-white/10"
              >
                Rename Track Stack
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setContextMenuOpen(false);
                  removeTrackStack(stack.id);
                }}
                className="w-full rounded px-2.5 py-1.5 text-left text-[11px] text-[#ff8989] hover:bg-white/10"
              >
                Flatten Stack
              </button>
            </>
          )}
        </div>
      )}
      {colorPaletteOpen && (
        <div
          role="dialog"
          aria-label={`Track colors for ${track.name}`}
          className="absolute left-2 top-7 z-40 grid w-[152px] grid-cols-6 gap-1.5 rounded-lg border border-white/10 bg-[#28282c] p-2.5 shadow-[0_8px_24px_rgba(0,0,0,.65)]"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {TRACK_COLOR_PALETTE.map((color, index) => (
            <button
              key={color}
              type="button"
              aria-label={`Track color ${index + 1}`}
              aria-pressed={track.color.toLowerCase() === color.toLowerCase()}
              title={color}
              onClick={() => assignColor(color)}
              className={cn(
                "size-4 rounded-full border border-black/60 shadow-[inset_0_1px_rgba(255,255,255,.25)] transition-transform hover:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
                track.color.toLowerCase() === color.toLowerCase() && "ring-2 ring-white ring-offset-1 ring-offset-[#28282c]"
              )}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      )}
      {collapsed ? (
        <>
          <button
            type="button"
            aria-label={`Expand ${track.name}`}
            title={`Expand ${track.name}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              p.onToggleTrackCollapse();
            }}
            className="mr-1 size-4 rounded flex items-center justify-center text-zinc-500 hover:bg-white/10 hover:text-zinc-200 shrink-0"
          >
            <ChevronRight size={12} />
          </button>
          <div
            className="size-4 rounded flex items-center justify-center shrink-0 border border-black/40"
            style={{ background: `linear-gradient(160deg, ${track.color}, ${track.color}bb)` }}
          >
            <TrackIcon icon={track.icon} size={11} className="text-black/70" />
          </div>
          <span className="ml-2 min-w-0 truncate text-[10px] font-medium text-zinc-300">
            {track.name}
          </span>
          {soundFontStatus?.state === "loading" && (
            <LoaderCircle size={11} className="animate-spin text-[#9dcfff]" aria-label="Loading SoundFont" />
          )}
          {soundFontStatus?.state === "fallback" && (
            <CloudOff size={11} className="text-amber-400" aria-label="Using built-in synth fallback" />
          )}
          <TrackModeButtons track={track} onMute={p.onMute} onSolo={p.onSolo} onArm={p.onArm} onMonitor={p.onMonitor} />
        </>
      ) : (
        <>
      <div className="flex items-center gap-2 min-w-0">
        {track.role === "folder" && (
          <button
            type="button"
            aria-label={p.folderCollapsed ? "Expand track stack" : "Collapse track stack"}
            title={p.folderCollapsed ? "Expand folder stack" : "Collapse folder stack"}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              p.onToggleCollapse();
            }}
            className="size-5 rounded flex items-center justify-center text-[#a8bad7] hover:bg-white/10 shrink-0"
          >
            {p.folderCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </button>
        )}
        {track.role !== "folder" && (
          <button
            type="button"
            aria-label={`Collapse ${track.name}`}
            title={`Collapse ${track.name}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              p.onToggleTrackCollapse();
            }}
            className="size-5 rounded flex items-center justify-center text-zinc-500 hover:bg-white/10 hover:text-zinc-200 shrink-0"
          >
            <ChevronDown size={13} />
          </button>
        )}
        <div
          className="size-7 rounded-md flex items-center justify-center shrink-0 shadow-sm border border-black/40"
          style={{ background: `linear-gradient(160deg, ${track.color}, ${track.color}bb)` }}
        >
          <TrackIcon icon={track.icon} size={15} className="text-black/70" />
        </div>
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                setEditing(false);
                if (name.trim()) p.onRename(name.trim());
                else setName(track.name);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  setName(track.name);
                  setEditing(false);
                }
              }}
              className="w-full bg-[#101013] border border-[#ffb648]/50 rounded px-1 text-[11px] text-zinc-100 outline-none"
            />
          ) : (
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[11px] font-medium leading-tight text-zinc-200">
                {track.name}
              </span>
              {soundFontStatus?.state === "loading" && (
                <LoaderCircle size={11} className="shrink-0 animate-spin text-[#9dcfff]" aria-label="Loading SoundFont" />
              )}
              {soundFontStatus?.state === "fallback" && (
                <CloudOff size={11} className="shrink-0 text-amber-400" aria-label="Using built-in synth fallback" />
              )}
            </div>
          )}
          {size !== "S" && track.role === "folder" && (
            <div className="text-[9px] text-[#a8bad7] truncate leading-tight">
              {p.folderChildCount} tracks · {p.folderCollapsed ? "collapsed" : "expanded"}
            </div>
          )}
          {size !== "S" && track.role !== "folder" && track.type === "midi" && (
            <div className="text-[9px] text-zinc-500 truncate leading-tight">
              {soundFontStatus?.state === "fallback"
                ? "Offline synth fallback"
                : soundFontStatus?.state === "loading"
                  ? "Loading SoundFont..."
                  : track.sampleName ?? patch?.name ?? track.instrument}
            </div>
          )}
          {size !== "S" && track.role !== "folder" && track.type === "audio" && (
            <div className="text-[9px] text-zinc-500 truncate leading-tight">
              {track.armed ? "Ready to record" : "Audio"}
            </div>
          )}
        </div>
        {/* hover actions */}
        <div className={cn("flex items-center gap-0.5 shrink-0", !hover && "opacity-0")}>
          <button
            title="Duplicate track"
            className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-white/10"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              p.onDuplicate();
            }}
          >
            <Copy className="size-3" />
          </button>
          <button
            title="Delete track"
            className="p-1 rounded text-zinc-500 hover:text-[#e5484d] hover:bg-white/10"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              p.onDelete();
            }}
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      </div>
      {/* controls row */}
      {size !== "S" && track.role !== "folder" && (
        <div className="flex items-center gap-2 mt-1.5" onPointerDown={(e) => e.stopPropagation()}>
          <button
            title="Record Enable (R)"
            aria-label={`Record enable ${track.name}`}
            aria-pressed={track.armed}
            onClick={p.onArm}
            className={cn(
              "w-[17px] h-[16px] rounded border text-[9px] font-bold flex items-center justify-center shrink-0",
              track.armed
                ? "bg-[#ff334f]/20 border-[#ff334f]/75 text-[#ff4d65] shadow-[0_0_8px_rgba(255,51,79,.3)]"
                : "border-zinc-700 text-zinc-500 hover:border-zinc-400"
            )}
          >
            R
          </button>
          <button
            title="Mute (M)"
            onClick={p.onMute}
            className={cn(
              "text-[9px] font-bold w-[18px] h-[16px] rounded border shrink-0",
              track.mute
                ? "bg-[#e5484d]/20 border-[#e5484d]/60 text-[#e5484d]"
                : "border-zinc-700 text-zinc-500 hover:border-zinc-500"
            )}
          >
            M
          </button>
          <button
            title="Solo (S)"
            onClick={p.onSolo}
            className={cn(
              "text-[9px] font-bold w-[18px] h-[16px] rounded border shrink-0",
              track.solo
                ? "bg-[#e8c355]/20 border-[#e8c355]/70 text-[#e8c355]"
                : "border-zinc-700 text-zinc-500 hover:border-zinc-500"
            )}
          >
            S
          </button>
          <button
            title="Input Monitoring (I)"
            aria-label={`Input monitoring ${track.name}`}
            aria-pressed={track.inputMonitor}
            onClick={p.onMonitor}
            className={cn(
              "w-[17px] h-[16px] rounded border text-[9px] font-bold flex items-center justify-center shrink-0",
              track.inputMonitor
                ? "bg-[#ff9633]/20 border-[#ff9633]/75 text-[#ffad52] shadow-[0_0_8px_rgba(255,150,51,.3)]"
                : "border-zinc-700 text-zinc-500 hover:border-zinc-400"
            )}
          >
            I
          </button>
          <div className="flex-1 flex items-center gap-1.5 min-w-0">
            <Volume2 className="size-3 text-zinc-600 shrink-0" />
            <Slider
              value={[Math.round(track.volume * 100)]}
              min={0}
              max={125}
              step={1}
              onValueChange={(v) => p.onVolume(v[0] / 100)}
              onPointerDown={p.onCommitStart}
              className="flex-1 h-1"
            />
            <span className="text-[8px] font-mono text-zinc-600 w-8 text-right shrink-0 tabular-nums">
              {gainToDb(track.volume) < -60 ? "-inf" : gainToDb(track.volume).toFixed(0)}
            </span>
          </div>
          {size === "L" && (
            <div className="flex items-center gap-1 w-16 shrink-0">
              <span className="text-[8px] text-zinc-600">PAN</span>
              <Slider
                value={[Math.round(track.pan * 50)]}
                min={-50}
                max={50}
                step={1}
                onValueChange={(v) => p.onPan(v[0] / 50)}
                onPointerDown={p.onCommitStart}
                className="flex-1 h-1"
              />
            </div>
          )}
        </div>
      )}
      {size !== "S" && track.role === "folder" && (
        <div className="mt-1 flex items-center gap-2 pl-7" onPointerDown={(event) => event.stopPropagation()}>
          <TrackModeButtons track={track} onMute={p.onMute} onSolo={p.onSolo} onArm={p.onArm} onMonitor={p.onMonitor} />
          <span className="text-[8px] uppercase tracking-wider text-zinc-600">Group</span>
          <Slider
            value={[Math.round(track.volume * 100)]}
            min={0}
            max={125}
            step={1}
            onValueChange={(value) => p.onVolume(value[0] / 100)}
            onPointerDown={p.onCommitStart}
            aria-label={`${track.name} group volume`}
            className="w-16 h-1"
          />
        </div>
      )}
      {size === "S" && track.role !== "folder" && (
        <div className="flex items-center gap-1 mt-1" onPointerDown={(e) => e.stopPropagation()}>
          <TrackModeButtons track={track} onMute={p.onMute} onSolo={p.onSolo} onArm={p.onArm} onMonitor={p.onMonitor} />
        </div>
      )}
      {size === "S" && track.role === "folder" && (
        <div className="ml-auto" onPointerDown={(event) => event.stopPropagation()}>
          <TrackModeButtons track={track} onMute={p.onMute} onSolo={p.onSolo} onArm={p.onArm} onMonitor={p.onMonitor} />
        </div>
      )}
      {automationView && (
        <AutomationTrackHeader ownerId={automationTrack.id} track={automationTrack} />
      )}
        </>
      )}
    </div>
  );
}

function TrackModeButtons({
  track,
  onMute,
  onSolo,
  onArm,
  onMonitor,
}: {
  track: Track;
  onMute: () => void;
  onSolo: () => void;
  onArm: () => void;
  onMonitor: () => void;
}) {
  const buttons = [
    { key: "M", label: "Mute", active: track.mute, click: onMute, color: "red" },
    { key: "S", label: "Solo", active: track.solo, click: onSolo, color: "yellow" },
    { key: "R", label: "Record Enable", active: track.armed, click: onArm, color: "red" },
    { key: "I", label: "Input Monitoring", active: track.inputMonitor, click: onMonitor, color: "orange" },
  ];
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {buttons.map((button) => (
        <button
          key={button.key}
          type="button"
          title={`${button.label} (${button.key})`}
          aria-label={`${button.label} ${track.name}`}
          aria-pressed={button.active}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            button.click();
          }}
          className={cn(
            "size-4 rounded border text-[8px] font-bold leading-none",
            button.active
              ? button.color === "yellow"
                ? "border-yellow-400/70 bg-yellow-400/15 text-yellow-300"
                : button.color === "orange"
                  ? "border-orange-400/70 bg-orange-400/15 text-orange-300"
                  : "border-red-400/70 bg-red-400/15 text-red-300"
              : "border-zinc-700 text-zinc-500 hover:border-zinc-400 hover:text-zinc-300"
          )}
        >
          {button.key}
        </button>
      ))}
    </div>
  );
}

function TrackStackDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, type: "folder" | "summing") => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"folder" | "summing">("folder");
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]" role="presentation">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-stack-title"
        onSubmit={(event) => {
          event.preventDefault();
          onCreate(name, type);
        }}
        className="w-full max-w-sm rounded-xl border border-white/10 bg-[#29292d] p-5 text-zinc-200 shadow-[0_20px_70px_rgba(0,0,0,.7),inset_0_1px_rgba(255,255,255,.07)]"
      >
        <h2 id="create-stack-title" className="text-sm font-semibold">Create Track Stack</h2>
        <p className="mt-1 text-[11px] text-zinc-500">Group the selected tracks under a parent track.</p>
        <label className="mt-4 block text-[10px] uppercase tracking-wider text-zinc-500">
          Stack name
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={type === "folder" ? "Track Stack" : "Summing Stack"}
            className="mt-1 h-8 w-full rounded-md border border-black/60 bg-[#19191c] px-2 text-xs text-zinc-100 outline-none focus:border-[#ffb648]/50"
          />
        </label>
        <fieldset className="mt-4 grid grid-cols-2 gap-2">
          {([
            ["folder", "Folder Stack", "Organize tracks together."],
            ["summing", "Summing Stack", "Route tracks through a shared bus."],
          ] as const).map(([value, label, detail]) => (
            <label key={value} className={cn("cursor-pointer rounded-lg border p-2.5", type === value ? "border-[#ffb648]/60 bg-[#ffb648]/10" : "border-white/10 bg-black/10")}>
              <input className="sr-only" type="radio" name="stack-type" value={value} checked={type === value} onChange={() => setType(value)} />
              <span className="block text-[11px] font-medium">{label}</span>
              <span className="mt-1 block text-[9px] leading-snug text-zinc-500">{detail}</span>
            </label>
          ))}
        </fieldset>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-7 rounded px-3 text-[11px] text-zinc-400 hover:bg-white/5">Cancel</button>
          <button type="submit" className="h-7 rounded bg-[#e6a845] px-3 text-[11px] font-semibold text-[#19191b] hover:brightness-110">Create Stack</button>
        </div>
      </form>
    </div>
  );
}
