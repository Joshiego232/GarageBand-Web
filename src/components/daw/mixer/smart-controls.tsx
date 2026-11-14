"use client";

// ============================================================
// SmartControls - editor-mode content ("smart") showing the
// selected track's patch knobs, or EQ quick controls for audio
// tracks. Rendered inside the bottom editor panel.
// ============================================================

import { useCallback, useState } from "react";
import { Mic, SlidersHorizontal } from "lucide-react";
import { useDAW } from "@/lib/daw/store";
import { PATCHES } from "@/lib/daw/instruments";
import type { KnobDef } from "@/lib/daw/types";
import { Knob } from "@/components/daw/controls/knob";
import { TrackIcon } from "./track-icon";
import { VisualEQ } from "./visual-eq";
import { PluginRack } from "./plugin-rack";

/** Unit-aware readout formatting for patch knobs. */
function knobFormat(unit?: string): ((v: number) => string) | undefined {
  if (unit === "Hz") {
    return (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`);
  }
  if (unit === "s") {
    return (v: number) => v.toFixed(2);
  }
  // default: let the Knob render Math.round(v * 100) / 100
  return undefined;
}

const EQ_GAIN_FORMAT = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;

export function SmartControls() {
  const track = useDAW((s) => s.project.tracks.find((t) => t.id === s.ui.selectedTrackId) ?? null);
  const commit = useDAW((s) => s.commit);
  const [view, setView] = useState<"sound" | "plugins">("sound");

  const setParam = useCallback((trackId: string, key: string, v: number) => {
    const t = useDAW.getState().project.tracks.find((x) => x.id === trackId);
    useDAW.getState().updateTrack(
      trackId,
      { params: { ...(t?.params ?? {}), [key]: v } },
      false
    );
  }, []);

  const setEqGain = useCallback(
    (trackId: string, key: "lowGain" | "midGain" | "highGain", v: number) => {
      const t = useDAW.getState().project.tracks.find((x) => x.id === trackId);
      if (!t) return;
      useDAW.getState().updateTrack(trackId, { eq: { ...t.eq, [key]: v } }, false);
    },
    []
  );

  if (!track) {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-[#1d1d20]">
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-zinc-600">Select a track to edit its sound</p>
        </div>
      </div>
    );
  }

  const patch = track.type === "midi" ? PATCHES[track.instrument] : undefined;
  const displayName = track.type === "midi" ? (patch?.name ?? track.name) : track.name;
  const category = track.type === "midi" ? (patch?.category ?? "Instrument") : "Audio";

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#1d1d20]">
      {/* header strip (Logic-style wood gradient) */}
      <div className="h-10 shrink-0 flex items-center gap-2.5 px-4 border-b border-black/50 bg-gradient-to-b from-[#2c2620] to-[#232327]">
        <div
          className="w-8 h-8 rounded-md flex items-center justify-center border border-black/50 shrink-0"
          style={{ backgroundColor: `${track.color}24` }}
        >
          <TrackIcon icon={track.icon} size={20} style={{ color: track.color }} />
        </div>
        <div className="min-w-0">
          <p className="text-[12px] font-medium leading-none text-zinc-200 truncate">
            {displayName}
          </p>
          <p className="text-[9px] leading-none text-zinc-500 mt-1 truncate">{category}</p>
        </div>

        <div className="ml-auto flex items-center gap-2 shrink-0">
          <div className="h-6 p-0.5 flex items-center rounded-md border border-black/50 bg-[#26262b]">
            <button
              type="button"
              onClick={() => setView("sound")}
              aria-pressed={view === "sound"}
              className={`h-5 px-2 rounded text-[9px] transition-colors ${view === "sound" ? "bg-[#45454d] text-zinc-100" : "text-zinc-500 hover:text-zinc-200"}`}
            >
              Sound
            </button>
            <button
              type="button"
              onClick={() => setView("plugins")}
              aria-pressed={view === "plugins"}
              className={`h-5 px-2 rounded text-[9px] transition-colors ${view === "plugins" ? "bg-[#45454d] text-zinc-100" : "text-zinc-500 hover:text-zinc-200"}`}
            >
              Plugins
            </button>
          </div>
          {view === "sound" && track.type === "audio" && (
            <div className="h-6 pl-1.5 pr-2 inline-flex items-center gap-1.5 rounded-md border border-black/50 bg-[#26262b]">
              <Mic size={11} className="text-zinc-500" aria-hidden="true" />
              <span className="text-[10px] text-zinc-400">Input: Microphone</span>
            </div>
          )}
          {view === "sound" && <VisualEQ trackId={track.id}>
            <button
              type="button"
              title="Visual EQ"
              className="h-6 px-2 inline-flex items-center gap-1.5 rounded-md border border-black/50 bg-[#26262b] hover:bg-[#2f2f34] text-[10px] text-zinc-300 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[#ffb648]/60"
            >
              <SlidersHorizontal size={11} className="text-[#ffb648]" aria-hidden="true" />
              Visual EQ
            </button>
          </VisualEQ>}
        </div>
      </div>

      {view === "plugins" ? (
        <PluginRack track={track} />
      ) : (
      /* knob grid */
      <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin] flex flex-wrap items-center justify-center gap-x-6 gap-y-2 py-3">
        {track.type === "midi"
          ? (patch?.knobs ?? []).map((k: KnobDef) => (
              <Knob
                key={k.id}
                size={52}
                label={k.label}
                min={k.min}
                max={k.max}
                value={track.params[k.id] ?? k.def}
                curve={k.curve}
                unit={k.unit}
                format={knobFormat(k.unit)}
                onChange={(v) => setParam(track.id, k.id, v)}
                onCommitStart={commit}
              />
            ))
          : (
            <>
              <Knob
                size={52}
                label="Low"
                min={-12}
                max={12}
                value={track.eq.lowGain}
                color="#e08e3c"
                format={EQ_GAIN_FORMAT}
                onChange={(v) => setEqGain(track.id, "lowGain", v)}
                onCommitStart={commit}
              />
              <Knob
                size={52}
                label="Mid"
                min={-12}
                max={12}
                value={track.eq.midGain}
                color="#ffb648"
                format={EQ_GAIN_FORMAT}
                onChange={(v) => setEqGain(track.id, "midGain", v)}
                onCommitStart={commit}
              />
              <Knob
                size={52}
                label="High"
                min={-12}
                max={12}
                value={track.eq.highGain}
                color="#e8e8ec"
                format={EQ_GAIN_FORMAT}
                onChange={(v) => setEqGain(track.id, "highGain", v)}
                onCommitStart={commit}
              />
            </>
          )}
      </div>
      )}
    </div>
  );
}
