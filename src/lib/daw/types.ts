import type { TrackPluginInstance } from "./plugins";

// ============================================================
// Core type definitions for the WebBand DAW
// All timing is in MIDI ticks (PPQ = 960 per quarter note)
// ============================================================

export const PPQ = 960;

export type TrackType = "midi" | "audio";
export type RegionType = "midi" | "audio";

export interface Note {
  id: string;
  pitch: number; // 0-127 MIDI note number
  velocity: number; // 0-127
  start: number; // ticks relative to region start
  length: number; // ticks
}

export interface Region {
  id: string;
  trackId: string;
  type: RegionType;
  name: string;
  start: number; // absolute ticks on timeline
  length: number; // ticks
  muted?: boolean;
  color?: string; // optional override
  looped?: boolean; // content repeats every coreLength
  coreLength?: number; // loop period in ticks (midi) - audio uses sampleLength
  // MIDI payload
  notes?: Note[];
  // Audio payload
  bufferId?: string; // IndexedDB key for PCM data
  sampleStart?: number; // seconds into the buffer
  sampleLength?: number; // seconds of audio content
  playbackRate?: number; // varispeed: 0.5..2, changes pitch and duration together
  gain?: number; // linear playback gain
  fadeIn?: number; // seconds
  fadeOut?: number; // seconds
}

export interface EqSettings {
  lowGain: number; // dB -12..12
  lowFreq: number; // Hz 20..400
  midGain: number; // dB
  midFreq: number; // Hz 100..6000
  midQ: number; // 0.3..8
  highGain: number; // dB
  highFreq: number; // Hz 1500..18000
}

export type TrackRole = "track" | "aux" | "vca" | "folder";

export interface TrackStack {
  id: string;
  name: string;
  type: "folder" | "summing";
  trackIds: string[];
  folderTrackId: string;
  busTrackId?: string;
}

export interface ProjectAlternative {
  id: string;
  name: string;
  snapshot: string;
  savedAt: string;
}

export interface ScreenSet {
  id: string;
  name: string;
  panels: Record<PanelKey, boolean>;
  editorMode: EditorMode;
  trackSize: TrackSize;
  zoom: number;
}

export interface SamplerZone {
  id: string;
  bufferId: string;
  name: string;
  rootPitch: number;
  lowKey: number;
  highKey: number;
  velocityLow: number;
  velocityHigh: number;
  playbackMode: "one-shot" | "loop";
}

export interface Track {
  id: string;
  role?: TrackRole;
  outputBusId?: string | null;
  vcaId?: string | null;
  stackId?: string | null;
  parentTrackId?: string | null;
  collapsed?: boolean;
  name: string;
  type: TrackType;
  icon: string; // icon key from INSTRUMENTS or 'mic' for audio
  color: string; // hex
  instrument: string; // patch id for midi tracks
  /** IndexedDB sample key for a user-created Quick Sampler instrument. */
  sampleBufferId?: string;
  sampleRootPitch?: number;
  samplePlaybackMode?: "one-shot" | "loop";
  sampleName?: string;
  sampleZones?: SamplerZone[];
  sampleDrumKit?: boolean;
  volume: number; // 0..1.25 (1 = 0 dB)
  pan: number; // -1..1
  /** Enable HRTF binaural 3D panning for stereo headphone playback. */
  spatialEnabled?: boolean;
  spatialX?: number; // metres, -5..5
  spatialY?: number; // metres, -5..5
  spatialZ?: number; // metres, -5..5 (negative is in front of listener)
  mute: boolean;
  solo: boolean;
  armed: boolean;
  inputMonitor: boolean; // audio input monitoring
  inputDeviceId?: string | null;
  compressor: boolean;
  eq: EqSettings;
  params: Record<string, number>; // smart-control params (patch knobs + sends)
  midiPlugins?: TrackPluginInstance[];
  audioPlugins?: TrackPluginInstance[];
  regions: Region[];
}

export type MidiCCTarget = "master-volume" | "track-volume" | "track-pan";

export interface MidiCCMapping {
  id: string;
  deviceId: string;
  deviceName: string;
  cc: number;
  target: MidiCCTarget;
  trackId?: string;
}

export interface Project {
  id?: string; // database id when saved
  name: string;
  tempo: number; // BPM
  timeSig: [number, number]; // e.g. [4, 4]
  keyTonic: number; // 0=C .. 11=B
  keyMode: "major" | "minor";
  cycleOn: boolean;
  cycleStart: number; // ticks
  cycleEnd: number; // ticks
  countIn: boolean;
  metronome: boolean;
  masterVolume: number; // 0..1.25
  audioOutputDeviceId?: string | null;
  midiCCMappings?: MidiCCMapping[];
  tracks: Track[];
  stacks?: TrackStack[];
  alternatives?: ProjectAlternative[];
  screensets?: ScreenSet[];
}

// ---------- UI state ----------

export type Tool = "pointer" | "pencil";
export type SnapMode = "smart" | "bar" | "beat" | "8th" | "16th" | "off";
export type TrackSize = "S" | "M" | "L";
export type EditorMode = "piano" | "audio" | "steps" | "score" | "smart";
export type PanelKey =
  | "library"
  | "loops"
  | "mixer"
  | "editor"
  | "keyboard"
  | "help"
  | "liveLoops";
export type ModalKind =
  | "none"
  | "newProject"
  | "addTrack"
  | "export"
  | "mySongs"
  | "composer";

export interface UIState {
  tool: Tool;
  snap: SnapMode;
  zoom: number; // pixels per beat
  trackSize: TrackSize;
  selectedTrackId: string | null;
  selectedRegionIds: string[];
  selectedNoteIds: string[];
  panels: Record<PanelKey, boolean>;
  editorMode: EditorMode;
  editorRegionId: string | null;
  modal: ModalKind;
  followPlayhead: boolean;
  musicalTyping: boolean;
  octaveBase: number; // base octave for musical typing (C3 = 3)
  velocity: number; // musical typing velocity
}

// ---------- Instruments ----------

export interface KnobDef {
  id: string;
  label: string;
  min: number;
  max: number;
  def: number;
  curve?: "lin" | "log";
  unit?: string;
  step?: number;
}

export interface Patch {
  id: string;
  name: string;
  category: string;
  icon: string;
  desc: string;
  knobs: KnobDef[];
  /** Original additive/wavetable synth engine used by the Morph Synth family. */
  synthEngine?: "morph-additive";
  /** Sound source used by the sampled-instrument engine. */
  sampled?: {
    engine: "soundfont" | "splendid-piano" | "electric-piano" | "drum-machine";
    instrument: string;
    kit?: "MusyngKite" | "FluidR3_GM";
    loop?: boolean;
  };
  /** Drum patches map MIDI drum pitches to sampled kit pieces. */
  isDrum?: boolean;
}

// ---------- Loops ----------

export interface LoopDef {
  id: string;
  name: string;
  category: string;
  genre: string;
  instrument: string; // patch id
  bars: number;
  keyAgnostic?: boolean; // drums
  mode?: "major" | "minor";
  tempoHint?: number;
  desc?: string;
  seed: number;
}

// ---------- Transport state (mirrored from engine) ----------

export interface TransportState {
  playing: boolean;
  recording: boolean;
  countInRemaining: number; // beats, 0 = none
}

// ---------- Helpers ----------

export const TRACK_SIZES: Record<TrackSize, number> = {
  S: 44,
  M: 68,
  L: 96,
};

export function uid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().slice(0, 13).replace(/-/g, "");
  }
  return Math.random().toString(36).slice(2, 12);
}

export const DEFAULT_EQ: EqSettings = {
  lowGain: 0,
  lowFreq: 90,
  midGain: 0,
  midFreq: 1000,
  midQ: 1,
  highGain: 0,
  highFreq: 8000,
};
