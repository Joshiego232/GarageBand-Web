"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { motion } from "framer-motion";
import {
  AudioLines,
  Minus,
  Move,
  MoveHorizontal,
  Music2,
  Plus,
  Waves,
  X,
} from "lucide-react";
import { MidiControlSurface } from "@/components/daw/panels/midi-control-surface";
import { ResizeHandle } from "@/components/daw/panels/resize-handle";
import { engine } from "@/lib/daw/engine";
import { useDAW } from "@/lib/daw/store";
import { isBlackKey, noteName } from "@/lib/daw/utils";
import { formatPitchClass } from "@/lib/daw/ChordDetector";
import { uid, type Track } from "@/lib/daw/types";
import { cn } from "@/lib/utils";

type ScaleId = "major" | "minor" | "dorian" | "pentatonic" | "blues";
type ScaleOption = { id: ScaleId; name: string; notes: readonly number[] };

const SCALE_OPTIONS: ScaleOption[] = [
  { id: "major", name: "Major", notes: [0, 2, 4, 5, 7, 9, 11] },
  { id: "minor", name: "Minor", notes: [0, 2, 3, 5, 7, 8, 10] },
  { id: "dorian", name: "Dorian", notes: [0, 2, 3, 5, 7, 9, 10] },
  { id: "pentatonic", name: "Pentatonic", notes: [0, 2, 4, 7, 9] },
  { id: "blues", name: "Blues", notes: [0, 3, 5, 6, 7, 10] },
] as const;
const GARAGEBAND_KEYS = ["a", "w", "s", "e", "d", "f", "t", "g", "y", "h", "u", "j", "k", "o", "l", "p", ";", "'"];
const LOWER_CHROMATIC_KEYS = ["z", "s", "x", "d", "c", "v", "g", "b", "h", "n", "j", "m"];
const UPPER_CHROMATIC_KEYS = ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "[", "]"];
const LOWER_SCALE_KEYS = ["z", "x", "c", "v", "b", "n", "m"];
const UPPER_SCALE_KEYS = ["q", "w", "e", "r", "t", "y", "u"];
const ROMAN_NUMERALS = ["I", "ii", "iii", "IV", "V", "vi", "vii°"];
const KEYBOARD_STYLE = {
  backgroundImage:
    "linear-gradient(90deg, rgba(114,63,34,.5), rgba(60,37,27,.45)), repeating-linear-gradient(2deg, #553824 0px, #68442b 3px, #4a3022 6px, #704a2e 9px)",
};

type ArpPattern = "up" | "down" | "up-down" | "random";
type PointerMode = "gliss" | "bend" | "scroll" | "chord";
type PointerState = {
  mode: PointerMode;
  sourceId: string;
  pitch?: number;
  startX: number;
  startScrollLeft: number;
};
type KeyBinding = { pitch?: number; chord?: number; octave?: number };
type CustomChordStrip = { name: string; notes: number[] };
type WindowRect = { left: number; top: number; width: number; height: number };

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

function scaleStep(rootPitch: number, step: number, notes: readonly number[]) {
  const degree = ((step % notes.length) + notes.length) % notes.length;
  const octave = Math.floor(step / notes.length);
  return rootPitch + notes[degree] + octave * 12;
}

function orderedArpeggio(notes: number[], pattern: ArpPattern): number[] {
  const sorted = [...new Set(notes)].sort((a, b) => a - b);
  if (pattern === "down") return sorted.reverse();
  if (pattern === "up-down" && sorted.length > 2) {
    return [...sorted, ...sorted.slice(1, -1).reverse()];
  }
  if (pattern === "random") {
    return sorted.map(() => sorted[Math.floor(Math.random() * sorted.length)]);
  }
  return sorted;
}

export function OnscreenKeyboard() {
  const open = useDAW((state) => state.ui.panels.keyboard);
  const octaveBase = useDAW((state) => state.ui.octaveBase);
  const musicalTyping = useDAW((state) => state.ui.musicalTyping);
  const scaleLock = useDAW((state) => state.ui.keyboardScaleLock);
  const root = useDAW((state) => state.ui.keyboardScaleRoot);
  const scaleId = useDAW((state) => state.ui.keyboardScaleMode);
  const customChordStrips = useDAW((state) => state.ui.keyboardChordStrips);
  const projectTempo = useDAW((state) => state.project.tempo);
  const selectedTrack = useDAW(
    (state) => state.project.tracks.find((track) => track.id === state.ui.selectedTrackId) ?? null,
  );
  const setUI = useDAW((state) => state.setUI);
  const togglePanel = useDAW((state) => state.togglePanel);
  const [pressed, setPressed] = useState<number[]>([]);
  const [typingLayout, setTypingLayout] = useState<"garageband" | "two-row">("garageband");
  const [chordMode, setChordMode] = useState(
    () => useDAW.getState().ui.keyboardChordStrips.length > 0,
  );
  const [dualRow, setDualRow] = useState(false);
  const [glissando, setGlissando] = useState(true);
  const [sustain, setSustain] = useState(false);
  const [pitchBend, setPitchBend] = useState(0);
  const [arpEnabled, setArpEnabled] = useState(false);
  const [arpRate, setArpRate] = useState<"1/4" | "1/8" | "1/16">("1/8");
  const [arpPattern, setArpPattern] = useState<ArpPattern>("up");
  const [midiOpen, setMidiOpen] = useState(false);
  const [floating, setFloating] = useState(false);
  const [dockedHeight, setDockedHeight] = useState(360);
  const [windowRect, setWindowRect] = useState<WindowRect>({
    left: 32,
    top: 72,
    width: 720,
    height: 340,
  });
  const keyScrollRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const resizeStart = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const pointers = useRef(new Map<number, PointerState>());
  const sources = useRef(new Map<string, number[]>());
  const pitchCounts = useRef(new Map<number, number>());
  const arpTimers = useRef(new Map<string, number>());
  const sustainRef = useRef(false);

  const scale = SCALE_OPTIONS.find((item) => item.id === scaleId) ?? SCALE_OPTIONS[0];
  const rootNames = useMemo(
    () => Array.from({ length: 12 }, (_, pitchClass) =>
      formatPitchClass(pitchClass, {
        tonic: root,
        mode: scaleId === "minor" ? "minor" : "major",
      }),
    ),
    [root, scaleId],
  );
  const pitchStart = Math.max(21, (octaveBase + 1) * 12);
  const pitchEnd = Math.min(108, (octaveBase + 3) * 12 - 1);
  const buildChord = useCallback((degree: number, octave: number) => {
    const rootPitch = (octaveBase + 1 + octave) * 12 + root;
    const degreeRoot = scaleStep(rootPitch, degree, scale.notes);
    return [
      degreeRoot,
      scaleStep(rootPitch, degree + 2, scale.notes),
      scaleStep(rootPitch, degree + 4, scale.notes),
    ].filter((pitch) => pitch >= 21 && pitch <= 108);
  }, [octaveBase, root, scale.notes]);
  const visiblePitches = useMemo(
    () =>
      Array.from({ length: 108 - 21 + 1 }, (_, index) => 21 + index)
        .filter((pitch) => !scaleLock || scale.notes.includes((pitch - root + 120) % 12)),
    [root, scale.notes, scaleLock],
  );
  const typingPitches = useMemo(
    () => visiblePitches.filter((pitch) => pitch >= pitchStart && pitch <= pitchEnd),
    [pitchEnd, pitchStart, visiblePitches],
  );
  const rows = useMemo(() => {
    if (!dualRow) return [visiblePitches];
    const splitAt = 65;
    return [
      visiblePitches.filter((pitch) => pitch >= splitAt),
      visiblePitches.filter((pitch) => pitch < splitAt),
    ];
  }, [dualRow, visiblePitches]);
  const typingRows = useMemo(() => {
    const splitAt = pitchStart + 12;
    return [
      typingPitches.filter((pitch) => pitch >= splitAt),
      typingPitches.filter((pitch) => pitch < splitAt),
    ];
  }, [pitchStart, typingPitches]);

  const keyBindings = useMemo(() => {
    const bindings = new Map<string, KeyBinding>();
    if (chordMode) {
      const lowerKeys = typingLayout === "garageband"
        ? GARAGEBAND_KEYS.slice(0, 7)
        : LOWER_SCALE_KEYS;
      const upperKeys = typingLayout === "garageband"
        ? GARAGEBAND_KEYS.slice(7, 14)
        : UPPER_SCALE_KEYS;
      lowerKeys.forEach((key, index) => bindings.set(key, { chord: index, octave: 0 }));
      upperKeys.forEach((key, index) => bindings.set(key, { chord: index, octave: 1 }));
      return bindings;
    }

    if (typingLayout === "garageband") {
      typingPitches.forEach((pitch, index) => {
        const key = GARAGEBAND_KEYS[index];
        if (key) bindings.set(key, { pitch });
      });
      return bindings;
    }

    if (dualRow) {
      typingRows.forEach((row, rowIndex) => {
        const keys = scaleLock
          ? rowIndex === 0 ? UPPER_SCALE_KEYS : LOWER_SCALE_KEYS
          : rowIndex === 0 ? UPPER_CHROMATIC_KEYS : LOWER_CHROMATIC_KEYS;
        row.forEach((pitch, index) => {
          const key = keys[index];
          if (key) bindings.set(key, { pitch });
        });
      });
    } else {
      const lowerKeys = scaleLock ? LOWER_SCALE_KEYS : LOWER_CHROMATIC_KEYS;
      const upperKeys = scaleLock ? UPPER_SCALE_KEYS : UPPER_CHROMATIC_KEYS;
      typingPitches.forEach((pitch, index) => {
        const key = index < lowerKeys.length
          ? lowerKeys[index]
          : upperKeys[index - lowerKeys.length];
        if (key) bindings.set(key, { pitch });
      });
    }
    return bindings;
  }, [chordMode, dualRow, scaleLock, typingLayout, typingPitches, typingRows]);

  const refreshPressed = useCallback(() => {
    setPressed([...pitchCounts.current.keys()]);
  }, []);

  const startDirectSource = useCallback((sourceId: string, pitches: number[], velocity: number) => {
    const uniquePitches = [...new Set(pitches)];
    sources.current.set(sourceId, uniquePitches);
    for (const pitch of uniquePitches) {
      const count = pitchCounts.current.get(pitch) ?? 0;
      pitchCounts.current.set(pitch, count + 1);
      if (count === 0) {
        engine.noteOn(pitch, velocity);
      }
    }
    refreshPressed();
  }, [refreshPressed]);

  const releaseDirectSource = useCallback((sourceId: string) => {
    const pitches = sources.current.get(sourceId);
    if (!pitches) return;
    sources.current.delete(sourceId);
    for (const pitch of pitches) {
      const count = (pitchCounts.current.get(pitch) ?? 1) - 1;
      if (count > 0) {
        pitchCounts.current.set(pitch, count);
        continue;
      }
      pitchCounts.current.delete(pitch);
      engine.noteOff(pitch, sustainRef.current);
    }
    refreshPressed();
  }, [refreshPressed]);

  const stopSource = useCallback((sourceId: string) => {
    const timer = arpTimers.current.get(sourceId);
    if (timer !== undefined) {
      window.clearInterval(timer);
      arpTimers.current.delete(sourceId);
      releaseDirectSource(`${sourceId}:arp`);
    }
    releaseDirectSource(sourceId);
  }, [releaseDirectSource]);

  const startSource = useCallback((
    sourceId: string,
    pitches: number[],
    velocity: number,
    useArpeggiator = arpEnabled,
  ) => {
    if (!useArpeggiator) {
      startDirectSource(sourceId, pitches, velocity);
      return;
    }
    stopSource(sourceId);
    const ordered = orderedArpeggio(pitches, arpPattern);
    if (!ordered.length) return;
    const rateBeats = arpRate === "1/4" ? 1 : arpRate === "1/8" ? 0.5 : 0.25;
    const interval = Math.max(35, (60_000 / projectTempo) * rateBeats);
    let step = 0;
    const playStep = () => {
      releaseDirectSource(`${sourceId}:arp`);
      startDirectSource(`${sourceId}:arp`, [ordered[step % ordered.length]], velocity);
      step += 1;
    };
    playStep();
    arpTimers.current.set(sourceId, window.setInterval(playStep, interval));
  }, [
    arpEnabled,
    arpPattern,
    arpRate,
    projectTempo,
    releaseDirectSource,
    startDirectSource,
    stopSource,
  ]);

  const releaseAll = useCallback(() => {
    for (const id of arpTimers.current.keys()) stopSource(id);
    for (const id of sources.current.keys()) releaseDirectSource(id);
    pointers.current.clear();
    engine.releaseSustainedNotes();
    refreshPressed();
  }, [refreshPressed, releaseDirectSource, stopSource]);

  useEffect(() => {
    sustainRef.current = sustain;
    if (sustain) return;
    engine.releaseSustainedNotes();
  }, [sustain]);

  useEffect(() => {
    const syncScale = (event: Event) => {
      const suggestion = (event as CustomEvent<{ tonic: number; mode: "major" | "minor" }>).detail;
      if (!suggestion) return;
      useDAW.getState().setUI({
        keyboardScaleRoot: suggestion.tonic,
        keyboardScaleMode: suggestion.mode,
        keyboardScaleLock: true,
      });
    };
    const loadChordStrips = (event: Event) => {
      const strips = (event as CustomEvent<CustomChordStrip[]>).detail;
      useDAW.getState().setUI({ keyboardChordStrips: (strips ?? []).slice(0, 8) });
      setChordMode(true);
    };
    window.addEventListener("webband:sync-scale", syncScale);
    window.addEventListener("webband:load-chord-strips", loadChordStrips);
    return () => {
      window.removeEventListener("webband:sync-scale", syncScale);
      window.removeEventListener("webband:load-chord-strips", loadChordStrips);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      releaseAll();
      return;
    }
    const onBlur = () => releaseAll();
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") releaseAll();
    };
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      releaseAll();
    };
  }, [open, releaseAll]);

  useEffect(() => {
    if (!open || !musicalTyping) return;
    const heldKeys = new Set<string>();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (event.repeat) return;
      const binding = keyBindings.get(key);
      if (!binding) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      heldKeys.add(key);
      const sourceId = `computer:${key}`;
      const velocity = useDAW.getState().ui.velocity;
      if (binding.chord !== undefined) {
        const chord = customChordStrips[binding.chord]?.notes
          ?? buildChord(binding.chord, binding.octave ?? 0);
        startSource(sourceId, chord, velocity);
      } else if (binding.pitch !== undefined) {
        startSource(sourceId, [binding.pitch], velocity);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!heldKeys.delete(key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      stopSource(`computer:${key}`);
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      for (const key of heldKeys) stopSource(`computer:${key}`);
    };
  }, [buildChord, customChordStrips, keyBindings, musicalTyping, open, startSource, stopSource]);

  useEffect(() => {
    if (!floating) return;
    const constrainWindow = () => {
      setWindowRect((rect) => {
        const width = Math.min(rect.width, window.innerWidth);
        const height = Math.min(rect.height, window.innerHeight);
        return {
          left: Math.max(0, Math.min(rect.left, window.innerWidth - width)),
          top: Math.max(0, Math.min(rect.top, window.innerHeight - Math.min(height, 72))),
          width,
          height,
        };
      });
    };
    constrainWindow();
    window.addEventListener("resize", constrainWindow);
    return () => window.removeEventListener("resize", constrainWindow);
  }, [floating]);

  const velocityFromPointer = (event: ReactPointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const amount = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    return Math.max(1, Math.min(127, Math.round(1 + amount * 126)));
  };

  const beginKeyPointer = (
    event: ReactPointerEvent<HTMLButtonElement>,
    pitch: number,
  ) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    const sourceId = `pointer:${event.pointerId}`;
    pointers.current.set(event.pointerId, {
      mode: glissando ? "gliss" : "bend",
      sourceId,
      pitch,
      startX: event.clientX,
      startScrollLeft: keyScrollRef.current?.scrollLeft ?? 0,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
    startSource(sourceId, [pitch], velocityFromPointer(event));
  };

  const beginChordPointer = (
    event: ReactPointerEvent<HTMLButtonElement>,
    degree: number,
    zone: "chord" | "bass" | "arp",
    octave: number,
  ) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    const sourceId = `pointer:${event.pointerId}`;
    const chord = buildChord(degree, octave);
    const pitches = zone === "bass" ? [Math.max(21, chord[0] - 12)] : chord;
    pointers.current.set(event.pointerId, {
      mode: "chord",
      sourceId,
      startX: event.clientX,
      startScrollLeft: 0,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
    startSource(sourceId, pitches, velocityFromPointer(event), zone === "arp" || arpEnabled);
  };

  const beginCustomChordPointer = (
    event: ReactPointerEvent<HTMLButtonElement>,
    chord: number[],
    zone: "chord" | "bass" | "arp",
  ) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    const sourceId = `pointer:${event.pointerId}`;
    const sorted = [...new Set(chord)].sort((a, b) => a - b);
    const pitches = zone === "bass"
      ? [Math.max(21, (sorted[0] ?? 48) - 12)]
      : sorted;
    pointers.current.set(event.pointerId, {
      mode: "chord",
      sourceId,
      startX: event.clientX,
      startScrollLeft: 0,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
    startSource(sourceId, pitches, velocityFromPointer(event), zone === "arp" || arpEnabled);
  };

  const beginScrollPointer = (event: ReactPointerEvent<HTMLElement>) => {
    if (
      glissando ||
      (event.target as HTMLElement).closest(
        "[data-key-pitch], [data-chord-strip], button, select, input",
      )
    ) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pointers.current.set(event.pointerId, {
      mode: "scroll",
      sourceId: `scroll:${event.pointerId}`,
      startX: event.clientX,
      startScrollLeft: keyScrollRef.current?.scrollLeft ?? 0,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const pointer = pointers.current.get(event.pointerId);
    if (!pointer) return;
    if (pointer.mode === "scroll") {
      if (keyScrollRef.current) {
        keyScrollRef.current.scrollLeft =
          pointer.startScrollLeft - (event.clientX - pointer.startX);
      }
      return;
    }
    if ((pointer.mode === "gliss" || pointer.mode === "bend") && pointer.pitch !== undefined) {
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-key-pitch]");
      const nextPitch = Number(target?.dataset.keyPitch);
      if (!Number.isFinite(nextPitch) || nextPitch === pointer.pitch) return;
      stopSource(pointer.sourceId);
      pointer.pitch = nextPitch;
      const amount = target
        ? Math.max(0, Math.min(1, (event.clientY - target.getBoundingClientRect().top) / target.getBoundingClientRect().height))
        : 0.5;
      startSource(pointer.sourceId, [nextPitch], Math.round(1 + amount * 126));
    }
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = pointers.current.get(event.pointerId);
    if (!pointer) return;
    pointers.current.delete(event.pointerId);
    if (pointer.mode !== "scroll") stopSource(pointer.sourceId);
  };

  const keyNameForPitch = useMemo(() => {
    const hints = new Map<number, string>();
    for (const [key, binding] of keyBindings) {
      if (binding.pitch !== undefined) hints.set(binding.pitch, key.toUpperCase());
    }
    return hints;
  }, [keyBindings]);
  const chordKeyHints = useMemo(() => {
    const lower = typingLayout === "garageband"
      ? GARAGEBAND_KEYS.slice(0, 7)
      : LOWER_SCALE_KEYS;
    const upper = typingLayout === "garageband"
      ? GARAGEBAND_KEYS.slice(7, 14)
      : UPPER_SCALE_KEYS;
    return { lower, upper };
  }, [typingLayout]);

  const pitchIsInScale = (pitch: number) =>
    scale.notes.includes((pitch - root + 120) % 12);

  const beginWindowDrag = (event: ReactPointerEvent<HTMLElement>) => {
    event.stopPropagation();
    if (!floating || (event.target as HTMLElement).closest("button, select, input")) return;
    event.preventDefault();
    dragStart.current = {
      x: event.clientX,
      y: event.clientY,
      left: windowRect.left,
      top: windowRect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveWindow = (event: ReactPointerEvent<HTMLElement>) => {
    if (!dragStart.current) return;
    const start = dragStart.current;
    setWindowRect((rect) => ({
      ...rect,
      left: Math.max(0, Math.min(window.innerWidth - rect.width, start.left + event.clientX - start.x)),
      top: Math.max(0, Math.min(window.innerHeight - 72, start.top + event.clientY - start.y)),
    }));
  };

  const endWindowDrag = () => {
    dragStart.current = null;
  };

  const setFloatingWindowSize = (width: number, height: number) => {
    setWindowRect((rect) => {
      const availableWidth = Math.max(1, window.innerWidth - rect.left);
      const availableHeight = Math.max(1, window.innerHeight - rect.top);
      return {
        ...rect,
        width: Math.max(Math.min(480, availableWidth), Math.min(availableWidth, width)),
        height: Math.max(Math.min(240, availableHeight), Math.min(availableHeight, height)),
      };
    });
  };

  const beginWindowResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    resizeStart.current = {
      x: event.clientX,
      y: event.clientY,
      width: windowRect.width,
      height: windowRect.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const resizeWindow = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!resizeStart.current) return;
    const start = resizeStart.current;
    setFloatingWindowSize(
      start.width + event.clientX - start.x,
      start.height + event.clientY - start.y,
    );
  };

  const endWindowResize = () => {
    resizeStart.current = null;
  };

  if (!open) return null;

  const isMidi = selectedTrack?.type === "midi";

  return (
    <>
      <div
        className={floating
          ? "fixed z-[80] max-w-[calc(100vw-16px)]"
          : "relative shrink-0 border-t border-black/80 bg-[#1c1c1e] px-2 py-1"}
        style={floating
          ? {
              left: windowRect.left,
              top: windowRect.top,
              width: windowRect.width,
              height: windowRect.height,
            }
          : { height: dockedHeight, maxHeight: "60vh" }}
      >
        {!floating && (
          <ResizeHandle
            axis="horizontal"
            value={dockedHeight}
            min={250}
            max={800}
            label="Resize performance keyboard height"
            onChange={setDockedHeight}
            className="absolute -top-1 left-0 z-20 bg-[#1c1c1e]"
          />
        )}
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          aria-label="On-screen performance keyboard"
          className="pointer-events-auto relative flex h-full min-h-0 w-full flex-col overflow-auto rounded-md border border-[#55535a] bg-gradient-to-b from-[#34343a] via-[#242428] to-[#19191c] p-3 text-zinc-200 shadow-[0_-8px_24px_rgba(0,0,0,.32),inset_0_1px_0_rgba(255,255,255,.1)]"
          onPointerDown={beginScrollPointer}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div className="pointer-events-none absolute inset-y-0 left-0 w-2.5 opacity-70" style={KEYBOARD_STYLE} />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-2.5 opacity-70" style={KEYBOARD_STYLE} />

          <header
            className={cn(
              "relative mb-2 flex flex-wrap items-center gap-2 border-b border-black/40 pb-2",
              floating && "touch-none cursor-grab active:cursor-grabbing",
            )}
            onPointerDown={beginWindowDrag}
            onPointerMove={moveWindow}
            onPointerUp={endWindowDrag}
            onPointerCancel={endWindowDrag}
          >
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-md border border-[#ffb648]/25 bg-[#ffb648]/10 text-[#ffca78]">
                <Music2 size={15} />
              </span>
              <div>
                <h2 className="text-[11px] font-semibold uppercase tracking-[.16em] text-zinc-100">
                  Performance Keyboard
                </h2>
                <p className="text-[9px] text-zinc-500">
                  {isMidi ? `Recording to ${selectedTrack.name}` : "Built-in warm synth · select a MIDI track to record"}
                </p>
              </div>
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <ControlButton
                active={scaleLock}
                label="Toggle scale lock"
                onClick={() => useDAW.getState().setUI({ keyboardScaleLock: !scaleLock })}
              >
                <span>Scale</span>
              </ControlButton>
              {scaleLock && (
                <>
                  <select
                    aria-label="Scale root note"
                    value={root}
                    onChange={(event) => useDAW.getState().setUI({ keyboardScaleRoot: Number(event.target.value) })}
                    className="h-7 rounded border border-black/50 bg-[#1a1a1d] px-1.5 text-[10px] text-zinc-200"
                  >
                    {rootNames.map((name, index) => <option key={`${name}-${index}`} value={index}>{name}</option>)}
                  </select>
                  <select
                    aria-label="Scale type"
                    value={scaleId}
                    onChange={(event) => useDAW.getState().setUI({ keyboardScaleMode: event.target.value as ScaleId })}
                    className="h-7 rounded border border-black/50 bg-[#1a1a1d] px-1.5 text-[10px] text-zinc-200"
                  >
                    {SCALE_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </>
              )}
              <ControlButton active={chordMode} label="Toggle chord strips" onClick={() => setChordMode((value) => !value)}>
                <AudioLines size={12} />
                <span>Chords</span>
              </ControlButton>
              <ControlButton active={dualRow} label="Toggle dual-row keyboard" onClick={() => setDualRow((value) => !value)}>
                <span>2 Rows</span>
              </ControlButton>
              <ControlButton
                active={typingLayout === "garageband"}
                label="Switch between GarageBand and two-row QWERTY note layouts"
                onClick={() => setTypingLayout((value) => value === "garageband" ? "two-row" : "garageband")}
              >
                <span>{typingLayout === "garageband" ? "GB Keys" : "Z/Q Keys"}</span>
              </ControlButton>
              <ControlButton
                active={floating}
                label={floating ? "Dock performance keyboard" : "Float performance keyboard"}
                onClick={() => setFloating((value) => !value)}
              >
                <Move size={12} />
                <span>{floating ? "Dock" : "Float"}</span>
              </ControlButton>
              <ControlButton active={glissando} label="Toggle glissando mode" onClick={() => setGlissando((value) => !value)}>
                {glissando ? <Waves size={12} /> : <MoveHorizontal size={12} />}
                <span>{glissando ? "Gliss" : "Scroll"}</span>
              </ControlButton>
              <button
                type="button"
                aria-label="Close performance keyboard"
                onClick={() => togglePanel("keyboard")}
                className="ml-1 flex size-7 items-center justify-center rounded text-zinc-500 hover:bg-white/5 hover:text-zinc-100"
              >
                <X size={14} />
              </button>
            </div>
          </header>

          <div className="relative flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-black/40 pb-2">
            <div className="flex items-center gap-1">
              <span className="mr-1 text-[8px] font-semibold uppercase tracking-wider text-zinc-500">Octave</span>
              <button
                type="button"
                aria-label="Octave down"
                disabled={octaveBase <= 0}
                onClick={() => setUI({ octaveBase: Math.max(0, octaveBase - 1) })}
                className="flex size-6 items-center justify-center rounded border border-black/50 bg-[#2f2f34] text-zinc-300 hover:bg-[#404047] disabled:opacity-40"
              >
                <Minus size={12} />
              </button>
              <span className="min-w-[4.5rem] text-center font-mono text-[9px] text-zinc-300">
                {noteName(pitchStart)}–{noteName(pitchEnd)}
              </span>
              <button
                type="button"
                aria-label="Octave up"
                disabled={octaveBase >= 7}
                onClick={() => setUI({ octaveBase: Math.min(7, octaveBase + 1) })}
                className="flex size-6 items-center justify-center rounded border border-black/50 bg-[#2f2f34] text-zinc-300 hover:bg-[#404047] disabled:opacity-40"
              >
                <Plus size={12} />
              </button>
            </div>

            <ControlButton active={sustain} label="Toggle sustain latch" onClick={() => setSustain((value) => !value)}>
              <span className={cn("size-1.5 rounded-full", sustain ? "bg-[#8fd17e] shadow-[0_0_7px_#8fd17e]" : "bg-zinc-600")} />
              <span>Sustain</span>
            </ControlButton>
            <label className="flex h-7 items-center gap-1.5 rounded-md border border-black/40 bg-[#26262b] px-2 text-[9px] text-zinc-400">
              <span>Bend</span>
              <input
                type="range"
                min={-1}
                max={1}
                step={0.01}
                value={pitchBend}
                aria-label="Pitch bend"
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setPitchBend(value);
                  engine.pitchBend(value);
                }}
                onDoubleClick={() => {
                  setPitchBend(0);
                  engine.pitchBend(0);
                }}
                className="w-16 accent-[#67b7ff]"
              />
              <button
                type="button"
                aria-label="Reset pitch bend"
                title="Reset pitch bend"
                onClick={() => {
                  setPitchBend(0);
                  engine.pitchBend(0);
                }}
                className="rounded px-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
              >
                0
              </button>
            </label>

            <ControlButton active={arpEnabled} label="Toggle arpeggiator" onClick={() => setArpEnabled((value) => !value)}>
              <Waves size={12} />
              <span>Arp</span>
            </ControlButton>
            <select
              aria-label="Arpeggiator rate"
              value={arpRate}
              onChange={(event) => setArpRate(event.target.value as typeof arpRate)}
              className="h-7 rounded border border-black/50 bg-[#1a1a1d] px-1.5 text-[9px] text-zinc-300"
            >
              <option value="1/4">1/4</option>
              <option value="1/8">1/8</option>
              <option value="1/16">1/16</option>
            </select>
            <select
              aria-label="Arpeggiator pattern"
              value={arpPattern}
              onChange={(event) => setArpPattern(event.target.value as ArpPattern)}
              className="h-7 rounded border border-black/50 bg-[#1a1a1d] px-1.5 text-[9px] text-zinc-300"
            >
              <option value="up">Up</option>
              <option value="down">Down</option>
              <option value="up-down">Up/Down</option>
              <option value="random">Random</option>
            </select>

            <label className="flex cursor-pointer items-center gap-1.5 text-[8px] font-semibold uppercase tracking-wider text-zinc-500">
              Typing
              <input
                type="checkbox"
                checked={musicalTyping}
                onChange={(event) => setUI({ musicalTyping: event.target.checked })}
                className="accent-[#ffb648]"
              />
            </label>
            <button
              type="button"
              onClick={() => setMidiOpen(true)}
              className="ml-auto flex h-7 items-center gap-1.5 rounded border border-[#8c75c8]/40 bg-[#8c75c8]/10 px-2 text-[9px] text-[#c1a9f5] hover:bg-[#8c75c8]/20"
            >
              <AudioLines size={12} />
              MIDI
            </button>
          </div>

          <InstrumentControls track={selectedTrack} />

          <div className="mt-2 flex min-h-0 flex-1 items-stretch gap-2">
            <div
              ref={keyScrollRef}
              className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden rounded-md border border-black/50 bg-[#171719] p-1.5 [scrollbar-color:#55545a_#202024] [scrollbar-width:thin]"
              onWheel={(event) => {
                if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
                  event.currentTarget.scrollLeft += event.deltaY;
                }
              }}
            >
              {chordMode ? (
                <div className={`grid gap-1.5 ${customChordStrips.length ? "min-w-[700px] grid-cols-8" : "min-w-[620px] grid-cols-7"}`}>
                  {(customChordStrips.length
                    ? customChordStrips.map((strip, degree) => ({
                        roman: strip.name,
                        degree,
                        rootNote: rootNames[(strip.notes[0] ?? 0) % 12],
                        quality: "Custom",
                        custom: strip,
                      }))
                    : ROMAN_NUMERALS.map((roman, degree) => ({
                        roman,
                        degree,
                        rootNote: rootNames[(root + (scale.notes[degree % scale.notes.length] ?? 0)) % 12],
                        quality: chordName(degree, scaleLock, scale.notes),
                        custom: undefined,
                      }))
                  ).map(({ roman, degree, rootNote, quality, custom }) => (
                    <ChordStrip
                      key={`${degree}-${roman}`}
                      degree={degree}
                      roman={roman}
                      chordName={quality}
                      rootNote={rootNote}
                      keyHints={musicalTyping
                        ? [chordKeyHints.lower[degree], chordKeyHints.upper[degree]]
                            .filter((key): key is string => !!key)
                        : []}
                      onPointerDown={(event, zone) =>
                        custom
                          ? beginCustomChordPointer(event, custom.notes, zone)
                          : beginChordPointer(event, degree, zone, dualRow ? 0 : 0)
                      }
                    />
                  ))}
                </div>
              ) : (
                <div className="flex w-fit min-w-max flex-col gap-1">
                  {rows.map((row, rowIndex) => (
                    <PianoRow
                      key={rowIndex}
                      pitches={row}
                      scaleLock={scaleLock}
                      pressed={pressed}
                      keyHints={keyNameForPitch}
                      typing={musicalTyping}
                      rowIndex={rowIndex}
                      onPointerDown={beginKeyPointer}
                      pitchIsInScale={pitchIsInScale}
                    />
                  ))}
                  {!glissando && (
                    <div className="flex h-5 items-center justify-center rounded bg-[#28282d] text-[8px] uppercase tracking-[.18em] text-zinc-500">
                      Drag the bezel to pan · drag a held key to bend pitch
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <footer className="mt-1.5 flex flex-wrap items-center justify-between gap-1 text-[8px] text-zinc-600">
            <span>
              {scaleLock
                ? `${rootNames[root]} ${scale.name} · non-scale keys hidden`
                : "88-note A0–C8 range · octave controls set the typing range"}
            </span>
            <span>{musicalTyping ? "QWERTY overlay active · key-up, blur and tab-switch release notes" : "Enable Typing for QWERTY hints"}</span>
          </footer>
            {floating && (
              <button
                type="button"
                aria-label="Resize performance keyboard window"
                title="Drag to resize"
                className="absolute bottom-0 right-0 z-20 size-5 cursor-nwse-resize touch-none rounded-tl-md border-l border-t border-white/15 bg-[#34343a]/90"
                onPointerDown={beginWindowResize}
                onPointerMove={resizeWindow}
                onPointerUp={endWindowResize}
                onPointerCancel={endWindowResize}
                onKeyDown={(event) => {
                  const amount = event.shiftKey ? 40 : 10;
                  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
                  event.preventDefault();
                  setFloatingWindowSize(
                    windowRect.width + (event.key === "ArrowRight" ? amount : event.key === "ArrowLeft" ? -amount : 0),
                    windowRect.height + (event.key === "ArrowDown" ? amount : event.key === "ArrowUp" ? -amount : 0),
                  );
                }}
              />
            )}
        </motion.section>
      </div>
      {midiOpen && <MidiControlSurface onClose={() => setMidiOpen(false)} />}
    </>
  );
}

function chordName(degree: number, scaleLock: boolean, scaleNotes: readonly number[]) {
  if (!scaleLock) return degree === 6 ? "dim" : degree % 3 === 1 ? "min" : "maj";
  if (scaleNotes === SCALE_OPTIONS.find((item) => item.id === "minor")?.notes) {
    return ["min", "dim", "maj", "min", "min", "maj", "maj"][degree];
  }
  return ["maj", "min", "min", "maj", "maj", "min", "dim"][degree];
}

function ControlButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded border px-2 text-[9px] transition-colors",
        active
          ? "border-[#ffb648]/40 bg-[#ffb648]/10 text-[#ffd08a]"
          : "border-black/40 bg-[#242428] text-zinc-400 hover:bg-[#34343a] hover:text-zinc-200",
      )}
    >
      {children}
    </button>
  );
}

function InstrumentControls({ track }: { track: Track | null }) {
  const updateTrack = useDAW((state) => state.updateTrack);
  const velocity = useDAW((state) => state.ui.velocity);
  const setUI = useDAW((state) => state.setUI);
  const compressor = track?.audioPlugins?.find((plugin) => plugin.pluginId === "compressor");
  const compressionValue = compressor?.enabled
    ? Math.round(((compressor.params.ratio ?? 2.5) - 1) / 11 * 100)
    : track?.compressor ? 100 : 0;
  const values = {
    compression: compressionValue,
    high: track?.eq.highGain ?? 0,
    mid: track?.eq.midGain ?? 0,
    low: track?.eq.lowGain ?? 0,
    reverb: Math.round((track?.params.reverb ?? 0.12) * 100),
    velocity,
  };
  const commit = () => useDAW.getState().commit();
  const changeTrack = (patch: Parameters<typeof updateTrack>[1]) => {
    if (track) updateTrack(track.id, patch, false);
  };

  const changeCompression = (value: number) => {
    if (!track) return;
    const plugins = track.audioPlugins ?? [];
    const existing = plugins.find((plugin) => plugin.pluginId === "compressor");
    const next = {
      id: existing?.id ?? uid(),
      pluginId: "compressor",
      enabled: value > 0,
      params: {
        ...existing?.params,
        threshold: -6 - value * 0.3,
        ratio: 1 + value * 0.11,
      },
    };
    changeTrack({
      compressor: false,
      audioPlugins: existing
        ? plugins.map((plugin) => plugin.id === existing.id ? next : plugin)
        : [...plugins, next],
    });
  };

  return (
    <section
      aria-label="Instrument Controls"
      className="mb-2 rounded-xl border border-white/10 bg-black/70 px-3 py-2.5 shadow-[inset_0_1px_rgba(255,255,255,.04)]"
    >
      <h3 className="mb-2 text-[13px] font-semibold text-zinc-100">Instrument Controls</h3>
      <div className="grid grid-cols-6 gap-1">
        <InstrumentDial
          label="Compression"
          range="0–100%"
          value={values.compression}
          min={0}
          max={100}
          step={1}
          format={(value) => `${Math.round(value)}%`}
          disabled={!track}
          onCommit={commit}
          onChange={changeCompression}
        />
        <InstrumentDial
          label="High"
          range="±12 dB"
          value={values.high}
          min={-12}
          max={12}
          step={1}
          format={(value) => `${Math.round(value)} dB`}
          disabled={!track}
          onCommit={commit}
          onChange={(value) => track && changeTrack({ eq: { ...track.eq, highGain: value } })}
        />
        <InstrumentDial
          label="Mid"
          range="±12 dB"
          value={values.mid}
          min={-12}
          max={12}
          step={1}
          format={(value) => `${Math.round(value)} dB`}
          disabled={!track}
          onCommit={commit}
          onChange={(value) => track && changeTrack({ eq: { ...track.eq, midGain: value } })}
        />
        <InstrumentDial
          label="Low"
          range="±12 dB"
          value={values.low}
          min={-12}
          max={12}
          step={1}
          format={(value) => `${Math.round(value)} dB`}
          disabled={!track}
          onCommit={commit}
          onChange={(value) => track && changeTrack({ eq: { ...track.eq, lowGain: value } })}
        />
        <InstrumentDial
          label="Reverb"
          range="0–100%"
          value={values.reverb}
          min={0}
          max={100}
          step={1}
          format={(value) => `${Math.round(value)}%`}
          disabled={!track}
          onCommit={commit}
          onChange={(value) => {
            if (track) changeTrack({ params: { ...track.params, reverb: value / 100 } });
          }}
        />
        <InstrumentDial
          label="Velocity"
          range="1–127"
          value={values.velocity}
          min={1}
          max={127}
          step={1}
          format={(value) => `${Math.round(value)}`}
          onCommit={() => undefined}
          onChange={(value) => setUI({ velocity: Math.max(1, Math.min(127, Math.round(value))) })}
        />
      </div>
    </section>
  );
}

function InstrumentDial({
  label,
  range,
  value,
  min,
  max,
  step,
  format,
  disabled = false,
  onCommit,
  onChange,
}: {
  label: string;
  range: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  disabled?: boolean;
  onCommit: () => void;
  onChange: (value: number) => void;
}) {
  const drag = useRef<{ y: number; value: number; pointerId: number } | null>(null);
  const updateByKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    let next: number | null = null;
    if (event.key === "ArrowUp" || event.key === "ArrowRight") next = value + step;
    if (event.key === "ArrowDown" || event.key === "ArrowLeft") next = value - step;
    if (event.key === "PageUp") next = value + step * 10;
    if (event.key === "PageDown") next = value - step * 10;
    if (event.key === "Home") next = min;
    if (event.key === "End") next = max;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    onCommit();
    onChange(Math.max(min, Math.min(max, next)));
  };
  const normalized = (value - min) / Math.max(1, max - min);
  const angle = -135 + normalized * 270;
  const activeAngle = normalized * 270;

  return (
    <div className="flex min-w-0 flex-col items-center gap-1">
      <button
        type="button"
        role="slider"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format(value)}
        aria-orientation="vertical"
        disabled={disabled}
        title={`${label}: ${format(value)} · rotate by dragging vertically or use arrow keys`}
        onPointerDown={(event) => {
          if (disabled || (event.pointerType === "mouse" && event.button !== 0)) return;
          event.preventDefault();
          event.stopPropagation();
          onCommit();
          drag.current = { y: event.clientY, value, pointerId: event.pointerId };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.pointerId !== event.pointerId) return;
          event.stopPropagation();
          const amount = (current.y - event.clientY) / 120;
          const precision = step < 1 ? 100 : 1;
          const next = Math.round((current.value + amount * (max - min)) * precision) / precision;
          onChange(Math.max(min, Math.min(max, next)));
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointerId !== event.pointerId) return;
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={(event) => {
          if (drag.current?.pointerId !== event.pointerId) return;
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onKeyDown={updateByKey}
        className="relative flex size-[52px] shrink-0 items-center justify-center rounded-full p-[4px] shadow-[0_3px_8px_rgba(0,0,0,.65)] transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffb648]/60 disabled:cursor-not-allowed disabled:opacity-40"
        style={{
          background: `conic-gradient(from 225deg, #ffb648 0deg ${activeAngle}deg, #52525b ${activeAngle}deg 270deg, transparent 270deg 360deg)`,
        }}
      >
        <span className="relative flex size-full items-center justify-center rounded-full border border-black/80 bg-[radial-gradient(circle_at_34%_25%,#57575d,#27272d_48%,#101013)] shadow-[inset_0_2px_3px_rgba(255,255,255,.18),inset_0_-3px_5px_rgba(0,0,0,.75)]">
          <span className="absolute inset-[5px] rounded-full border border-white/10 bg-[repeating-conic-gradient(rgba(255,255,255,.025)_0deg_3deg,rgba(0,0,0,.08)_3deg_6deg),radial-gradient(circle_at_35%_25%,#3e3e44,#17171a_75%)] shadow-[inset_0_1px_2px_rgba(255,255,255,.12),0_1px_2px_rgba(0,0,0,.7)]" />
          <span
            aria-hidden="true"
            className="absolute top-[4px] left-1/2 h-[13px] w-[2px] -translate-x-1/2 rounded-full bg-[#ffe0a6] shadow-[0_0_4px_#ffb648]"
            style={{ transform: `translateX(-50%) rotate(${angle}deg)`, transformOrigin: "50% 18px" }}
          />
        </span>
      </button>
      <span className="truncate text-center text-[10px] font-medium leading-tight text-zinc-100">{label}</span>
      <span className="text-center text-[10px] leading-tight tabular-nums text-[#ffcf7e]">{format(value)}</span>
      <span className="text-center text-[9px] leading-tight text-zinc-500">{range}</span>
    </div>
  );
}

function ChordStrip({
  degree,
  roman,
  chordName: quality,
  rootNote,
  keyHints,
  onPointerDown,
}: {
  degree: number;
  roman: string;
  chordName: string;
  rootNote: string;
  keyHints: string[];
  onPointerDown: (
    event: ReactPointerEvent<HTMLButtonElement>,
    zone: "chord" | "bass" | "arp",
  ) => void;
}) {
  return (
    <button
      type="button"
      data-chord-strip={degree}
      aria-label={`${rootNote} ${roman} ${quality} chord. Top plays chord, middle bass, bottom arpeggio.`}
      onPointerDown={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const position = (event.clientY - bounds.top) / bounds.height;
        onPointerDown(event, position < 0.56 ? "chord" : position < 0.78 ? "bass" : "arp");
      }}
      className="group relative flex h-[116px] min-w-[76px] touch-none flex-col overflow-hidden rounded border border-black/50 bg-gradient-to-b from-[#414148] to-[#252529] text-left shadow-[inset_0_1px_0_rgba(255,255,255,.08)] active:brightness-125"
    >
      <span className="pointer-events-none flex h-[65%] flex-col items-center justify-center">
        <span className="mb-1 flex gap-1">
          {keyHints.map((key) => (
            <kbd key={key} className="rounded border border-white/10 bg-black/25 px-1 font-mono text-[7px] text-zinc-500">
              {key.toUpperCase()}
            </kbd>
          ))}
        </span>
        <span className="text-lg font-semibold text-[#f3c27b]">{roman}</span>
        <span className="text-[9px] uppercase text-zinc-400">{quality}</span>
      </span>
      <span className="pointer-events-none flex h-[22%] items-center justify-center border-t border-black/30 bg-black/10 text-[8px] uppercase tracking-wider text-zinc-500">
        Bass
      </span>
      <span className="pointer-events-none flex flex-1 items-center justify-center border-t border-black/30 text-[8px] uppercase tracking-wider text-zinc-500">
        Arp
      </span>
    </button>
  );
}

function PianoRow({
  pitches,
  scaleLock,
  pressed,
  keyHints,
  typing,
  rowIndex,
  onPointerDown,
  pitchIsInScale,
}: {
  pitches: number[];
  scaleLock: boolean;
  pressed: number[];
  keyHints: Map<number, string>;
  typing: boolean;
  rowIndex: number;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, pitch: number) => void;
  pitchIsInScale: (pitch: number) => boolean;
}) {
  if (!pitches.length) return null;
  const keyButton = (pitch: number, black: boolean) => {
    const isPressed = pressed.includes(pitch);
    const hint = typing ? keyHints.get(pitch) : undefined;
    return (
      <button
        key={pitch}
        type="button"
        data-key-pitch={pitch}
        data-row={rowIndex}
        aria-label={`Play ${noteName(pitch)}${pitchIsInScale(pitch) ? "" : ", outside scale"}`}
        aria-pressed={isPressed}
        onPointerDown={(event) => onPointerDown(event, pitch)}
        className={cn(
          "relative touch-none select-none outline-none focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-[#ffb648]/70",
          black
            ? "z-10 h-[66px] w-full -translate-x-1/2 rounded-b border border-black/80"
                : cn(
                    "h-[90px] shrink-0 rounded-b border border-black/30",
                    scaleLock ? "w-full min-w-0" : "w-9 sm:w-11",
                  ),
          black
            ? isPressed
              ? "bg-gradient-to-b from-[#a77a31] to-[#553c14]"
              : "bg-gradient-to-b from-[#303035] to-[#111113] shadow-[inset_0_1px_0_rgba(255,255,255,.08),0_3px_4px_rgba(0,0,0,.5)]"
            : isPressed
              ? "translate-y-px bg-gradient-to-b from-[#ffe5b8] to-[#e9ad55]"
              : "bg-gradient-to-b from-[#fffefa] to-[#d2d1d1] shadow-[inset_0_-3px_4px_rgba(0,0,0,.12),0_2px_3px_rgba(0,0,0,.35)]",
        )}
      >
        <span className={cn(
          "pointer-events-none absolute inset-x-0 bottom-1 flex flex-col items-center gap-0.5",
          black && "bottom-0.5",
        )}>
          {hint && <span className={cn("rounded px-1 font-mono text-[8px]", black ? "text-[#ffca78]" : "bg-[#252529] text-zinc-300")}>{hint}</span>}
          <span className={cn("whitespace-nowrap text-[7px]", black ? "text-zinc-500" : "text-zinc-600")}>
            {noteName(pitch)}
          </span>
        </span>
      </button>
    );
  };

  if (scaleLock) {
    return (
      <div
        className="grid h-[90px] w-fit min-w-max gap-0.5"
        style={{ gridTemplateColumns: `repeat(${pitches.length}, 30px)` }}
      >
        {pitches.map((pitch) => (
          <div key={pitch} className="min-w-0">
            {keyButton(pitch, false)}
          </div>
        ))}
      </div>
    );
  }

  const whites = pitches.filter((pitch) => !isBlackKey(pitch));
  const blackKeys = pitches.filter((pitch) => isBlackKey(pitch));
  return (
    <div className="relative flex h-[90px] w-fit">
      {whites.map((pitch) => keyButton(pitch, false))}
      {blackKeys.map((pitch) => {
        const whitesBefore = whites.filter((white) => white < pitch).length;
        return (
          <div
            key={`black-${pitch}`}
            className="absolute top-0 z-20"
            style={{
              left: `${(whitesBefore / whites.length) * 100}%`,
              width: "24px",
            }}
          >
            {keyButton(pitch, true)}
          </div>
        );
      })}
    </div>
  );
}
