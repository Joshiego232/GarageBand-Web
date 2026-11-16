export interface ChordResult {
  rootNote: number;
  bassNote: number;
  pitchClasses: number[];
  intervals: number[];
  intervalVector: number[];
  quality: string;
  name: string;
  confidence: number;
}

export interface ChordKey {
  tonic: number;
  mode: "major" | "minor";
}

export interface ChordSuggestion {
  tonic: number;
  mode: "major" | "minor";
  name: string;
  score: number;
}

interface ChordTemplate {
  suffix: string;
  intervals: number[];
  core: number[];
}

const TEMPLATES: ChordTemplate[] = [
  { suffix: "maj13", intervals: [0, 2, 4, 5, 7, 9, 11], core: [0, 4, 11] },
  { suffix: "m13", intervals: [0, 2, 3, 5, 7, 9, 10], core: [0, 3, 10] },
  { suffix: "13", intervals: [0, 2, 4, 5, 7, 9, 10], core: [0, 4, 10] },
  { suffix: "maj11", intervals: [0, 2, 4, 5, 7, 11], core: [0, 4, 11] },
  { suffix: "m11", intervals: [0, 2, 3, 5, 7, 10], core: [0, 3, 10] },
  { suffix: "11", intervals: [0, 2, 4, 5, 7, 10], core: [0, 4, 10] },
  { suffix: "maj9", intervals: [0, 2, 4, 7, 11], core: [0, 4, 11] },
  { suffix: "m9", intervals: [0, 2, 3, 7, 10], core: [0, 3, 10] },
  { suffix: "9", intervals: [0, 2, 4, 7, 10], core: [0, 4, 10] },
  { suffix: "7sus4", intervals: [0, 5, 7, 10], core: [0, 5, 10] },
  { suffix: "mMaj7", intervals: [0, 3, 7, 11], core: [0, 3, 11] },
  { suffix: "m7b5", intervals: [0, 3, 6, 10], core: [0, 3, 6, 10] },
  { suffix: "dim7", intervals: [0, 3, 6, 9], core: [0, 3, 6, 9] },
  { suffix: "maj7", intervals: [0, 4, 7, 11], core: [0, 4, 11] },
  { suffix: "m7", intervals: [0, 3, 7, 10], core: [0, 3, 10] },
  { suffix: "7", intervals: [0, 4, 7, 10], core: [0, 4, 10] },
  { suffix: "6", intervals: [0, 4, 7, 9], core: [0, 4, 7] },
  { suffix: "m6", intervals: [0, 3, 7, 9], core: [0, 3, 7] },
  { suffix: "add9", intervals: [0, 2, 4, 7], core: [0, 4, 7] },
  { suffix: "sus2", intervals: [0, 2, 7], core: [0, 2, 7] },
  { suffix: "sus4", intervals: [0, 5, 7], core: [0, 5, 7] },
  { suffix: "dim", intervals: [0, 3, 6], core: [0, 3, 6] },
  { suffix: "aug", intervals: [0, 4, 8], core: [0, 4, 8] },
  { suffix: "5", intervals: [0, 7], core: [0, 7] },
  { suffix: "m", intervals: [0, 3, 7], core: [0, 3, 7] },
  { suffix: "", intervals: [0, 4, 7], core: [0, 4, 7] },
];

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
const mod12 = (value: number) => ((value % 12) + 12) % 12;

function spellings(key?: ChordKey): string[] {
  if (!key) return SHARP_NAMES;
  const signatureTonic = key.mode === "minor" ? mod12(key.tonic + 3) : key.tonic;
  return [1, 3, 5, 6, 8, 10].includes(signatureTonic) ? FLAT_NAMES : SHARP_NAMES;
}

export function formatPitchClass(pitchClass: number, key?: ChordKey): string {
  return spellings(key)[mod12(pitchClass)];
}

export function midiNoteName(note: number, key?: ChordKey): string {
  return `${formatPitchClass(note, key)}${Math.floor(note / 12) - 1}`;
}

export function pitchClassMask(notes: number[]): number {
  return notes.reduce((mask, note) => mask | (1 << mod12(note)), 0);
}

export function calculateIntervalVector(maskOrNotes: number | number[]): number[] {
  const mask = Array.isArray(maskOrNotes) ? pitchClassMask(maskOrNotes) : maskOrNotes;
  const vector = Array<number>(6).fill(0);
  const pcs = Array.from({ length: 12 }, (_, pitchClass) => pitchClass)
    .filter((pitchClass) => (mask & (1 << pitchClass)) !== 0);
  for (let left = 0; left < pcs.length; left += 1) {
    for (let right = left + 1; right < pcs.length; right += 1) {
      const interval = mod12(pcs[right] - pcs[left]);
      const intervalClass = Math.min(interval, 12 - interval);
      if (intervalClass > 0) vector[intervalClass - 1] += 1;
    }
  }
  return vector;
}

function candidateScore(observed: number[], root: number, template: ChordTemplate): number {
  let score = 0;
  for (const interval of observed) {
    score += template.intervals.includes(mod12(interval - root)) ? 5 : -4.5;
  }
  for (const core of template.core) {
    if (!observed.includes(mod12(root + core))) score -= 2.7;
  }
  const matched = observed.filter((note) => template.intervals.includes(mod12(note - root))).length;
  for (const interval of template.intervals) {
    if (template.core.includes(interval) || interval === 7) continue;
    if (!observed.includes(mod12(root + interval))) score -= 1.25;
  }
  score += matched * 0.12 + template.intervals.length * 0.16;
  return score;
}

export function detectChord(notes: number[], key?: ChordKey): ChordResult | null {
  const valid = notes
    .filter((note) => Number.isFinite(note) && note >= 0 && note <= 127)
    .map((note) => Math.round(note));
  const pitchClasses = [...new Set(valid.map(mod12))].sort((a, b) => a - b);
  if (pitchClasses.length < 2) return null;

  let best: { root: number; template: ChordTemplate; score: number } | null = null;
  for (const root of pitchClasses) {
    for (const template of TEMPLATES) {
      const score = candidateScore(pitchClasses, root, template)
        + (mod12(Math.min(...valid)) === root ? 0.55 : 0);
      if (!best || score > best.score) best = { root, template, score };
    }
  }
  if (!best) return null;

  const orderedNotes = [...valid].sort((a, b) => a - b);
  const bassNote = orderedNotes[0];
  const name = `${formatPitchClass(best.root, key)}${best.template.suffix}${
    mod12(bassNote) !== best.root ? `/${formatPitchClass(bassNote, key)}` : ""
  }`;
  const fit = pitchClasses.filter((pitchClass) =>
    best!.template.intervals.includes(mod12(pitchClass - best!.root)),
  ).length;
  const confidence = Math.max(0, Math.min(1, fit / pitchClasses.length));
  return {
    rootNote: best.root,
    bassNote,
    pitchClasses,
    intervals: pitchClasses.map((pitchClass) => mod12(pitchClass - best!.root)).sort((a, b) => a - b),
    intervalVector: calculateIntervalVector(pitchClassMask(pitchClasses)),
    quality: best.template.suffix || "major",
    name,
    confidence,
  };
}

export function suggestKeys(chords: ChordResult[], limit = 2): ChordSuggestion[] {
  const recent = chords.slice(-8);
  if (!recent.length) return [];
  const suggestions: ChordSuggestion[] = [];
  for (let tonic = 0; tonic < 12; tonic += 1) {
    for (const mode of ["major", "minor"] as const) {
      const scale = mode === "major" ? MAJOR_SCALE : MINOR_SCALE;
      const scaleMask = pitchClassMask(scale.map((degree) => tonic + degree));
      const score = recent.reduce((total, chord) => {
        const chordMask = pitchClassMask(chord.pitchClasses);
        const inScale = chord.pitchClasses.filter((pitchClass) => (scaleMask & (1 << pitchClass)) !== 0).length;
        const rootInScale = (scaleMask & (1 << chord.rootNote)) !== 0;
        return total + inScale / Math.max(1, chord.pitchClasses.length) + (rootInScale ? 0.35 : -0.5);
      }, 0) / recent.length;
      suggestions.push({
        tonic,
        mode,
        name: `${formatPitchClass(tonic, { tonic, mode })} ${mode === "major" ? "Major" : "Minor"}`,
        score,
      });
    }
  }
  const seen = new Set<string>();
  return suggestions
    .sort((a, b) => b.score - a.score)
    .filter((suggestion) => {
      if (seen.has(suggestion.name)) return false;
      seen.add(suggestion.name);
      return true;
    })
    .slice(0, limit);
}

export interface ExtractedChord {
  start: number;
  length: number;
  name: string;
  notes: number[];
}

export function analyzeMidiNotesByBar(
  notes: { pitch: number; start: number; length: number }[],
  regionStart: number,
  regionLength: number,
  ticksPerBar: number,
  key?: ChordKey,
): ExtractedChord[] {
  const result: ExtractedChord[] = [];
  const barCount = Math.ceil(regionLength / ticksPerBar);
  for (let bar = 0; bar < barCount; bar += 1) {
    const start = bar * ticksPerBar;
    const end = Math.min(regionLength, start + ticksPerBar);
    const barNotes = notes.filter((note) => note.start < end && note.start + note.length > start);
    const chord = detectChord(barNotes.map((note) => note.pitch), key);
    if (chord) result.push({ start: regionStart + start, length: end - start, name: chord.name, notes: barNotes.map((note) => note.pitch) });
  }
  return result;
}
