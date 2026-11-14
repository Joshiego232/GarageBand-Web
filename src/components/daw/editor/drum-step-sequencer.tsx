"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Drum, Music2 } from "lucide-react";
import { useDAW } from "@/lib/daw/store";
import { engine } from "@/lib/daw/engine";
import type { Note } from "@/lib/daw/types";
import { barTicks, noteName } from "@/lib/daw/utils";
import { PATCHES } from "@/lib/daw/instruments";
import { findActiveRegion } from "./piano-roll";

const DRUM_VOICES = [
  { label: "Kick", pitch: 36, color: "bg-orange-400" },
  { label: "Snare", pitch: 38, color: "bg-rose-400" },
  { label: "Closed hat", pitch: 42, color: "bg-cyan-400" },
  { label: "Open hat", pitch: 46, color: "bg-sky-400" },
  { label: "Clap", pitch: 39, color: "bg-violet-400" },
  { label: "Rim", pitch: 37, color: "bg-amber-300" },
  { label: "Low tom", pitch: 45, color: "bg-emerald-400" },
  { label: "Crash", pitch: 49, color: "bg-fuchsia-400" },
] as const;

export function DrumStepSequencer() {
  const found = useDAW((s) => findActiveRegion(s.project, s.ui.editorRegionId, s.ui.selectedRegionIds, s.ui.selectedTrackId));
  const region = found?.region ?? null;
  const track = found?.track ?? null;
  const tempo = useDAW((s) => s.project.tempo);
  const timeSig = useDAW((s) => s.project.timeSig);
  const addNote = useDAW((s) => s.addNote);
  const removeNotes = useDAW((s) => s.removeNotes);
  const [barSelection, setBarSelection] = useState<{ regionId: string | null; index: number }>({
    regionId: null,
    index: 0,
  });
  const barIndex = barSelection.regionId === region?.id ? barSelection.index : 0;
  const setBarIndex = (index: number) =>
    setBarSelection({ regionId: region?.id ?? null, index });

  const isDrumTrack = !!track && !!PATCHES[track.instrument]?.isDrum;
  const keyTonic = useDAW((s) => s.project.keyTonic);
  const keyMode = useDAW((s) => s.project.keyMode);
  const ticksPerBar = barTicks(timeSig);
  const stepTicks = ticksPerBar / 16;
  const bars = Math.max(1, Math.ceil((region?.length ?? ticksPerBar) / ticksPerBar));
  const notes = region?.notes ?? [];
  const voices = (() => {
    if (isDrumTrack) return DRUM_VOICES;
    const intervals = keyMode === "major"
      ? [0, 2, 4, 5, 7, 9, 11, 12]
      : [0, 2, 3, 5, 7, 8, 10, 12];
    const base = 48 + keyTonic;
    const scalePitches = intervals.map((interval) => base + interval);
    const existingPitches = notes.map((note) => note.pitch);
    const pitches = [...new Set([...scalePitches, ...existingPitches])]
      .sort((a, b) => b - a)
      .slice(0, 16);
    const colors = [
      "bg-cyan-400", "bg-sky-400", "bg-indigo-400", "bg-violet-400",
      "bg-fuchsia-400", "bg-rose-400", "bg-amber-300", "bg-emerald-400",
    ];
    return pitches.map((pitch, index) => ({
      label: noteName(pitch),
      pitch,
      color: colors[index % colors.length],
    }));
  })();
  const active = new Map<string, Note>();
  const rawOffset = barIndex * ticksPerBar;
  const offset = region?.looped && region.coreLength ? rawOffset % region.coreLength : rawOffset;
  for (const voice of voices) {
    for (const note of notes) {
      if (
        note.pitch === voice.pitch &&
        Math.abs(note.start - offset - Math.round((note.start - offset) / stepTicks) * stepTicks) < 12
      ) {
        const step = Math.round((note.start - offset) / stepTicks);
        if (step >= 0 && step < 16) active.set(`${voice.pitch}:${step}`, note);
      }
    }
  }

  if (!region || !track || region.type !== "midi") {
    return <div className="flex-1 grid place-items-center text-xs text-zinc-600">Select a MIDI drum region to edit its steps</div>;
  }

  const toggleStep = (pitch: number, step: number) => {
    const rawOffset = barIndex * ticksPerBar;
    const offset = region.looped && region.coreLength ? rawOffset % region.coreLength : rawOffset;
    const start = offset + step * stepTicks;
    const match = notes.find((n) => n.pitch === pitch && Math.abs(n.start - start) < 12);
    if (match) {
      removeNotes(region.id, [match.id]);
      return;
    }
    addNote(region.id, { pitch, velocity: 105, start, length: Math.max(60, Math.round(stepTicks * 0.88)) });
    engine.auditionNote(track.instrument, pitch, 105);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#1a1a1d]">
      <div className="flex items-center gap-2 px-3 h-9 shrink-0 border-b border-black/40">
        {isDrumTrack ? <Drum className="size-3.5 text-zinc-400" /> : <Music2 className="size-3.5 text-zinc-400" />}
        <span className="text-[11px] font-medium text-zinc-300">
          {isDrumTrack ? "16-step drum sequencer" : "16-step melodic sequencer"}
        </span>
        <span className="text-[10px] text-zinc-600">{tempo} BPM · {timeSig.join("/")}</span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" className="p-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30" onClick={() => setBarIndex(Math.max(0, barIndex - 1))} disabled={barIndex === 0} aria-label="Previous bar"><ChevronLeft className="size-3.5" /></button>
          <span className="text-[10px] tabular-nums text-zinc-400">Bar {barIndex + 1} / {bars}</span>
          <button type="button" className="p-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30" onClick={() => setBarIndex(Math.min(bars - 1, barIndex + 1))} disabled={barIndex >= bars - 1} aria-label="Next bar"><ChevronRight className="size-3.5" /></button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-3">
        <div className="min-w-[620px] space-y-1.5">
          <div className="grid grid-cols-[92px_repeat(16,minmax(0,1fr))] gap-1 items-center mb-2">
            <span className="text-[9px] uppercase tracking-wider text-zinc-600">Instrument</span>
            {Array.from({ length: 16 }, (_, i) => <span key={i} className={`text-center text-[9px] tabular-nums ${i % 4 === 0 ? "text-zinc-300" : "text-zinc-600"}`}>{i + 1}</span>)}
          </div>
          {voices.map((voice) => (
            <div key={voice.pitch} className="grid grid-cols-[92px_repeat(16,minmax(0,1fr))] gap-1 items-center">
              <span className="text-[10px] text-zinc-400 truncate pr-2">{voice.label}</span>
              {Array.from({ length: 16 }, (_, step) => {
                const note = active.get(`${voice.pitch}:${step}`);
                return (
                  <button
                    key={step}
                    type="button"
                    aria-label={`${voice.label}, step ${step + 1}${note ? ", active" : ", inactive"}`}
                    aria-pressed={!!note}
                    onClick={() => toggleStep(voice.pitch, step)}
                    className={`h-7 rounded-[3px] border transition-colors ${note ? `${voice.color} border-white/20 shadow-[0_0_8px_rgba(255,255,255,0.08)]` : step % 4 === 0 ? "bg-[#303036] border-[#46464d] hover:bg-[#404047]" : "bg-[#242428] border-[#34343a] hover:bg-[#38383f]"}`}
                  />
                );
              })}
            </div>
          ))}
          <p className="pt-2 text-[9px] text-zinc-600">
            Each column is a sixteenth note. Click a cell to toggle a step. {isDrumTrack ? "Drum rows use the standard kit note map." : `Melodic rows follow the ${keyMode} scale in ${noteName(48 + keyTonic)} and include pitches already in the region.`} Steps are regular MIDI notes, so they appear in the piano roll and WAV export.
          </p>
        </div>
      </div>
    </div>
  );
}
