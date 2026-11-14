"use client";

// ============================================================
// OnscreenKeyboard: GarageBand-style musical typing keyboard.
// Two octaves of clickable keys (with mouse / touch glissando),
// octave stepper, velocity slider and typing on/off toggle.
// ============================================================

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { motion } from "framer-motion";
import { Info, Minus, Plus, X } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { engine } from "@/lib/daw/engine";
import { SEMITONE_TO_KEY } from "@/lib/daw/input";
import { PATCHES } from "@/lib/daw/instruments";
import { useDAW } from "@/lib/daw/store";
import { isBlackKey, noteName } from "@/lib/daw/utils";
import { cn } from "@/lib/utils";

const WHITE_KEY_COUNT = 15; // two octaves C..C inclusive

export function OnscreenKeyboard() {
  const open = useDAW((s) => s.ui.panels.keyboard);
  const octaveBase = useDAW((s) => s.ui.octaveBase);
  const velocity = useDAW((s) => s.ui.velocity);
  const musicalTyping = useDAW((s) => s.ui.musicalTyping);
  const setUI = useDAW((s) => s.setUI);
  const togglePanel = useDAW((s) => s.togglePanel);
  const selectedTrack = useDAW(
    (s) => s.project.tracks.find((t) => t.id === s.ui.selectedTrackId) ?? null
  );

  const [pressed, setPressed] = useState<number[]>([]);
  const pointerNotes = useRef(new Map<number, number>());

  const noteOn = useCallback((pitch: number) => {
    engine.noteOn(pitch, useDAW.getState().ui.velocity);
    setPressed((prev) => (prev.includes(pitch) ? prev : [...prev, pitch]));
  }, []);

  const noteOff = useCallback((pitch: number) => {
    engine.noteOff(pitch);
    setPressed((prev) => (prev.includes(pitch) ? prev.filter((p) => p !== pitch) : prev));
  }, []);

  // Safety net: release every note when a pointer is lifted anywhere
  // (pointerup may land outside the key that started the note) and on unmount.
  useEffect(() => {
    const releasePointer = (e: PointerEvent) => {
      const pitch = pointerNotes.current.get(e.pointerId);
      pointerNotes.current.delete(e.pointerId);
      if (pitch !== undefined) noteOff(pitch);
    };
    const releaseAll = () => {
      if (pointerNotes.current.size === 0) return;
      const pitches = [...pointerNotes.current.values()];
      pointerNotes.current.clear();
      for (const p of pitches) noteOff(p);
    };
    window.addEventListener("pointerup", releasePointer);
    window.addEventListener("pointercancel", releasePointer);
    return () => {
      window.removeEventListener("pointerup", releasePointer);
      window.removeEventListener("pointercancel", releasePointer);
      releaseAll();
    };
  }, [noteOff]);

  // ---- geometry: 2 octaves starting at C(octaveBase) ----
  const startPitch = (octaveBase + 1) * 12;
  const whites: number[] = [];
  for (let p = startPitch; p <= startPitch + 24; p++) {
    if (!isBlackKey(p)) whites.push(p);
  }
  const blacks = whites
    .map((p, i) => ({ pitch: p + 1, after: i }))
    .filter((b) => isBlackKey(b.pitch) && b.pitch <= startPitch + 24);

  // Computer-key labels only on the first octave (GarageBand behavior)
  const keyCharFor = useCallback(
    (pitch: number): string | null => {
      const offset = pitch - startPitch;
      if (offset < 0 || offset > 11) return null;
      const key = SEMITONE_TO_KEY[offset];
      return key ? key.toUpperCase() : null;
    },
    [startPitch]
  );

  // ---- pointer interaction with glissando ----
  const handleDown = (e: ReactPointerEvent<HTMLButtonElement>, pitch: number) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    // Release implicit touch capture so pointerenter fires on sibling keys (touch glissando)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    pointerNotes.current.set(e.pointerId, pitch);
    noteOn(pitch);
  };

  const handleEnter = (e: ReactPointerEvent<HTMLButtonElement>, pitch: number) => {
    if ((e.buttons & 1) !== 1) return; // only glissando while the button is held
    const prev = pointerNotes.current.get(e.pointerId);
    if (prev === pitch) return;
    if (prev !== undefined) noteOff(prev);
    pointerNotes.current.set(e.pointerId, pitch);
    noteOn(pitch);
  };

  const handleLeave = (e: ReactPointerEvent<HTMLButtonElement>, pitch: number) => {
    if (pointerNotes.current.get(e.pointerId) === pitch) {
      pointerNotes.current.delete(e.pointerId);
    }
    noteOff(pitch);
  };

  const handleUp = (e: ReactPointerEvent<HTMLButtonElement>, pitch: number) => {
    const current = pointerNotes.current.get(e.pointerId);
    pointerNotes.current.delete(e.pointerId);
    noteOff(current ?? pitch);
  };

  if (!open) return null;

  const isMidi = selectedTrack?.type === "midi";
  const instrumentName =
    isMidi && selectedTrack ? (PATCHES[selectedTrack.instrument]?.name ?? selectedTrack.name) : null;

  return (
    <div className="pointer-events-none fixed bottom-7 left-0 right-0 z-40 flex justify-center">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="pointer-events-auto max-w-[calc(100vw-1rem)] rounded-t-xl border border-black/60 bg-[#232327]/95 px-4 pt-2 pb-3 shadow-2xl backdrop-blur"
      >
        {/* Header row */}
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-200">
              Musical Typing
            </span>
            {instrumentName && (
              <span className="flex min-w-0 items-center gap-1.5 text-[10px] text-zinc-500">
                <span
                  className="size-2 shrink-0 rounded-full border border-black/40"
                  style={{ backgroundColor: selectedTrack?.color }}
                />
                <span className="max-w-44 truncate">{instrumentName}</span>
              </span>
            )}
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {/* Octave stepper */}
            <div className="flex items-center gap-1">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
                Octave
              </span>
              <button
                type="button"
                aria-label="Octave down"
                disabled={octaveBase <= 0}
                onClick={() => setUI({ octaveBase: Math.max(0, octaveBase - 1) })}
                className="flex size-7 items-center justify-center rounded border border-black/50 bg-[#2f2f34] text-zinc-300 transition-colors hover:bg-[#3a3a41] disabled:opacity-40 disabled:hover:bg-[#2f2f34]"
              >
                <Minus className="size-3" />
              </button>
              <span className="w-[4.6rem] text-center font-mono text-[10px] text-zinc-300">
                C{octaveBase}–F{octaveBase + 1}
              </span>
              <button
                type="button"
                aria-label="Octave up"
                disabled={octaveBase >= 7}
                onClick={() => setUI({ octaveBase: Math.min(7, octaveBase + 1) })}
                className="flex size-7 items-center justify-center rounded border border-black/50 bg-[#2f2f34] text-zinc-300 transition-colors hover:bg-[#3a3a41] disabled:opacity-40 disabled:hover:bg-[#2f2f34]"
              >
                <Plus className="size-3" />
              </button>
            </div>

            {/* Velocity slider */}
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
                Velocity
              </span>
              <Slider
                value={[velocity]}
                min={16}
                max={127}
                step={1}
                onValueChange={(v) => setUI({ velocity: v[0] ?? velocity })}
                aria-label="Musical typing velocity"
                className="w-24 [&_[data-slot=slider-range]]:bg-[#ffb648] [&_[data-slot=slider-thumb]]:border-[#ffb648]/70 [&_[data-slot=slider-thumb]]:bg-[#2f2f34] [&_[data-slot=slider-track]]:bg-black/60"
              />
              <span className="w-6 text-right font-mono text-[10px] text-zinc-400">{velocity}</span>
            </div>

            {/* Typing on/off */}
            <label
              className="flex cursor-pointer select-none items-center gap-1.5"
              title="Play notes from the computer keyboard"
            >
              <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
                Typing
              </span>
              <Switch
                checked={musicalTyping}
                onCheckedChange={(v) => setUI({ musicalTyping: v })}
                aria-label="Toggle musical typing"
                className="data-[state=checked]:bg-[#ffb648] [&[data-state=checked]_[data-slot=switch-thumb]]:bg-[#231303]"
              />
            </label>

            <button
              type="button"
              aria-label="Close musical typing keyboard"
              onClick={() => togglePanel("keyboard")}
              className="rounded p-1 text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>

        {/* Hint when the selected track can't play MIDI */}
        {!isMidi && (
          <div className="mb-2 flex items-center gap-1.5 rounded-md border border-black/50 bg-[#1d1d20] px-2.5 py-1 text-[11px] text-amber-200/70">
            <Info className="size-3 shrink-0 text-[#ffb648]" />
            Select a software instrument track to play
          </div>
        )}

        {/* Keys */}
        <div className="[scrollbar-color:#4a4a52_transparent] [scrollbar-width:thin] max-w-full overflow-x-auto pb-0.5">
          <div className="relative flex w-fit touch-none select-none">
            {whites.map((pitch) => {
              const isPressed = pressed.includes(pitch);
              const keyChar = musicalTyping ? keyCharFor(pitch) : null;
              return (
                <button
                  key={pitch}
                  type="button"
                  aria-label={`Play ${noteName(pitch)}`}
                  aria-pressed={isPressed}
                  onPointerDown={(e) => handleDown(e, pitch)}
                  onPointerEnter={(e) => handleEnter(e, pitch)}
                  onPointerLeave={(e) => handleLeave(e, pitch)}
                  onPointerUp={(e) => handleUp(e, pitch)}
                  onPointerCancel={(e) => handleUp(e, pitch)}
                  className={cn(
                    "relative h-24 w-10 shrink-0 rounded-b border border-black/40 outline-none focus-visible:ring-2 focus-visible:ring-[#ffb648]/60 sm:w-12",
                    isPressed
                      ? "translate-y-[1px] bg-gradient-to-b from-[#ffe0a8] to-[#ffbe62] shadow-[inset_0_2px_6px_rgba(120,70,0,0.35)]"
                      : "bg-gradient-to-b from-[#fafafa] to-[#d8d8dc] shadow-[inset_0_-3px_5px_rgba(0,0,0,0.08)]"
                  )}
                >
                  <span className="pointer-events-none absolute inset-x-0 bottom-1 flex flex-col items-center gap-[3px]">
                    {keyChar && (
                      <span className="flex h-[15px] min-w-[15px] items-center justify-center rounded border border-black/50 bg-[#2f2f34] px-[3px] font-mono text-[9px] leading-none text-zinc-300 shadow-sm">
                        {keyChar}
                      </span>
                    )}
                    <span
                      className={cn(
                        "text-[9px] font-medium leading-none",
                        isPressed ? "text-zinc-700" : "text-zinc-500"
                      )}
                    >
                      {noteName(pitch)}
                    </span>
                  </span>
                </button>
              );
            })}
            {blacks.map(({ pitch, after }) => {
              const isPressed = pressed.includes(pitch);
              const keyChar = musicalTyping ? keyCharFor(pitch) : null;
              return (
                <button
                  key={pitch}
                  type="button"
                  aria-label={`Play ${noteName(pitch)}`}
                  aria-pressed={isPressed}
                  onPointerDown={(e) => handleDown(e, pitch)}
                  onPointerEnter={(e) => handleEnter(e, pitch)}
                  onPointerLeave={(e) => handleLeave(e, pitch)}
                  onPointerUp={(e) => handleUp(e, pitch)}
                  onPointerCancel={(e) => handleUp(e, pitch)}
                  style={{ left: `${((after + 1) / WHITE_KEY_COUNT) * 100}%` }}
                  className={cn(
                    "absolute top-0 z-10 h-15 w-7 -translate-x-1/2 rounded-b border border-black/60 outline-none focus-visible:ring-2 focus-visible:ring-[#ffb648]/60",
                    isPressed
                      ? "translate-y-[1px] bg-gradient-to-b from-[#8a6a2c] to-[#4a3812] shadow-[inset_0_1px_0_rgba(255,214,140,0.4)]"
                      : "bg-[#17171a] shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]"
                  )}
                >
                  <span className="pointer-events-none absolute inset-x-0 bottom-[3px] flex flex-col items-center gap-[2px]">
                    {keyChar && (
                      <span className="font-mono text-[9px] leading-none text-[#ffb648]">
                        {keyChar}
                      </span>
                    )}
                    <span className="whitespace-nowrap text-[9px] leading-none text-zinc-500">
                      {noteName(pitch)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
