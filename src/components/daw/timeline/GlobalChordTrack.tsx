"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Layers2, Music2, Plus } from "lucide-react";
import { useDAW } from "@/lib/daw/store";
import { analyzeMidiRegionsByTiming, detectChord, suggestKeys } from "@/lib/daw/ChordDetector";
import { engine } from "@/lib/daw/engine";
import { uid, type ChordRegion } from "@/lib/daw/types";
import { toast } from "sonner";
import { mixHex } from "@/lib/daw/colors";
import { PATCHES } from "@/lib/daw/instruments";

export function GlobalChordTrack({
  scrollX,
  pxPerTick,
  contentW,
  ticksPerBar,
}: {
  scrollX: number;
  pxPerTick: number;
  contentW: number;
  ticksPerBar: number;
}) {
  const project = useDAW((state) => state.project);
  const setChordRegions = useDAW((state) => state.setChordRegions);
  const [expanded, setExpanded] = useState(true);
  const chordRegions = project.chordRegions ?? [];
  const key = { tonic: project.keyTonic, mode: project.keyMode };
  const suggestions = useMemo(
    () => suggestKeys(chordRegions.map((region) => detectChord(region.notes, key)).filter((chord) => chord !== null)),
    [chordRegions, project.keyMode, project.keyTonic],
  );

  const syncToKeyboard = () => {
    const ui = useDAW.getState().ui;
    const strips = chordRegions.slice(0, 8).map((region) => ({
      name: region.name,
      notes: [...new Set(region.notes)].sort((a, b) => a - b),
    }));
    useDAW.getState().setUI({
      keyboardChordStrips: strips,
      panels: { ...ui.panels, keyboard: true },
    });
    window.dispatchEvent(new CustomEvent("webband:load-chord-strips", {
      detail: strips,
    }));
  };

  const syncScale = () => {
    const suggestion = suggestions[0];
    if (!suggestion) return;
    const ui = useDAW.getState().ui;
    useDAW.getState().setUI({
      keyboardScaleRoot: suggestion.tonic,
      keyboardScaleMode: suggestion.mode,
      keyboardScaleLock: true,
      panels: { ...ui.panels, keyboard: true },
    });
    window.dispatchEvent(new CustomEvent("webband:sync-scale", { detail: suggestion }));
  };

  const audition = (chord: ChordRegion) => {
    const pitches = [...new Set(chord.notes)].sort((a, b) => a - b).slice(0, 8);
    pitches.forEach((pitch) => engine.noteOn(pitch, 88));
    window.setTimeout(() => pitches.forEach((pitch) => engine.noteOff(pitch)), 550);
  };

  const clearTrack = () => setChordRegions([]);

  const analyzeArrangement = () => {
    const tracks = project.tracks;
    const hasSolo = tracks.some((track) => track.solo);
    const regions = tracks
      .filter((track) =>
        track.type === "midi" && !PATCHES[track.instrument]?.isDrum &&
        track.role !== "aux" && track.role !== "vca" && track.role !== "folder" &&
        !track.mute && (!hasSolo || track.solo),
      )
      .flatMap((track) => track.regions
        .filter((region) => region.type === "midi" && !region.muted && region.notes?.length)
        .map((region) => ({
          start: region.start,
          length: region.length,
          notes: region.notes,
          muted: region.muted,
          looped: region.looped,
          coreLength: region.coreLength,
          trackId: track.id,
        })));
    if (!regions.length) {
      toast.error("No audible MIDI regions are available to analyze.");
      return;
    }

    const extracted = analyzeMidiRegionsByTiming(regions, key);
    if (!extracted.length) {
      toast.error("No chords could be identified across the MIDI regions.");
      return;
    }
    setChordRegions(extracted.map((chord) => ({ ...chord, id: uid() })));
    toast.success(`Analyzed ${regions.length} MIDI region${regions.length === 1 ? "" : "s"} and found ${extracted.length} chord${extracted.length === 1 ? "" : "s"}.`);
  };

  const createMidiTrack = () => {
    if (!chordRegions.length) return;
    const trackId = uid();
    const trackName = "Chord Progression";
    const trackColor = chordRegions[0].color ?? detectChord(chordRegions[0].notes, key)?.color ?? "#28B463";
    const regions = chordRegions
      .filter((chord) => chord.length > 0 && chord.notes.length > 0)
      .map((chord) => ({
        id: uid(),
        trackId,
        type: "midi" as const,
        name: chord.name,
        start: chord.start,
        length: chord.length,
        color: chord.color ?? detectChord(chord.notes, key)?.color ?? trackColor,
        notes: [...new Set(chord.notes)]
          .filter((pitch) => Number.isInteger(pitch) && pitch >= 0 && pitch <= 127)
          .map((pitch) => ({
            id: uid(),
            pitch,
            velocity: 90,
            start: 0,
            length: chord.length,
          })),
      }));
    if (!regions.length) return;

    const state = useDAW.getState();
    state.addTrack({
      id: trackId,
      type: "midi",
      name: trackName,
      instrument: "grand-piano",
      color: trackColor,
    });
    useDAW.getState().addRegions(regions);
    toast.success(`Created "${trackName}" with ${regions.length} MIDI chord region${regions.length === 1 ? "" : "s"}`);
  };

  return (
    <div className="flex h-[34px] shrink-0 border-b border-black/70 bg-[#191a1e]">
      <div className="sticky left-0 z-30 flex w-[260px] shrink-0 items-center gap-1 border-r border-black/60 bg-[#202126] px-2 shadow-[4px_0_12px_rgba(0,0,0,0.45)]">
        <button
          type="button"
          aria-label={expanded ? "Collapse Global Tracks" : "Expand Global Tracks"}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="flex size-4 items-center justify-center text-zinc-500 hover:text-zinc-200"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <Music2 size={12} className="text-cyan-300/80" />
        <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-300">Chord Track</span>
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            title="Analyze audible MIDI regions and align basic chords to MIDI note timing"
            onClick={analyzeArrangement}
            className="flex items-center gap-0.5 rounded border border-white/10 px-1 py-0.5 text-[8px] text-zinc-400 hover:text-violet-100"
          >
            <Layers2 size={9} />
            All
          </button>
          <button
            type="button"
            title={suggestions[0] ? `Sync keyboard scale to ${suggestions[0].name}` : "Analyze chords to suggest a scale"}
            disabled={!suggestions.length}
            onClick={syncScale}
            className="rounded border border-white/10 px-1 py-0.5 text-[8px] text-zinc-400 hover:text-cyan-100 disabled:opacity-30"
          >
            Scale
          </button>
          <button
            type="button"
            title="Load progression into the on-screen keyboard chord strips"
            disabled={!chordRegions.length}
            onClick={syncToKeyboard}
            className="rounded border border-white/10 px-1 py-0.5 text-[8px] text-zinc-400 hover:text-cyan-100 disabled:opacity-30"
          >
            Sync
          </button>
          <button
            type="button"
            title="Create a MIDI instrument track from the chord regions"
            disabled={!chordRegions.length}
            onClick={createMidiTrack}
            className="flex items-center gap-0.5 rounded border border-white/10 px-1 py-0.5 text-[8px] text-zinc-400 hover:text-emerald-100 disabled:opacity-30"
          >
            <Plus size={9} />
            Track
          </button>
          {chordRegions.length > 0 && (
            <button type="button" title="Clear chord track" onClick={clearTrack} className="px-0.5 text-[9px] text-zinc-600 hover:text-red-300">×</button>
          )}
        </div>
      </div>
      <div className="relative min-w-0 flex-1 overflow-hidden bg-[#17181b]">
        {expanded && (
          <div className="absolute inset-y-0" style={{ width: contentW, transform: `translateX(${-scrollX}px)` }}>
            {Array.from({ length: Math.ceil(contentW / (ticksPerBar * pxPerTick)) }, (_, bar) => (
              <span
                key={bar}
                aria-hidden="true"
                className="absolute inset-y-0 border-l border-white/[.035]"
                style={{ left: bar * ticksPerBar * pxPerTick }}
              />
            ))}
            {chordRegions.map((chord) => {
              const color = chord.color ?? detectChord(chord.notes, key)?.color ?? "#168C8C";
              return (
                <button
                  type="button"
                  key={chord.id}
                  title={`${chord.name} · click to audition · ${chord.length} ticks`}
                  onClick={() => audition(chord)}
                  className="absolute top-[4px] h-[25px] min-w-[35px] overflow-hidden rounded border px-2 text-left font-mono text-[10px] font-semibold text-white shadow-[inset_0_1px_rgba(255,255,255,.13),0_1px_3px_rgba(0,0,0,.5)] hover:brightness-125"
                  style={{
                    left: chord.start * pxPerTick,
                    width: Math.max(35, chord.length * pxPerTick - 2),
                    background: `linear-gradient(180deg, ${color}, ${mixHex(color, "#111318", 0.4)})`,
                    borderColor: mixHex(color, "#ffffff", 0.24),
                  }}
                >
                  {chord.name}
                </button>
              );
            })}
          </div>
        )}
        {!expanded && <div className="h-full" />}
      </div>
    </div>
  );
}

export function extractChordRegions(
  existing: ChordRegion[],
  extracted: Omit<ChordRegion, "id">[],
  sourceRegionId: string,
): ChordRegion[] {
  return [
    ...existing.filter((chord) => chord.sourceRegionId !== sourceRegionId),
    ...extracted.map((chord) => ({ ...chord, id: uid(), sourceRegionId })),
  ];
}
