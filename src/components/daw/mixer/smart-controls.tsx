"use client";

// ============================================================
// SmartControls - editor-mode content ("smart") showing the
// selected track's patch knobs, or EQ quick controls for audio
// tracks. Rendered inside the bottom editor panel.
// ============================================================

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Drum, Headphones, Mic, Play, SlidersHorizontal, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { useDAW } from "@/lib/daw/store";
import { PATCHES } from "@/lib/daw/instruments";
import { uid, type KnobDef, type SamplerZone, type Track } from "@/lib/daw/types";
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
        {track.sampleBufferId || (track.sampleZones ?? []).length > 0 ? (
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
      {view === "sound" && <SpatialControls track={track} />}
    </div>
  );
}


function SpatialControls({ track }: { track: Track }) {
  const updateTrack = useDAW((state) => state.updateTrack);
  const commit = useDAW((state) => state.commit);
  const enabled = track.spatialEnabled === true;
  const x = track.spatialX ?? 0;
  const y = track.spatialY ?? 0;
  const z = track.spatialZ ?? -1;

  const update = (patch: Partial<Track>) => updateTrack(track.id, patch, false);

  return (
    <section className="w-full max-w-2xl mx-4 rounded-lg border border-[#60a5fa]/25 bg-[#60a5fa]/[0.05] p-3 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="size-9 shrink-0 rounded-lg bg-[#60a5fa]/10 border border-[#60a5fa]/20 flex items-center justify-center">
          <Headphones size={17} className="text-[#93c5fd]" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-zinc-200">Binaural 3D Position</p>
          <p className="text-[9px] text-zinc-500">HRTF headphone spatialization · stereo output</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => {
            commit();
            update({ spatialEnabled: !enabled });
          }}
          className={`relative h-6 w-11 rounded-full border transition-colors ${enabled ? "bg-[#60a5fa]/30 border-[#60a5fa]/60" : "bg-[#303036] border-black/40"}`}
        >
          <span className={`absolute top-0.5 size-4 rounded-full bg-zinc-100 shadow transition-transform ${enabled ? "translate-x-5" : "translate-x-0.5"}`} />
        </button>
      </div>

      {enabled ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {([
            ["X · Left / Right", "spatialX", x],
            ["Y · Down / Up", "spatialY", y],
            ["Z · Front / Back", "spatialZ", z],
          ] as const).map(([label, key, value]) => (
            <label key={key} className="rounded border border-black/30 bg-[#19191d] px-2.5 py-2 flex flex-col gap-1.5">
              <span className="flex items-center justify-between text-[9px] text-zinc-500">
                <span>{label}</span>
                <span className="font-mono text-zinc-300">{value.toFixed(1)} m</span>
              </span>
              <input
                type="range"
                min={-5}
                max={5}
                step={0.1}
                value={value}
                onPointerDown={commit}
                onChange={(event) => update({ [key]: Number(event.target.value) })}
                aria-label={label}
                className="w-full accent-[#60a5fa]"
              />
            </label>
          ))}
        </div>
      ) : (
        <p className="text-[9px] text-zinc-600">
          Turn this on to place the channel in a 3D headphone field. Ordinary stereo pan remains active while binaural mode is off.
        </p>
      )}
      <p className="text-[9px] leading-relaxed text-zinc-600">
        Uses the browser's HRTF PannerNode to render a binaural stereo impression. Headphones are recommended. This is not Dolby Atmos, multichannel speaker routing, or head tracking.
      </p>
    </section>
  );
}


function QuickSamplerControls({ track }: { track: NonNullable<ReturnType<typeof useDAW.getState>["project"]["tracks"][number]> }) {
  const updateTrack = useDAW((state) => state.updateTrack);
  const commit = useDAW((state) => state.commit);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const drumPadInputRef = useRef<HTMLInputElement>(null);
  const [importingZone, setImportingZone] = useState(false);
  const [selectedPad, setSelectedPad] = useState(36);
  const [newZoneRoot, setNewZoneRoot] = useState(
    Math.min(108, (track.sampleRootPitch ?? 60) + 12 * ((track.sampleZones ?? []).length + 1))
  );
  const sample = track.sampleBufferId ? engine.getStoredBuffer(track.sampleBufferId) : undefined;
  const duration = sample?.channels[0]?.length
    ? sample.channels[0].length / sample.sampleRate
    : 0;
  const rootPitch = track.sampleRootPitch ?? 60;
  const zones = track.sampleZones ?? [];
  const noteName = (pitch: number) => {
    const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
    return `${names[pitch % 12]} ${Math.floor(pitch / 12) - 1}`;
  };

  const drumPads = [
    "Kick", "Side Stick", "Snare", "Hand Clap",
    "Electric Snare", "Low Tom", "Closed Hat", "Floor Tom",
    "Pedal Hat", "Low Tom 2", "Open Hat", "Mid Tom",
    "High-Mid Tom", "Crash Cymbal", "High Tom", "Ride Cymbal",
  ];

  const assignDrumPad = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      toast.error("Choose an audio file for this drum pad");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast.error("Drum pad samples must be 25 MB or smaller");
      return;
    }

    setImportingZone(true);
    try {
      const decoded = await engine.decodeAudioFile(file);
      const sampleDuration = decoded.channels[0]?.length
        ? decoded.channels[0].length / decoded.sampleRate
        : 0;
      if (sampleDuration <= 0 || sampleDuration > 60) {
        toast.error("Drum pad samples must be 60 seconds or shorter");
        return;
      }

      const bufferId = `drum-pad-${uid()}`;
      await engine.storeBuffer(bufferId, decoded);
      const zone: SamplerZone = {
        id: uid(),
        bufferId,
        name: file.name,
        rootPitch: selectedPad,
        lowKey: selectedPad,
        highKey: selectedPad,
        velocityLow: 1,
        velocityHigh: 127,
        playbackMode: "one-shot",
      };
      const current = useDAW.getState().project.tracks.find((item) => item.id === track.id);
      commit();
      const otherZones = (current?.sampleZones ?? []).filter(
        (item) => !(selectedPad >= item.lowKey && selectedPad <= item.highKey)
      );
      useDAW.getState().updateTrack(
        track.id,
        {
          sampleDrumKit: true,
          sampleZones: [...otherZones, zone],
        },
        false
      );
      toast.success(`Assigned ${file.name} to ${drumPads[selectedPad - 36] ?? "drum pad"}`);
    } catch (error) {
      console.error("Drum pad import failed", error);
      toast.error("Could not decode that drum sample. Try WAV, MP3 or OGG.");
    } finally {
      setImportingZone(false);
    }
  };

  const updateZone = (zoneId: string, patch: Partial<SamplerZone>) => {
    const current = useDAW.getState().project.tracks.find((item) => item.id === track.id);
    updateTrack(
      track.id,
      { sampleZones: (current?.sampleZones ?? []).map((zone) => zone.id === zoneId ? { ...zone, ...patch } : zone) },
      false
    );
  };

  const removeZone = (zoneId: string) => {
    commit();
    const current = useDAW.getState().project.tracks.find((item) => item.id === track.id);
    updateTrack(
      track.id,
      { sampleZones: (current?.sampleZones ?? []).filter((zone) => zone.id !== zoneId) },
      false
    );
    toast.success("Sample zone removed");
  };

  const addSampleZone = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      toast.error("Choose an audio file for a sample zone");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast.error("Sample zones must be 25 MB or smaller");
      return;
    }

    setImportingZone(true);
    try {
      const decoded = await engine.decodeAudioFile(file);
      const sampleDuration = decoded.channels[0]?.length
        ? decoded.channels[0].length / decoded.sampleRate
        : 0;
      if (sampleDuration <= 0 || sampleDuration > 60) {
        toast.error("Sample zones must be 60 seconds or shorter");
        return;
      }

      const bufferId = `sampler-zone-${uid()}`;
      await engine.storeBuffer(bufferId, decoded);
      const zone: SamplerZone = {
        id: uid(),
        bufferId,
        name: file.name,
        rootPitch: newZoneRoot,
        lowKey: Math.max(0, newZoneRoot - 5),
        highKey: Math.min(127, newZoneRoot + 5),
        velocityLow: 1,
        velocityHigh: 127,
        playbackMode: track.samplePlaybackMode ?? "one-shot",
      };
      const current = useDAW.getState().project.tracks.find((item) => item.id === track.id);
      commit();
      useDAW.getState().updateTrack(
        track.id,
        { sampleZones: [...(current?.sampleZones ?? []), zone] },
        false
      );
      setNewZoneRoot(Math.min(120, newZoneRoot + 12));
      toast.success(`Added sample zone: ${file.name}`);
    } catch (error) {
      console.error("Sampler zone import failed", error);
      toast.error("Could not decode that sample. Try WAV, MP3 or OGG.");
    } finally {
      setImportingZone(false);
    }
  };

  return (
    <div className="w-full max-w-3xl px-4 flex flex-col gap-4 overflow-y-auto py-2">
      <div className="rounded-lg border border-[#4a90d9]/30 bg-[#4a90d9]/10 p-4 flex items-center gap-3">
        <div className="size-10 rounded-lg bg-[#4a90d9]/15 text-[#9dc8f0] flex items-center justify-center shrink-0">
          <SlidersHorizontal size={19} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold text-zinc-100">{zones.length ? "Multi Sampler" : "Quick Sampler"}</p>
          <p className="text-[10px] text-zinc-400 truncate">{track.sampleName ?? track.name}</p>
          <p className="text-[9px] text-zinc-600 mt-0.5">
            {duration > 0
              ? `${duration.toFixed(2)} seconds · ${sample?.sampleRate.toLocaleString()} Hz`
              : "Sample sources load when the track is played"}
            {zones.length ? ` · ${zones.length} mapped zones` : ""}
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
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Base sample root key</span>
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
          <span className="text-[9px] text-zinc-600">The base recording is played at its original pitch on this key.</span>
        </label>

        <label className="rounded-md border border-black/40 bg-[#232327] p-3 flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Base playback mode</span>
          <select
            value={track.samplePlaybackMode ?? "one-shot"}
            onPointerDown={commit}
            onChange={(event) => updateTrack(track.id, { samplePlaybackMode: event.target.value as "one-shot" | "loop" }, false)}
            className="h-8 rounded border border-black/50 bg-[#17171a] px-2 text-[11px] text-zinc-200 outline-none focus:border-[#4a90d9]/60"
          >
            <option value="one-shot">One-shot · Play sample to the end</option>
            <option value="loop">Loop · Hold while MIDI note is held</option>
          </select>
          <span className="text-[9px] text-zinc-600">Base sample playback behavior.</span>
        </label>
      </div>

      <div className="rounded-lg border border-[#d9b13b]/30 bg-[#d9b13b]/[0.05] p-3 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Drum size={14} className="text-[#e6c16d]" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-zinc-200">Drum Machine Designer</p>
            <p className="text-[9px] text-zinc-600">Load a separate one-shot sample onto each of 16 MIDI pads.</p>
          </div>
          <span className={track.sampleDrumKit ? "text-[8px] text-[#e6c16d]" : "text-[8px] text-zinc-600"}>
            {track.sampleDrumKit ? "KIT MODE ON" : "KIT MODE OFF"}
          </span>
        </div>
        <input
          ref={drumPadInputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={assignDrumPad}
        />
        <div className="grid grid-cols-4 gap-1.5">
          {drumPads.map((padName, index) => {
            const pitch = index + 36;
            const zone = zones.find((item) => pitch >= item.lowKey && pitch <= item.highKey);
            const selected = selectedPad === pitch;
            return (
              <button
                key={pitch}
                type="button"
                onClick={() => {
                  setSelectedPad(pitch);
                  if (zone) engine.auditionNote(track.instrument, pitch, 110, track.params);
                }}
                aria-pressed={selected}
                title={`${padName} · MIDI ${pitch}${zone ? ` · ${zone.name}` : " · Empty"}`}
                className={`min-h-14 rounded-md border p-1.5 text-left flex flex-col justify-between transition-colors ${
                  selected
                    ? "border-[#e6c16d]/65 bg-[#d9b13b]/15"
                    : zone
                      ? "border-[#8fb44a]/35 bg-[#8fb44a]/[0.08] hover:bg-[#8fb44a]/15"
                      : "border-black/40 bg-[#19191d] hover:bg-[#2b2b31]"
                }`}
              >
                <span className="text-[8px] text-zinc-500">PAD {String(index + 1).padStart(2, "0")} · {pitch}</span>
                <span className="text-[9px] font-medium text-zinc-200 truncate w-full">{zone?.name ?? padName}</span>
                <span className={zone ? "text-[8px] text-[#a8cf79]" : "text-[8px] text-zinc-700"}>
                  {zone ? "SAMPLE LOADED" : "EMPTY"}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 text-[9px] text-zinc-500 truncate">
            Selected: {drumPads[selectedPad - 36]} · MIDI {selectedPad}
          </p>
          <button
            type="button"
            disabled={importingZone}
            onClick={() => drumPadInputRef.current?.click()}
            className="h-7 shrink-0 px-2 rounded border border-[#d9b13b]/40 bg-[#d9b13b]/10 text-[9px] text-[#e6c16d] hover:bg-[#d9b13b]/20 disabled:opacity-40 inline-flex items-center gap-1"
          >
            <Upload size={10} /> {importingZone ? "Loading…" : "Assign Sample"}
          </button>
        </div>
        <p className="text-[9px] text-zinc-600">
          Each pad is mapped to one MIDI note, uses full velocity range and plays as a one-shot. The custom kit is available in the Drum Step Sequencer.
        </p>
      </div>

      <div className="rounded-lg border border-black/40 bg-[#202024] p-3 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold text-zinc-200">Sample Zones</p>
            <p className="text-[9px] text-zinc-600">Map different recordings to specific keyboard ranges and velocity layers.</p>
          </div>
          <input ref={fileInputRef} type="file" accept="audio/*" className="hidden" onChange={addSampleZone} />
          <div className="flex items-center gap-1.5">
            <select
              value={newZoneRoot}
              onChange={(event) => setNewZoneRoot(Number(event.target.value))}
              aria-label="New sample zone root key"
              className="h-7 max-w-20 rounded border border-black/50 bg-[#17171a] px-1.5 text-[9px] text-zinc-200"
            >
              {Array.from({ length: 73 }, (_, index) => index + 24).map((pitch) => (
                <option key={pitch} value={pitch}>{noteName(pitch)}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={importingZone}
              onClick={() => fileInputRef.current?.click()}
              className="h-7 px-2 rounded border border-[#4a90d9]/35 bg-[#4a90d9]/10 text-[9px] text-[#a9d1f6] hover:bg-[#4a90d9]/20 disabled:opacity-40 inline-flex items-center gap-1"
            >
              <Upload size={10} /> {importingZone ? "Loading…" : "Add Sample"}
            </button>
          </div>
        </div>

        {zones.length === 0 ? (
          <p className="rounded border border-dashed border-[#3c3c43] p-3 text-[9px] text-zinc-600 text-center">
            No extra zones yet. Import another recording and assign its root key to build a multi-sampled instrument or drum kit.
          </p>
        ) : (
          <div className="space-y-1.5">
            {zones.map((zone) => (
              <div key={zone.id} className="grid grid-cols-[minmax(110px,1fr)_62px_52px_52px_48px_48px_66px_26px] gap-1.5 items-center rounded border border-black/30 bg-[#19191d] p-2">
                <span className="truncate text-[9px] text-zinc-300" title={zone.name}>{zone.name}</span>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[8px] text-zinc-600">Root</span>
                  <select
                    value={zone.rootPitch}
                    onPointerDown={commit}
                    onChange={(event) => updateZone(zone.id, { rootPitch: Number(event.target.value) })}
                    className="h-6 w-full rounded bg-[#2a2a30] px-1 text-[9px] text-zinc-200"
                  >
                    {Array.from({ length: 73 }, (_, index) => index + 24).map((pitch) => (
                      <option key={pitch} value={pitch}>{noteName(pitch)}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[8px] text-zinc-600">Key Lo</span>
                  <input
                    type="number" min={0} max={127} value={zone.lowKey}
                    onPointerDown={commit}
                    onChange={(event) => updateZone(zone.id, { lowKey: Math.min(zone.highKey, Math.max(0, Math.min(127, Number(event.target.value)))) })}
                    className="h-6 w-full rounded bg-[#2a2a30] px-1 text-[9px] text-zinc-200"
                    aria-label={`${zone.name} low key`}
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[8px] text-zinc-600">Key Hi</span>
                  <input
                    type="number" min={0} max={127} value={zone.highKey}
                    onPointerDown={commit}
                    onChange={(event) => updateZone(zone.id, { highKey: Math.max(zone.lowKey, Math.max(0, Math.min(127, Number(event.target.value)))) })}
                    className="h-6 w-full rounded bg-[#2a2a30] px-1 text-[9px] text-zinc-200"
                    aria-label={`${zone.name} high key`}
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[8px] text-zinc-600">Vel Lo</span>
                  <input
                    type="number" min={1} max={127} value={zone.velocityLow}
                    onPointerDown={commit}
                    onChange={(event) => updateZone(zone.id, { velocityLow: Math.min(zone.velocityHigh, Math.max(1, Math.min(127, Number(event.target.value)))) })}
                    className="h-6 w-full rounded bg-[#2a2a30] px-1 text-[9px] text-zinc-200"
                    aria-label={`${zone.name} low velocity`}
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[8px] text-zinc-600">Vel Hi</span>
                  <input
                    type="number" min={1} max={127} value={zone.velocityHigh}
                    onPointerDown={commit}
                    onChange={(event) => updateZone(zone.id, { velocityHigh: Math.max(zone.velocityLow, Math.max(1, Math.min(127, Number(event.target.value)))) })}
                    className="h-6 w-full rounded bg-[#2a2a30] px-1 text-[9px] text-zinc-200"
                    aria-label={`${zone.name} high velocity`}
                  />
                </label>
                <select
                  value={zone.playbackMode}
                  onPointerDown={commit}
                  onChange={(event) => updateZone(zone.id, { playbackMode: event.target.value as "one-shot" | "loop" })}
                  aria-label={`${zone.name} playback mode`}
                  className="h-6 w-full rounded bg-[#2a2a30] px-1 text-[8px] text-zinc-200"
                >
                  <option value="one-shot">One-shot</option>
                  <option value="loop">Loop</option>
                </select>
                <button
                  type="button"
                  onClick={() => removeZone(zone.id)}
                  title="Remove sample zone"
                  aria-label={`Remove ${zone.name} sample zone`}
                  className="h-6 w-6 rounded text-zinc-600 hover:text-red-300 hover:bg-white/5"
                >
                  <Trash2 size={11} className="mx-auto" />
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="text-[9px] text-zinc-600">
          Narrower key zones take priority over wider zones. Edit key and velocity ranges to build velocity layers, and choose one-shot or loop behavior per sample. Set Key Lo and Key Hi to the same note to create a one-key drum pad.
        </p>
      </div>
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
