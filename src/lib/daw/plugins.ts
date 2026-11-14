import type { Note } from "./types";
import { uid, PPQ } from "./types";
import { clamp } from "./utils";

export interface PluginControl {
  id: string;
  label: string;
  min: number;
  max: number;
  defaultValue: number;
  step?: number;
}

export interface PluginDefinition {
  id: string;
  name: string;
  description: string;
  controls: PluginControl[];
}

export interface TrackPluginInstance {
  id: string;
  pluginId: string;
  enabled: boolean;
  params: Record<string, number>;
}

const control = (
  id: string,
  label: string,
  min: number,
  max: number,
  defaultValue: number,
  step = 1
): PluginControl => ({ id, label, min, max, defaultValue, step });

export const MIDI_PLUGIN_DEFS: PluginDefinition[] = [
  { id: "arpeggiator", name: "Arpeggiator", description: "Turns held chord notes into a timed up/down note pattern.", controls: [control("stepTicks", "Step", 120, 960, 240, 120), control("gate", "Gate", 0.2, 1, 0.82, 0.02)] },
  { id: "chord-maker", name: "Chord Generator", description: "Adds a third and fifth above each incoming note.", controls: [control("third", "Third", 3, 4, 4), control("fifth", "Fifth", 7, 7, 7)] },
  { id: "scale-lock", name: "Scale Lock", description: "Moves notes to the nearest note in the song key.", controls: [] },
  { id: "octave-doubler", name: "Octave Doubler", description: "Adds a second voice one octave above the played notes.", controls: [control("semitones", "Interval", 12, 24, 12)] },
  { id: "transposer", name: "Transposer", description: "Shifts every note by a selected number of semitones.", controls: [control("semitones", "Semitones", -24, 24, 0)] },
  { id: "velocity-humanizer", name: "Velocity Humanizer", description: "Adds repeatable velocity variation for a more natural performance.", controls: [control("amount", "Amount", 0, 40, 8)] },
  { id: "note-repeater", name: "Note Repeater", description: "Repeats every note evenly inside its original duration.", controls: [control("repeats", "Repeats", 2, 4, 2), control("gate", "Gate", 0.2, 1, 0.82, 0.02)] },
  { id: "strummer", name: "Strummer", description: "Staggers simultaneous chord notes like a guitar or harp strum.", controls: [control("spreadTicks", "Spread", 0, 120, 36, 6)] },
  { id: "gate", name: "Gate / Staccato", description: "Shortens MIDI note lengths to create tighter articulation.", controls: [control("length", "Note Length", 0.1, 1, 0.65, 0.05)] },
  { id: "note-echo", name: "Note Echo", description: "Creates timed, progressively softer MIDI repeats.", controls: [control("repeats", "Repeats", 1, 4, 2), control("delayTicks", "Delay", 120, 960, 480, 120)] },
];

export const AUDIO_PLUGIN_DEFS: PluginDefinition[] = [
  { id: "eq", name: "Channel EQ", description: "Three-band low, mid and high equalizer.", controls: [control("mix", "Amount", 0, 1, 1, 0.05)] },
  { id: "compressor", name: "Compressor", description: "Controls vocal and instrument dynamics.", controls: [control("threshold", "Threshold", -36, 0, -18), control("ratio", "Ratio", 1, 12, 3, 0.5)] },
  { id: "noise-gate", name: "Noise Gate", description: "Reduces low-level room noise between phrases.", controls: [control("threshold", "Threshold", -70, -20, -48)] },
  { id: "de-esser", name: "De-Esser", description: "Tames harsh sibilance in vocal recordings.", controls: [control("frequency", "Frequency", 4000, 10000, 6800, 100), control("reduction", "Reduction", 0, 12, 5)] },
  { id: "presence", name: "Vocal Presence", description: "Adds controlled clarity and intelligibility in the upper mids.", controls: [control("frequency", "Frequency", 1500, 6000, 3200, 100), control("gain", "Gain", 0, 8, 2, 0.5)] },
  { id: "saturation", name: "Tape Saturation", description: "Adds harmonic warmth and gentle drive.", controls: [control("drive", "Drive", 0, 1, 0.28, 0.02)] },
  { id: "chorus", name: "Stereo Chorus", description: "Adds modulated width and gentle movement.", controls: [control("rate", "Rate", 0.1, 2, 0.7, 0.05), control("depth", "Depth", 0, 1, 0.45, 0.05)] },
  { id: "flanger", name: "Flanger", description: "Adds a moving comb-filter sweep with feedback.", controls: [control("rate", "Rate", 0.05, 1.5, 0.25, 0.05), control("feedback", "Feedback", 0, 0.85, 0.35, 0.05)] },
  { id: "reverb", name: "Studio Reverb", description: "Sends the track to the shared convolution reverb.", controls: [control("amount", "Send", 0, 1, 0.28, 0.02)] },
  { id: "delay", name: "Tempo Delay", description: "Sends the track to a tempo-synced echo.", controls: [control("amount", "Send", 0, 1, 0.22, 0.02)] },
];

export function createPluginInstance(
  pluginId: string,
  definitions: PluginDefinition[]
): TrackPluginInstance | null {
  const definition = definitions.find((item) => item.id === pluginId);
  if (!definition) return null;
  return {
    id: uid(),
    pluginId,
    enabled: true,
    params: Object.fromEntries(
      definition.controls.map((item) => [item.id, item.defaultValue])
    ),
  };
}

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

function snapToScale(pitch: number, tonic: number, mode: "major" | "minor") {
  const scale = mode === "minor" ? MINOR_SCALE : MAJOR_SCALE;
  let best = clamp(Math.round(pitch), 0, 127);
  let bestDistance = Infinity;
  for (let candidate = Math.max(0, pitch - 6); candidate <= Math.min(127, pitch + 6); candidate++) {
    const pc = ((candidate - tonic) % 12 + 12) % 12;
    if (!scale.includes(pc)) continue;
    const distance = Math.abs(candidate - pitch);
    if (distance < bestDistance || (distance === bestDistance && candidate < best)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function groupByStart(notes: Note[]) {
  const groups = new Map<number, Note[]>();
  for (const note of notes) {
    const group = groups.get(note.start) ?? [];
    group.push(note);
    groups.set(note.start, group);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]);
}

/** Apply active MIDI-track processors in rack order. Used by playback and export. */
export function applyMidiPlugins(
  source: Note[],
  plugins: TrackPluginInstance[],
  tonic: number,
  mode: "major" | "minor"
): Note[] {
  let notes = source.map((note) => ({ ...note }));
  for (const plugin of plugins) {
    if (!plugin.enabled) continue;
    const params = plugin.params;
    switch (plugin.pluginId) {
      case "transposer": {
        const shift = Math.round(params.semitones ?? 0);
        notes = notes.map((note) => ({ ...note, pitch: clamp(note.pitch + shift, 0, 127) }));
        break;
      }
      case "scale-lock":
        notes = notes.map((note) => ({ ...note, pitch: snapToScale(note.pitch, tonic, mode) }));
        break;
      case "octave-doubler": {
        const interval = Math.round(params.semitones ?? 12);
        notes = notes.flatMap((note) => [
          note,
          { ...note, id: uid(), pitch: clamp(note.pitch + interval, 0, 127) },
        ]);
        break;
      }
      case "chord-maker": {
        const third = mode === "minor" ? 3 : Math.round(params.third ?? 4);
        const fifth = Math.round(params.fifth ?? 7);
        notes = notes.flatMap((note) => [
          note,
          { ...note, id: uid(), pitch: clamp(note.pitch + third, 0, 127) },
          { ...note, id: uid(), pitch: clamp(note.pitch + fifth, 0, 127) },
        ]);
        break;
      }
      case "velocity-humanizer": {
        const amount = Math.max(0, params.amount ?? 0);
        notes = notes.map((note) => {
          const seed = Math.abs((note.start * 31 + note.pitch * 17 + note.velocity * 13) % 997) / 997;
          const offset = (seed * 2 - 1) * amount;
          return { ...note, velocity: clamp(Math.round(note.velocity + offset), 1, 127) };
        });
        break;
      }
      case "note-repeater": {
        const repeats = clamp(Math.round(params.repeats ?? 2), 2, 4);
        const gate = clamp(params.gate ?? 0.82, 0.1, 1);
        notes = notes.flatMap((note) => {
          const step = note.length / repeats;
          return Array.from({ length: repeats }, (_, index) => ({
            ...note,
            id: index === 0 ? note.id : uid(),
            start: note.start + step * index,
            length: Math.max(1, Math.round(step * gate)),
          }));
        });
        break;
      }
      case "strummer": {
        const spread = Math.max(0, Math.round(params.spreadTicks ?? 0));
        notes = groupByStart(notes).flatMap(([start, group]) => {
          const ordered = [...group].sort((a, b) => a.pitch - b.pitch);
          return ordered.map((note, index) => ({
            ...note,
            start: start + (ordered.length > 1 ? Math.round(spread * index / (ordered.length - 1)) : 0),
          }));
        });
        break;
      }
      case "gate": {
        const length = clamp(params.length ?? 0.65, 0.1, 1);
        notes = notes.map((note) => ({ ...note, length: Math.max(1, Math.round(note.length * length)) }));
        break;
      }
      case "note-echo": {
        const repeats = clamp(Math.round(params.repeats ?? 2), 1, 4);
        const delay = Math.max(1, Math.round(params.delayTicks ?? PPQ / 2));
        notes = notes.flatMap((note) => [
          note,
          ...Array.from({ length: repeats }, (_, index) => ({
            ...note,
            id: uid(),
            start: note.start + delay * (index + 1),
            velocity: clamp(Math.round(note.velocity * Math.pow(0.72, index + 1)), 1, 127),
          })),
        ]);
        break;
      }
      case "arpeggiator": {
        const step = Math.max(1, Math.round(params.stepTicks ?? PPQ / 4));
        const gate = clamp(params.gate ?? 0.82, 0.1, 1);
        notes = groupByStart(notes).flatMap(([start, group]) => {
          const ordered = [...group].sort((a, b) => a.pitch - b.pitch);
          const end = Math.max(...ordered.map((note) => note.start + note.length));
          const count = Math.min(64, Math.max(1, Math.ceil((end - start) / step)));
          return Array.from({ length: count }, (_, index) => {
            const sourceNote = ordered[index % ordered.length];
            return {
              ...sourceNote,
              id: index === 0 ? sourceNote.id : uid(),
              start: start + index * step,
              length: Math.max(1, Math.round(step * gate)),
            };
          });
        });
        break;
      }
      default:
        break;
    }
  }
  return notes;
}
