// Import/export bridge for Soundstage DAW project JSON files.
// Audio media is deliberately not embedded in JSON: source samples remain private
// browser storage objects and must be re-imported in the destination studio.
import { defaultParams } from "./instruments";
import { PPQ, uid, type Project, type Track, type Region, type Note, DEFAULT_EQ } from "./types";

export interface SoundstageProjectFile {
  id?: string;
  name?: string;
  bpm?: number;
  timeSignature?: string;
  keySignature?: string;
  totalBars?: number;
  cycleEnabled?: boolean;
  cycleStartBeat?: number;
  cycleEndBeat?: number;
  metronomeEnabled?: boolean;
  countInEnabled?: boolean;
  masterVolume?: number;
  tracks?: Array<Record<string, unknown>>;
  regions?: Array<Record<string, unknown>>;
  updatedAt?: number;
  [key: string]: unknown;
}

const PATCH_FROM_SOUNDSTAGE: Record<string, string> = {
  "keys-steinway-grand": "grand-piano",
  "keys-rhodes-mk1": "stage-epiano",
  "keys-b3-organ": "tonewheel-organ",
  "strings-warm-ensemble": "string-ensemble",
  "synth-analog-pad": "warm-pad",
  "synth-juno-brass": "saw-lead",
  "synth-pluck-arp": "pluck-bass",
  "synth-lead-square": "retro-chip",
  "bass-moog-sub": "sub-bass",
  "bass-finger-synth": "pluck-bass",
  "drums-acoustic-soho": "drum-kit",
  "drums-808-trap": "808-kit",
  "drums-house-909": "drum-kit",
  "guitar-clean-jazz": "nylon-guitar",
};

const PATCH_TO_SOUNDSTAGE: Record<string, string> = {
  "grand-piano": "keys-steinway-grand",
  "bright-piano": "keys-steinway-grand",
  "stage-epiano": "keys-rhodes-mk1",
  "tonewheel-organ": "keys-b3-organ",
  "string-ensemble": "strings-warm-ensemble",
  "warm-pad": "synth-analog-pad",
  "saw-lead": "synth-juno-brass",
  "retro-chip": "synth-lead-square",
  "pluck-bass": "bass-finger-synth",
  "sub-bass": "bass-moog-sub",
  "808-bass": "bass-moog-sub",
  "drum-kit": "drums-acoustic-soho",
  "808-kit": "drums-808-trap",
  "nylon-guitar": "guitar-clean-jazz",
};

const DRUM_PITCH: Record<string, number> = {
  kick: 36, snare: 38, closedHat: 42, openHat: 46,
  clap: 39, rim: 37, tom: 45, crash: 49,
};

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function string(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}
function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
function arr(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asObject) : [];
}
function parseTimeSignature(value: unknown): [number, number] {
  const match = /^(\d+)\/(\d+)$/.exec(string(value, "4/4"));
  const n = match ? Number(match[1]) : 4;
  const d = match ? Number(match[2]) : 4;
  return ([2, 3, 4, 5, 6, 7, 8].includes(n) && [2, 4, 8, 16].includes(d) ? [n, d] : [4, 4]);
}
function parseKey(value: unknown): { tonic: number; mode: "major" | "minor" } {
  const text = string(value, "C Maj");
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const root = text.split(/\s+/)[0].replace("♭", "b");
  const flats: Record<string, string> = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#" };
  const tonic = names.indexOf(flats[root] ?? root);
  return { tonic: tonic < 0 ? 0 : tonic, mode: /min/i.test(text) ? "minor" : "major" };
}

function soundstagePatch(track: Record<string, unknown>): string {
  const explicit = string(track.presetId, "");
  if (PATCH_FROM_SOUNDSTAGE[explicit]) return PATCH_FROM_SOUNDSTAGE[explicit];
  const synth = asObject(track.synth);
  if (synth.waveform === "strings") return "string-ensemble";
  if (synth.waveform === "piano") return "grand-piano";
  if (track.type === "drummer") return track.drumKit === "808" ? "808-kit" : "drum-kit";
  return "warm-pad";
}

/** Convert a Soundstage-exported JSON project into the native DAW project model. */
export function importSoundstageProject(input: unknown): { project: Project; omittedAudioRegions: number } {
  const source = asObject(input) as SoundstageProjectFile;
  if (!Array.isArray(source.tracks) || !Array.isArray(source.regions)) {
    throw new Error("This file is not a Soundstage project JSON. Expected tracks and regions arrays.");
  }

  const timeSig = parseTimeSignature(source.timeSignature);
  const key = parseKey(source.keySignature);
  const tempo = Math.min(260, Math.max(30, Math.round(finite(source.bpm, 120))));
  const sourceTracks = source.tracks.map(asObject);
  const trackMap = new Map<string, Track>();
  const tracks: Track[] = sourceTracks.map((raw) => {
    const sourceId = string(raw.id, uid());
    const type = raw.type === "audio" ? "audio" : "midi";
    const instrument = soundstagePatch(raw);
    const synth = asObject(raw.synth);
    const fx = asObject(raw.fx);
    const sourceEq = asObject(fx.eq);
    const params = defaultParams(instrument);
    params.reverb = finite(fx.reverbSend, params.reverb ?? 0.12);
    params.delay = finite(fx.delaySend, params.delay ?? 0);
    if (typeof synth.cutoffHz === "number") params.brightness = Math.min(1, Math.max(0, synth.cutoffHz / 14000));
    if (typeof synth.chorus === "number") params.vibrato = Math.min(1, Math.max(0, synth.chorus));
    const track: Track = {
      id: sourceId,
      name: string(raw.name, "Imported Track"),
      type,
      icon: type === "audio" ? "mic" : (instrument.includes("drum") || instrument === "808-kit" ? "drum" : "music"),
      color: string(raw.color, "#4b9b8f"),
      instrument,
      volume: Math.min(1.25, Math.max(0, finite(raw.volume, 0.85))),
      pan: Math.min(1, Math.max(-1, finite(raw.pan, 0))),
      mute: raw.muted === true,
      solo: raw.soloed === true,
      armed: raw.armed === true,
      inputMonitor: false,
      compressor: false,
      eq: {
        ...DEFAULT_EQ,
        lowGain: finite(sourceEq.lowGainDb, DEFAULT_EQ.lowGain),
        midGain: finite(sourceEq.midGainDb, DEFAULT_EQ.midGain),
        midFreq: finite(sourceEq.midFreqHz, DEFAULT_EQ.midFreq),
        highGain: finite(sourceEq.highGainDb, DEFAULT_EQ.highGain),
      },
      params,
      regions: [],
    };
    trackMap.set(sourceId, track);
    return track;
  });

  let omittedAudioRegions = 0;
  for (const raw of source.regions.map(asObject)) {
    const trackId = string(raw.trackId, "");
    const track = trackMap.get(trackId);
    if (!track) continue;
    if (track.type === "audio") {
      if (raw.audioBufferId || raw.audioDurationBeats) omittedAudioRegions++;
      continue; // source app's IndexedDB media blobs cannot be carried in its JSON export
    }

    const startBeat = Math.max(0, finite(raw.startBeat, 0));
    const coreBeats = Math.max(0.25, finite(raw.lengthBeats, 4));
    const loopCount = Math.max(1, Math.min(128, Math.round(finite(raw.loopCount, 1))));
    const coreLength = Math.round(coreBeats * PPQ);
    const length = Math.max(PPQ / 4, coreLength * loopCount);
    const notes: Note[] = arr(raw.notes).map((n) => ({
      id: string(n.id, uid()),
      pitch: Math.max(0, Math.min(127, Math.round(finite(n.pitch, 60)))),
      velocity: Math.max(1, Math.min(127, Math.round(finite(n.velocity, 96)))),
      start: Math.max(0, Math.round(finite(n.startBeat, 0) * PPQ)),
      length: Math.max(1, Math.round(finite(n.durationBeats, 0.25) * PPQ)),
    }));

    const pattern = asObject(raw.drumPattern);
    const voices = asObject(pattern.voices);
    if (Object.keys(voices).length) {
      const stepsPerBar = Math.max(1, Math.min(32, Math.round(finite(pattern.stepsPerBar, 16))));
      const stepTicks = coreLength / stepsPerBar;
      for (const [voice, pitch] of Object.entries(DRUM_PITCH)) {
        const steps = Array.isArray(voices[voice]) ? voices[voice] as unknown[] : [];
        steps.forEach((value, index) => {
          const velocity = Math.round(finite(value, 0));
          if (velocity <= 0 || index >= stepsPerBar) return;
          notes.push({
            id: uid(), pitch, velocity: Math.min(127, velocity),
            start: Math.round(index * stepTicks), length: Math.max(60, Math.round(stepTicks * 0.88)),
          });
        });
      }
    }

    const region: Region = {
      id: string(raw.id, uid()),
      trackId,
      type: "midi",
      name: string(raw.name, "Imported MIDI Region"),
      start: Math.round(startBeat * PPQ),
      length,
      looped: loopCount > 1,
      coreLength: loopCount > 1 ? coreLength : undefined,
      muted: raw.muted === true,
      color: string(raw.color, track.color),
      notes,
    };
    track.regions.push(region);
  }

  return {
    project: {
      id: undefined,
      name: string(source.name, "Imported Soundstage Session"),
      tempo,
      timeSig,
      keyTonic: key.tonic,
      keyMode: key.mode,
      cycleOn: source.cycleEnabled === true,
      cycleStart: Math.round(finite(source.cycleStartBeat, 0) * PPQ),
      cycleEnd: Math.max(PPQ, Math.round(finite(source.cycleEndBeat, 16) * PPQ)),
      countIn: source.countInEnabled === true,
      metronome: source.metronomeEnabled === true,
      masterVolume: Math.min(1.25, Math.max(0, finite(source.masterVolume, 0.9))),
      tracks,
    },
    omittedAudioRegions,
  };
}

/** Convert the native DAW model into Soundstage's documented JSON project shape. */
export function exportSoundstageProject(project: Project): Record<string, unknown> {
  const keyName = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][project.keyTonic] ?? "C";
  const synthFor = (track: Track) => ({
    waveform: track.instrument === "string-ensemble" ? "strings" : track.instrument === "grand-piano" || track.instrument === "bright-piano" ? "piano" : "sawtooth",
    cutoffHz: Math.round(1800 + (track.params.brightness ?? 0.5) * 10500),
    resonance: 1,
    attackSec: track.instrument === "string-ensemble" ? 0.2 : 0.004,
    releaseSec: track.instrument === "string-ensemble" ? 0.75 : (track.params.release ?? 0.5),
    drive: 0,
    chorus: track.params.vibrato ?? 0.25,
  });
  const tracks = project.tracks.map((track) => ({
    id: track.id,
    name: track.name,
    type: track.type === "audio" ? "audio" : (track.instrument.includes("kit") || track.instrument === "drum-kit" ? "drummer" : "instrument"),
    presetId: PATCH_TO_SOUNDSTAGE[track.instrument] ?? "synth-analog-pad",
    color: track.color,
    volume: track.volume,
    pan: track.pan,
    muted: track.mute,
    soloed: track.solo,
    armed: track.armed,
    showAutomation: false,
    automationParam: "volume",
    automationPoints: [],
    synth: synthFor(track),
    fx: {
      eq: { lowGainDb: track.eq.lowGain, midGainDb: track.eq.midGain, midFreqHz: track.eq.midFreq, highGainDb: track.eq.highGain },
      reverbSend: track.params.reverb ?? 0,
      delaySend: track.params.delay ?? 0,
      delayTimeBeats: 0.5,
      delayFeedback: 0.35,
    },
    drumKit: track.instrument === "808-kit" ? "808" : "acoustic",
  }));
  const regions = project.tracks.flatMap((track) => track.regions.map((region) => {
    const coreTicks = region.looped && region.coreLength ? region.coreLength : region.length;
    const loopCount = region.looped && region.coreLength ? Math.max(1, Math.round(region.length / region.coreLength)) : 1;
    return {
      id: region.id,
      trackId: track.id,
      name: region.name,
      color: region.color ?? track.color,
      startBeat: region.start / PPQ,
      lengthBeats: coreTicks / PPQ,
      loopCount,
      muted: region.muted ?? false,
      notes: (region.notes ?? []).map((note) => ({
        id: note.id, pitch: note.pitch, startBeat: note.start / PPQ,
        durationBeats: note.length / PPQ, velocity: note.velocity,
      })),
      ...(region.type === "audio" ? { audioDurationBeats: (region.sampleLength ?? 0) * project.tempo / 60, audioAssetOmitted: true } : {}),
    };
  }));

  const beatsPerBar = project.timeSig[0] * (4 / project.timeSig[1]);
  const endBeat = Math.max(1, ...regions.map((r) => finite(r.startBeat, 0) + finite(r.lengthBeats, 4) * finite(r.loopCount, 1)));
  const totalBars = Math.max(1, Math.ceil(endBeat / Math.max(1, beatsPerBar)));

  return {
    id: project.id ?? uid(),
    name: project.name,
    bpm: project.tempo,
    timeSignature: `${project.timeSig[0]}/${project.timeSig[1]}`,
    keySignature: `${keyName} ${project.keyMode === "minor" ? "Min" : "Maj"}`,
    totalBars,
    cycleEnabled: project.cycleOn,
    cycleStartBeat: project.cycleStart / PPQ,
    cycleEndBeat: project.cycleEnd / PPQ,
    metronomeEnabled: project.metronome,
    countInEnabled: project.countIn,
    masterVolume: project.masterVolume,
    tracks,
    regions,
    updatedAt: Date.now(),
    audioAssetsIncluded: false,
  };
}
