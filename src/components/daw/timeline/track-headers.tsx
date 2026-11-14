"use client";

// ============================================================
// Track headers column (left of the timeline canvas)
// ============================================================

import { useState } from "react";
import { ChevronDown, ChevronRight, Circle, Copy, Trash2, Volume2 } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { useDAW } from "@/lib/daw/store";
import { TRACK_SIZES, type Track, type TrackSize } from "@/lib/daw/types";
import { gainToDb } from "@/lib/daw/utils";
import { TrackIcon } from "@/components/daw/mixer/mixer-panel";
import { PATCHES } from "@/lib/daw/instruments";
import { cn } from "@/lib/utils";

interface TrackHeadersProps {
  scrollTop: number;
  width: number;
  size: TrackSize;
}

export function TrackHeaders({ scrollTop, width, size }: TrackHeadersProps) {
  const project = useDAW((s) => s.project);
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
  const selectTrack = useDAW((s) => s.selectTrack);
  const toggleTrackMute = useDAW((s) => s.toggleTrackMute);
  const toggleTrackSolo = useDAW((s) => s.toggleTrackSolo);
  const updateTrack = useDAW((s) => s.updateTrack);
  const commit = useDAW((s) => s.commit);
  const duplicateTrack = useDAW((s) => s.duplicateTrack);
  const removeTrack = useDAW((s) => s.removeTrack);
  const setModal = useDAW((s) => s.setModal);
  const toggleTrackStack = useDAW((s) => s.toggleTrackStack);

  const h = TRACK_SIZES[size];

  return (
    <div className="relative h-full overflow-hidden" data-testid="track-headers">
      <div
        className="absolute inset-x-0 top-0 will-change-transform"
        style={{ transform: `translateY(${-scrollTop}px)` }}
      >
        {tracks.map((track, i) => (
          <TrackHeader
            key={track.id}
            track={track}
            index={i}
            height={h}
            width={width}
            selected={track.id === selectedTrackId}
            size={size}
            onSelect={() => selectTrack(track.id)}
            onMute={() => toggleTrackMute(track.id)}
            onSolo={() => toggleTrackSolo(track.id)}
            onVolume={(v) => updateTrack(track.id, { volume: v }, false)}
            onCommitStart={commit}
            onPan={(v) => updateTrack(track.id, { pan: v }, false)}
            onArm={() => updateTrack(track.id, { armed: !track.armed }, false)}
            onRename={(name) => updateTrack(track.id, { name }, false)}
            onDuplicate={() => duplicateTrack(track.id)}
            onDelete={() => removeTrack(track.id)}
            folderChildCount={project.stacks?.find((stack) => stack.folderTrackId === track.id)?.trackIds.length ?? 0}
            folderCollapsed={!!track.collapsed}
            onToggleCollapse={() => {
              const stack = project.stacks?.find((item) => item.folderTrackId === track.id);
              if (stack) toggleTrackStack(stack.id);
            }}
          />
        ))}
        {/* add track button */}
        <button
          onClick={() => setModal("addTrack")}
          className="flex items-center gap-2 px-3 text-[11px] text-zinc-500 hover:text-[#ffb648] transition-colors w-full py-2"
        >
          <span className="size-5 rounded-full border border-dashed border-zinc-600 flex items-center justify-center text-sm leading-none">+</span>
          Add Track
        </button>
      </div>
    </div>
  );
}

interface TrackHeaderProps {
  track: Track;
  index: number;
  height: number;
  width: number;
  selected: boolean;
  size: TrackSize;
  onSelect: () => void;
  onMute: () => void;
  onSolo: () => void;
  onVolume: (v: number) => void;
  onCommitStart: () => void;
  onPan: (v: number) => void;
  onArm: () => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  folderChildCount: number;
  folderCollapsed: boolean;
  onToggleCollapse: () => void;
}

function TrackHeader(p: TrackHeaderProps) {
  const { track, height, selected, size } = p;
  const [editing, setEditing] = useState(false);
  const [hover, setHover] = useState(false);
  const [name, setName] = useState(track.name);
  const patch = PATCHES[track.instrument];

  return (
    <div
      className={cn(
        "relative border-b border-black/40 flex flex-col justify-center px-2.5 cursor-pointer group transition-colors",
        selected ? "bg-[#2c2c33]" : "bg-[#242429] hover:bg-[#28282e]",
        track.parentTrackId && "pl-7",
        track.role === "folder" && "bg-[#292e37]"
      )}
      style={{ height, width: "100%" }}
      onPointerDown={p.onSelect}
      onDoubleClick={(e) => {
        if (e.target instanceof HTMLInputElement) return;
        setEditing(true);
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-testid={`track-header-${track.name}`}
    >
      {/* selection accent */}
      {selected && <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#ffb648]" />}
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
            <div className="text-[11px] font-medium text-zinc-200 truncate leading-tight">
              {track.name}
            </div>
          )}
          {size !== "S" && track.role === "folder" && (
            <div className="text-[9px] text-[#a8bad7] truncate leading-tight">
              {p.folderChildCount} tracks · {p.folderCollapsed ? "collapsed" : "expanded"}
            </div>
          )}
          {size !== "S" && track.role !== "folder" && track.type === "midi" && (
            <div className="text-[9px] text-zinc-500 truncate leading-tight">
              {patch?.name ?? track.instrument}
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
            title="Record enable"
            onClick={p.onArm}
            className={cn(
              "size-[15px] rounded-full border flex items-center justify-center shrink-0",
              track.armed
                ? "bg-[#e5484d] border-[#e5484d] text-white"
                : "border-zinc-600 text-zinc-600 hover:border-zinc-400"
            )}
          >
            <Circle className="size-1.5 fill-current" />
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
      {size === "S" && track.role !== "folder" && (
        <div className="flex items-center gap-1 mt-1" onPointerDown={(e) => e.stopPropagation()}>
          <button
            title="Mute (M)"
            onClick={p.onMute}
            className={cn(
              "text-[8px] font-bold w-[16px] h-[14px] rounded border",
              track.mute
                ? "bg-[#e5484d]/20 border-[#e5484d]/60 text-[#e5484d]"
                : "border-zinc-700 text-zinc-500"
            )}
          >
            M
          </button>
          <button
            title="Solo (S)"
            onClick={p.onSolo}
            className={cn(
              "text-[8px] font-bold w-[16px] h-[14px] rounded border",
              track.solo
                ? "bg-[#e8c355]/20 border-[#e8c355]/70 text-[#e8c355]"
                : "border-zinc-700 text-zinc-500"
            )}
          >
            S
          </button>
        </div>
      )}
    </div>
  );
}
