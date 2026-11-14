// ============================================================
// Loop library: generative MIDI loops (drums, bass, chords, melodies)
// All loops are green-style MIDI loops: they follow project tempo & key
// ============================================================
import { PPQ, type LoopDef, type Note, type Project, type Track, uid } from "./types";
import {
  makeRng,
  scalePitch,
  CHORD_TYPES,
  PROGRESSIONS,
  clamp,
} from "./utils";
import { PATCHES, defaultParams } from "./instruments";

export type LoopNotes = { pitch: number; velocity: number; start: number; len: number }[];

// ---------- drum patterns (16 steps per bar, step = 16th) ----------
// K=kick 36, S=snare 38, h=hat 42, H=open hat 46, C=clap 39, T=toms, R=rim 37, r=ride 51, c=crash 49

interface DrumPattern {
  steps: Record<number, number[]>; // step -> [pitches]
  swing?: number; // 0..0.6 of a 16th
}

function pattern(map: Record<number, number[]>): DrumPattern {
  return { steps: map };
}

const DRUM_PATTERNS: Record<string, DrumPattern> = {
  "rock-basic": pattern({ 0: [36, 49], 2: [42], 4: [38], 6: [42], 8: [36], 10: [42], 12: [38], 14: [42] }),
  "rock-driving": pattern({ 0: [36, 49], 2: [42], 3: [36], 4: [38], 6: [42], 7: [42], 8: [36], 10: [42], 11: [36], 12: [38], 14: [42], 15: [42] }),
  "pop-groove": pattern({ 0: [36, 49], 2: [42], 4: [38], 6: [36, 42], 8: [38, 42], 10: [42], 12: [42], 14: [36] }),
  "pop-busy": pattern({ 0: [36, 49], 2: [42], 4: [42], 6: [36, 42], 8: [38, 42], 10: [36, 42], 12: [42], 14: [42] }),
  "hiphop-boom": pattern({ 0: [36], 2: [42], 5: [42], 6: [42], 7: [36], 8: [38], 10: [36], 12: [42], 14: [42], 15: [42] }),
  "hiphop-trap": pattern({ 0: [36], 2: [42], 3: [42], 4: [42], 6: [36, 42], 7: [36], 8: [42], 10: [42], 11: [42], 12: [42], 14: [42], 15: [42] }),
  "house-4floor": pattern({ 0: [36, 51], 2: [46], 4: [36, 39], 6: [46], 8: [36, 51], 10: [46], 12: [36, 39], 14: [46] }),
  "house-groove": pattern({ 0: [36, 51], 2: [46], 4: [36, 39], 6: [46], 7: [42], 8: [36], 10: [46], 12: [36, 39], 14: [46], 15: [42] }),
  "funk-pocket": pattern({ 0: [36], 2: [42], 3: [42], 4: [38], 6: [36, 42], 7: [37], 9: [36], 10: [42], 11: [42], 12: [38], 13: [38], 14: [42], 15: [42] }),
  "disco-classic": pattern({ 0: [36], 1: [42], 2: [38], 3: [46], 4: [36], 5: [42], 6: [38], 7: [46], 8: [36], 9: [42], 10: [38], 11: [46], 12: [36], 13: [42], 14: [38], 15: [46] }),
  "shuffle-blues": pattern({ 0: [36], 2: [42], 4: [38], 5: [42], 6: [42], 8: [38, 42], 11: [42], 14: [36, 42] }),
  "punk-fast": pattern({ 0: [36, 49, 42], 2: [42], 4: [38, 42], 6: [42], 8: [36, 42], 10: [42], 12: [38, 42], 14: [42] }),
  "latin-clave": pattern({ 0: [36], 2: [42], 3: [37], 4: [38], 6: [37, 42], 8: [47], 10: [36, 42], 12: [37, 38, 45], 14: [42] }),
  "ballad-brush": pattern({ 0: [36, 51], 2: [42], 4: [38], 6: [42], 8: [36, 51], 10: [42], 12: [38], 14: [42] }),
};

function generateDrumNotes(def: LoopDef, bars: number): LoopNotes {
  const pat = DRUM_PATTERNS[def.genre] ?? DRUM_PATTERNS["pop-groove"];
  const stepsPerBar = 16;
  const totalSteps = bars * stepsPerBar;
  const notes: LoopNotes = [];
  const rng = makeRng(def.seed);
  const stepTicks = PPQ / 4;
  for (let s = 0; s < totalSteps; s++) {
    const inBar = s % stepsPerBar;
    const pitches = pat.steps[inBar];
    if (!pitches) continue;
    for (const p of pitches) {
      // ghost notes & velocity humanization
      let vel = 96;
      if (p === 42) vel = 52 + Math.floor(rng() * 22);
      if (p === 38) vel = 92 + Math.floor(rng() * 20);
      if (p === 36) vel = 108;
      let start = s * stepTicks;
      // swing: delay off-8th 16ths
      if (pat.swing && inBar % 2 === 1) start += Math.floor(pat.swing * stepTicks);
      notes.push({ pitch: p, velocity: vel, start, len: stepTicks * 0.9 });
    }
  }
  return notes;
}

// ---------- bass patterns ----------
function generateBassNotes(def: LoopDef, bars: number, tonic: number, mode: "major" | "minor"): LoopNotes {
  const notes: LoopNotes = [];
  const rng = makeRng(def.seed);
  const prog = PROGRESSIONS[mode === "minor" ? "i-VI-III-VII" : "I-V-vi-IV"];
  const eighth = PPQ / 2;
  const style = def.genre;
  for (let bar = 0; bar < bars; bar++) {
    const chord = prog[bar % prog.length];
    const root = scalePitch(tonic, chord.deg, mode) - 24; // bass octave
    const rootMidi = 36 + (((root % 12) + 12) % 12) + (root < 36 ? 12 : 0);
    if (style === "sub-drone") {
      notes.push({ pitch: rootMidi, velocity: 110, start: bar * 4 * PPQ, len: 4 * PPQ * 0.98 });
    } else if (style === "808-flow") {
      notes.push({ pitch: rootMidi, velocity: 112, start: bar * 4 * PPQ, len: PPQ * 1.8 });
      if (rng() > 0.5) notes.push({ pitch: rootMidi + (rng() > 0.5 ? 3 : -2), velocity: 96, start: bar * 4 * PPQ + 2.5 * PPQ, len: PPQ * 1.2 });
    } else if (style === "walking") {
      const fifth = rootMidi + 7;
      const notesSeq = [rootMidi, rootMidi, fifth, rootMidi + (rng() > 0.5 ? 12 : 10)];
      for (let b = 0; b < 4; b++) {
        notes.push({ pitch: notesSeq[b], velocity: 100, start: bar * 4 * PPQ + b * PPQ, len: eighth * 0.9 });
      }
    } else {
      // eighths pop/funk
      for (let e = 0; e < 8; e++) {
        if (style === "funk" && rng() > 0.62) continue;
        const p = e % 4 === 3 && rng() > 0.6 ? rootMidi + 7 : rootMidi;
        notes.push({ pitch: p, velocity: e % 2 === 0 ? 104 : 84, start: bar * 4 * PPQ + e * eighth, len: eighth * 0.85 });
      }
    }
  }
  return notes;
}

// ---------- chord patterns ----------
function generateChordNotes(def: LoopDef, bars: number, tonic: number, mode: "major" | "minor"): LoopNotes {
  const notes: LoopNotes = [];
  const rng = makeRng(def.seed);
  const progKey = Object.keys(PROGRESSIONS)[Math.floor(rng() * 3) + (mode === "minor" ? 0 : 3)];
  const prog = PROGRESSIONS[progKey] ?? PROGRESSIONS["i-VI-III-VII"];
  const style = def.genre;
  for (let bar = 0; bar < bars; bar++) {
    const chord = prog[bar % prog.length];
    const intervals = CHORD_TYPES[chord.type] ?? CHORD_TYPES.maj;
    const root = scalePitch(tonic, chord.deg, mode) + 12; // mid register
    const barStart = bar * 4 * PPQ;
    if (style === "pad" || style === "swell") {
      for (const iv of intervals) {
        notes.push({ pitch: root + iv, velocity: 76, start: barStart, len: 4 * PPQ * 0.99 });
      }
    } else if (style === "piano-block") {
      for (const iv of intervals) {
        notes.push({ pitch: root + iv, velocity: 92, start: barStart + Math.floor(rng() * 30), len: 4 * PPQ * 0.6 });
      }
    } else if (style === "broken") {
      const seq = [0, 1, 2, 1, 0, 2, 1, 2];
      for (let e = 0; e < 8; e++) {
        notes.push({ pitch: root + intervals[seq[e] % intervals.length], velocity: e % 2 ? 68 : 88, start: barStart + e * (PPQ / 2), len: PPQ / 2 * 0.95 });
      }
    } else if (style === "arp-up") {
      const all = [...intervals, intervals[0] + 12];
      for (let s = 0; s < 16; s++) {
        notes.push({ pitch: root + all[s % all.length], velocity: s % 4 === 0 ? 90 : 64, start: barStart + s * (PPQ / 4), len: PPQ / 4 * 0.9 });
      }
    } else if (style === "guitar-strum") {
      for (let e = 0; e < 4; e++) {
        intervals.forEach((iv, i) => {
          notes.push({ pitch: root + iv, velocity: 78, start: barStart + e * PPQ + i * 40, len: PPQ * 0.8 });
        });
      }
    } else if (style === "stab") {
      for (const off of [0, 1.5, 2.5]) {
        for (const iv of intervals) {
          notes.push({ pitch: root + iv, velocity: 102, start: barStart + off * PPQ, len: PPQ * 0.28 });
        }
      }
    }
  }
  return notes;
}

// ---------- melodies ----------
function generateMelodyNotes(def: LoopDef, bars: number, tonic: number, mode: "major" | "minor"): LoopNotes {
  const notes: LoopNotes = [];
  const rng = makeRng(def.seed);
  const prog = PROGRESSIONS[mode === "minor" ? "i-VI-III-VII" : "I-V-vi-IV"];
  const scale = mode === "minor" ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const pent = mode === "minor" ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
  const style = def.genre;
  let deg = 2 + Math.floor(rng() * 3);
  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * 4 * PPQ;
    if (style === "hook") {
      // catchy syncopated hook on beats
      const rhythm = [0, 0.75, 1.5, 2, 3, 3.5];
      for (const beatOff of rhythm) {
        if (rng() > 0.82) continue;
        deg += Math.floor(rng() * 5) - 2;
        deg = clamp(deg, 0, 9);
        const octave = Math.floor(deg / 5);
        const pc = tonic + pent[((deg % 5) + 5) % 5] + 12 * (octave + 2);
        notes.push({ pitch: pc, velocity: 96, start: barStart + beatOff * PPQ, len: PPQ * (rng() > 0.6 ? 0.7 : 0.45) });
      }
    } else if (style === "flow") {
      // steady 8th note flow
      let d = deg;
      for (let e = 0; e < 8; e++) {
        if (rng() > 0.85) continue;
        d += Math.floor(rng() * 3) - 1;
        d = clamp(d, 0, 9);
        const octave = Math.floor(d / 7);
        const pc = tonic + scale[((d % 7) + 7) % 7] + 12 * (octave + 2);
        notes.push({ pitch: pc, velocity: 86, start: barStart + e * (PPQ / 2), len: PPQ / 2 * 0.9 });
      }
      deg = d;
    } else if (style === "sparse") {
      const spots = [0, 1, 2.5];
      for (const beatOff of spots) {
        if (rng() > 0.6) continue;
        const pc = tonic + pent[Math.floor(rng() * 5)] + 12 * 3;
        notes.push({ pitch: pc, velocity: 82, start: barStart + beatOff * PPQ, len: PPQ * 1.2 });
      }
    }
  }
  return notes;
}

/** Generate the notes for a loop, adapted to the project key */
export function generateLoopNotes(
  def: LoopDef,
  tonic: number,
  mode: "major" | "minor",
  bars?: number
): LoopNotes {
  const b = bars ?? def.bars;
  if (def.keyAgnostic) return generateDrumNotes(def, b);
  if (def.category === "Bass") return generateBassNotes(def, b, tonic, mode);
  if (def.category === "Chords" || def.category === "Pads") return generateChordNotes(def, b, tonic, mode);
  return generateMelodyNotes(def, b, tonic, mode);
}

/** Create a MIDI region from a loop, snapped to the project grid */
export function loopToRegion(def: LoopDef, trackId: string, startTick: number, project: Project) {
  const notes = generateLoopNotes(def, project.keyTonic, project.keyMode, def.bars);
  const bt = 4 * PPQ;
  return {
    id: uid(),
    trackId,
    type: "midi" as const,
    name: def.name,
    start: Math.max(0, Math.round(startTick / bt) * bt),
    length: def.bars * bt,
    looped: false,
    notes: notes.map((n) => ({
      id: uid(),
      pitch: n.pitch,
      velocity: n.velocity,
      start: n.start,
      length: n.len,
    })) as Note[],
  };
}

// ---------- loop catalog ----------
export const LOOPS: LoopDef[] = [
  // Drums
  { id: "dr-rock-basic", name: "Rock Beat", category: "Drums", genre: "rock-basic", instrument: "drum-kit", bars: 2, keyAgnostic: true, seed: 11, tempoHint: 110, desc: "Classic backbeat" },
  { id: "dr-rock-drive", name: "Driving Rock", category: "Drums", genre: "rock-driving", instrument: "drum-kit", bars: 2, keyAgnostic: true, seed: 12, tempoHint: 130, desc: "Eighth-note energy" },
  { id: "dr-pop", name: "Pop Groove", category: "Drums", genre: "pop-groove", instrument: "drum-kit", bars: 2, keyAgnostic: true, seed: 13, tempoHint: 100, desc: "Radio-ready beat" },
  { id: "dr-pop-busy", name: "Pop Busy", category: "Drums", genre: "pop-busy", instrument: "drum-kit", bars: 2, keyAgnostic: true, seed: 14, tempoHint: 105, desc: "Sixteenth hats" },
  { id: "dr-boom", name: "Boom Bap", category: "Drums", genre: "hiphop-boom", instrument: "drum-kit", bars: 2, keyAgnostic: true, seed: 15, tempoHint: 90, desc: "Golden-age hip-hop" },
  { id: "dr-trap", name: "Trap Roll", category: "Drums", genre: "hiphop-trap", instrument: "808-kit", bars: 2, keyAgnostic: true, seed: 16, tempoHint: 140, desc: "Rolling hats" },
  { id: "dr-house", name: "Four on Floor", category: "Drums", genre: "house-4floor", instrument: "808-kit", bars: 2, keyAgnostic: true, seed: 17, tempoHint: 124, desc: "Club groove" },
  { id: "dr-house2", name: "House Groove", category: "Drums", genre: "house-groove", instrument: "808-kit", bars: 2, keyAgnostic: true, seed: 18, tempoHint: 122, desc: "Clap house" },
  { id: "dr-funk", name: "Funk Pocket", category: "Drums", genre: "funk-pocket", instrument: "drum-kit", bars: 2, keyAgnostic: true, seed: 19, tempoHint: 98, desc: "Ghost-note snare" },
  { id: "dr-disco", name: "Disco Beat", category: "Drums", genre: "disco-classic", instrument: "drum-kit", bars: 2, keyAgnostic: true, seed: 20, tempoHint: 118, desc: "Open-hat disco" },
  { id: "dr-shuffle", name: "Shuffle", category: "Drums", genre: "shuffle-blues", instrument: "drum-kit", bars: 2, keyAgnostic: true, seed: 21, tempoHint: 84, desc: "Blues shuffle" },
  { id: "dr-punk", name: "Punk Fast", category: "Drums", genre: "punk-fast", instrument: "drum-kit", bars: 1, keyAgnostic: true, seed: 22, tempoHint: 160, desc: "Fast and loud" },
  { id: "dr-latin", name: "Latin Clave", category: "Drums", genre: "latin-clave", instrument: "drum-kit", bars: 2, keyAgnostic: true, seed: 23, tempoHint: 104, desc: "Clave and toms" },
  { id: "dr-ballad", name: "Ballad Brush", category: "Drums", genre: "ballad-brush", instrument: "drum-kit", bars: 2, keyAgnostic: true, seed: 24, tempoHint: 72, desc: "Gentle ballad" },
  // Bass
  { id: "bs-sub", name: "Sub Drone", category: "Bass", genre: "sub-drone", instrument: "sub-bass", bars: 2, seed: 31, mode: "minor" },
  { id: "bs-808", name: "808 Flow", category: "Bass", genre: "808-flow", instrument: "808-bass", bars: 2, seed: 32, mode: "minor" },
  { id: "bs-walk", name: "Walking Bass", category: "Bass", genre: "walking", instrument: "pluck-bass", bars: 2, seed: 33, mode: "major" },
  { id: "bs-pop", name: "Pop Eighths", category: "Bass", genre: "pop", instrument: "pluck-bass", bars: 2, seed: 34, mode: "major" },
  { id: "bs-funk", name: "Funk Bass", category: "Bass", genre: "funk", instrument: "pluck-bass", bars: 2, seed: 35, mode: "minor" },
  // Chords
  { id: "ch-pad", name: "Warm Pad Chords", category: "Pads", genre: "pad", instrument: "warm-pad", bars: 4, seed: 41, mode: "minor" },
  { id: "ch-swell", name: "String Swell", category: "Pads", genre: "swell", instrument: "string-ensemble", bars: 4, seed: 42, mode: "minor" },
  { id: "ch-block", name: "Piano Chords", category: "Chords", genre: "piano-block", instrument: "grand-piano", bars: 4, seed: 43, mode: "major" },
  { id: "ch-broken", name: "Broken Piano", category: "Chords", genre: "broken", instrument: "grand-piano", bars: 2, seed: 44, mode: "major" },
  { id: "ch-epiano", name: "E.Piano Chords", category: "Chords", genre: "piano-block", instrument: "stage-epiano", bars: 4, seed: 45, mode: "minor" },
  { id: "ch-arp", name: "Arp Pattern", category: "Chords", genre: "arp-up", instrument: "celesta", bars: 2, seed: 46, mode: "minor" },
  { id: "ch-guitar", name: "Strummed Guitar", category: "Chords", genre: "guitar-strum", instrument: "steel-guitar", bars: 2, seed: 47, mode: "major" },
  { id: "ch-stab", name: "Synth Stabs", category: "Chords", genre: "stab", instrument: "saw-lead", bars: 2, seed: 48, mode: "minor" },
  { id: "ch-organ", name: "Organ Chords", category: "Chords", genre: "piano-block", instrument: "tonewheel-organ", bars: 4, seed: 49, mode: "major" },
  // Melody
  { id: "me-hook", name: "Pop Hook", category: "Melody", genre: "hook", instrument: "saw-lead", bars: 2, seed: 51, mode: "major" },
  { id: "me-hook-min", name: "Minor Hook", category: "Melody", genre: "hook", instrument: "saw-lead", bars: 2, seed: 52, mode: "minor" },
  { id: "me-flow", name: "Melodic Flow", category: "Melody", genre: "flow", instrument: "stage-epiano", bars: 2, seed: 53, mode: "minor" },
  { id: "me-sparse", name: "Sparse Bells", category: "Melody", genre: "sparse", instrument: "celesta", bars: 2, seed: 54, mode: "minor" },
  { id: "me-flute", name: "Flute Line", category: "Melody", genre: "flow", instrument: "wood-flute", bars: 2, seed: 55, mode: "major" },
];

export const LOOP_CATEGORIES = ["All", "Drums", "Bass", "Chords", "Pads", "Melody"];

// ============================================================
// Track + project factories
// ============================================================

export function makeTrack(partial: Partial<Track> & { type: "midi" | "audio" }): Track {
  const instrument = partial.instrument ?? (partial.type === "midi" ? "grand-piano" : "");
  const patch = PATCHES[instrument];
  return {
    id: partial.id ?? uid(),
    role: partial.role ?? "track",
    outputBusId: partial.outputBusId ?? null,
    vcaId: partial.vcaId ?? null,
    stackId: partial.stackId ?? null,
    parentTrackId: partial.parentTrackId ?? null,
    collapsed: partial.collapsed ?? false,
    name: partial.name ?? patch?.name ?? "Audio",
    type: partial.type,
    icon: partial.icon ?? (partial.type === "audio" ? "mic" : patch?.icon ?? "piano"),
    color: partial.color ?? (partial.type === "midi" ? "#8fb44a" : "#4a90d9"),
    instrument,
    volume: partial.volume ?? 0.9,
    pan: partial.pan ?? 0,
    mute: false,
    solo: false,
    armed: partial.armed ?? false,
    inputMonitor: partial.inputMonitor ?? false,
    compressor: partial.compressor ?? false,
    eq: partial.eq ?? { lowGain: 0, lowFreq: 90, midGain: 0, midFreq: 1000, midQ: 1, highGain: 0, highFreq: 8000 },
    params: partial.params ?? defaultParams(instrument),
    midiPlugins: partial.midiPlugins ?? [],
    audioPlugins: partial.audioPlugins ?? [],
    regions: partial.regions ?? [],
  };
}

export function emptyProject(name = "My Song"): Project {
  return {
    name,
    tempo: 100,
    timeSig: [4, 4],
    keyTonic: 0,
    keyMode: "minor",
    cycleOn: false,
    cycleStart: 0,
    cycleEnd: 4 * 4 * PPQ,
    countIn: true,
    metronome: false,
    masterVolume: 0.9,
    tracks: [],
    stacks: [],
    alternatives: [],
    screensets: [],
  };
}

// ============================================================
// Demo song: "Neon Horizon" - 24 bars, A minor, 100 BPM
// ============================================================

export function demoProject(): Project {
  const project = emptyProject("Neon Horizon");
  project.tempo = 100;
  project.keyTonic = 9; // A
  project.keyMode = "minor";
  const bt = 4 * PPQ;

  const pad = makeTrack({ type: "midi", name: "Cinematic Pad", instrument: "warm-pad", color: "#7a6fd0" });
  const piano = makeTrack({ type: "midi", name: "Grand Piano", instrument: "grand-piano", color: "#8fb44a" });
  const bass = makeTrack({ type: "midi", name: "Fingered Bass", instrument: "pluck-bass", color: "#e08e3c" });
  const drums = makeTrack({ type: "midi", name: "Pop Drums", instrument: "drum-kit", color: "#d9b13b" });
  const arp = makeTrack({ type: "midi", name: "Celesta Arp", instrument: "celesta", color: "#c65cb8" });
  const lead = makeTrack({ type: "midi", name: "Lead Synth", instrument: "saw-lead", color: "#e0533d" });

  const padLoop = LOOPS.find((l) => l.id === "ch-pad")!;
  const pianoLoop = LOOPS.find((l) => l.id === "ch-broken")!;
  const bassLoop = LOOPS.find((l) => l.id === "bs-pop")!;
  const drumLoop = LOOPS.find((l) => l.id === "dr-pop")!;
  const drumBusy = LOOPS.find((l) => l.id === "dr-pop-busy")!;
  const arpLoop = LOOPS.find((l) => l.id === "ch-arp")!;
  const hookLoop = LOOPS.find((l) => l.id === "me-hook")!;

  // 24-bar arrangement: 8 intro, 8 verse, 8 chorus
  pad.regions.push(
    loopToRegion({ ...padLoop, seed: 41 }, pad.id, 0, project),
    loopToRegion({ ...padLoop, seed: 41 }, pad.id, 4 * bt, project),
    loopToRegion({ ...padLoop, seed: 41 }, pad.id, 8 * bt, project),
    loopToRegion({ ...padLoop, seed: 41 }, pad.id, 12 * bt, project),
    loopToRegion({ ...padLoop, seed: 41 }, pad.id, 16 * bt, project),
    loopToRegion({ ...padLoop, seed: 41 }, pad.id, 20 * bt, project)
  );
  piano.regions.push(
    loopToRegion({ ...pianoLoop, seed: 44 }, piano.id, 0, project),
    loopToRegion({ ...pianoLoop, seed: 44 }, piano.id, 2 * bt, project),
    loopToRegion({ ...pianoLoop, seed: 44 }, piano.id, 4 * bt, project),
    loopToRegion({ ...pianoLoop, seed: 44 }, piano.id, 6 * bt, project),
    loopToRegion({ ...pianoLoop, seed: 44 }, piano.id, 16 * bt, project),
    loopToRegion({ ...pianoLoop, seed: 44 }, piano.id, 18 * bt, project)
  );
  bass.regions.push(
    loopToRegion({ ...bassLoop, seed: 34 }, bass.id, 4 * bt, project),
    loopToRegion({ ...bassLoop, seed: 34 }, bass.id, 6 * bt, project),
    loopToRegion({ ...bassLoop, seed: 34 }, bass.id, 8 * bt, project),
    loopToRegion({ ...bassLoop, seed: 34 }, bass.id, 10 * bt, project),
    loopToRegion({ ...bassLoop, seed: 34 }, bass.id, 12 * bt, project),
    loopToRegion({ ...bassLoop, seed: 34 }, bass.id, 14 * bt, project),
    loopToRegion({ ...bassLoop, seed: 34 }, bass.id, 16 * bt, project),
    loopToRegion({ ...bassLoop, seed: 34 }, bass.id, 18 * bt, project),
    loopToRegion({ ...bassLoop, seed: 34 }, bass.id, 20 * bt, project),
    loopToRegion({ ...bassLoop, seed: 34 }, bass.id, 22 * bt, project)
  );
  drums.regions.push(
    loopToRegion({ ...drumLoop, seed: 13 }, drums.id, 4 * bt, project),
    loopToRegion({ ...drumLoop, seed: 13 }, drums.id, 6 * bt, project),
    loopToRegion({ ...drumLoop, seed: 13 }, drums.id, 8 * bt, project),
    loopToRegion({ ...drumLoop, seed: 13 }, drums.id, 10 * bt, project),
    loopToRegion({ ...drumLoop, seed: 13 }, drums.id, 12 * bt, project),
    loopToRegion({ ...drumLoop, seed: 13 }, drums.id, 14 * bt, project),
    loopToRegion({ ...drumBusy, seed: 14 }, drums.id, 16 * bt, project),
    loopToRegion({ ...drumBusy, seed: 14 }, drums.id, 18 * bt, project),
    loopToRegion({ ...drumBusy, seed: 14 }, drums.id, 20 * bt, project),
    loopToRegion({ ...drumBusy, seed: 14 }, drums.id, 22 * bt, project)
  );
  arp.regions.push(
    loopToRegion({ ...arpLoop, seed: 46 }, arp.id, 8 * bt, project),
    loopToRegion({ ...arpLoop, seed: 46 }, arp.id, 10 * bt, project),
    loopToRegion({ ...arpLoop, seed: 46 }, arp.id, 12 * bt, project),
    loopToRegion({ ...arpLoop, seed: 46 }, arp.id, 14 * bt, project),
    loopToRegion({ ...arpLoop, seed: 46 }, arp.id, 16 * bt, project),
    loopToRegion({ ...arpLoop, seed: 46 }, arp.id, 18 * bt, project),
    loopToRegion({ ...arpLoop, seed: 46 }, arp.id, 20 * bt, project),
    loopToRegion({ ...arpLoop, seed: 46 }, arp.id, 22 * bt, project)
  );
  lead.regions.push(
    loopToRegion({ ...hookLoop, seed: 51 }, lead.id, 16 * bt, project),
    loopToRegion({ ...hookLoop, seed: 51 }, lead.id, 18 * bt, project),
    loopToRegion({ ...hookLoop, seed: 51 }, lead.id, 20 * bt, project),
    loopToRegion({ ...hookLoop, seed: 51 }, lead.id, 22 * bt, project)
  );
  lead.params.reverb = 0.25;
  lead.params.delay = 0.18;
  arp.params.reverb = 0.3;
  pad.params.reverb = 0.35;
  drums.params.reverb = 0.08;

  project.tracks = [drums, bass, piano, pad, arp, lead];
  return project;
}

// ============================================================
// Templates
// ============================================================

export interface TemplateDef {
  id: string;
  name: string;
  desc: string;
  build: () => Project;
}

export const TEMPLATES: TemplateDef[] = [
  {
    id: "empty",
    name: "Empty Project",
    desc: "Start from scratch with one track",
    build: () => {
      const p = emptyProject();
      p.tracks = [makeTrack({ type: "midi", instrument: "grand-piano" })];
      return p;
    },
  },
  {
    id: "hiphop",
    name: "Hip-Hop",
    desc: "808s, trap hats and a dark pad",
    build: () => {
      const p = emptyProject("Hip-Hop Idea");
      p.tempo = 140;
      p.keyMode = "minor";
      p.keyTonic = 6;
      const drums = makeTrack({ type: "midi", instrument: "808-kit", name: "Trap Drums" });
      const bass = makeTrack({ type: "midi", instrument: "808-bass", name: "808 Bass" });
      const pad = makeTrack({ type: "midi", instrument: "warm-pad", name: "Dark Pad", color: "#7a6fd0" });
      const bell = makeTrack({ type: "midi", instrument: "celesta", name: "Bell Lead", color: "#c65cb8" });
      const trap = LOOPS.find((l) => l.id === "dr-trap")!;
      const b808 = LOOPS.find((l) => l.id === "bs-808")!;
      const padLoop = LOOPS.find((l) => l.id === "ch-pad")!;
      const bellLoop = LOOPS.find((l) => l.id === "me-sparse")!;
      drums.regions.push(loopToRegion(trap, drums.id, 0, p), loopToRegion(trap, drums.id, 2 * 4 * PPQ, p), loopToRegion(trap, drums.id, 4 * 4 * PPQ, p), loopToRegion(trap, drums.id, 6 * 4 * PPQ, p));
      bass.regions.push(loopToRegion(b808, bass.id, 0, p), loopToRegion(b808, bass.id, 2 * 4 * PPQ, p), loopToRegion(b808, bass.id, 4 * 4 * PPQ, p), loopToRegion(b808, bass.id, 6 * 4 * PPQ, p));
      pad.regions.push(loopToRegion({ ...padLoop, bars: 4 }, pad.id, 0, p), loopToRegion({ ...padLoop, bars: 4 }, pad.id, 4 * 4 * PPQ, p));
      bell.regions.push(loopToRegion(bellLoop, bell.id, 4 * 4 * PPQ, p), loopToRegion(bellLoop, bell.id, 6 * 4 * PPQ, p));
      p.tracks = [drums, bass, pad, bell];
      return p;
    },
  },
  {
    id: "edm",
    name: "Electronic",
    desc: "House drums, saw lead and stabs",
    build: () => {
      const p = emptyProject("Electronic Idea");
      p.tempo = 124;
      p.keyMode = "minor";
      const drums = makeTrack({ type: "midi", instrument: "808-kit", name: "House Drums" });
      const bass = makeTrack({ type: "midi", instrument: "sub-bass", name: "Sub Bass" });
      const stab = makeTrack({ type: "midi", instrument: "saw-lead", name: "Synth Stabs" });
      const lead = makeTrack({ type: "midi", instrument: "saw-lead", name: "Lead Synth", color: "#e0533d" });
      const house = LOOPS.find((l) => l.id === "dr-house")!;
      const house2 = LOOPS.find((l) => l.id === "dr-house2")!;
      const sub = LOOPS.find((l) => l.id === "bs-sub")!;
      const stabs = LOOPS.find((l) => l.id === "ch-stab")!;
      const hook = LOOPS.find((l) => l.id === "me-hook-min")!;
      drums.regions.push(loopToRegion(house, drums.id, 0, p), loopToRegion(house, drums.id, 2 * 4 * PPQ, p), loopToRegion(house2, drums.id, 4 * 4 * PPQ, p), loopToRegion(house2, drums.id, 6 * 4 * PPQ, p));
      bass.regions.push(loopToRegion(sub, bass.id, 4 * 4 * PPQ, p), loopToRegion(sub, bass.id, 6 * 4 * PPQ, p));
      stab.regions.push(loopToRegion(stabs, stab.id, 4 * 4 * PPQ, p), loopToRegion(stabs, stab.id, 6 * 4 * PPQ, p));
      lead.regions.push(loopToRegion(hook, lead.id, 8 * 4 * PPQ, p));
      p.tracks = [drums, bass, stab, lead];
      return p;
    },
  },
  {
    id: "rock",
    name: "Rock Band",
    desc: "Drums, bass and guitars",
    build: () => {
      const p = emptyProject("Rock Idea");
      p.tempo = 120;
      p.keyMode = "major";
      p.keyTonic = 2; // D
      const drums = makeTrack({ type: "midi", instrument: "drum-kit", name: "Acoustic Drums" });
      const bass = makeTrack({ type: "midi", instrument: "pluck-bass", name: "Bass" });
      const guitar = makeTrack({ type: "midi", instrument: "steel-guitar", name: "Steel Guitar", color: "#e08e3c" });
      const lead = makeTrack({ type: "midi", instrument: "saw-lead", name: "Guitar Lead", color: "#e0533d" });
      const rock = LOOPS.find((l) => l.id === "dr-rock-drive")!;
      const bs = LOOPS.find((l) => l.id === "bs-pop")!;
      const gtr = LOOPS.find((l) => l.id === "ch-guitar")!;
      const hook = LOOPS.find((l) => l.id === "me-hook")!;
      drums.regions.push(loopToRegion(rock, drums.id, 0, p), loopToRegion(rock, drums.id, 2 * 4 * PPQ, p), loopToRegion(rock, drums.id, 4 * 4 * PPQ, p), loopToRegion(rock, drums.id, 6 * 4 * PPQ, p));
      bass.regions.push(loopToRegion(bs, bass.id, 0, p), loopToRegion(bs, bass.id, 2 * 4 * PPQ, p), loopToRegion(bs, bass.id, 4 * 4 * PPQ, p), loopToRegion(bs, bass.id, 6 * 4 * PPQ, p));
      guitar.regions.push(loopToRegion(gtr, guitar.id, 0, p), loopToRegion(gtr, guitar.id, 2 * 4 * PPQ, p), loopToRegion(gtr, guitar.id, 4 * 4 * PPQ, p), loopToRegion(gtr, guitar.id, 6 * 4 * PPQ, p));
      lead.regions.push(loopToRegion(hook, lead.id, 4 * 4 * PPQ, p), loopToRegion(hook, lead.id, 6 * 4 * PPQ, p));
      p.tracks = [drums, bass, guitar, lead];
      return p;
    },
  },
  {
    id: "songwriter",
    name: "Singer-Songwriter",
    desc: "Piano, guitar and strings",
    build: () => {
      const p = emptyProject("Songwriter Idea");
      p.tempo = 88;
      p.keyMode = "major";
      p.keyTonic = 7; // G
      const piano = makeTrack({ type: "midi", instrument: "grand-piano", name: "Grand Piano" });
      const guitar = makeTrack({ type: "midi", instrument: "nylon-guitar", name: "Nylon Guitar", color: "#e08e3c" });
      const strings = makeTrack({ type: "midi", instrument: "string-ensemble", name: "Strings", color: "#7a6fd0" });
      const broken = LOOPS.find((l) => l.id === "ch-broken")!;
      const gtr = LOOPS.find((l) => l.id === "ch-guitar")!;
      const swell = LOOPS.find((l) => l.id === "ch-swell")!;
      piano.regions.push(loopToRegion(broken, piano.id, 0, p), loopToRegion(broken, piano.id, 2 * 4 * PPQ, p), loopToRegion(broken, piano.id, 4 * 4 * PPQ, p), loopToRegion(broken, piano.id, 6 * 4 * PPQ, p));
      guitar.regions.push(loopToRegion(gtr, guitar.id, 2 * 4 * PPQ, p), loopToRegion(gtr, guitar.id, 4 * 4 * PPQ, p), loopToRegion(gtr, guitar.id, 6 * 4 * PPQ, p));
      strings.regions.push(loopToRegion({ ...swell, bars: 4 }, strings.id, 4 * 4 * PPQ, p));
      p.tracks = [piano, guitar, strings];
      return p;
    },
  },
  {
    id: "podcast",
    name: "Voice & Music Bed",
    desc: "Mic track with background music",
    build: () => {
      const p = emptyProject("Podcast");
      p.tempo = 90;
      p.keyMode = "major";
      const mic = makeTrack({ type: "audio", name: "Microphone", icon: "mic" });
      mic.inputMonitor = true;
      const keys = makeTrack({ type: "midi", instrument: "stage-epiano", name: "Music Bed" });
      keys.volume = 0.45;
      keys.params.reverb = 0.3;
      const epi = LOOPS.find((l) => l.id === "ch-epiano")!;
      keys.regions.push(loopToRegion({ ...epi, bars: 4 }, keys.id, 0, p), loopToRegion({ ...epi, bars: 4 }, keys.id, 4 * 4 * PPQ, p), loopToRegion({ ...epi, bars: 4 }, keys.id, 8 * 4 * PPQ, p));
      p.tracks = [mic, keys];
      return p;
    },
  },
];
