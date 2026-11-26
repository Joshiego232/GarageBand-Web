import type { WorkletSynthesizer } from "spessasynth_lib";
import {
  cacheSoundFont,
  getCachedSoundFont,
  getImportedSoundFont,
} from "./soundfont-cache";
import type { Patch, SoundFontPresetRef } from "./types";
import type { VoiceHandle } from "./instruments";

export type SoundFontLoadState = "loading" | "ready" | "fallback";

export interface SoundFontStatus {
  trackId: string;
  state: SoundFontLoadState;
  message?: string;
}

interface SynthSession {
  trackId: string;
  destination: AudioNode;
  owner: Map<AudioNode, SynthSession>;
  synth?: WorkletSynthesizer;
  widthNodes?: {
    directLeft: GainNode;
    crossLeft: GainNode;
    crossRight: GainNode;
    directRight: GainNode;
    merger: ChannelMergerNode;
    splitter: ChannelSplitterNode;
    highShelf: BiquadFilterNode;
  };
  ready: Promise<void>;
  refKey?: string;
  bankLoad?: Promise<void>;
  channel?: number;
  bank?: number;
  program?: number;
}

type MIDIController = Parameters<WorkletSynthesizer["controllerChange"]>[1];

const sessions = new WeakMap<BaseAudioContext, Map<AudioNode, SynthSession>>();
const workletRegistrations = new WeakMap<BaseAudioContext, Promise<void>>();
const statuses = new Map<string, SoundFontStatus>();
const activeSessions = new Set<SynthSession>();

function setStatus(status: SoundFontStatus) {
  statuses.set(status.trackId, status);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<SoundFontStatus>("webband:soundfont-status", {
      detail: status,
    }));
  }
}

export function getSoundFontStatus(trackId: string): SoundFontStatus | undefined {
  return statuses.get(trackId);
}

export function clearSoundFontStatus(trackId: string): void {
  statuses.delete(trackId);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<SoundFontStatus>("webband:soundfont-status", {
      detail: { trackId, state: "ready" },
    }));
  }
}

function sessionsFor(context: BaseAudioContext): Map<AudioNode, SynthSession> {
  let contextSessions = sessions.get(context);
  if (!contextSessions) {
    contextSessions = new Map();
    sessions.set(context, contextSessions);
  }
  return contextSessions;
}

function setStereoWidth(session: SynthSession, width: number, highShelfDb: number) {
  const nodes = session.widthNodes;
  if (!nodes) return;
  const clampedWidth = Math.min(2, Math.max(0, width));
  nodes.directLeft.gain.value = (1 + clampedWidth) / 2;
  nodes.crossLeft.gain.value = (1 - clampedWidth) / 2;
  nodes.crossRight.gain.value = (1 - clampedWidth) / 2;
  nodes.directRight.gain.value = (1 + clampedWidth) / 2;
  nodes.highShelf.gain.value = Math.min(12, Math.max(-12, highShelfDb));
}

function refKey(ref: SoundFontPresetRef): string {
  return ref.source === "marmooo"
    ? `${ref.url}:${ref.bank}:${ref.program}`
    : `${ref.fileId}:${ref.bank}:${ref.program}`;
}

function isOfflineContext(context: BaseAudioContext): boolean {
  return typeof OfflineAudioContext !== "undefined" && context instanceof OfflineAudioContext;
}

async function loadBytes(ref: SoundFontPresetRef): Promise<ArrayBuffer> {
  if (ref.source === "imported") {
    if (!ref.fileId) throw new Error("The imported SoundFont record is missing its file ID.");
    const record = await getImportedSoundFont(ref.fileId);
    if (!record) throw new Error(`Imported SoundFont "${ref.name}" is no longer available.`);
    return record.bytes;
  }
  if (!ref.url) throw new Error(`No streaming URL is configured for "${ref.name}".`);

  try {
    const cached = await getCachedSoundFont(ref.url);
    if (cached) return cached;
  } catch (error) {
    console.warn("SoundFont cache read failed; requesting the instrument from its CDN.", error);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let bytes: ArrayBuffer;
  try {
    const response = await fetch(ref.url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`SoundFont request failed (${response.status} ${response.statusText}).`);
    }
    bytes = await response.arrayBuffer();
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`SoundFont request timed out for "${ref.name}".`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  try {
    await cacheSoundFont(ref.url, bytes.slice(0));
  } catch (error) {
    console.warn("SoundFont was loaded but could not be cached for a future session.", error);
  }
  return bytes;
}

async function registerWorklet(context: BaseAudioContext): Promise<void> {
  let registration = workletRegistrations.get(context);
  if (!registration) {
    if (!context.audioWorklet?.addModule) {
      throw new Error("AudioWorklet is not supported in this browser.");
    }
    registration = context.audioWorklet.addModule("/api/daw/soundfont-worklet");
    workletRegistrations.set(context, registration);
    registration.catch(() => workletRegistrations.delete(context));
  }
  await registration;
}

async function sessionFor(
  context: BaseAudioContext,
  destination: AudioNode,
  trackId: string,
): Promise<SynthSession> {
  const byDestination = sessionsFor(context);
  const existing = byDestination.get(destination);
  if (existing) {
    existing.trackId = trackId;
    await existing.ready;
    return existing;
  }

  const session: SynthSession = {
    trackId,
    destination,
    owner: byDestination,
    ready: Promise.resolve(),
  };
  byDestination.set(destination, session);
  session.ready = (async () => {
    await registerWorklet(context);
    const { WorkletSynthesizer: Synthesizer } = await import("spessasynth_lib");
    const synth = new Synthesizer(context, {
      eventsEnabled: false,
      decodedSampleBudget: 128 * 1024 * 1024,
    });
    const splitter = context.createChannelSplitter(2);
    const merger = context.createChannelMerger(2);
    const directLeft = context.createGain();
    const crossLeft = context.createGain();
    const crossRight = context.createGain();
    const directRight = context.createGain();
    const highShelf = context.createBiquadFilter();
    highShelf.type = "highshelf";
    highShelf.frequency.value = 6000;
    synth.connect(splitter);
    splitter.connect(directLeft, 0);
    splitter.connect(crossLeft, 1);
    splitter.connect(crossRight, 0);
    splitter.connect(directRight, 1);
    directLeft.connect(merger, 0, 0);
    crossLeft.connect(merger, 0, 0);
    crossRight.connect(merger, 0, 1);
    directRight.connect(merger, 0, 1);
    merger.connect(highShelf);
    highShelf.connect(destination);
    session.widthNodes = {
      directLeft,
      crossLeft,
      crossRight,
      directRight,
      merger,
      splitter,
      highShelf,
    };
    setStereoWidth(session, 1, 0);
    await synth.isReady;
    session.synth = synth;
    activeSessions.add(session);
  })().catch((error: unknown) => {
    if (byDestination.get(destination) === session) byDestination.delete(destination);
    activeSessions.delete(session);
    throw error;
  });
  await session.ready;
  return session;
}

function controllerValue(
  key: string,
  value: number,
  min: number,
  max: number,
): number {
  const normalized = Math.min(1, Math.max(0, (value - min) / (max - min)));
  if (key === "cutoff" || key === "attack" || key === "release") {
    const low = key === "cutoff" ? 20 : 0.001;
    const high = key === "cutoff" ? 20_000 : 10;
    return Math.round(127 * Math.log(Math.max(low, value) / low) / Math.log(high / low));
  }
  return Math.round(normalized * 127);
}

function applyControls(
  session: SynthSession,
  patch: Patch,
  params: Record<string, number>,
  when: number,
) {
  const synth = session.synth;
  if (!synth) return;
  const channel = session.channel ?? 0;
  const controllers: Record<string, MIDIController> = {
    cutoff: 74 as MIDIController,
    resonance: 71 as MIDIController,
    attack: 73 as MIDIController,
    release: 72 as MIDIController,
    chorus: 93 as MIDIController,
    reverb: 91 as MIDIController,
  };
  for (const knob of patch.knobs) {
    const controller = controllers[knob.id];
    if (controller === undefined) continue;
    const value = params[knob.id] ?? knob.def;
    synth.controllerChange(
      channel,
      controller,
      controllerValue(knob.id, value, knob.min, knob.max),
      { time: when },
    );
  }
}

export async function prepareSoundFontPatch(
  context: BaseAudioContext,
  destination: AudioNode,
  trackId: string,
  patch: Patch,
): Promise<void> {
  const ref = patch.soundfont;
  if (!ref) throw new Error(`The SoundFont patch "${patch.name}" has no source.`);
  if (isOfflineContext(context)) {
    setStatus({
      trackId,
      state: "fallback",
      message: "Built-in synth used for offline rendering.",
    });
    return;
  }

  setStatus({ trackId, state: "loading" });
  try {
    const [session, bytes] = await Promise.all([
      sessionFor(context, destination, trackId),
      loadBytes(ref),
    ]);
    const synth = session.synth;
    if (!synth) throw new Error("The SoundFont synthesizer did not initialize.");
    const key = refKey(ref);
    const loadBank = (session.bankLoad ?? Promise.resolve()).then(async () => {
      if (session.refKey === key) return;
      const channel = ref.bank === 128 ? 9 : 0;
      await synth.soundBankManager.addSoundBank(bytes.slice(0), "active-preset");
      session.channel = channel;
      session.bank = ref.bank;
      session.program = ref.program;
      session.refKey = key;
      synth.controllerChange(channel, 0, Math.floor(ref.bank / 128), {
        time: context.currentTime,
      });
      synth.controllerChange(channel, 32, ref.bank % 128, {
        time: context.currentTime,
      });
      synth.programChange(channel, ref.program, {
        time: context.currentTime,
      });
    });
    session.bankLoad = loadBank.catch(() => undefined);
    await loadBank;
    setStereoWidth(session, ref.stereoWidth ?? 1, ref.highShelfDb ?? 0);
    const defaults = Object.fromEntries(patch.knobs.map((knob) => [knob.id, knob.def]));
    applyControls(session, patch, defaults, context.currentTime);
    setStatus({ trackId, state: "ready" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SoundFont loading failed.";
    console.warn(`Using the built-in synth for "${patch.name}".`, error);
    setStatus({ trackId, state: "fallback", message });
    throw error;
  }
}

export function playSoundFontNote(
  context: BaseAudioContext,
  destination: AudioNode,
  patch: Patch,
  pitch: number,
  velocity: number,
  when: number,
  params: Record<string, number>,
): VoiceHandle | null {
  const session = sessions.get(context)?.get(destination);
  const synth = session?.synth;
  if (!session || !synth || !session.refKey || !patch.soundfont || session.refKey !== refKey(patch.soundfont)) {
    return null;
  }
  const channel = session.channel ?? 0;
  const note = Math.max(0, Math.min(127, Math.round(pitch)));
  const noteVelocity = Math.max(1, Math.min(127, Math.round(velocity * 127)));
  applyControls(session, patch, params, when);
  synth.noteOn(channel, note, noteVelocity, { time: when });
  return {
    scheduleStop(at: number) {
      if (patch.soundfont?.bank !== 128) {
        synth.noteOff(channel, note, { time: at });
      }
    },
    kill() {
      synth.noteOff(channel, note, { time: context.currentTime });
    },
  };
}

export function updateSoundFontPatchControls(
  trackId: string,
  patch: Patch,
  params: Record<string, number>,
): void {
  for (const session of activeSessions) {
    if (session.trackId === trackId && session.synth) {
      applyControls(session, patch, params, session.synth.currentTime);
    }
  }
}

export function pitchBendSoundFontTrack(trackId: string, value: number): void {
  for (const session of activeSessions) {
    if (session.trackId === trackId && session.channel !== undefined && session.synth) {
      const normalized = Math.min(1, Math.max(-1, value));
      session.synth.pitchWheel(
        session.channel,
        Math.round(8192 + normalized * (normalized < 0 ? 8192 : 8191)),
        { time: session.synth.currentTime },
      );
    }
  }
}

export function disposeSoundFontTrack(trackId: string): void {
  for (const session of activeSessions) {
    if (session.trackId !== trackId) continue;
    session.synth?.destroy();
    session.widthNodes?.splitter.disconnect();
    session.widthNodes?.merger.disconnect();
    session.widthNodes?.highShelf.disconnect();
    session.widthNodes?.directLeft.disconnect();
    session.widthNodes?.crossLeft.disconnect();
    session.widthNodes?.crossRight.disconnect();
    session.widthNodes?.directRight.disconnect();
    activeSessions.delete(session);
    session.owner.delete(session.destination);
  }
  clearSoundFontStatus(trackId);
}
