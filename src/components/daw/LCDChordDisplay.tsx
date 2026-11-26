"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  detectChord,
  midiNoteName,
  suggestKeys,
  type ChordKey,
  type ChordResult,
} from "@/lib/daw/ChordDetector";
import { useDAW } from "@/lib/daw/store";

const ONSET_DEBOUNCE_MS = 75;
const RELEASE_GRACE_MS = 160;

export function LCDChordDisplay({ keySignature }: { keySignature: ChordKey }) {
  const [notes, setNotes] = useState<number[]>([]);
  const [holdLast, setHoldLast] = useState(false);
  const [recent, setRecent] = useState<ChordResult[]>([]);
  const lastProgressionName = useRef("");
  const pending = useRef<number | null>(null);

  useEffect(() => {
    const handleNotes = (event: Event) => {
      const activeNotes = (event as CustomEvent<number[]>).detail;
      if (pending.current !== null) window.clearTimeout(pending.current);
      pending.current = window.setTimeout(
        () => setNotes(activeNotes),
        activeNotes.length ? ONSET_DEBOUNCE_MS : RELEASE_GRACE_MS,
      );
    };
    window.addEventListener("webband:live-notes", handleNotes);
    return () => {
      window.removeEventListener("webband:live-notes", handleNotes);
      if (pending.current !== null) window.clearTimeout(pending.current);
    };
  }, []);

  const currentChord = useMemo(() => detectChord(notes, keySignature), [notes, keySignature]);
  useEffect(() => {
    if (!currentChord) return;
    if (lastProgressionName.current !== currentChord.name) {
      lastProgressionName.current = currentChord.name;
      setRecent((previous) => [...previous, currentChord].slice(-8));
    }
  }, [currentChord]);

  const shownChord = currentChord ?? (holdLast ? recent[recent.length - 1] ?? null : null);
  const suggestions = useMemo(() => suggestKeys(recent), [recent]);
  const displayNotes = notes.length
    ? [...new Set(notes)].sort((a, b) => a - b).slice(0, 7)
    : holdLast && shownChord
      ? shownChord.pitchClasses.map((pitchClass) => {
          const base = Math.floor(shownChord.bassNote / 12) * 12;
          return base + ((pitchClass - (base % 12) + 12) % 12);
        }).slice(0, 7)
      : [];

  const syncScale = (suggestion: (typeof suggestions)[number]) => {
    const ui = useDAW.getState().ui;
    useDAW.getState().setUI({
      keyboardScaleRoot: suggestion.tonic,
      keyboardScaleMode: suggestion.mode,
      keyboardScaleLock: true,
      panels: { ...ui.panels, keyboard: true },
    });
    window.dispatchEvent(new CustomEvent("webband:sync-scale", { detail: suggestion }));
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5" data-testid="lcd-chord">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            title="Live chord and key suggestions"
            aria-label={shownChord ? `Current chord ${shownChord.name}` : "No chord detected"}
            className="min-w-0 truncate text-left font-sans text-[13px] font-semibold tracking-wide text-cyan-100 [text-shadow:0_0_8px_rgba(70,220,255,.55)] hover:text-white"
          >
            {shownChord?.name ?? "--"}
          </button>
        </PopoverTrigger>
        <PopoverContent align="center" className="w-72 border-black/60 bg-[#25262a] p-3 text-zinc-200 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <p className="text-[9px] uppercase tracking-[.16em] text-zinc-500">Chord analysis</p>
              <p className="text-sm font-semibold text-cyan-100">{shownChord?.name ?? "Play a chord"}</p>
            </div>
            <button
              type="button"
              aria-pressed={holdLast}
              onClick={() => setHoldLast((value) => !value)}
              className={`rounded border px-2 py-1 text-[9px] ${holdLast ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-100" : "border-white/10 text-zinc-400"}`}
            >
              Hold Last {holdLast ? "On" : "Off"}
            </button>
          </div>
          <p className="mb-3 text-[10px] text-zinc-500">
            {shownChord ? `Root ${midiNoteName(shownChord.rootNote + 60, keySignature).replace(/\d+$/, "")} · Bass ${midiNoteName(shownChord.bassNote, keySignature)} · ${Math.round(shownChord.confidence * 100)}% fit` : "Notes are briefly grouped to accommodate staggered playing."}
          </p>
          <div className="mb-3 flex flex-wrap gap-1">
            {displayNotes.map((note) => (
              <span key={note} className="rounded border border-cyan-200/10 bg-[#15171a] px-1.5 py-0.5 font-mono text-[9px] text-cyan-100">
                {midiNoteName(note, keySignature)}
              </span>
            ))}
          </div>
          <p className="mb-1 text-[9px] uppercase tracking-wider text-zinc-500">Recent progression</p>
          <p className="mb-2 truncate font-mono text-[10px] text-zinc-300">
            {recent.slice(-8).map((chord) => chord.name).join(" → ") || "--"}
          </p>
          <p className="mb-1 text-[9px] uppercase tracking-wider text-zinc-500">Suggested keys</p>
          <div className="flex gap-1.5">
            {suggestions.map((suggestion) => (
              <button
                type="button"
                key={suggestion.name}
                onClick={() => syncScale(suggestion)}
                className="flex-1 rounded border border-white/10 bg-[#1a1b1e] px-2 py-1.5 text-left text-[10px] hover:border-cyan-300/30 hover:text-cyan-100"
              >
                {suggestion.name}
                <span className="block text-[8px] text-zinc-600">Sync Scale</span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <div className="hidden min-w-0 truncate font-mono text-[8px] text-cyan-100/55 xl:block">
        {displayNotes.map((note) => midiNoteName(note, keySignature)).join(" · ") || "notes"}
      </div>
      <button
        type="button"
        title={holdLast ? "Disable Hold Last Chord" : "Hold Last Chord"}
        aria-label="Toggle hold last chord"
        aria-pressed={holdLast}
        onClick={() => setHoldLast((value) => !value)}
        className={`shrink-0 rounded px-1 text-[8px] ${holdLast ? "text-cyan-100" : "text-zinc-600 hover:text-zinc-300"}`}
      >
        HOLD
      </button>
    </div>
  );
}
