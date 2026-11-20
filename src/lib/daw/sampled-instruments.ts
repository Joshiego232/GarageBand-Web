// Sampled instrument engine. Instrument audio is loaded lazily from the
// credited SoundFont and sampled-kit libraries; no oscillator-only patches
// are used for the expanded library.
import {
  CacheStorage,
  DrumMachine,
  ElectricPiano,
  SampleLoader,
  Scheduler,
  SplendidGrandPiano,
  Soundfont,
} from "smplr";
import type { LoadProgress, SmplrPreset, StorageResponse } from "smplr";
import type { Patch } from "./types";
import type { VoiceHandle } from "./instruments";
import {
  playSoundFontNote,
  prepareSoundFontPatch,
} from "./soundfont-engine";

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
  loadProgress?: LoadProgress;
};

export interface SampledInstrumentStatus {
  trackId: string;
  patchId: string;
  patchName: string;
  state: "loading" | "ready" | "error";
  loaded: number;
  total: number;
  message?: string;
}

type SampleEntry = {
  players: SampledPlayer[];
  ready: boolean;
  failed: boolean;
  readyPromise: Promise<void>;
  tones: BiquadFilterNode[];
};

const sampledStatuses = new Map<string, SampledInstrumentStatus>();

function publishSampledStatus(status: SampledInstrumentStatus): void {
  sampledStatuses.set(status.trackId, status);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<SampledInstrumentStatus>(
      "webband:sampled-instrument-status",
      { detail: status },
    ));
  }
}

export function getSampledInstrumentStatus(
  trackId: string,
): SampledInstrumentStatus | undefined {
  return sampledStatuses.get(trackId);
}

export function findMissingSampleBuffers(
  preset: Pick<SmplrPreset, "groups">,
  buffers: ReadonlyMap<string, AudioBuffer>,
): string[] {
  const required = new Set(
    preset.groups.flatMap((group) => group.regions.map((region) => region.sample)),
  );
  return [...required].filter((name) => !buffers.has(name));
}

const loaders = new WeakMap<BaseAudioContext, SampleLoader>();
const schedulers = new WeakMap<BaseAudioContext, ReturnType<typeof Scheduler>>();
let persistentSampleStorage: ReturnType<typeof CacheStorage> | undefined;
const MAX_CONCURRENT_SAMPLE_FETCHES = 4;
let activeSampleFetches = 0;
const waitingSampleFetches: Array<() => void> = [];

function sampleStorageForSecureOrigin() {
  // CacheStorage requires the browser Cache API, which is restricted to
  // secure contexts. localhost and HTTPS-hosted deployments qualify.
  if (
    typeof window === "undefined" ||
    !window.isSecureContext ||
    typeof caches === "undefined"
  ) {
    return undefined;
  }

  try {
    persistentSampleStorage ??= CacheStorage();
    return persistentSampleStorage;
  } catch (error) {
    console.warn("Persistent sample cache is unavailable; using session memory only.", error);
    return undefined;
  }
}

async function fetchSampleAsset(url: string): Promise<StorageResponse> {
  // smplr requests the notes for an instrument concurrently. Keep a global
  // cap so several tracks cannot flood GitHub Pages with sample requests.
  if (activeSampleFetches >= MAX_CONCURRENT_SAMPLE_FETCHES) {
    await new Promise<void>((resolve) => waitingSampleFetches.push(resolve));
  } else {
    activeSampleFetches += 1;
  }

  try {
    const storage = sampleStorageForSecureOrigin();
    const response = storage ? await storage.fetch(url) : await fetch(url);
    if (response.status !== 200) {
      throw new Error(`Sample request failed with HTTP ${response.status}: ${url}`);
    }
    return response;
  } finally {
    // Hand the occupied slot directly to the next waiter. Do not decrement
    // and re-increment here, which could briefly allow a fifth request in.
    const nextWaiting = waitingSampleFetches.shift();
    if (nextWaiting) nextWaiting();
    else activeSampleFetches -= 1;
  }
}

const limitedSampleStorage = { fetch: fetchSampleAsset };
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
    loader = SampleLoader(ctx, { storage: limitedSampleStorage });
    const originalLoad = loader.load.bind(loader) as (
      preset: SmplrPreset,
      options?: unknown,
    ) => Promise<Map<string, AudioBuffer>>;
    loader.load = (async (preset: SmplrPreset, options?: unknown) => {
      const buffers = await originalLoad(preset, options);
      const missing = findMissingSampleBuffers(preset, buffers);
      if (missing.length) {
        const examples = missing.slice(0, 5).join(", ");
        const remainder = missing.length > 5 ? ` and ${missing.length - 5} more` : "";
        throw new Error(
          `Missing or undecodable sample assets (${missing.length}): ${examples}${remainder}`,
        );
      }
      return buffers;
    }) as SampleLoader["load"];
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
  trackId = patch.id,
): Promise<void> {
  const source = patch.sampled;
  if (!source) return Promise.resolve();

  const byPatch = instrumentMapFor(ctx, dest);
  const existing = byPatch.get(patch.id);
  if (existing && source.engine !== "soundfont-worklet") {
    return existing.readyPromise;
  }

  if (source.engine === "soundfont-worklet") {
    if (!offline) {
      publishSampledStatus({
        trackId,
        patchId: patch.id,
        patchName: patch.name,
        state: "loading",
        loaded: 0,
        total: 1,
      });
    }
    const entry: SampleEntry = existing ?? {
      players: [],
      ready: false,
      failed: false,
      readyPromise: Promise.resolve(),
      tones: [],
    };
    entry.ready = false;
    entry.failed = false;
    byPatch.set(patch.id, entry);
    entry.readyPromise = prepareSoundFontPatch(ctx, dest, trackId, patch)
      .then(() => {
        entry.ready = true;
        if (!offline) {
          publishSampledStatus({
            trackId,
            patchId: patch.id,
            patchName: patch.name,
            state: "ready",
            loaded: 1,
            total: 1,
          });
        }
      })
      .catch((error: unknown) => {
        entry.ready = true;
        if (!offline) {
          publishSampledStatus({
            trackId,
            patchId: patch.id,
            patchName: patch.name,
            state: "error",
            loaded: 0,
            total: 1,
            message: error instanceof Error ? error.message : "SoundFont could not be loaded.",
          });
        }
      });
    return entry.readyPromise;
  }

  const loader = loaderFor(ctx);
  const scheduler = schedulerFor(ctx, offline);
  const playersForPatch: SampledPlayer[] = [];
  const layerProgress = new Map<number, LoadProgress>();
  const reportProgress = (layerIndex: number, progress: LoadProgress) => {
    layerProgress.set(layerIndex, progress);
    if (offline) return;
    const loaded = [...layerProgress.values()].reduce((sum, item) => sum + item.loaded, 0);
    const total = [...layerProgress.values()].reduce((sum, item) => sum + item.total, 0);
    publishSampledStatus({
      trackId,
      patchId: patch.id,
      patchName: patch.name,
      state: "loading",
      loaded,
      total,
    });
  };
  if (!offline) {
    publishSampledStatus({
      trackId,
      patchId: patch.id,
      patchName: patch.name,
      state: "loading",
      loaded: 0,
      total: 0,
    });
  }

  switch (source.engine) {
    case "splendid-piano":
      playersForPatch.push(SplendidGrandPiano(ctx, {
        destination: dest,
        loader,
        scheduler,
        storage: limitedSampleStorage,
        onLoadProgress: (progress) => reportProgress(0, progress),
        volume: 100,
        notesToLoad: {
          notes: PIANO_SAMPLE_NOTES,
          velocityRange: [1, 127],
        },
      }) as unknown as SampledPlayer);
      break;
    case "electric-piano":
      playersForPatch.push(ElectricPiano(ctx, {
        instrument: source.instrument,
        destination: dest,
        loader,
        scheduler,
        storage: limitedSampleStorage,
        onLoadProgress: (progress) => reportProgress(0, progress),
        volume: 96,
      }) as unknown as SampledPlayer);
      break;
    case "drum-machine":
      playersForPatch.push(DrumMachine(ctx, {
        instrument: source.instrument,
        destination: dest,
        loader,
        scheduler,
        storage: limitedSampleStorage,
        onLoadProgress: (progress) => reportProgress(0, progress),
        volume: 96,
      }) as unknown as SampledPlayer);
      break;
    case "soundfont":
    default:
      for (const [index, layer] of [
        { instrument: source.instrument, gain: 1 },
        ...(source.layers ?? []),
      ].entries()) {
        playersForPatch.push(Soundfont(ctx, {
          instrument: layer.instrument,
          kit: source.kit ?? "MusyngKite",
          loadLoopData: source.loop ?? true,
          destination: dest,
          loader,
          scheduler,
          storage: limitedSampleStorage,
          onLoadProgress: (progress) => reportProgress(index, progress),
          volume: Math.round(96 * (index === 0 ? 1 : layer.gain)),
        }) as unknown as SampledPlayer);
      }
      break;
  }

  const entry: SampleEntry = {
    players: playersForPatch,
    ready: false,
    failed: false,
    readyPromise: Promise.resolve(),
    tones: [],
  };
  byPatch.set(patch.id, entry);

  entry.readyPromise = Promise.all(playersForPatch.map((player) => player.ready))
    .then(() => {
      for (const player of playersForPatch) {
        const tone = ctx.createBiquadFilter();
        tone.type = "lowpass";
        tone.frequency.value = 16500;
        tone.Q.value = 0.35;
        player.output.addInsert(tone);
        entry.tones.push(tone);
      }
      entry.ready = true;
      if (!offline) {
        const loaded = [...layerProgress.values()].reduce((sum, item) => sum + item.loaded, 0);
        const total = [...layerProgress.values()].reduce((sum, item) => sum + item.total, 0);
        publishSampledStatus({
          trackId,
          patchId: patch.id,
          patchName: patch.name,
          state: "ready",
          loaded: total || loaded,
          total: total || loaded,
        });
      }
    })
    .catch((error: unknown) => {
      entry.failed = true;
      if (!offline) {
        const loaded = [...layerProgress.values()].reduce((sum, item) => sum + item.loaded, 0);
        const total = [...layerProgress.values()].reduce((sum, item) => sum + item.total, 0);
        publishSampledStatus({
          trackId,
          patchId: patch.id,
          patchName: patch.name,
          state: "error",
          loaded,
          total,
          message: error instanceof Error ? error.message : "One or more instrument samples could not be loaded.",
        });
      }
      // Remove failed cache entries so a later Play/Preview attempt can retry.
      if (byPatch.get(patch.id) === entry) byPatch.delete(patch.id);
      console.error(
        `Could not load sampled instrument ${patch.name}. Check the sample host connection and try loading the instrument again.`,
        error,
      );
      throw error;
    });

  return entry.readyPromise;
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
  noteOffControlled = false,
): VoiceHandle | null {
  const source = patch.sampled;
  if (!source) return null;
  if (source.engine === "soundfont-worklet") {
    return playSoundFontNote(ctx, dest, patch, pitch, velocity, when, params);
  }

  const entry = entryFor(ctx, dest, patch.id);
  if (!entry?.ready || entry.failed) return null;

  const isDrumMachine = source.engine === "drum-machine";
  const note = isDrumMachine
    ? drumSampleName(entry.players[0], pitch)
    : pitch;

  if (entry.tones.length) {
    const brightness = Math.min(
      1,
      Math.max(0, params.brightness ?? params.tone ?? 0.68),
    );
    for (const tone of entry.tones) {
      tone.frequency.setTargetAtTime(3500 + brightness * 12500, when, 0.025);
    }
  }

  const stops = entry.players.map((player) => player.start({
      note,
      velocity: Math.round(Math.min(1, Math.max(0.02, velocity)) * 127),
      time: when,
      duration: isDrumMachine || noteOffControlled ? null : dur,
      ampRelease: Math.max(0.04, Math.min(2.5, params.release ?? 0.28)),
    }));

  return {
    scheduleStop(at: number) {
      // Timeline notes are stopped by Smplr's duration parameter so scheduled
      // future events are not cancelled. Live input notes instead wait for an
      // actual key-up and must call the returned stop function.
      if (noteOffControlled && !isDrumMachine) {
        for (const stop of stops) stop(at);
      }
      // Drum-machine samples are one-shots and decay naturally.
    },
    kill() {
      for (const stop of stops) stop(ctx.currentTime);
    },
  };
}
