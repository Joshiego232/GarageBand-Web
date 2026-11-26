"use client";

// ============================================================
// ChannelStrip - one mixer channel: EQ thumbnail, comp toggle,
// send + pan knobs, fader + level meter, mute/solo and I/O.
//
// Vertical budget (panel body is 258px, header h-8 above):
//   chip 8 + name 12 + EQ 22 + comp 14 + knobs 46 + fader 118
//   + mute/solo 16 + 6 gaps x2 + py-1 x2 = 256px
// ============================================================

import { useCallback } from "react";
import { AudioLines } from "lucide-react";
import { Knob } from "@/components/daw/controls/knob";
import { Fader } from "@/components/daw/controls/fader";
import { Meter } from "@/components/daw/controls/meter";
import { TrackIcon } from "./track-icon";
import { EqMiniDisplay, VisualEQ } from "./visual-eq";
import { useDAW } from "@/lib/daw/store";
import { engine } from "@/lib/daw/engine";
import type { Track } from "@/lib/daw/types";
import { cn } from "@/lib/utils";
import { AUDIO_PLUGIN_DEFS, createPluginInstance } from "@/lib/daw/plugins";

const PAN_FORMAT = (v: number) =>
  Math.abs(v) < 0.02 ? "C" : `${v < 0 ? "L" : "R"}${Math.round(Math.abs(v) * 50)}`;

export function ChannelStrip({ track, selected }: { track: Track; selected: boolean }) {
  const selectTrack = useDAW((s) => s.selectTrack);
  const toggleMute = useDAW((s) => s.toggleTrackMute);
  const toggleSolo = useDAW((s) => s.toggleTrackSolo);
  const commit = useDAW((s) => s.commit);

  const getLevel = useCallback(() => engine.getTrackLevel(track.id), [track.id]);

  const setParam = useCallback(
    (key: string, v: number) => {
      const t = useDAW.getState().project.tracks.find((x) => x.id === track.id);
      useDAW.getState().updateTrack(
        track.id,
        { params: { ...(t?.params ?? {}), [key]: v } },
        false
      );
    },
    [track.id]
  );

  const setPan = useCallback(
    (v: number) => {
      useDAW.getState().updateTrack(track.id, { pan: v }, false);
    },
    [track.id]
  );

  const setVolume = useCallback(
    (v: number) => {
      useDAW.getState().updateTrack(track.id, { volume: v }, false);
    },
    [track.id]
  );

  const toggleComp = useCallback(() => {
    const t = useDAW.getState().project.tracks.find((x) => x.id === track.id);
    if (t) useDAW.getState().updateTrack(track.id, { compressor: !t.compressor });
  }, [track.id]);

  const toggleArm = useCallback(() => {
    const t = useDAW.getState().project.tracks.find((x) => x.id === track.id);
    if (t) useDAW.getState().updateTrack(track.id, { armed: !t.armed });
  }, [track.id]);

  const openPedalboard = () => {
    const state = useDAW.getState();
    const current = state.project.tracks.find((item) => item.id === track.id);
    if (!current) return;
    state.selectTrack(current.id);
    if (!(current.audioPlugins ?? []).some((plugin) => plugin.pluginId === "pedalboard")) {
      const instance = createPluginInstance("pedalboard", AUDIO_PLUGIN_DEFS);
      if (!instance) return;
      state.updateTrack(current.id, {
        audioPlugins: [...(current.audioPlugins ?? []), instance],
      });
    }
    state.setModal("pedalboard");
  };

  const reverb = track.params.reverb ?? 0;
  const delay = track.params.delay ?? 0;

  return (
    <div
      data-track-id={track.id}
      className={cn(
        "w-[88px] shrink-0 border-r border-black/40 flex flex-col items-center px-1 py-1 gap-[2px] transition-colors",
        selected ? "bg-[#232327]" : "bg-[#1d1d20] hover:bg-[#202024]"
      )}
    >
      {/* track color chip */}
      <div className="h-2 w-full rounded-[2px]" style={{ backgroundColor: track.color }} />

      {/* icon + name (click selects the track) */}
      <div className="w-full h-3 flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => selectTrack(track.id)}
          title={track.name}
          className="min-w-0 flex-1 h-3 flex items-center justify-center gap-1 px-0.5 rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-[#ffb648]/60"
        >
          <TrackIcon icon={track.icon} size={10} className="shrink-0" style={{ color: track.color }} />
          <span className={cn("text-[10px] leading-none truncate", selected ? "text-zinc-100" : "text-zinc-300")}>
            {track.name}
          </span>
        </button>
        <button
          type="button"
          onClick={openPedalboard}
          aria-label={`Open ${track.name} Pedalboard`}
          title="Pedalboard Audio FX insert"
          className={cn(
            "size-4 shrink-0 rounded flex items-center justify-center",
            track.audioPlugins?.some((plugin) => plugin.pluginId === "pedalboard" && plugin.enabled)
              ? "text-[#7ed7c8]"
              : "text-zinc-600 hover:text-zinc-300"
          )}
        >
          <AudioLines size={11} />
        </button>
      </div>

      {/* EQ mini display -> opens the visual EQ popover */}
      <VisualEQ trackId={track.id}>
        <button
          type="button"
          aria-label={`Open channel EQ for ${track.name}`}
          title="Channel EQ"
          className="h-[22px] w-[60px] rounded-[3px] overflow-hidden bg-[#101013] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.55)] hover:shadow-[inset_0_0_0_1px_#3a3a41] transition-shadow focus:outline-none focus-visible:ring-1 focus-visible:ring-[#ffb648]/60"
        >
          <EqMiniDisplay eq={track.eq} width={60} height={22} />
        </button>
      </VisualEQ>

      {/* compressor toggle + record arm (audio tracks) */}
      <div className="h-[14px] flex items-center gap-1.5">
        <button
          type="button"
          aria-pressed={track.compressor}
          onClick={toggleComp}
          title="Compressor"
          className={cn(
            "h-[14px] px-1.5 rounded text-[9px] leading-none font-medium border transition-colors",
            track.compressor
              ? "border-[#ffb648]/60 bg-[#ffb648]/15 text-[#ffb648]"
              : "border-black/50 bg-[#26262b] text-zinc-500 hover:text-zinc-300"
          )}
        >
          Comp
        </button>
        {track.type === "audio" && (
          <button
            type="button"
            aria-pressed={track.armed}
            aria-label={`Record arm ${track.name}`}
            title="Record arm"
            onClick={toggleArm}
            className={cn(
              "w-[10px] h-[10px] rounded-full border transition-colors",
              track.armed
                ? "bg-[#e5484d] border-[#e5484d] shadow-[0_0_5px_rgba(229,72,77,0.7)]"
                : "bg-transparent border-[#5a5a62] hover:border-zinc-400"
            )}
          />
        )}
      </div>

      {/* sends (reverb / delay) + pan */}
      <div className="flex items-start justify-center gap-[2px]">
        <Knob
          size={24}
          label="Rev"
          min={0}
          max={1}
          value={reverb}
          onChange={(v) => setParam("reverb", v)}
          onCommitStart={commit}
        />
        <Knob
          size={24}
          label="Dly"
          min={0}
          max={1}
          value={delay}
          onChange={(v) => setParam("delay", v)}
          onCommitStart={commit}
        />
        <Knob
          size={28}
          min={-1}
          max={1}
          value={track.pan}
          onChange={setPan}
          onCommitStart={commit}
          format={PAN_FORMAT}
        />
      </div>

      {/* fader + level meter */}
      <div className="flex items-center justify-center gap-1.5">
        <Fader value={track.volume} onChange={setVolume} onCommitStart={commit} height={92} />
        <Meter getLevel={getLevel} vertical width={8} height={110} />
      </div>

      {/* mute / solo + input label */}
      <div className="w-full h-4 flex items-center justify-center gap-1">
        <button
          type="button"
          aria-pressed={track.mute}
          aria-label={`Mute ${track.name}`}
          title="Mute"
          onClick={() => toggleMute(track.id)}
          className={cn(
            "w-4 h-4 rounded-[3px] border text-[9px] leading-none font-semibold transition-colors",
            track.mute
              ? "bg-[#e5484d]/20 border-[#e5484d]/70 text-[#e5484d]"
              : "bg-[#26262b] border-black/50 text-zinc-500 hover:text-zinc-200"
          )}
        >
          M
        </button>
        <button
          type="button"
          aria-pressed={track.solo}
          aria-label={`Solo ${track.name}`}
          title="Solo"
          onClick={() => toggleSolo(track.id)}
          className={cn(
            "w-4 h-4 rounded-[3px] border text-[9px] leading-none font-semibold transition-colors",
            track.solo
              ? "bg-[#e8c355]/20 border-[#e8c355]/70 text-[#e8c355]"
              : "bg-[#26262b] border-black/50 text-zinc-500 hover:text-zinc-200"
          )}
        >
          S
        </button>
        <span className="text-[9px] leading-none text-zinc-600 truncate max-w-[38px]">
          {track.type === "audio" ? "IN: Mic" : "Instrument"}
        </span>
      </div>
    </div>
  );
}
