"use client";

// ============================================================
// MixerPanel - bottom mixer deck: channel strips + master.
// ============================================================

import { useCallback } from "react";
import { X, Speaker } from "lucide-react";
import { useDAW } from "@/lib/daw/store";
import { engine } from "@/lib/daw/engine";
import { Fader } from "@/components/daw/controls/fader";
import { Meter } from "@/components/daw/controls/meter";
import { ChannelStrip } from "./channel-strip";

// Re-exported so other surfaces (timeline, dialogs) can import the
// shared track icon helper from the mixer module.
export { TrackIcon } from "./track-icon";

export function MixerPanel() {
  const tracks = useDAW((s) => s.project.tracks);
  const songName = useDAW((s) => s.project.name);
  const selectedTrackId = useDAW((s) => s.ui.selectedTrackId);
  const togglePanel = useDAW((s) => s.togglePanel);

  return (
    <div className="h-[290px] w-full border-t border-black/60 bg-[#1d1d20] flex flex-col shrink-0">
      {/* header */}
      <header className="h-8 shrink-0 flex items-center gap-2.5 px-3 border-b border-black/50 bg-[#212124]">
        <span className="text-[11px] font-semibold tracking-wide text-zinc-200">Mixer</span>
        <span className="text-[10px] text-zinc-500 truncate max-w-[180px]">{songName}</span>
        <span className="text-[10px] text-zinc-600">
          {tracks.length} {tracks.length === 1 ? "track" : "tracks"}
        </span>
        <button
          type="button"
          aria-label="Close mixer"
          title="Close mixer"
          onClick={() => togglePanel("mixer")}
          className="ml-auto w-6 h-6 rounded flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-[#2f2f34] transition-colors"
        >
          <X size={13} />
        </button>
      </header>

      {/* strips */}
      <div className="flex-1 flex overflow-x-auto overflow-y-hidden [scrollbar-width:thin] [&::-webkit-scrollbar]:h-[7px] [&::-webkit-scrollbar-track]:bg-[#161619] [&::-webkit-scrollbar-thumb]:bg-[#3a3a41] [&::-webkit-scrollbar-thumb]:rounded-full">
        {tracks.length === 0 && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-xs text-zinc-600">Add a track to start mixing</p>
          </div>
        )}
        {tracks.map((t) => (
          <ChannelStrip key={t.id} track={t} selected={t.id === selectedTrackId} />
        ))}
        <MasterStrip />
      </div>
    </div>
  );
}

function MasterStrip() {
  const masterVolume = useDAW((s) => s.project.masterVolume);
  const setMasterVolume = useDAW((s) => s.setMasterVolume);
  const commit = useDAW((s) => s.commit);
  const getLevel = useCallback(() => engine.getMasterLevel()[0], []);

  return (
    <div className="w-[100px] shrink-0 bg-[#222226] border-l-2 border-[#3a3a41] flex flex-col items-center px-2 py-1.5 gap-1.5">
      <div className="h-5 flex items-center gap-1.5 shrink-0">
        <Speaker size={12} className="text-zinc-400" aria-hidden="true" />
        <span className="text-[10px] font-semibold text-zinc-200">Master</span>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center gap-2">
        <Fader
          value={masterVolume}
          onChange={setMasterVolume}
          onCommitStart={commit}
          height={150}
        />
        <Meter getLevel={getLevel} vertical width={8} height={140} />
      </div>
      <span className="text-[9px] text-zinc-500 shrink-0">Stereo Out</span>
    </div>
  );
}
