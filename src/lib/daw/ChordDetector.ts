export interface ChordResult {
  rootNote: number;
  bassNote: number;
  pitchClasses: number[];
  intervals: number[];
  intervalVector: number[];
  quality: string;
  name: string;
  color: string;
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
  { suffix: "maj13#11", intervals: [0, 2, 4, 6, 7, 9, 11], core: [0, 4, 7, 11] },
  { suffix: "maj13", intervals: [0, 2, 4, 5, 7, 9, 11], core: [0, 4, 11] },
  { suffix: "maj9#11", intervals: [0, 2, 4, 6, 7, 11], core: [0, 4, 11] },
  { suffix: "m13", intervals: [0, 2, 3, 5, 7, 9, 10], core: [0, 3, 10] },
  { suffix: "13", intervals: [0, 2, 4, 5, 7, 9, 10], core: [0, 4, 10] },
  { suffix: "maj11", intervals: [0, 2, 4, 5, 7, 11], core: [0, 4, 11] },
  { suffix: "m11", intervals: [0, 2, 3, 5, 7, 10], core: [0, 3, 10] },
  { suffix: "m9#11", intervals: [0, 2, 3, 6, 7, 10], core: [0, 3, 10] },
  { suffix: "11", intervals: [0, 2, 4, 5, 7, 10], core: [0, 4, 10] },
  { suffix: "maj9", intervals: [0, 2, 4, 7, 11], core: [0, 4, 11] },
  { suffix: "mMaj9", intervals: [0, 2, 3, 7, 11], core: [0, 3, 11] },
  { suffix: "m9", intervals: [0, 2, 3, 7, 10], core: [0, 3, 10] },
  { suffix: "13#11", intervals: [0, 2, 4, 6, 7, 9, 10], core: [0, 4, 10] },
  { suffix: "13b9", intervals: [0, 1, 4, 7, 9, 10], core: [0, 4, 10] },
  { suffix: "13#9", intervals: [0, 3, 4, 7, 9, 10], core: [0, 4, 10] },
  { suffix: "13b5", intervals: [0, 2, 4, 6, 9, 10], core: [0, 4, 10] },
  { suffix: "9#11", intervals: [0, 2, 4, 6, 7, 10], core: [0, 4, 10] },
  { suffix: "9#5", intervals: [0, 2, 4, 8, 10], core: [0, 4, 10] },
  { suffix: "9b5", intervals: [0, 2, 4, 6, 10], core: [0, 4, 10] },
  { suffix: "9", intervals: [0, 2, 4, 7, 10], core: [0, 4, 10] },
  { suffix: "9sus4", intervals: [0, 2, 5, 7, 10], core: [0, 5, 10] },
  { suffix: "13sus4", intervals: [0, 2, 5, 7, 9, 10], core: [0, 5, 10] },
  { suffix: "7b9#11", intervals: [0, 1, 4, 6, 7, 10], core: [0, 4, 10] },
  { suffix: "7#9#11", intervals: [0, 3, 4, 6, 7, 10], core: [0, 4, 10] },
  { suffix: "7b9b13", intervals: [0, 1, 4, 7, 8, 10], core: [0, 4, 10] },
  { suffix: "7#9b13", intervals: [0, 3, 4, 7, 8, 10], core: [0, 4, 10] },
  { suffix: "7b9", intervals: [0, 1, 4, 7, 10], core: [0, 4, 10] },
  { suffix: "7#9", intervals: [0, 3, 4, 7, 10], core: [0, 4, 10] },
  { suffix: "7b13", intervals: [0, 4, 7, 8, 10], core: [0, 4, 10] },
  { suffix: "7#11", intervals: [0, 4, 6, 7, 10], core: [0, 4, 10] },
  { suffix: "7#5", intervals: [0, 4, 8, 10], core: [0, 4, 10] },
  { suffix: "7b5", intervals: [0, 4, 6, 10], core: [0, 4, 10] },
  { suffix: "7alt", intervals: [0, 1, 3, 4, 6, 8, 10], core: [0, 4, 10] },
  { suffix: "7sus4b9", intervals: [0, 1, 5, 7, 10], core: [0, 5, 10] },
  { suffix: "7sus4#9", intervals: [0, 3, 5, 7, 10], core: [0, 5, 10] },
  { suffix: "7sus2", intervals: [0, 2, 7, 10], core: [0, 2, 10] },
  { suffix: "7sus4", intervals: [0, 5, 7, 10], core: [0, 5, 10] },
  { suffix: "mMaj7", intervals: [0, 3, 7, 11], core: [0, 3, 11] },
  { suffix: "m9b5", intervals: [0, 2, 3, 6, 10], core: [0, 3, 6, 10] },
  { suffix: "m7#5", intervals: [0, 3, 8, 10], core: [0, 3, 10] },
  { suffix: "m7b6", intervals: [0, 3, 7, 8, 10], core: [0, 3, 10] },
  { suffix: "m7b5", intervals: [0, 3, 6, 10], core: [0, 3, 6, 10] },
  { suffix: "dimMaj7", intervals: [0, 3, 6, 11], core: [0, 3, 6, 11] },
  { suffix: "augMaj7", intervals: [0, 4, 8, 11], core: [0, 4, 8, 11] },
  { suffix: "dim7", intervals: [0, 3, 6, 9], core: [0, 3, 6, 9] },
  { suffix: "maj7#5", intervals: [0, 4, 8, 11], core: [0, 4, 11] },
  { suffix: "maj7#11", intervals: [0, 4, 6, 7, 11], core: [0, 4, 11] },
  { suffix: "maj7b5", intervals: [0, 4, 6, 11], core: [0, 4, 11] },
  { suffix: "maj7", intervals: [0, 4, 7, 11], core: [0, 4, 11] },
  { suffix: "m7", intervals: [0, 3, 7, 10], core: [0, 3, 10] },
  { suffix: "7", intervals: [0, 4, 7, 10], core: [0, 4, 10] },
  { suffix: "6/9", intervals: [0, 2, 4, 7, 9], core: [0, 4, 7] },
  { suffix: "m6/9", intervals: [0, 2, 3, 7, 9], core: [0, 3, 7] },
  { suffix: "6", intervals: [0, 4, 7, 9], core: [0, 4, 7] },
  { suffix: "m6", intervals: [0, 3, 7, 9], core: [0, 3, 7] },
  { suffix: "m(add11)", intervals: [0, 3, 5, 7], core: [0, 3, 7] },
  { suffix: "m(add9)", intervals: [0, 2, 3, 7], core: [0, 3, 7] },
  { suffix: "add11", intervals: [0, 4, 5, 7], core: [0, 4, 7] },
  { suffix: "add9", intervals: [0, 2, 4, 7], core: [0, 4, 7] },
  { suffix: "quartal", intervals: [0, 5, 10], core: [0, 5, 10] },
  { suffix: "sus2", intervals: [0, 2, 7], core: [0, 2, 7] },
  { suffix: "sus4", intervals: [0, 5, 7], core: [0, 5, 7] },
  { suffix: "dim", intervals: [0, 3, 6], core: [0, 3, 6] },
  { suffix: "aug", intervals: [0, 4, 8], core: [0, 4, 8] },
  { suffix: "5", intervals: [0, 7], core: [0, 7] },
  { suffix: "m", intervals: [0, 3, 7], core: [0, 3, 7] },
  { suffix: "", intervals: [0, 4, 7], core: [0, 4, 7] },
];

interface ScoredChordTemplate extends ChordTemplate {
  intervalMask: number;
  coreMask: number;
  extensionMask: number;
}

const SCORED_TEMPLATES: ScoredChordTemplate[] = TEMPLATES.map((template) => {
  const intervalMask = template.intervals.reduce((mask, interval) => mask | (1 << interval), 0);
  const coreMask = template.core.reduce((mask, interval) => mask | (1 << interval), 0);
  return {
    ...template,
    intervalMask,
    coreMask,
    extensionMask: intervalMask & ~coreMask & ~(1 << 7),
  };
});

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const CHORD_ROOT_COLORS = [
  "#E57373", "#FF8A65", "#FFB74D", "#FFD54F", "#DCE775", "#AED581",
  "#81C784", "#4DB6AC", "#4DD0E1", "#64B5F6", "#7986CB", "#BA68C8",
];
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

function countBits(mask: number): number {
  let count = 0;
  while (mask) {
    mask &= mask - 1;
    count += 1;
  }
  return count;
}

function candidateScore(
  observedMask: number,
  observedCount: number,
  template: ScoredChordTemplate,
  keyScaleMask?: number,
  rootInKey = false,
): number {
  const matched = countBits(observedMask & template.intervalMask);
  let score = matched * 5 - (observedCount - matched) * 4.5;
  score -= countBits(template.coreMask & ~observedMask) * 2.7;
  score -= countBits(template.extensionMask & ~observedMask) * 1.25;
  score += matched * 0.12 + template.intervals.length * 0.16;
  if (keyScaleMask !== undefined) {
    const chordTonesInKey = countBits(template.intervalMask & keyScaleMask);
    score += (rootInKey ? 0.35 : -0.35) +
      chordTonesInKey / template.intervals.length * 0.3;
  }
  return score;
}

export function detectChord(notes: number[], key?: ChordKey): ChordResult | null {
  const valid = notes
    .filter((note) => Number.isFinite(note) && note >= 0 && note <= 127)
    .map((note) => Math.round(note));
  const pitchClasses = [...new Set(valid.map(mod12))].sort((a, b) => a - b);
  if (pitchClasses.length < 2) return null;

  const keyMask = key
    ? pitchClassMask((key.mode === "major" ? MAJOR_SCALE : MINOR_SCALE).map((degree) => key.tonic + degree))
    : undefined;
  const observedMask = pitchClassMask(pitchClasses);
  let best: { root: number; template: ScoredChordTemplate; score: number } | null = null;
  for (const root of pitchClasses) {
    let relativeMask = 0;
    let relativeKeyMask = 0;
    for (let pitchClass = 0; pitchClass < 12; pitchClass += 1) {
      if (observedMask & (1 << pitchClass)) relativeMask |= 1 << mod12(pitchClass - root);
      if (keyMask !== undefined && keyMask & (1 << pitchClass)) {
        relativeKeyMask |= 1 << mod12(pitchClass - root);
      }
    }
    const rootInKey = keyMask !== undefined && (keyMask & (1 << root)) !== 0;
    for (const template of SCORED_TEMPLATES) {
      const score = candidateScore(
        relativeMask,
        pitchClasses.length,
        template,
        keyMask === undefined ? undefined : relativeKeyMask,
        rootInKey,
      )
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
    color: CHORD_ROOT_COLORS[best.root],
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
  color: string;
}

function autoQuantizeChords(chords: ExtractedChord[], ticksPerBeat: number): ExtractedChord[] {
  if (!Number.isFinite(ticksPerBeat) || ticksPerBeat <= 0) return chords;
  const grid = Math.max(1, ticksPerBeat / 4);
  const quantized: ExtractedChord[] = [];
  for (const chord of chords) {
    const previousEnd = quantized.length
      ? quantized[quantized.length - 1].start + quantized[quantized.length - 1].length
      : Number.NEGATIVE_INFINITY;
    const start = Math.max(previousEnd, Math.round(chord.start / grid) * grid);
    const end = Math.round((chord.start + chord.length) / grid) * grid;
    quantized.push({
      ...chord,
      start,
      length: Math.max(grid, end - start),
    });
  }
  return quantized;
}

export interface MidiChordAnalysisRegion {
  start: number;
  length: number;
  notes?: { pitch: number; start: number; length: number }[];
  muted?: boolean;
  looped?: boolean;
  coreLength?: number;
  trackId: string;
}

export function analyzeMidiRegionsByBeat(
  regions: MidiChordAnalysisRegion[],
  ticksPerBar: number,
  beatsPerBar: number,
  key?: ChordKey,
): ExtractedChord[] {
  const ticksPerBeat = ticksPerBar / beatsPerBar;
  if (!Number.isFinite(ticksPerBeat) || ticksPerBeat <= 0) return [];

  const beats = new Map<number, {
    pitches: Set<number>;
    trackIds: Set<string>;
    start: number;
    end: number;
  }>();
  const addNoteToBeat = (beatStart: number, pitch: number, trackId: string, start: number, end: number) => {
    let beat = beats.get(beatStart);
    if (!beat) {
      beat = { pitches: new Set(), trackIds: new Set(), start, end };
      beats.set(beatStart, beat);
    }
    beat.pitches.add(pitch);
    beat.trackIds.add(trackId);
    beat.start = Math.min(beat.start, start);
    beat.end = Math.max(beat.end, end);
  };

  for (const region of regions) {
    if (region.muted || !region.notes?.length ||
      !Number.isFinite(region.start) || !Number.isFinite(region.length) || region.length <= 0) continue;

    const regionEnd = region.start + region.length;
    const loopLength = region.looped && Number.isFinite(region.coreLength) && (region.coreLength ?? 0) > 0
      ? Math.min(region.length, region.coreLength!)
      : region.length;
    for (let offset = 0; offset < region.length; offset += loopLength) {
      for (const note of region.notes) {
        if (!Number.isFinite(note.pitch) || !Number.isFinite(note.start) ||
          !Number.isFinite(note.length) || note.length <= 0 || note.start >= loopLength) continue;
        const noteStart = Math.max(0, note.start);
        const start = region.start + offset + noteStart;
        const end = Math.min(regionEnd, region.start + offset + note.start + note.length);
        if (end <= start) continue;
        const pitch = Math.round(note.pitch);
        if (pitch < 0 || pitch > 127) continue;

        const firstBeat = Math.floor(start / ticksPerBeat) * ticksPerBeat;
        for (let beatStart = firstBeat; beatStart < end; beatStart += ticksPerBeat) {
          addNoteToBeat(
            beatStart,
            pitch,
            region.trackId,
            Math.max(start, beatStart),
            Math.min(end, beatStart + ticksPerBeat),
          );
        }
      }
    }
  }

  const result: ExtractedChord[] = [];
  for (const [beatStart, beat] of [...beats.entries()].sort(([a], [b]) => a - b)) {
    const pitches = [...beat.pitches].sort((a, b) => a - b);
    if (pitches.length < 2 || (pitches.length < 3 && beat.trackIds.size < 2)) continue;
    const chord = detectChord(pitches, key);
    if (!chord) continue;

    const start = Math.max(beatStart, beat.start);
    const end = Math.min(beatStart + ticksPerBeat, beat.end);
    if (end <= start) continue;
    const previous = result[result.length - 1];
    if (previous && previous.start + previous.length === start && previous.name === chord.name) {
      previous.length += end - start;
      previous.notes = [...new Set([...previous.notes, ...pitches])].sort((a, b) => a - b);
    } else {
      result.push({
        start,
        length: end - start,
        name: chord.name,
        notes: pitches,
        color: chord.color,
      });
    }
  }
  return autoQuantizeChords(result, ticksPerBeat);
}

export function analyzeMidiNotesByBar(
  notes: { pitch: number; start: number; length: number }[],
  regionStart: number,
  regionLength: number,
  ticksPerBar: number,
  key?: ChordKey,
  beatsPerBar = 4,
): ExtractedChord[] {
  if (!Number.isFinite(regionStart) || !Number.isFinite(regionLength) || regionLength <= 0) return [];

  const events = new Map<number, { starts: { id: number; pitch: number }[]; ends: number[] }>();
  const addEvent = (tick: number) => {
    let event = events.get(tick);
    if (!event) {
      event = { starts: [], ends: [] };
      events.set(tick, event);
    }
    return event;
  };
  notes.forEach((note, id) => {
    if (!Number.isFinite(note.pitch) || !Number.isFinite(note.start) ||
      !Number.isFinite(note.length) || note.length <= 0) return;
    const start = Math.max(0, note.start);
    const end = Math.min(regionLength, note.start + note.length);
    if (end <= start) return;
    addEvent(start).starts.push({ id, pitch: Math.round(note.pitch) });
    addEvent(end).ends.push(id);
  });

  const ticks = [...events.keys()].sort((a, b) => a - b);
  const active = new Map<number, number>();
  const result: ExtractedChord[] = [];
  for (let index = 0; index < ticks.length - 1; index += 1) {
    const start = ticks[index];
    const event = events.get(start)!;
    for (const id of event.ends) active.delete(id);
    for (const note of event.starts) active.set(note.id, note.pitch);

    const end = ticks[index + 1];
    if (end <= start) continue;
    const activeNotes = [...active.values()];
    const chord = detectChord(activeNotes, key);
    if (!chord) continue;

    const previous = result[result.length - 1];
    if (previous && previous.start + previous.length === regionStart + start &&
      previous.name === chord.name) {
      previous.length += end - start;
      previous.notes = [...new Set([...previous.notes, ...activeNotes])].sort((a, b) => a - b);
    } else {
      result.push({
        start: regionStart + start,
        length: end - start,
        name: chord.name,
        notes: [...new Set(activeNotes)].sort((a, b) => a - b),
        color: chord.color,
      });
    }
  }
  return autoQuantizeChords(result, ticksPerBar / beatsPerBar);
}
