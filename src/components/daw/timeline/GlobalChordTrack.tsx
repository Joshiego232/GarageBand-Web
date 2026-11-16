"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Music2 } from "lucide-react";
import { useDAW } from "@/lib/daw/store";
import { detectChord, suggestKeys } from "@/lib/daw/ChordDetector";
import { engine } from "@/lib/daw/engine";
import { uid, type ChordRegion } from "@/lib/daw/types";

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

  return (
    <div className="flex h-[34px] shrink-0 border-b border-black/70 bg-[#191a1e]">
      <div className="flex w-[212px] shrink-0 items-center gap-1 border-r border-black/60 bg-[#202126] px-2">
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
            {chordRegions.map((chord) => (
              <button
                type="button"
                key={chord.id}
                title={`${chord.name} · click to audition`}
                onClick={() => audition(chord)}
                className="absolute top-[4px] h-[25px] min-w-[35px] overflow-hidden rounded border border-cyan-200/20 bg-gradient-to-b from-[#245c69] to-[#173940] px-2 text-left font-mono text-[10px] font-semibold text-cyan-50 shadow-[inset_0_1px_rgba(255,255,255,.13),0_1px_3px_rgba(0,0,0,.5)] hover:brightness-125"
                style={{
                  left: chord.start * pxPerTick,
                  width: Math.max(35, chord.length * pxPerTick - 2),
                }}
              >
                {chord.name}
              </button>
            ))}
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
