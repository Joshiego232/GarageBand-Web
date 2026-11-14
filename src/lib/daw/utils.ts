// ============================================================
// Utilities: time formatting, snapping, music theory
// ============================================================
import { PPQ, type SnapMode, type Project } from "./types";

export const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

export function noteName(pitch: number): string {
  return `${NOTE_NAMES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
}

export function isBlackKey(pitch: number): boolean {
  return [1, 3, 6, 8, 10].includes(((pitch % 12) + 12) % 12);
}

export function midiToFreq(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

// ---------- Time conversions ----------

export function secPerBeat(tempo: number): number {
  return 60 / tempo;
}

export function tickToSec(tick: number, tempo: number): number {
  return (tick / PPQ) * secPerBeat(tempo);
}

export function secToTick(sec: number, tempo: number): number {
  return (sec / secPerBeat(tempo)) * PPQ;
}

export function barTicks(timeSig: [number, number]): number {
  return timeSig[0] * (PPQ * (4 / timeSig[1]));
}

/** Format ticks as "bar.beat.sub.division" like GarageBand's LCD */
export function formatBarsBeats(
  tick: number,
  timeSig: [number, number]
): string {
  const bt = barTicks(timeSig);
  const t = Math.max(0, tick);
  const bar = Math.floor(t / bt) + 1;
  const restBar = t - (bar - 1) * bt;
  const beatLen = PPQ * (4 / timeSig[1]);
  const beat = Math.floor(restBar / beatLen) + 1;
  const sub = Math.floor((restBar - (beat - 1) * beatLen) / (beatLen / 4)) + 1;
  const div = Math.floor(
    (restBar - (beat - 1) * beatLen - (sub - 1) * (beatLen / 4)) /
      (beatLen / 16)
  ) + 1;
  return `${bar}.${beat}.${sub}.${String(div).padStart(2, "0")}`;
}

/** Format ticks as seconds "m:ss.mmm" */
export function formatTime(tick: number, tempo: number): string {
  const sec = tickToSec(tick, tempo);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 1000);
  return `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

// ---------- Snapping ----------

export function snapTicks(mode: SnapMode, zoom: number, timeSig: [number, number]): number {
  switch (mode) {
    case "off":
      return 1;
    case "bar":
      return barTicks(timeSig);
    case "beat":
      return PPQ * (4 / timeSig[1]);
    case "8th":
      return PPQ / 2;
    case "16th":
      return PPQ / 4;
    case "smart":
    default:
      // smart: coarser when zoomed out
      if (zoom < 26) return barTicks(timeSig);
      if (zoom < 60) return PPQ * (4 / timeSig[1]);
      if (zoom < 130) return PPQ / 2;
      return PPQ / 4;
  }
}

export function snapTick(t: number, grid: number): number {
  if (grid <= 1) return Math.round(t);
  return Math.round(t / grid) * grid;
}

// ---------- Music theory ----------

export const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
export const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

export function scalePitch(tonic: number, degree: number, mode: "major" | "minor"): number {
  const steps = mode === "major" ? MAJOR_STEPS : MINOR_STEPS;
  const octave = Math.floor(degree / 7);
  const idx = ((degree % 7) + 7) % 7;
  return tonic + steps[idx] + octave * 12;
}

/** Chord intervals from root for common chord types */
export const CHORD_TYPES: Record<string, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
  sus4: [0, 5, 7],
  add9: [0, 4, 7, 14],
  min9: [0, 3, 7, 10, 14],
};

/** Common pop progressions as scale degrees (0-indexed) with chord types */
export const PROGRESSIONS: Record<string, { deg: number; type: string }[]> = {
  // minor
  "i-VI-III-VII": [
    { deg: 0, type: "min" },
    { deg: 5, type: "maj" },
    { deg: 2, type: "maj" },
    { deg: 6, type: "maj" },
  ],
  "i-iv-v-VI": [
    { deg: 0, type: "min" },
    { deg: 3, type: "min" },
    { deg: 4, type: "min" },
    { deg: 5, type: "maj" },
  ],
  "i-VII-VI-VII": [
    { deg: 0, type: "min" },
    { deg: 6, type: "maj" },
    { deg: 5, type: "maj" },
    { deg: 6, type: "maj" },
  ],
  // major
  "I-V-vi-IV": [
    { deg: 0, type: "maj" },
    { deg: 4, type: "maj" },
    { deg: 5, type: "min" },
    { deg: 3, type: "maj" },
  ],
  "I-vi-IV-V": [
    { deg: 0, type: "maj" },
    { deg: 5, type: "min" },
    { deg: 3, type: "maj" },
    { deg: 4, type: "maj" },
  ],
  "ii-V-I-vi": [
    { deg: 1, type: "min7" },
    { deg: 4, type: "dom7" },
    { deg: 0, type: "maj7" },
    { deg: 5, type: "min7" },
  ],
};

export function keyLabel(tonic: number, mode: "major" | "minor"): string {
  return `${NOTE_NAMES[tonic]} ${mode === "major" ? "major" : "minor"}`;
}

/** Deterministic pseudo-random generator (mulberry32) */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(g: number): number {
  return 20 * Math.log10(Math.max(g, 1e-6));
}

/** Approximate GB volume slider: 0..1.25 linear display mapping */
export function volumeToSlider(v: number): number {
  return Math.pow(v, 1 / 2.2); // perceptual
}

export function sliderToVolume(s: number): number {
  return Math.pow(s, 2.2);
}

export function projectLengthTicks(project: Project): number {
  let end = 0;
  for (const t of project.tracks) {
    for (const r of t.regions) {
      end = Math.max(end, r.start + r.length);
    }
  }
  const bt = barTicks(project.timeSig);
  return Math.ceil((end + bt) / bt) * bt; // round up to bar
}
