"use client";

// ============================================================
// SmartControls - editor-mode content ("smart") showing the
// selected track's patch knobs, or EQ quick controls for audio
// tracks. Rendered inside the bottom editor panel.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { Mic, Play, SlidersHorizontal } from "lucide-react";
import { useDAW } from "@/lib/daw/store";
import { PATCHES } from "@/lib/daw/instruments";
import type { KnobDef } from "@/lib/daw/types";
import { Knob } from "@/components/daw/controls/knob";
import { TrackIcon } from "./track-icon";
import { VisualEQ } from "./visual-eq";
import { PluginRack } from "./plugin-rack";
import { engine } from "@/lib/daw/engine";

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
  const displayName = track.sampleBufferId
    ? track.sampleName ?? track.name
    : track.type === "midi"
      ? (patch?.name ?? track.name)
      : track.name;
  const category = track.sampleBufferId
    ? "Quick Sampler"
    : track.type === "midi"
      ? (patch?.category ?? "Instrument")
      : "Audio";

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
            <AudioInputSelector trackId={track.id} inputDeviceId={track.inputDeviceId ?? null} />
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
        {track.sampleBufferId ? (
          <QuickSamplerControls track={track} />
        ) : track.type === "midi" ? (
          (patch?.knobs ?? []).map((k: KnobDef) => (
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
        ) : (
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


function QuickSamplerControls({ track }: { track: NonNullable<ReturnType<typeof useDAW.getState>["project"]["tracks"][number]> }) {
  const updateTrack = useDAW((state) => state.updateTrack);
  const commit = useDAW((state) => state.commit);
  const sample = track.sampleBufferId ? engine.getStoredBuffer(track.sampleBufferId) : undefined;
  const duration = sample?.channels[0]?.length
    ? sample.channels[0].length / sample.sampleRate
    : 0;
  const rootPitch = track.sampleRootPitch ?? 60;
  const noteName = (pitch: number) => {
    const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
    return `${names[pitch % 12]} ${Math.floor(pitch / 12) - 1}`;
  };

  return (
    <div className="w-full max-w-3xl px-4 flex flex-col gap-4">
      <div className="rounded-lg border border-[#4a90d9]/30 bg-[#4a90d9]/10 p-4 flex items-center gap-3">
        <div className="size-10 rounded-lg bg-[#4a90d9]/15 text-[#9dc8f0] flex items-center justify-center shrink-0">
          <SlidersHorizontal size={19} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold text-zinc-100">Quick Sampler</p>
          <p className="text-[10px] text-zinc-400 truncate">{track.sampleName ?? track.name}</p>
          <p className="text-[9px] text-zinc-600 mt-0.5">
            {duration > 0 ? `${duration.toFixed(2)} seconds · ${sample?.sampleRate.toLocaleString()} Hz` : "Sample will load when the track is played"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => engine.auditionNote(track.instrument, rootPitch, 100, track.params)}
          className="h-8 px-3 rounded-md border border-[#4a90d9]/35 bg-[#4a90d9]/15 text-[10px] text-[#b6d9fa] hover:bg-[#4a90d9]/25 inline-flex items-center gap-1.5"
        >
          <Play size={11} fill="currentColor" /> Preview
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="rounded-md border border-black/40 bg-[#232327] p-3 flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Root key</span>
          <select
            value={rootPitch}
            onPointerDown={commit}
            onChange={(event) => updateTrack(track.id, { sampleRootPitch: Number(event.target.value) }, false)}
            className="h-8 rounded border border-black/50 bg-[#17171a] px-2 text-[11px] text-zinc-200 outline-none focus:border-[#4a90d9]/60"
          >
            {Array.from({ length: 49 }, (_, index) => index + 36).map((pitch) => (
              <option key={pitch} value={pitch}>{noteName(pitch)}</option>
            ))}
          </select>
          <span className="text-[9px] text-zinc-600">The imported recording is played at its original pitch on this key.</span>
        </label>

        <label className="rounded-md border border-black/40 bg-[#232327] p-3 flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Playback mode</span>
          <select
            value={track.samplePlaybackMode ?? "one-shot"}
            onPointerDown={commit}
            onChange={(event) => updateTrack(track.id, { samplePlaybackMode: event.target.value as "one-shot" | "loop" }, false)}
            className="h-8 rounded border border-black/50 bg-[#17171a] px-2 text-[11px] text-zinc-200 outline-none focus:border-[#4a90d9]/60"
          >
            <option value="one-shot">One-shot · Play sample to the end</option>
            <option value="loop">Loop · Hold while MIDI note is held</option>
          </select>
          <span className="text-[9px] text-zinc-600">Loop mode follows MIDI note length; one-shot ignores note-off.</span>
        </label>
      </div>
      <p className="text-[9px] text-zinc-600">
        This is a single-sample instrument mapped across the keyboard using pitch shifting. Multi-zone velocity layers and key-range mapping can be added as a later sampler upgrade.
      </p>
    </div>
  );
}


function AudioInputSelector({
  trackId,
  inputDeviceId,
}: {
  trackId: string;
  inputDeviceId: string | null;
}) {
  const updateTrack = useDAW((state) => state.updateTrack);
  const commit = useDAW((state) => state.commit);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        if (active) setDevices(list.filter((device) => device.kind === "audioinput"));
      } catch (error) {
        console.warn("Could not enumerate audio input devices", error);
      }
    };
    void refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => {
      active = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
    };
  }, []);

  return (
    <label className="h-6 pl-1.5 pr-1 inline-flex items-center gap-1.5 rounded-md border border-black/50 bg-[#26262b] max-w-52">
      <Mic size={11} className="text-zinc-500 shrink-0" aria-hidden="true" />
      <span className="text-[9px] text-zinc-500 shrink-0">Input</span>
      <select
        value={inputDeviceId ?? ""}
        onPointerDown={commit}
        onChange={(event) => updateTrack(trackId, { inputDeviceId: event.target.value || null }, false)}
        aria-label="Audio recording input device"
        className="min-w-0 max-w-36 bg-transparent text-[9px] text-zinc-300 outline-none"
      >
        <option value="">Default microphone</option>
        {devices.map((device, index) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || `Audio input ${index + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}
