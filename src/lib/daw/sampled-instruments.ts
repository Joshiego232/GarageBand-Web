// Multi-sampled instruments for the DAW's acoustic piano and orchestral strings.
// The sampler is warmed after the audio context is unlocked. Until it is ready,
// the procedural patches remain available as a graceful offline/network fallback.
import { SampleLoader, SplendidGrandPiano, Soundfont } from "smplr";
import type { VoiceHandle } from "./instruments";

type SampledPlayer = ReturnType<typeof SplendidGrandPiano> | ReturnType<typeof Soundfont>;
type SampleEntry = {
  player: SampledPlayer;
  ready: boolean;
  failed: boolean;
  tone?: BiquadFilterNode;
};

const loaders = new WeakMap<BaseAudioContext, SampleLoader>();
const players = new WeakMap<BaseAudioContext, Map<AudioNode, Map<string, SampleEntry>>>();
const PIANO_SAMPLE_NOTES = [21, 27, 33, 39, 45, 51, 57, 63, 69, 75, 81, 87, 93, 99, 105, 108];

function loaderFor(ctx: BaseAudioContext): SampleLoader {
  let loader = loaders.get(ctx);
  if (!loader) {
    loader = SampleLoader(ctx);
    loaders.set(ctx, loader);
  }
  return loader;
}

function entryFor(ctx: BaseAudioContext, dest: AudioNode, patchId: string): SampleEntry | undefined {
  const instrumentMap = players.get(ctx);
  return instrumentMap?.get(dest)?.get(patchId);
}

/** Load a sample-backed instrument into a track input. Safe to call repeatedly. */
export function warmSampledPatch(
  ctx: BaseAudioContext,
  dest: AudioNode,
  patchId: string,
): Promise<void> {
  if (patchId !== "grand-piano" && patchId !== "bright-piano" && patchId !== "string-ensemble") {
    return Promise.resolve();
  }

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
  const existing = byPatch.get(patchId);
  if (existing) return existing.player.ready.then(() => undefined).catch(() => undefined);

  const loader = loaderFor(ctx);
  const isStrings = patchId === "string-ensemble";
  const player: SampledPlayer = isStrings
    ? Soundfont(ctx, {
        instrument: "string_ensemble_1",
        kit: "FluidR3_GM",
        loadLoopData: true,
        destination: dest,
        loader,
        volume: 92,
      })
    : SplendidGrandPiano(ctx, {
        destination: dest,
        loader,
        volume: 100,
        notesToLoad: { notes: PIANO_SAMPLE_NOTES, velocityRange: [1, 127] },
      });

  const entry: SampleEntry = { player, ready: false, failed: false };
  byPatch.set(patchId, entry);
  return player.ready.then(() => {
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = isStrings ? 6200 : 15000;
    tone.Q.value = 0.35;
    player.output.addInsert(tone);
    entry.tone = tone;
    entry.ready = true;
  }).catch((error: unknown) => {
    entry.failed = true;
    console.warn(`Could not load sampled ${patchId}; using the built-in fallback.`, error);
  });
}

/** Return a sample-backed voice when loaded, or null so the caller can fall back. */
export function playSampledNote(
  ctx: BaseAudioContext,
  dest: AudioNode,
  patchId: string,
  pitch: number,
  velocity: number,
  when: number,
  dur: number,
  params: Record<string, number>,
): VoiceHandle | null {
  const entry = entryFor(ctx, dest, patchId);
  if (!entry?.ready || entry.failed) return null;

  const isStrings = patchId === "string-ensemble";
  if (entry.tone) {
    const brightness = Math.min(1, Math.max(0, params.brightness ?? (isStrings ? 0.5 : 0.6)));
    entry.tone.frequency.setTargetAtTime(isStrings ? 1800 + brightness * 10500 : 1800 + brightness * 16500, when, 0.025);
  }
  if (isStrings) {
    // General MIDI modulation wheel adds natural ensemble vibrato on the sampled patch.
    entry.player.setCC(1, Math.round(Math.min(1, Math.max(0, params.vibrato ?? 0.35)) * 127));
  }

  const stop = entry.player.start({
    note: pitch,
    velocity: Math.round(Math.min(1, Math.max(0.02, velocity)) * 127),
    time: when,
    duration: dur,
    ampRelease: isStrings ? 0.75 : Math.max(0.05, Math.min(1.5, params.release ?? 0.12)),
  });
  return {
    scheduleStop(at: number) {
      stop(at);
    },
    kill() {
      // Smplr releases voices safely at the requested audio-clock time.
      stop(ctx.currentTime);
    },
  };
}
