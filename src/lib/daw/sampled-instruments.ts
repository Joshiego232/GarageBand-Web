// Sampled instrument engine. Instrument audio is loaded lazily from the
// credited SoundFont and sampled-kit libraries; no oscillator-only patches
// are used for the expanded library.
import {
  DrumMachine,
  ElectricPiano,
  SampleLoader,
  Scheduler,
  SplendidGrandPiano,
  Soundfont,
} from "smplr";
import type { Patch } from "./types";
import type { VoiceHandle } from "./instruments";

type SampleStartOptions = {
  note: string | number;
  velocity?: number;
  time?: number;
  duration?: number | null;
  ampRelease?: number;
};

type SampledPlayer = {
  ready: Promise<void>;
  start(event: SampleStartOptions): (at?: number) => void;
  output: { addInsert(node: AudioNode): void };
  setCC?: (controller: number, value: number) => void;
  getGroupNames?: () => string[];
};

type SampleEntry = {
  player: SampledPlayer;
  ready: boolean;
  failed: boolean;
  tone?: BiquadFilterNode;
};

const loaders = new WeakMap<BaseAudioContext, SampleLoader>();
const schedulers = new WeakMap<BaseAudioContext, ReturnType<typeof Scheduler>>();
const players = new WeakMap<
  BaseAudioContext,
  Map<AudioNode, Map<string, SampleEntry>>
>();
const PIANO_SAMPLE_NOTES = [
  21, 27, 33, 39, 45, 51, 57, 63, 69, 75, 81, 87, 93, 99, 105, 108,
];

function loaderFor(ctx: BaseAudioContext): SampleLoader {
  let loader = loaders.get(ctx);
  if (!loader) {
    loader = SampleLoader(ctx);
    loaders.set(ctx, loader);
  }
  return loader;
}

function schedulerFor(ctx: BaseAudioContext, offline: boolean) {
  let scheduler = schedulers.get(ctx);
  if (!scheduler) {
    // OfflineAudioContext renders much faster than wall-clock timers advance.
    // Dispatch every note immediately and let Web Audio schedule it at its
    // absolute audio time, rather than relying on the sampler's polling queue.
    scheduler = Scheduler(ctx, {
      lookaheadMs: offline ? 60_000_000 : 200,
    });
    schedulers.set(ctx, scheduler);
  }
  return scheduler;
}

function instrumentMapFor(ctx: BaseAudioContext, dest: AudioNode) {
  let byDestination = players.get(ctx);
  if (!byDestination) {
    byDestination = new Map();
    players.set(ctx, byDestination);
  }

  let byPatch = byDestination.get(dest);
  if (!byPatch) {
    byPatch = new Map();
    byDestination.set(dest, byPatch);
  }
  return byPatch;
}

function entryFor(
  ctx: BaseAudioContext,
  dest: AudioNode,
  patchId: string,
): SampleEntry | undefined {
  return players.get(ctx)?.get(dest)?.get(patchId);
}

/** Load one selected patch. Repeated requests share the same player and buffers. */
export function warmSampledPatch(
  ctx: BaseAudioContext,
  dest: AudioNode,
  patch: Patch,
  offline = false,
): Promise<void> {
  const source = patch.sampled;
  if (!source) return Promise.resolve();

  const byPatch = instrumentMapFor(ctx, dest);
  const existing = byPatch.get(patch.id);
  if (existing) {
    return existing.player.ready.then(() => undefined).catch(() => undefined);
  }

  const loader = loaderFor(ctx);
  const scheduler = schedulerFor(ctx, offline);
  let player: SampledPlayer;

  switch (source.engine) {
    case "splendid-piano":
      player = SplendidGrandPiano(ctx, {
        destination: dest,
        loader,
        scheduler,
        volume: 100,
        notesToLoad: {
          notes: PIANO_SAMPLE_NOTES,
          velocityRange: [1, 127],
        },
      }) as unknown as SampledPlayer;
      break;
    case "electric-piano":
      player = ElectricPiano(ctx, {
        instrument: source.instrument,
        destination: dest,
        loader,
        scheduler,
        volume: 96,
      }) as unknown as SampledPlayer;
      break;
    case "drum-machine":
      player = DrumMachine(ctx, {
        instrument: source.instrument,
        destination: dest,
        loader,
        volume: 96,
      }) as unknown as SampledPlayer;
      break;
    case "soundfont":
    default:
      player = Soundfont(ctx, {
        instrument: source.instrument,
        kit: source.kit ?? "MusyngKite",
        loadLoopData: source.loop ?? false,
        destination: dest,
        loader,
        volume: 96,
      }) as unknown as SampledPlayer;
      break;
  }

  const entry: SampleEntry = { player, ready: false, failed: false };
  byPatch.set(patch.id, entry);

  return player.ready
    .then(() => {
      const tone = ctx.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = 16500;
      tone.Q.value = 0.35;
      player.output.addInsert(tone);
      entry.tone = tone;
      entry.ready = true;
    })
    .catch((error: unknown) => {
      entry.failed = true;
      console.warn(
        `Could not load sampled instrument ${patch.name}; playback will wait for a successful sample load.`,
        error,
      );
    });
}

const DRUM_GROUPS: Record<number, string[]> = {
  35: ["kick", "bassdrum"],
  36: ["kick", "bassdrum"],
  37: ["rim", "sidestick", "crossstick"],
  38: ["snare"],
  39: ["clap", "handclap"],
  40: ["snare"],
  41: ["lowtom", "tom"],
  42: ["closedhat", "closedhi-hat", "hihat", "hi-hat"],
  43: ["lowtom", "tom"],
  44: ["pedalhat", "pedalhi-hat", "hihat"],
  45: ["midtom", "tom"],
  46: ["openhat", "openhi-hat", "hihat"],
  47: ["midtom", "tom"],
  48: ["hitom", "tom"],
  49: ["crash"],
  50: ["hitom", "tom"],
  51: ["ride"],
  52: ["china", "ride"],
  53: ["ridebell", "ride"],
  54: ["tambourine"],
  55: ["splash", "cymbal"],
  56: ["cowbell"],
  57: ["crash"],
  58: ["vibraslap", "rim"],
  59: ["ride"],
  60: ["hitom", "tom"],
  61: ["lowtom", "tom"],
  62: ["hitom", "tom"],
  63: ["lowtom", "tom"],
  64: ["muteconga", "conga"],
  65: ["openconga", "conga"],
  66: ["lowconga", "conga"],
  67: ["highbongo", "bongo"],
  68: ["lowbongo", "bongo"],
  69: ["cabasa"],
  70: ["maracas"],
  71: ["shortwhistle", "whistle"],
  72: ["longwhistle", "whistle"],
  73: ["shortguiro", "guiro"],
  74: ["longguiro", "guiro"],
  75: ["claves"],
  76: ["highwoodblock", "woodblock"],
  77: ["lowwoodblock", "woodblock"],
  78: ["cuica"],
  79: ["cuica"],
  80: ["triangle"],
  81: ["triangle"],
};

function normalizeGroup(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function drumSampleName(player: SampledPlayer, pitch: number): string {
  const groups = player.getGroupNames?.() ?? [];
  const candidates = DRUM_GROUPS[pitch] ?? ["snare", "kick"];
  for (const candidate of candidates) {
    const exact = groups.find((group) => normalizeGroup(group) === candidate);
    if (exact) return exact;
    const partial = groups.find((group) =>
      normalizeGroup(group).includes(candidate),
    );
    if (partial) return partial;
  }
  return groups[0] ?? "kick";
}

/** Play one sampled note. Returns null while a patch is loading or unavailable. */
export function playSampledNote(
  ctx: BaseAudioContext,
  dest: AudioNode,
  patch: Patch,
  pitch: number,
  velocity: number,
  when: number,
  dur: number,
  params: Record<string, number>,
): VoiceHandle | null {
  const source = patch.sampled;
  if (!source) return null;

  const entry = entryFor(ctx, dest, patch.id);
  if (!entry?.ready || entry.failed) return null;

  const isDrumMachine = source.engine === "drum-machine";
  const note = isDrumMachine
    ? drumSampleName(entry.player, pitch)
    : pitch;

  if (entry.tone) {
    const brightness = Math.min(
      1,
      Math.max(0, params.brightness ?? params.tone ?? 0.68),
    );
    entry.tone.frequency.setTargetAtTime(
      3500 + brightness * 12500,
      when,
      0.025,
    );
  }

  const stop = entry.player.start({
    note,
    velocity: Math.round(Math.min(1, Math.max(0.02, velocity)) * 127),
    time: when,
    duration: isDrumMachine ? null : dur,
    ampRelease: Math.max(0.04, Math.min(2.5, params.release ?? 0.28)),
  });

  return {
    scheduleStop() {
      // Tonal SoundFonts already receive a duration in start(), which schedules
      // Voice.stop() on the audio clock. Calling the returned StopFn here would
      // also cancel a not-yet-dispatched sampler queue event. Drum-machine
      // samples are one-shots and are allowed to decay naturally.
    },
    kill() {
      stop(ctx.currentTime);
    },
  };
}
