// ============================================================
// Audio engine: transport, lookahead scheduler, mixing, recording
// Works with the zustand store (reads live project state)
// ============================================================
import {
  PPQ,
  type Project,
  type Track,
  type Region,
  type Note,
  type Patch,
  type AutomationLane,
  uid,
  getRegionPlaybackBufferId,
} from "./types";
import { playNote, PATCHES, trackPatch, type VoiceHandle } from "./instruments";
import { warmSampledPatch } from "./sampled-instruments";
import {
  clearSoundFontStatus,
  disposeSoundFontTrack,
  pitchBendSoundFontTrack,
  updateSoundFontPatchControls,
} from "./soundfont-engine";
import { applyMidiPlugins } from "./plugins";
import { PedalboardProcessor } from "./pedalboard-engine";
import { selectSamplerZone, shouldReleaseSamplerOnNoteOff } from "./sampler";
import { useDAW } from "./store";
import {
  tickToSec,
  secToTick,
  clamp,
  barTicks,
  makeRng,
  projectLengthTicks,
} from "./utils";
import type { StoredBuffer } from "./idb";
import { loadBuffer, saveBuffer } from "./idb";
import { toast } from "sonner";
import {
  getEffectiveTrackGain,
  getVcaMultiplier,
  isTrackAudible,
  resolveOutputBus,
} from "./routing";
import { AutomationEngine, automationEngine, automationValueAt } from "./AutomationEngine";

const LOOKAHEAD_SEC = 0.18;
const TICK_INTERVAL_MS = 40;

interface TrackNodes {
  input: GainNode;
  eqLow: BiquadFilterNode;
  eqMid: BiquadFilterNode;
  eqHigh: BiquadFilterNode;
  deEsser: BiquadFilterNode;
  presence: BiquadFilterNode;
  highPass: BiquadFilterNode;
  comp: DynamicsCompressorNode;
  saturation: WaveShaperNode;
  gain: GainNode;
  groupGain: GainNode;
  muteGain: GainNode;
  panner: StereoPannerNode;
  spatialPanner: PannerNode;
  output: GainNode;
  routingTarget: AudioNode;
  analyser: AnalyserNode;
  pedalboard: PedalboardProcessor;
  reverbSend: GainNode;
  delaySend: GainNode;
  chorusDelay: DelayNode;
  chorusSend: GainNode;
  chorusLfo: OscillatorNode;
  chorusDepth: GainNode;
  flangerDelay: DelayNode;
  flangerSend: GainNode;
  flangerFeedback: GainNode;
  flangerLfo: OscillatorNode;
  flangerDepth: GainNode;
}

interface AudioInputSession {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  monitorGain: GainNode;
  captureNode: ScriptProcessorNode | null;
  sink: GainNode | null;
  chunks: Float32Array[];
  sampleRate: number;
  startCtxTime: number;
}

interface RecordedAudio {
  trackId: string;
  stored: StoredBuffer;
  offsetSec: number;
  durationSec: number;
}

interface RecordedMidiNote {
  trackId: string;
  pitch: number;
  velocity: number;
  start: number;
  length: number;
}

interface LiveClipRef {
  trackId: string;
  regionId: string;
}

interface LiveMidiClipState {
  kind: "midi";
  track: Track;
  region: Region;
  regionId: string;
  notes: Note[];
  startTime: number;
  periodTicks: number;
  periodSec: number;
  scheduledUntil: number;
  voices: { handle: VoiceHandle; until: number }[];
}

interface LiveAudioClipState {
  kind: "audio";
  trackId: string;
  regionId: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

type LiveClipState = LiveMidiClipState | LiveAudioClipState;

interface MasterNodes {
  input: GainNode;
  limiter: DynamicsCompressorNode;
  volume: GainNode;
  filter: BiquadFilterNode;
  panner: StereoPannerNode;
  analyser: AnalyserNode;
  reverbConv: ConvolverNode;
  reverbReturn: GainNode;
  delay: DelayNode;
  delayFb: GainNode;
  delayFilter: BiquadFilterNode;
  delayReturn: GainNode;
  click: GainNode;
}

interface ActiveVoice {
  handle: VoiceHandle;
  until: number; // ctx time when it can be pruned
}

export interface OfflineRenderOptions {
  startTick?: number;
  endTick?: number;
  sampleRate?: number;
  tailSeconds?: number;
  includeTrackIds?: string[];
  signal?: AbortSignal;
}

function makeImpulse(ctx: BaseAudioContext, seconds = 2.6): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  const random = makeRng(0x475542);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const decay = Math.pow(1 - t, 2.4) * Math.exp(-2.2 * t);
      const white = random() * 2 - 1;
      lp = lp + 0.28 * (white - lp); // dark tail
      d[i] = lp * decay * 1.4;
      // early reflections
      if (i === Math.floor(sr * 0.013 * (c + 1))) d[i] += 0.5 * (c ? -1 : 1);
      if (i === Math.floor(sr * 0.031)) d[i] += 0.3;
    }
  }
  return buf;
}

function buildMaster(ctx: BaseAudioContext): MasterNodes {
  const input = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1.5;
  limiter.knee.value = 0;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  const volume = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 20000;
  const panner = ctx.createStereoPanner();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;

  input.connect(limiter).connect(volume).connect(filter).connect(panner).connect(analyser);
  analyser.connect(ctx.destination);

  const reverbConv = ctx.createConvolver();
  reverbConv.buffer = makeImpulse(ctx);
  const reverbReturn = ctx.createGain();
  reverbReturn.gain.value = 0.8;
  reverbConv.connect(reverbReturn).connect(input);

  const delay = ctx.createDelay(2);
  const delayFb = ctx.createGain();
  delayFb.gain.value = 0.36;
  const delayFilter = ctx.createBiquadFilter();
  delayFilter.type = "lowpass";
  delayFilter.frequency.value = 4200;
  const delayReturn = ctx.createGain();
  delayReturn.gain.value = 0.85;
  delay.connect(delayFilter).connect(delayReturn).connect(input);
  delayFilter.connect(delayFb).connect(delay);

  const click = ctx.createGain();
  click.gain.value = 0.9;
  click.connect(ctx.destination);

  return { input, limiter, volume, filter, panner, analyser, reverbConv, reverbReturn, delay, delayFb, delayFilter, delayReturn, click };
}

function buildTrack(ctx: BaseAudioContext, master: MasterNodes): TrackNodes {
  const input = ctx.createGain();
  const eqLow = ctx.createBiquadFilter();
  eqLow.type = "lowshelf";
  const eqMid = ctx.createBiquadFilter();
  eqMid.type = "peaking";
  const eqHigh = ctx.createBiquadFilter();
  eqHigh.type = "highshelf";

  const deEsser = ctx.createBiquadFilter();
  deEsser.type = "peaking";
  deEsser.frequency.value = 6800;
  deEsser.Q.value = 2;
  const presence = ctx.createBiquadFilter();
  presence.type = "peaking";
  presence.frequency.value = 3200;
  presence.Q.value = 0.8;

  const highPass = ctx.createBiquadFilter();
  highPass.type = "highpass";
  highPass.frequency.value = 20;
  highPass.Q.value = 0.707;

  const comp = ctx.createDynamicsCompressor();
  setComp(comp, false);
  const saturation = ctx.createWaveShaper();
  saturation.curve = new Float32Array([-1, 1]);
  saturation.oversample = "4x";

  const gain = ctx.createGain();
  const groupGain = ctx.createGain();
  const muteGain = ctx.createGain();
  const panner = ctx.createStereoPanner();
  const spatialPanner = ctx.createPanner();
  spatialPanner.panningModel = "equalpower";
  spatialPanner.distanceModel = "inverse";
  spatialPanner.refDistance = 1;
  spatialPanner.rolloffFactor = 0;
  const analyser = ctx.createAnalyser();
  const output = ctx.createGain();
  const pedalboard = new PedalboardProcessor(ctx);
  analyser.fftSize = 512;
  const reverbSend = ctx.createGain();
  reverbSend.gain.value = 0;
  const delaySend = ctx.createGain();
  delaySend.gain.value = 0;

  const chorusDelay = ctx.createDelay(0.08);
  chorusDelay.delayTime.value = 0.02;
  const chorusSend = ctx.createGain();
  chorusSend.gain.value = 0;
  const chorusLfo = ctx.createOscillator();
  chorusLfo.frequency.value = 0.7;
  const chorusDepth = ctx.createGain();
  chorusDepth.gain.value = 0.003;
  chorusLfo.connect(chorusDepth).connect(chorusDelay.delayTime);
  chorusLfo.start();

  const flangerDelay = ctx.createDelay(0.03);
  flangerDelay.delayTime.value = 0.004;
  const flangerSend = ctx.createGain();
  flangerSend.gain.value = 0;
  const flangerFeedback = ctx.createGain();
  flangerFeedback.gain.value = 0;
  const flangerLfo = ctx.createOscillator();
  flangerLfo.frequency.value = 0.25;
  const flangerDepth = ctx.createGain();
  flangerDepth.gain.value = 0.0015;
  flangerLfo.connect(flangerDepth).connect(flangerDelay.delayTime);
  flangerLfo.start();

  input
    .connect(eqLow)
    .connect(eqMid)
    .connect(eqHigh)
    .connect(deEsser)
    .connect(presence)
    .connect(highPass)
    .connect(comp)
    .connect(saturation)
    .connect(gain)
    .connect(groupGain)
    .connect(muteGain)
    .connect(panner)
    .connect(spatialPanner)
    .connect(analyser)
    .connect(pedalboard.input);
  pedalboard.output.connect(output);

  output.connect(master.input);

  panner.connect(reverbSend).connect(master.reverbConv);
  panner.connect(delaySend).connect(master.delay);

  // Chorus and flanger are parallel, tempo-independent insert sends.
  panner.connect(chorusDelay);
  chorusDelay.connect(chorusSend).connect(spatialPanner);

  panner.connect(flangerDelay);
  flangerDelay.connect(flangerSend).connect(spatialPanner);
  flangerDelay.connect(flangerFeedback).connect(flangerDelay);

  return {
    input, eqLow, eqMid, eqHigh, deEsser, presence, highPass, comp, saturation,
    gain, groupGain, muteGain, panner, spatialPanner, analyser, output, routingTarget: master.input, pedalboard,
    reverbSend, delaySend, chorusDelay, chorusSend,
    chorusLfo, chorusDepth, flangerDelay, flangerSend, flangerFeedback,
    flangerLfo, flangerDepth,
  };
}

function applyTrackSpatialPanning(tn: TrackNodes, track: Track) {
  const enabled = track.spatialEnabled === true;
  tn.spatialPanner.panningModel = enabled ? "HRTF" : "equalpower";
  tn.panner.pan.value = enabled ? 0 : clamp(track.pan, -1, 1);

  const x = enabled ? clamp(track.spatialX ?? 0, -5, 5) : 0;
  const y = enabled ? clamp(track.spatialY ?? 0, -5, 5) : 0;
  const z = enabled ? clamp(track.spatialZ ?? -1, -5, 5) : -1;

  if (tn.spatialPanner.positionX && tn.spatialPanner.positionY && tn.spatialPanner.positionZ) {
    tn.spatialPanner.positionX.value = x;
    tn.spatialPanner.positionY.value = y;
    tn.spatialPanner.positionZ.value = z;
  } else {
    tn.spatialPanner.setPosition(x, y, z);
  }
}

function setComp(
  comp: DynamicsCompressorNode,
  on: boolean,
  threshold = -18,
  ratio = 2.5
) {
  comp.threshold.value = on ? threshold : 0;
  comp.ratio.value = on ? ratio : 1;
  comp.knee.value = on ? 6 : 0;
  comp.attack.value = 0.006;
  comp.release.value = 0.18;
}

function activeAudioPlugin(track: Track, id: string) {
  return (track.audioPlugins ?? []).find((plugin) => plugin.pluginId === id) ?? null;
}

function applyTrackAudioPlugins(tn: TrackNodes, track: Track) {
  const get = (id: string) => activeAudioPlugin(track, id);
  const eqPlugin = get("eq");
  const eqEnabled = eqPlugin ? eqPlugin.enabled : true;
  const eq = track.eq;

  tn.eqLow.frequency.value = eq.lowFreq;
  const eqMix = eqPlugin?.enabled ? clamp(eqPlugin.params.mix ?? 1, 0, 1) : 1;
  tn.eqLow.gain.value = eqEnabled ? eq.lowGain * eqMix : 0;
  tn.eqMid.frequency.value = eq.midFreq;
  tn.eqMid.Q.value = eq.midQ;
  tn.eqMid.gain.value = eqEnabled ? eq.midGain * eqMix : 0;
  tn.eqHigh.frequency.value = eq.highFreq;
  tn.eqHigh.gain.value = eqEnabled ? eq.highGain * eqMix : 0;

  const compressor = get("compressor");
  const compressorPluginEnabled = !!compressor?.enabled;
  setComp(
    tn.comp,
    track.compressor || compressorPluginEnabled,
    compressorPluginEnabled ? compressor?.params.threshold ?? -18 : -18,
    compressorPluginEnabled ? compressor?.params.ratio ?? 2.5 : 2.5
  );

  const highPass = get("high-pass");
  tn.highPass.frequency.value = highPass?.enabled
    ? clamp(highPass.params.frequency ?? 80, 20, 320)
    : 20;

  const deEsser = get("de-esser");
  tn.deEsser.frequency.value = deEsser?.params.frequency ?? 6800;
  tn.deEsser.gain.value = deEsser?.enabled
    ? -(deEsser.params.reduction ?? 5)
    : 0;
  const presence = get("presence");
  tn.presence.frequency.value = presence?.params.frequency ?? 3200;
  tn.presence.gain.value = presence?.enabled ? presence.params.gain ?? 2 : 0;

  const saturation = get("saturation");
  const drive = saturation?.enabled ? Math.max(0, saturation.params.drive ?? 0.28) : 0;
  const curve = new Float32Array(1024);
  const amount = drive * 6;
  const normalizer = amount > 0 ? Math.tanh(amount) : 1;
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = amount > 0 ? Math.tanh(x * amount) / normalizer : x;
  }
  tn.saturation.curve = curve;

  const chorus = get("chorus");
  if (chorus?.enabled) {
    tn.chorusLfo.frequency.value = chorus.params.rate ?? 0.7;
    tn.chorusDepth.gain.value = 0.001 + (chorus.params.depth ?? 0.45) * 0.006;
    tn.chorusDelay.delayTime.value = 0.02;
    tn.chorusSend.gain.value = 0.28;
  } else {
    tn.chorusSend.gain.value = 0;
  }

  const flanger = get("flanger");
  if (flanger?.enabled) {
    tn.flangerLfo.frequency.value = flanger.params.rate ?? 0.25;
    tn.flangerDepth.gain.value = 0.0003 + (flanger.params.feedback ?? 0.35) * 0.002;
    tn.flangerDelay.delayTime.value = 0.004;
    tn.flangerFeedback.gain.value = Math.min(0.85, flanger.params.feedback ?? 0.35);
    tn.flangerSend.gain.value = 0.24;
  } else {
    tn.flangerSend.gain.value = 0;
    tn.flangerFeedback.gain.value = 0;
  }

  const reverb = get("reverb");
  const delay = get("delay");
  tn.reverbSend.gain.value = reverb
    ? (reverb.enabled ? clamp(reverb.params.amount ?? 0.28, 0, 1) : 0)
    : clamp((track.params.reverb ?? 0) * 0.9, 0, 1);
  tn.delaySend.gain.value = delay
    ? (delay.enabled ? clamp(delay.params.amount ?? 0.22, 0, 1) : 0)
    : clamp((track.params.delay ?? 0) * 0.9, 0, 1);

}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master: MasterNodes | null = null;
  private tracks = new Map<string, TrackNodes>();
  private pedalAutomationUnbinds = new Map<string, (() => void)[]>();
  private voices: ActiveVoice[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private playRequestId = 0;
  private playPending = false;

  // transport
  playing = false;
  recording = false;
  recordPending = false;
  private passStartTime = 0;
  private passStartTick = 0;
  private scheduledUntilTick = 0;
  private countInBeats = 0;
  private countInStartTime = 0;
  private stoppedAtTick = 0;

  // MIDI live input + recording
  private openInputNotes = new Map<number, Map<string, { voices: VoiceHandle[]; startTick: number; velocity: number }>>();
  private sustainedVoices: VoiceHandle[] = [];
  recordedMidi: RecordedMidiNote[] = [];
  private recordingStartTick = 0;
  private recordingMidiTrackIds = new Set<string>();
  private recordingAudioTrackIds = new Set<string>();

  // audio capture
  private audioInputs = new Map<string, AudioInputSession>();

  // buffer cache
  private bufferCache = new Map<string, StoredBuffer>();
  private pendingLoads = new Set<string>();
  private bufferLoadPromises = new Map<string, Promise<StoredBuffer | undefined>>();
  private ctxBufferCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();
  private auditionDest: GainNode | null = null;
  private previewTimer: ReturnType<typeof setInterval> | null = null;
  private liveLoopTimer: ReturnType<typeof setInterval> | null = null;
  private liveClips = new Map<string, LiveClipState>();
  private liveGridStartTime = 0;
  private lastAutomationPersistTime = 0;
  private pendingAutomationPoints: ReturnType<typeof automationEngine.recordContinuous> = [];

  // loop preview
  private preview: {
    patchId: string;
    params: Record<string, number>;
    notes: { pitch: number; velocity: number; start: number; len: number }[];
    periodSec: number;
    startTime: number;
    scheduledUntil: number;
    dest: GainNode;
  } | null = null;

  private unsub: (() => void) | null = null;
  private inited = false;
  private activeOutputDeviceId: string | null | undefined = undefined;
  private tempoMapSource: AutomationLane | undefined;
  private tempoMapPoints: AutomationLane["points"] | undefined;
  private tempoMapBase = -1;
  private tempoMapEnabled = false;
  private tempoKnots: { tick: number; seconds: number }[] = [];

  // ---------------- lifecycle ----------------

  init() {
    if (this.inited || typeof window === "undefined") return;
    this.inited = true;
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    this.master = buildMaster(this.ctx);
    // sync whenever the project changes
    this.unsub = useDAW.subscribe((state, prev) => {
      if (
        state.project.tracks !== prev.project.tracks ||
        state.project.stacks !== prev.project.stacks ||
        state.project.masterVolume !== prev.project.masterVolume ||
        state.project.tempo !== prev.project.tempo ||
        state.project.audioOutputDeviceId !== prev.project.audioOutputDeviceId
      ) this.sync(state.project);
    });
    window.addEventListener("pointerup", () => {
      const state = useDAW.getState();
      state.appendAutomationPoints(
        automationEngine.finishTouches(
          state.project.automationLanes ?? [],
          state.project.automationModes ?? {}
        )
      );
    });
    this.sync(useDAW.getState().project);
    void this.ctx.resume();
  }

  get ready(): boolean {
    return !!this.ctx && !!this.master;
  }

  ensure(): AudioContext {
    if (!this.ready) this.init();
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx as AudioContext;
  }

  // ---------------- project sync ----------------

  sync(project: Project) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const m = this.master;
    m.volume.gain.value = clamp(project.masterVolume, 0, 1.25);
    automationEngine.bindParameter("master", "volume", m.volume.gain);
    automationEngine.bindParameter("master", "pan", m.panner.pan);
    automationEngine.bindParameter("master", "filterCutoff", m.filter.frequency);
    automationEngine.bindParameter("master", "reverbWet", m.reverbReturn.gain);
    const beat = 60 / project.tempo;
    m.delay.delayTime.value = Math.min(1.9, beat * 0.75); // dotted 8th
    const requestedOutput = project.audioOutputDeviceId ?? null;
    if (this.activeOutputDeviceId !== requestedOutput) {
      this.activeOutputDeviceId = requestedOutput;
      const contextWithSink = ctx as AudioContext & {
        setSinkId?: (sinkId: string) => Promise<void>;
      };
      if (typeof contextWithSink.setSinkId === "function") {
        void contextWithSink.setSinkId(requestedOutput ?? "").catch((error: unknown) => {
          this.activeOutputDeviceId = undefined;
          console.error("Could not route audio to the selected output device.", error);
          toast.error("Could not select that audio output device. The default output is still active.");
        });
      } else if (requestedOutput) {
        this.activeOutputDeviceId = undefined;
        toast.error("This browser does not support selecting an audio output device.");
      }
    }
    m.click.gain.value = 0.9;

    const seen = new Set<string>();
    for (const track of project.tracks) {
      seen.add(track.id);
      let tn = this.tracks.get(track.id);
      if (!tn) {
        tn = buildTrack(ctx, m);
        this.tracks.set(track.id, tn);
      }
      if (track.type === "midi") {
        const patch = trackPatch(track);
        if (patch?.sampled) {
          // Warm in the background when a track is created or its instrument changes.
          // Transport start also awaits these promises before scheduling MIDI notes.
          void warmSampledPatch(ctx, tn.input, patch, false, track.id).catch(() => undefined);
        } else {
          clearSoundFontStatus(track.id);
        }
      }
      applyTrackAudioPlugins(tn, track);
      const folderStack = track.role === "folder"
        ? project.stacks?.find((stack) => stack.folderTrackId === track.id)
        : undefined;
      tn.gain.gain.value = folderStack?.type === "folder" ? 1 : track.volume;
      const parentVolume = track.parentTrackId
        ? project.tracks.find((item) => item.id === track.parentTrackId)?.volume ?? 1
        : 1;
      tn.groupGain.gain.value = folderStack?.type === "folder"
        ? 1
        : parentVolume * getVcaMultiplier(track, project.tracks);
      tn.muteGain.gain.value = folderStack?.type === "folder"
        ? track.mute ? 0 : 1
        : isTrackAudible(track, project.tracks) ? 1 : 0;
      automationEngine.bindParameter(track.id, "volume", tn.gain.gain);
      automationEngine.bindParameter(track.id, "pan", tn.panner.pan);
      automationEngine.bindParameter(track.id, "mute", tn.muteGain.gain);
      automationEngine.bindParameter(track.id, "filterCutoff", tn.highPass.frequency);
      automationEngine.bindParameter(track.id, "param:cutoff", tn.highPass.frequency);
      automationEngine.bindParameter(track.id, "param:resonance", tn.highPass.Q);
      automationEngine.bindParameter(track.id, "param:chorusDepth", tn.chorusDepth.gain);
      automationEngine.bindParameter(track.id, "param:reverb", tn.reverbSend.gain);
      automationEngine.bindParameter(track.id, "param:delay", tn.delaySend.gain);
      automationEngine.bindParameter(track.id, "eq:lowGain", tn.eqLow.gain);
      automationEngine.bindParameter(track.id, "eq:midGain", tn.eqMid.gain);
      automationEngine.bindParameter(track.id, "eq:highGain", tn.eqHigh.gain);
      automationEngine.bindParameter(track.id, "send:reverb", tn.reverbSend.gain);
      automationEngine.bindParameter(track.id, "send:delay", tn.delaySend.gain);
      const pedalboardSlot = activeAudioPlugin(track, "pedalboard");
      tn.pedalboard.sync(track.pedalboard ?? [], pedalboardSlot?.enabled === true);
      this.pedalAutomationUnbinds.get(track.id)?.forEach((unbind) => unbind());
      const pedalUnbinds = tn.pedalboard
        .getAutomationBindings(track.pedalboard ?? [])
        .map((binding) =>
          automationEngine.bindParameter(
            track.id,
            binding.parameterId,
            binding.parameter,
            binding.transform,
          ),
        );
      this.pedalAutomationUnbinds.set(track.id, pedalUnbinds);
      applyTrackSpatialPanning(tn, track);
      // prefetch audio buffers
      for (const bufferId of [
        track.sampleBufferId,
        ...(track.sampleZones ?? []).map((zone) => zone.bufferId),
        ...track.regions.map(getRegionPlaybackBufferId),
      ].filter((id): id is string => !!id)) {
        if (bufferId && !this.bufferCache.has(bufferId) && !this.pendingLoads.has(bufferId)) {
          void this.ensureBufferLoaded(bufferId).catch(() => undefined);
        }
      }
    }
    // Reconnect channel outputs after every track node exists so an instrument
    // can safely feed an Aux bus that appears later in the track list.
    for (const track of project.tracks) {
      const nodes = this.tracks.get(track.id);
      if (!nodes || track.role === "vca") continue;

      let target: AudioNode = m.input;
      const parentStack = track.parentTrackId
        ? project.stacks?.find((stack) =>
            stack.folderTrackId === track.parentTrackId && stack.type === "folder",
          )
        : undefined;
      if (parentStack && track.id !== parentStack.folderTrackId) {
        const parentNodes = this.tracks.get(parentStack.folderTrackId);
        if (parentNodes && parentNodes !== nodes) target = parentNodes.input;
      } else {
        const firstBus = resolveOutputBus(track, project.tracks);
        if (firstBus) {
          const busNodes = this.tracks.get(firstBus.id);
          if (busNodes && busNodes !== nodes) target = busNodes.input;
        }
      }

      if (nodes.routingTarget !== target) {
        try { nodes.output.disconnect(); } catch { /* noop */ }
        nodes.output.connect(target);
        nodes.routingTarget = target;
      }
    }

    // remove stale track nodes
    for (const id of Array.from(this.tracks.keys())) {
      if (!seen.has(id)) {
        this.pedalAutomationUnbinds.get(id)?.forEach((unbind) => unbind());
        this.pedalAutomationUnbinds.delete(id);
        automationEngine.unbindOwner(id);
        disposeSoundFontTrack(id);
        const tn = this.tracks.get(id);
        if (tn) {
          try {
            tn.input.disconnect();
            tn.analyser.disconnect();
            tn.spatialPanner.disconnect();
            tn.output.disconnect();
            tn.pedalboard.dispose();
            tn.reverbSend.disconnect();
            tn.delaySend.disconnect();
            tn.chorusSend.disconnect();
            tn.flangerSend.disconnect();
            tn.chorusLfo.stop();
            tn.flangerLfo.stop();
          } catch { /* noop */ }
        }
        this.tracks.delete(id);
      }
    }
  }

  // ---------------- buffers ----------------

  async storeBuffer(id: string, buf: StoredBuffer) {
    this.bufferCache.set(id, buf);
    await saveBufferQuiet(id, buf);
  }

  async storePersistentBuffer(id: string, buf: StoredBuffer) {
    this.bufferCache.set(id, buf);
    await saveBuffer(id, buf);
  }

  hasBuffer(id: string): boolean {
    return this.bufferCache.has(id);
  }

  /** Public read access to cached PCM (for waveform drawing) */
  getStoredBuffer(id: string): StoredBuffer | undefined {
    return this.bufferCache.get(id);
  }

  async ensureBufferLoaded(id: string): Promise<StoredBuffer | undefined> {
    const cached = this.bufferCache.get(id);
    if (cached) return cached;

    const existing = this.bufferLoadPromises.get(id);
    if (existing) return existing;

    this.pendingLoads.add(id);
    const pending = loadBuffer(id)
      .then((buffer) => {
        if (buffer) this.bufferCache.set(id, buffer);
        return buffer;
      })
      .finally(() => {
        this.pendingLoads.delete(id);
        this.bufferLoadPromises.delete(id);
      });
    this.bufferLoadPromises.set(id, pending);
    return pending;
  }

  /** Create (and cache per-context) an AudioBuffer for playback */
  bufferFor(ctx: BaseAudioContext, id: string): AudioBuffer | null {
    const stored = this.bufferCache.get(id);
    if (!stored) return null;
    let perCtx = this.ctxBufferCache.get(ctx);
    if (!perCtx) {
      perCtx = new Map();
      this.ctxBufferCache.set(ctx, perCtx);
    }
    let buf = perCtx.get(id);
    if (!buf) {
      buf = ctx.createBuffer(stored.channels.length, stored.channels[0].length, stored.sampleRate);
      stored.channels.forEach((ch, i) => buf!.copyToChannel(new Float32Array(ch), i));
      perCtx.set(id, buf);
    }
    return buf;
  }

  async decodeAudioFile(file: File): Promise<StoredBuffer> {
    const ctx = this.ensure();
    const arr = await file.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arr);
    const channels: Float32Array[] = [];
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      channels.push(new Float32Array(decoded.getChannelData(c)));
    }
    return { sampleRate: decoded.sampleRate, channels, name: file.name };
  }

  // ---------------- transport ----------------

  play(fromTick?: number) {
    const ctx = this.ensure();
    this.stopPreview();

    const requestId = ++this.playRequestId;
    this.playPending = true;

    // Sample-backed instruments load over the network. Never start the
    // transport while a MIDI patch is still loading, otherwise the first
    // notes in a region can be silently dropped.
    void this.preparePlaybackSamples(requestId, ctx)
      .then(() => {
        if (requestId !== this.playRequestId || this.ctx !== ctx) return;
        this.playPending = false;
        this.beginPlayback(fromTick, ctx);
      })
      .catch((error: unknown) => {
        if (requestId !== this.playRequestId) return;
        this.playPending = false;
        this.recording = false;
        useDAW.getState().setTransport({ playing: false, recording: false, countInRemaining: 0 });
        console.error("GarageBand Web Studio could not load one or more instrument samples.", error);
        toast.error("Some instrument samples could not load. Check your connection and press Play to retry.");
      });
  }

  private async preparePlaybackSamples(requestId: number, ctx: AudioContext) {
    let snapshot: Project;
    do {
      if (requestId !== this.playRequestId || this.ctx !== ctx) return;

      snapshot = useDAW.getState().project;
      this.sync(snapshot);

      const anySolo = snapshot.tracks.some((track) => track.solo);
      const sampleLoads: Promise<void>[] = [];
      for (const track of snapshot.tracks) {
        if (track.type !== "midi" || track.mute || (anySolo && !track.solo)) continue;
        const patch = trackPatch(track);
        const nodes = this.tracks.get(track.id);
        const customSampleIds = [
          track.sampleBufferId,
          ...(track.sampleZones ?? []).map((zone) => zone.bufferId),
        ].filter((id): id is string => !!id);
        if (customSampleIds.length) {
          sampleLoads.push(
            ...[...new Set(customSampleIds)].map(async (sampleId) => {
              const buffer = await this.ensureBufferLoaded(sampleId);
              if (!buffer) throw new Error(`Sampler audio is missing for ${track.sampleName ?? track.name}`);
            })
          );
        } else if (patch?.sampled && nodes) {
          sampleLoads.push(warmSampledPatch(ctx, nodes.input, patch, false, track.id));
        }
      }

      await Promise.all(sampleLoads);
      // If the user changed instruments while samples were loading, prepare
      // the latest project too before allowing playback to begin.
    } while (
      snapshot !== useDAW.getState().project &&
      requestId === this.playRequestId
    );
  }

  private beginPlayback(fromTick: number | undefined, ctx: AudioContext) {
    if (this.ctx !== ctx || !this.master) return;

    const project = useDAW.getState().project;
    const start = fromTick ?? this.stoppedAtTick ?? 0;
    const beatSec = 60 / this.tempoAtTick(fromTick ?? this.stoppedAtTick ?? 0, project);
    const countIn = this.recording && project.countIn ? project.timeSig[0] : 0;
    const now = ctx.currentTime + 0.08;
    this.countInBeats = countIn;
    this.countInStartTime = now;
    this.passStartTime = now + countIn * beatSec;
    this.passStartTick = start;
    this.scheduledUntilTick = start;
    this.playing = true;
    automationEngine.setClock(start, true);
    // schedule count-in clicks
    for (let i = 0; i < countIn; i++) {
      this.click(now + i * beatSec, i === 0);
    }
    // schedule entry events (regions overlapping start)
    this.scheduleEntry(start, this.passStartTime);
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), TICK_INTERVAL_MS);
    this.tick();
    useDAW.getState().setTransport({ playing: true });
  }

  stop() {
    // Also cancels playback that is waiting for sample downloads.
    this.playRequestId += 1;
    this.playPending = false;
    const wasPlaying = this.playing;
    if (!wasPlaying) {
      if (this.recording || useDAW.getState().transport.recording) {
        this.recording = false;
        this.countInBeats = 0;
        useDAW.getState().setTransport({ playing: false, recording: false, countInRemaining: 0 });
      }
      return;
    }
    const tick = Math.min(this.currentTick(), projectLengthTicks(useDAW.getState().project));
    useDAW.getState().appendAutomationPoints(this.pendingAutomationPoints);
    this.pendingAutomationPoints = [];
    this.stoppedAtTick = tick;
    this.playing = false;
    automationEngine.setClock(tick, false);
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // finalize open input notes
    for (const [pitch, notes] of this.openInputNotes) {
      for (const [trackId, note] of notes) {
        const len = Math.max(PPQ / 8, tick - note.startTick);
        if (this.recording && this.recordingMidiTrackIds.has(trackId)) {
          this.recordedMidi.push({
            trackId,
            pitch,
            velocity: note.velocity,
            start: note.startTick,
            length: len,
          });
        }
        for (const voice of note.voices) {
          try { voice.scheduleStop(this.ctx ? this.ctx.currentTime : 0); } catch { /* noop */ }
        }
      }
    }
    this.openInputNotes.clear();
    this.releaseSustainedNotes();
    for (const v of this.voices) v.handle.kill();
    this.voices = [];
    this.countInBeats = 0;
    useDAW.getState().setTransport({ playing: false, recording: false, countInRemaining: 0 });
    this.recording = false;
  }

  togglePlay() {
    if (this.playing || this.playPending) this.stop();
    else this.play(this.stoppedAtTick ?? 0);
  }

  async startRecording() {
    if (this.recording || this.recordPending) return;
    this.recordPending = true;
    const st = useDAW.getState();
    const armed = st.project.tracks.filter((track) => track.armed);
    const selected = st.project.tracks.find((track) => track.id === st.ui.selectedTrackId);
    const targets = armed.length ? armed : selected ? [selected] : [];
    const expandedTargets = new Set(targets.map((track) => track.id));
    for (const parent of targets.filter((track) => track.role === "folder")) {
      const stack = st.project.stacks?.find((item) => item.folderTrackId === parent.id);
      for (const childId of stack?.trackIds ?? []) expandedTargets.add(childId);
    }
    this.recordingMidiTrackIds = new Set(
      st.project.tracks
        .filter((track) => track.type === "midi" && expandedTargets.has(track.id))
        .map((track) => track.id)
    );
    this.recordingAudioTrackIds = new Set(
      st.project.tracks
        .filter((track) => track.type === "audio" && expandedTargets.has(track.id) && track.role === "track")
        .map((track) => track.id)
    );
    try {
      await Promise.all([...this.recordingAudioTrackIds].map(async (trackId) => {
        const track = st.project.tracks.find((item) => item.id === trackId);
        if (!track) return;
        try {
          await this.startAudioCapture(track.id, track.inputMonitor, track.inputDeviceId);
        } catch (error) {
          console.error(`Could not start recording on ${track.name}.`, error);
          toast.error(`Could not start recording on ${track.name}. Check microphone permissions.`);
          this.recordingAudioTrackIds.delete(track.id);
        }
      }));
    } finally {
      this.recordPending = false;
    }
    this.recordingStartTick = this.playing
      ? this.currentTick()
      : this.stoppedAtTick ?? 0;
    this.recording = true;
    this.recordedMidi = [];
    useDAW.getState().setTransport({ recording: true });
    if (!this.playing) this.play(this.recordingStartTick);
  }

  stopRecording(): { midi: RecordedMidiNote[]; audio: RecordedAudio[]; trackIds: string[]; startTick: number; endTick: number } {
    const startTick = this.recordingStartTick;
    const endTick = this.currentTick();
    const trackIds = [...new Set([...this.recordingMidiTrackIds, ...this.recordingAudioTrackIds])];
    for (const pitch of this.openInputNotes.keys()) this.noteOff(pitch);
    this.stop();
    this.recording = false;
    const midi = [...this.recordedMidi];
    this.recordedMidi = [];
    const audio: RecordedAudio[] = [];
    for (const trackId of this.recordingAudioTrackIds) {
      const result = this.finishAudioCapture(trackId);
      if (result) audio.push({ trackId, ...result });
    }
    this.recordingMidiTrackIds.clear();
    this.recordingAudioTrackIds.clear();
    return { midi, audio, trackIds, startTick, endTick };
  }

  currentTick(): number {
    if (!this.ctx) return this.stoppedAtTick ?? 0;
    if (!this.playing) return this.stoppedAtTick ?? 0;
    const now = this.ctx.currentTime;
    const project = useDAW.getState().project;
    if (now < this.passStartTime) {
      // during count-in
      return this.passStartTick;
    }
    return this.tickAtTransportSeconds(now - this.passStartTime, this.passStartTick, project);
  }

  private tempoAtTick(tick: number, project: Project): number {
    const lane = this.activeTempoLane(project);
    if (!lane) {
      return project.tempo;
    }
    return clamp(automationValueAt(lane.points, tick), 30, 260);
  }

  private activeTempoLane(project: Project): AutomationLane | undefined {
    const lane = project.automationLanes?.find(
      (item) => item.ownerId === "master" && item.parameterId === "tempo" && item.scope === "track"
    );
    return lane?.points.length && (project.automationModes?.master ?? "off") !== "off"
      ? lane
      : undefined;
  }

  private integrateTempo(start: number, end: number, project: Project, lane: AutomationLane): number {
    if (end <= start) return 0;
    const steps = 8;
    let seconds = 0;
    for (let step = 0; step < steps; step++) {
      const a = start + (end - start) * step / steps;
      const b = start + (end - start) * (step + 1) / steps;
      seconds += tickToSec(b - a, clamp(automationValueAt(lane.points, (a + b) / 2), 30, 260));
    }
    return seconds;
  }

  private ensureTempoMap(project: Project, lane: AutomationLane): void {
    const enabled = this.tempoMapEnabled;
    if (
      this.tempoMapSource === lane &&
      this.tempoMapPoints === lane.points &&
      this.tempoMapBase === project.tempo &&
      enabled
    ) return;
    this.tempoMapSource = lane;
    this.tempoMapPoints = lane.points;
    this.tempoMapBase = project.tempo;
    this.tempoMapEnabled = true;
    this.tempoKnots = [{ tick: 0, seconds: 0 }];
    let previousTick = 0;
    let elapsed = 0;
    for (const point of lane.points) {
      if (point.tick <= previousTick) continue;
      elapsed += this.integrateTempo(previousTick, point.tick, project, lane);
      this.tempoKnots.push({ tick: point.tick, seconds: elapsed });
      previousTick = point.tick;
    }
  }

  private tempoMapSecondsAt(tick: number, project: Project, lane: AutomationLane): number {
    this.ensureTempoMap(project, lane);
    if (tick <= 0) return 0;
    let low = 0;
    let high = this.tempoKnots.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (this.tempoKnots[mid].tick <= tick) low = mid;
      else high = mid - 1;
    }
    const knot = this.tempoKnots[low];
    return knot.seconds + this.integrateTempo(knot.tick, tick, project, lane);
  }

  private transportSeconds(fromTick: number, toTick: number, project: Project): number {
    if (toTick <= fromTick) return 0;
    const lane = this.activeTempoLane(project);
    if (!lane) {
      this.tempoMapEnabled = false;
      return tickToSec(toTick - fromTick, project.tempo);
    }
    this.tempoMapEnabled = true;
    return this.tempoMapSecondsAt(toTick, project, lane) -
      this.tempoMapSecondsAt(fromTick, project, lane);
  }

  private tickAtTransportSeconds(seconds: number, startTick: number, project: Project): number {
    if (seconds <= 0) return startTick;
    let low = startTick;
    let high = startTick + seconds * PPQ * (260 / 60);
    for (let i = 0; i < 32; i++) {
      const mid = (low + high) / 2;
      if (this.transportSeconds(startTick, mid, project) < seconds) low = mid;
      else high = mid;
    }
    return (low + high) / 2;
  }

  setPlayhead(tick: number) {
    this.stoppedAtTick = Math.max(0, tick);
    if (this.playing || this.playPending) {
      this.play(Math.max(0, tick));
    }
  }

  getCountInRemaining(): number {
    if (!this.ctx || !this.playing || this.countInBeats === 0) return 0;
    const now = this.ctx.currentTime;
    if (now >= this.passStartTime) return 0;
    const project = useDAW.getState().project;
    const beatSec = 60 / project.tempo;
    return Math.ceil((this.passStartTime - now) / beatSec);
  }

  getVoiceCount(): number {
    return this.voices.length;
  }

  // ---------------- scheduler ----------------

  private tick() {
    if (!this.ctx || !this.playing || !this.master) return;
    const ctx = this.ctx;
    const project = useDAW.getState().project;
    const currentTick = this.currentTick();
    automationEngine.setClock(currentTick, true);
    this.pendingAutomationPoints.push(
      ...automationEngine.recordContinuous(
        project.automationLanes ?? [],
        project.automationModes ?? {},
        (lane) => {
          if (lane.ownerId === "master") {
            if (lane.parameterId === "volume") return project.masterVolume;
            if (lane.parameterId === "pan") return this.master?.panner.pan.value;
            if (lane.parameterId === "tempo") return this.tempoAtTick(currentTick, project);
            if (lane.parameterId === "filterCutoff") return this.master?.filter.frequency.value;
            if (lane.parameterId === "reverbWet") return this.master?.reverbReturn.gain.value;
            return undefined;
          }
          const track = project.tracks.find((item) => item.id === lane.ownerId);
          if (!track) return undefined;
          if (lane.parameterId === "volume") return track.volume;
          if (lane.parameterId === "pan") return track.pan;
          if (lane.parameterId === "mute") return track.mute ? 1 : 0;
          if (lane.parameterId.startsWith("param:")) {
            const parameterId = lane.parameterId.slice("param:".length);
            if (parameterId.startsWith("pedal:")) {
              const [, pedalId, key] = parameterId.split(":");
              return track.pedalboard?.find((pedal) => pedal.id === pedalId)?.params[key];
            }
            return track.params[parameterId];
          }
          if (lane.parameterId.startsWith("eq:")) {
            return track.eq[lane.parameterId.slice(3) as keyof Track["eq"]];
          }
          if (lane.parameterId.startsWith("pedal:")) {
            const [, pedalId, parameterId] = lane.parameterId.split(":");
            return track.pedalboard?.find((pedal) => pedal.id === pedalId)?.params[parameterId];
          }
          return undefined;
        },
        (lane) => lane.scope === "region" && lane.regionId
          ? project.tracks.flatMap((track) => track.regions).find((region) => region.id === lane.regionId)?.start ?? 0
          : 0
      )
    );
    if (ctx.currentTime - this.lastAutomationPersistTime >= 0.2) {
      useDAW.getState().appendAutomationPoints(this.pendingAutomationPoints);
      this.pendingAutomationPoints = [];
      this.lastAutomationPersistTime = ctx.currentTime;
    }
    const horizon = ctx.currentTime + LOOKAHEAD_SEC;
    // prune old voices
    if (this.voices.length > 0) {
      this.voices = this.voices.filter((v) => v.until > ctx.currentTime - 2);
    }
    // loop preview scheduling
    if (this.preview) this.previewTick();

    let guard = 0;
    while (guard++ < 16) {
      const projectEndTick = projectLengthTicks(project);
      const passEndTick = project.cycleOn
        ? Math.min(projectEndTick, Math.max(project.cycleStart + PPQ, project.cycleEnd))
        : projectEndTick;
      const passEndTime = this.passStartTime +
        this.transportSeconds(this.passStartTick, passEndTick, project);
      const sliceEnd = Math.min(horizon, passEndTime);
      const fromTick = this.scheduledUntilTick;
      const toTick =
        Number.isFinite(sliceEnd)
          ? Math.min(
              passEndTick,
              this.tickAtTransportSeconds(sliceEnd - this.passStartTime, this.passStartTick, project),
            )
          : fromTick;
      if (toTick > fromTick && Number.isFinite(sliceEnd)) {
        this.scheduleRange(fromTick, toTick, sliceEnd - this.transportSeconds(fromTick, toTick, project), project);
        this.scheduledUntilTick = toTick;
      }
      if (horizon < passEndTime) break;
      if (!project.cycleOn || this.passStartTick >= projectEndTick) {
        this.stop();
        break;
      }
      // wrap cycle
      this.passStartTime = passEndTime;
      this.passStartTick = project.cycleStart;
      this.scheduledUntilTick = project.cycleStart;
      this.scheduleEntry(project.cycleStart, this.passStartTime);
    }
  }

  private click(when: number, accent: boolean) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.value = accent ? 1660 : 1108;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(accent ? 0.24 : 0.15, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 900;
    o.connect(f).connect(g).connect(this.master.click);
    o.start(when);
    o.stop(when + 0.08);
  }

  /** Schedule all events whose start is inside [fromTick, toTick) */
  private scheduleRange(fromTick: number, toTick: number, timeAtFrom: number, project: Project) {
    const timeAt = (tick: number) => timeAtFrom + this.transportSeconds(fromTick, tick, project);
    automationEngine.scheduleWindow(
      project.automationLanes ?? [],
      project.automationModes ?? {},
      fromTick,
      toTick,
      timeAt,
      (regionId) => {
        const region = project.tracks
        .flatMap((track) => track.regions)
        .find((item) => item.id === regionId);
        return region ? { start: region.start, end: region.start + region.length } : undefined;
      }
    );

    // metronome
    if (project.metronome) {
      const beatTicks = (PPQ * 4) / project.timeSig[1];
      let k = Math.ceil(fromTick / beatTicks - 1e-9);
      if (k * beatTicks < fromTick) k++;
      for (; k * beatTicks < toTick; k++) {
        this.click(timeAt(k * beatTicks), ((k % project.timeSig[0]) + project.timeSig[0]) % project.timeSig[0] === 0);
      }
    }

    const anySolo = project.tracks.some((t) => t.solo);
    for (const track of project.tracks) {
      const muteAutomation = (project.automationLanes ?? []).some(
        (lane) => lane.ownerId === track.id && lane.parameterId === "mute"
      ) && (project.automationModes?.[track.id] ?? "off") !== "off";
      if ((track.mute && !muteAutomation) || (anySolo && !track.solo)) continue;
      const tn = this.tracks.get(track.id);
      if (!tn) continue;
      for (const region of track.regions) {
        if (region.muted) continue;
        if (region.type === "midi") {
          this.scheduleMidiRegion(region, track, tn, fromTick, toTick, timeAt, project);
        } else {
          this.scheduleAudioRegionStarts(region, tn, fromTick, toTick, timeAt, project);
        }
      }
    }
  }

  private playTrackNote(
    ctx: BaseAudioContext,
    dest: AudioNode,
    track: Track,
    pitch: number,
    velocity: number,
    when: number,
    duration: number,
    noteOffControlled = false
  ): VoiceHandle {
    const matchingZone = selectSamplerZone(track.sampleZones, pitch, velocity * 127);
    const bufferId = matchingZone?.bufferId ?? track.sampleBufferId;
    if (!bufferId) {
      if ((track.sampleZones ?? []).length) {
        return { scheduleStop() {}, kill() {} };
      }
      const patch = trackPatch(track);
      return playNote(
        ctx,
        dest,
        track.instrument,
        pitch,
        velocity,
        when,
        duration,
        track.params,
        noteOffControlled,
        patch
      );
    }

    const buffer = this.bufferFor(ctx, bufferId);
    if (!buffer || buffer.duration <= 0) {
      return { scheduleStop() {}, kill() {} };
    }

    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    const mode = matchingZone?.playbackMode ?? track.samplePlaybackMode ?? "one-shot";
    const rootPitch = matchingZone?.rootPitch ?? track.sampleRootPitch ?? 60;
    source.buffer = buffer;
    source.playbackRate.value = clamp(
      Math.pow(2, (pitch - clamp(rootPitch, 0, 127)) / 12),
      0.25,
      4
    );
    source.loop = mode === "loop";
    if (source.loop) {
      source.loopStart = 0;
      source.loopEnd = buffer.duration;
    }

    const level = clamp(velocity, 0, 1);
    const attack = Math.min(0.008, Math.max(0.002, duration * 0.05));
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(Math.max(0.0001, level), when + attack);
    source.connect(gain).connect(dest);
    source.start(when);

    let stopped = false;
    const stopAt = (at: number, release: number) => {
      if (stopped) return;
      stopped = true;
      const safeAt = Math.max(at, ctx.currentTime);
      try {
        gain.gain.cancelScheduledValues(safeAt);
        gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), safeAt);
        gain.gain.linearRampToValueAtTime(0.0001, safeAt + release);
        source.stop(safeAt + release + 0.005);
      } catch {
        // The source may already have reached the end of a one-shot sample.
      }
    };

    source.onended = () => {
      try {
        source.disconnect();
        gain.disconnect();
      } catch { /* already disconnected */ }
    };

    return {
      scheduleStop(at: number) {
        // Quick Sampler's one-shot mode plays through even when the MIDI key
        // is released. Loop mode follows MIDI note-off and fades cleanly.
        if (shouldReleaseSamplerOnNoteOff(mode)) stopAt(at, 0.045);
      },
      kill() {
        stopAt(ctx.currentTime, 0.005);
      },
    };
  }

  private scheduleMidiRegion(
    region: Region,
    track: Track,
    tn: TrackNodes,
    fromTick: number,
    toTick: number,
    timeAt: (t: number) => number,
    project: Project
  ) {
    const notes = applyMidiPlugins(
      region.notes ?? [],
      track.midiPlugins ?? [],
      project.keyTonic,
      project.keyMode
    );
    const regionEnd = region.start + region.length;
    if (!notes.length) return;
    const period = region.looped && region.coreLength ? region.coreLength : 0;
    const reps = period ? Math.ceil(region.length / period) + 1 : 1;
    for (let k = 0; k < reps; k++) {
      const base = region.start + k * period;
      for (const n of notes) {
        const absStart = base + n.start;
        if (absStart >= toTick || absStart + n.length <= fromTick) continue;
        if (absStart >= regionEnd) continue;
        if (absStart < fromTick) continue; // note started before window (entry handles pass starts; skip mid-notes)
        const durTicks = Math.min(n.length, regionEnd - absStart);
        if (durTicks <= 0) continue;
        const when = timeAt(absStart);
        const dur = this.transportSeconds(absStart, absStart + durTicks, project);
        const noteStart = Math.max(when, (this.ctx as AudioContext).currentTime);
        const voice = this.playTrackNote(
          this.ctx as AudioContext,
          tn.input,
          track,
          n.pitch,
          n.velocity / 127,
          noteStart,
          dur
        );
        // All sustained instruments must receive MIDI note-off at the end of
        // the note. Without this, pads, strings, organs and leads can sustain
        // until transport stop even though the region/note has already ended.
        voice.scheduleStop(noteStart + dur);
        this.voices.push({ handle: voice, until: noteStart + dur + 6 });
      }
    }
  }

  private scheduleAudioRegionStarts(
    region: Region,
    tn: TrackNodes,
    fromTick: number,
    toTick: number,
    timeAt: (t: number) => number,
    project: Project
  ) {
    const bufferId = getRegionPlaybackBufferId(region);
    if (!bufferId) return;
    const buf = this.bufferFor(this.ctx as AudioContext, bufferId);
    if (!buf) return;
    const regionEnd = region.start + region.length;
    const contentSec = region.sampleLength ?? buf.duration;
    const playbackRate = clamp(region.playbackRate ?? 1, 0.5, 2);
    const contentPlaySec = contentSec / playbackRate;
    const periodTicks = region.looped
      ? secToTick(contentPlaySec, this.tempoAtTick(region.start, project))
      : 0;
    const reps = periodTicks ? Math.ceil(region.length / periodTicks) + 1 : 1;
    for (let k = 0; k < reps; k++) {
      const occStart = region.start + k * periodTicks;
      if (occStart >= toTick || occStart >= regionEnd) continue;
      if (occStart < fromTick) continue;
      const when = timeAt(occStart);
      const remainTicks = Math.min(regionEnd - occStart, periodTicks || regionEnd - occStart);
      const durSec = Math.min(contentPlaySec, this.transportSeconds(occStart, occStart + remainTicks, project));
      if (durSec <= 0.005) continue;
      this.playAudioSlice(region, buf, tn.input, when, 0, durSec);
    }
  }

  /** Play [offsetSec, offsetSec+durSec) of the region content at `when` */
  private playAudioSlice(
    region: Region,
    buf: AudioBuffer,
    dest: AudioNode,
    when: number,
    offsetIntoContentSec: number,
    durSec: number
  ) {
    const ctx = this.ctx as AudioContext;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const playbackRate = clamp(region.playbackRate ?? 1, 0.5, 2);
    src.playbackRate.value = playbackRate;
    const g = ctx.createGain();
    const gainVal = region.gain ?? 1;
    const fi = Math.min(region.fadeIn ?? 0, durSec);
    const fo = Math.min(region.fadeOut ?? 0, durSec);
    const fiRemain = Math.max(0, fi - offsetIntoContentSec / playbackRate);
    const end = when + durSec;
    let t = when;
    if (fiRemain > 0) {
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(gainVal, when + fiRemain);
      t = when + fiRemain;
    } else {
      g.gain.setValueAtTime(gainVal, when);
    }
    if (fo > 0) {
      const foStart = Math.max(t, end - fo);
      g.gain.setValueAtTime(gainVal, foStart);
      g.gain.linearRampToValueAtTime(0.0001, end);
    }
    src.connect(g).connect(dest);
    const sampleStart = (region.sampleStart ?? 0) + offsetIntoContentSec;
    src.start(Math.max(when, ctx.currentTime), sampleStart, durSec * playbackRate + 0.02);
    // register for kill
    const voice: VoiceHandle = {
      scheduleStop() { /* scheduled already */ },
      kill() {
        const now = ctx.currentTime;
        try {
          g.gain.cancelScheduledValues(now);
          g.gain.setValueAtTime(g.gain.value, now);
          g.gain.linearRampToValueAtTime(0.0001, now + 0.015);
          src.stop(now + 0.03);
        } catch { /* noop */ }
      },
    };
    this.voices.push({ handle: voice, until: end + 1 });
  }

  /** Schedule regions that are already sounding at a pass start */
  private scheduleEntry(atTick: number, atTime: number) {
    const project = useDAW.getState().project;
    const anySolo = project.tracks.some((t) => t.solo);
    for (const track of project.tracks) {
      if (track.mute || (anySolo && !track.solo)) continue;
      const tn = this.tracks.get(track.id);
      if (!tn) continue;
      for (const region of track.regions) {
        if (region.muted) continue;
        const regionEnd = region.start + region.length;
        const bufferId = getRegionPlaybackBufferId(region);
        if (region.type !== "audio" || !bufferId) continue;
        if (atTick <= region.start || atTick >= regionEnd) continue;
        const buf = this.bufferFor(this.ctx as AudioContext, bufferId);
        if (!buf) continue;
        const contentSec = region.sampleLength ?? buf.duration;
        const playbackRate = clamp(region.playbackRate ?? 1, 0.5, 2);
        const contentPlaySec = contentSec / playbackRate;
        const periodTicks = region.looped
          ? secToTick(contentPlaySec, this.tempoAtTick(region.start, project))
          : 0;
        let occStart = region.start;
        if (periodTicks) {
          occStart = region.start + Math.floor((atTick - region.start) / periodTicks) * periodTicks;
        }
        const offsetIntoContent = this.transportSeconds(occStart, atTick, project) * playbackRate;
        const remainRegionSec = this.transportSeconds(atTick, regionEnd, project);
        const durSec = Math.max(0, Math.min((contentSec - offsetIntoContent) / playbackRate, remainRegionSec));
        if (durSec > 0.005) {
          this.playAudioSlice(region, buf, tn.input, atTime, offsetIntoContent, durSec);
        }
      }
    }
  }

  // ---------------- live input (musical typing / onscreen keys) ----------------

  private publishLiveNotes() {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent<number[]>(
        "webband:live-notes",
        { detail: [...this.openInputNotes.keys()] },
      ));
    }
  }

  private liveMidiTargets() {
    const st = useDAW.getState();
    const active = st.project.tracks.filter(
      (track) => track.type === "midi" && track.role === "track" && (track.armed || track.inputMonitor)
    );
    const activeIds = new Set(active.map((track) => track.id));
    for (const parent of st.project.tracks.filter(
      (track) => track.role === "folder" && (track.armed || track.inputMonitor)
    )) {
      const stack = st.project.stacks?.find((item) => item.folderTrackId === parent.id);
      for (const id of stack?.trackIds ?? []) activeIds.add(id);
    }
    if (activeIds.size) {
      return st.project.tracks.filter((track) => activeIds.has(track.id) && track.type === "midi");
    }
    const selected = st.project.tracks.find((track) => track.id === st.ui.selectedTrackId);
    if (selected?.role === "folder") {
      const stack = st.project.stacks?.find((item) => item.folderTrackId === selected.id);
      return st.project.tracks.filter((track) => stack?.trackIds.includes(track.id) && track.type === "midi");
    }
    return selected?.type === "midi" ? [selected] : [];
  }

  noteOn(pitch: number, velocity: number) {
    const ctx = this.ensure();
    const st = useDAW.getState();
    const targets = this.liveMidiTargets();
    if (!targets.length) return;
    const startTick = this.playing ? this.currentTick() : this.stoppedAtTick ?? 0;
    let pitchTracks = this.openInputNotes.get(pitch);
    if (!pitchTracks) {
      pitchTracks = new Map();
      this.openInputNotes.set(pitch, pitchTracks);
    }
    const noteStates = pitchTracks;
    for (const track of targets) {
      if (noteStates.has(track.id)) continue;
      const noteState = { voices: [] as VoiceHandle[], startTick, velocity };
      noteStates.set(track.id, noteState);
      const livePlugins = (track.midiPlugins ?? []).filter(
        (plugin) => !["arpeggiator", "note-repeater", "gate", "note-echo"].includes(plugin.pluginId)
      );
      const inputNotes = applyMidiPlugins(
        [{ id: uid(), pitch, velocity, start: 0, length: PPQ * 4 }],
        livePlugins,
        st.project.keyTonic,
        st.project.keyMode
      );

      const playLiveVoices = () => {
        if (noteStates.get(track.id) !== noteState) return;
        const currentTrack = useDAW.getState().project.tracks.find((item) => item.id === track.id);
        if (!currentTrack || currentTrack.type !== "midi" || currentTrack.instrument !== track.instrument) {
          noteStates.delete(track.id);
          return;
        }
        const destination = this.tracks.get(currentTrack.id)?.input ?? this.master?.input ?? ctx.destination;
        noteState.voices = inputNotes.slice(0, 16).map((note) =>
          this.playTrackNote(ctx, destination, currentTrack, note.pitch, note.velocity / 127, ctx.currentTime, 3600, true)
        );
      };

      const prepareTrack = async () => {
        if (track.sampleBufferId || (track.sampleZones ?? []).length) {
          const sampleIds = [...new Set([
            track.sampleBufferId,
            ...(track.sampleZones ?? []).map((zone) => zone.bufferId),
          ].filter((id): id is string => !!id))];
          const buffers = await Promise.all(sampleIds.map((sampleId) => this.ensureBufferLoaded(sampleId)));
          if (!sampleIds.length || buffers.some((buffer) => !buffer)) {
            throw new Error(`Sampler audio is missing for ${track.name}`);
          }
        } else {
          const patch = trackPatch(track);
          if (patch?.sampled) {
            await warmSampledPatch(
              ctx,
              this.tracks.get(track.id)?.input ?? ctx.destination,
              patch,
              false,
              track.id,
            );
          }
        }
        playLiveVoices();
      };
      void prepareTrack().catch((error: unknown) => {
        noteStates.delete(track.id);
        this.publishLiveNotes();
        console.error(`Could not load samples for ${track.name}.`, error);
        toast.error(`Could not load ${track.sampleName ?? track.name}. Please try again.`);
      });
    }
    this.publishLiveNotes();
  }

  noteOff(pitch: number, sustain = false) {
    const notes = this.openInputNotes.get(pitch);
    if (!notes || !this.ctx) return;
    const tick = this.playing ? this.currentTick() : (this.stoppedAtTick ?? 0) + PPQ / 4;
    for (const [trackId, note] of notes) {
      if (this.recording && this.playing && this.recordingMidiTrackIds.has(trackId)) {
        const len = Math.max(PPQ / 8, tick - note.startTick);
        this.recordedMidi.push({ trackId, pitch, velocity: note.velocity, start: note.startTick, length: len });
      }
      if (sustain) this.sustainedVoices.push(...note.voices);
      else for (const voice of note.voices) voice.scheduleStop(this.ctx.currentTime);
    }
    this.openInputNotes.delete(pitch);
    this.publishLiveNotes();
  }

  pitchBend(value: number) {
    for (const track of this.liveMidiTargets()) {
      pitchBendSoundFontTrack(track.id, value);
    }
  }

  setSoundFontParams(trackId: string, params: Record<string, number>) {
    const track = useDAW.getState().project.tracks.find((item) => item.id === trackId);
    const patch = track ? trackPatch(track) : undefined;
    if (patch?.sampled?.engine === "soundfont-worklet") {
      updateSoundFontPatchControls(trackId, patch, params);
    }
  }

  releaseSustainedNotes() {
    if (this.ctx) {
      for (const voice of this.sustainedVoices) {
        voice.scheduleStop(this.ctx.currentTime);
      }
    }
    this.sustainedVoices = [];
  }

  /** One-shot audition (piano roll keys, library preview) */
  auditionNote(
    patchId: string,
    pitch: number,
    velocity = 100,
    params?: Record<string, number>,
    patchOverride?: Patch,
  ) {
    const ctx = this.ensure();
    if (!this.master) return;
    const st = useDAW.getState();
    const sourceTrack = st.project.tracks.find((t) => t.instrument === patchId);
    const p = params ?? sourceTrack?.params ?? {};
    const patch = patchOverride ?? (sourceTrack ? trackPatch(sourceTrack) : PATCHES[patchId]);

    if (!this.auditionDest) {
      this.auditionDest = ctx.createGain();
      this.auditionDest.gain.value = 1;
      this.auditionDest.connect(this.master.input);
    }

    const dest = this.auditionDest;
    const play = () => {
      const when = ctx.currentTime;
      const duration = 0.5;
      const customTrack = st.project.tracks.find(
        (track) =>
          track.instrument === patchId &&
          (!!track.sampleBufferId || (track.sampleZones ?? []).length > 0)
      );
      const voice = customTrack
        ? this.playTrackNote(ctx, dest, customTrack, pitch, velocity / 127, when, duration)
        : playNote(ctx, dest, patchId, pitch, velocity / 127, when, duration, p, false, patch);
      voice.scheduleStop(when + duration);
      this.voices.push({ handle: voice, until: when + 6 });
    };

    const customTrack = st.project.tracks.find(
      (track) =>
        track.instrument === patchId &&
        (!!track.sampleBufferId || (track.sampleZones ?? []).length > 0)
    );
    if (customTrack) {
      const selectedZone = selectSamplerZone(customTrack.sampleZones, pitch, velocity);
      const sampleId = selectedZone?.bufferId ?? customTrack.sampleBufferId;
      if (sampleId) {
        void this.ensureBufferLoaded(sampleId).then((buffer) => {
          if (!buffer) throw new Error("Sampler audio could not be loaded");
          play();
        }).catch((error: unknown) => {
          console.error("Sampler audition failed", error);
          toast.error(`Could not load ${customTrack.sampleName ?? customTrack.name}.`);
        });
        return;
      }
    }

    if (patch?.sampled) {
      void warmSampledPatch(ctx, dest, patch, false, sourceTrack?.id ?? patch.id).then(play).catch(() => {
        toast.error(`Could not load ${patch.name} samples. Please try again.`);
      });
      return;
    }
    play();
  }

  // ---------------- loop preview ----------------

  startPreview(
    patchId: string,
    notes: { pitch: number; velocity: number; start: number; len: number }[],
    periodSec: number,
    params?: Record<string, number>
  ) {
    const ctx = this.ensure();
    this.stopPreview();
    if (this.playing || this.playPending) this.stop();
    const dest = ctx.createGain();
    dest.gain.value = 0.9;
    dest.connect(this.master?.input ?? ctx.destination);
    const project = useDAW.getState().project;
    const sourceTrack = project.tracks.find((track) => track.instrument === patchId);
    const previewNotes = applyMidiPlugins(
      notes.map((note, index) => ({
        id: `preview-${index}`,
        pitch: note.pitch,
        velocity: note.velocity,
        start: note.start,
        length: note.len,
      })),
      sourceTrack?.midiPlugins ?? [],
      project.keyTonic,
      project.keyMode
    ).map((note) => ({
      pitch: note.pitch,
      velocity: note.velocity,
      start: note.start,
      len: note.length,
    }));
    this.preview = {
      patchId,
      params: params ?? {},
      notes: previewNotes,
      periodSec,
      startTime: ctx.currentTime + 0.05,
      scheduledUntil: ctx.currentTime + 0.05,
      dest,
    };

    const startScheduler = () => {
      if (this.preview?.dest !== dest) return;
      this.previewTick();
      if (this.previewTimer) clearInterval(this.previewTimer);
      this.previewTimer = setInterval(() => this.previewTick(), TICK_INTERVAL_MS);
    };
    const patch = PATCHES[patchId];
    if (patch?.sampled) {
      void warmSampledPatch(ctx, dest, patch).then(startScheduler).catch(() => {
        this.stopPreview();
        toast.error(`Could not load ${patch.name} samples for the loop preview.`);
      });
    } else {
      startScheduler();
    }
  }

  stopPreview() {
    if (this.previewTimer) {
      clearInterval(this.previewTimer);
      this.previewTimer = null;
    }
    if (this.preview) {
      try { this.preview.dest.disconnect(); } catch { /* noop */ }
      this.preview = null;
    }
  }

  get previewActive(): boolean {
    return !!this.preview;
  }

  private previewTick() {
    if (!this.preview || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const pv = this.preview;
    const horizon = ctx.currentTime + LOOKAHEAD_SEC;
    const track = useDAW.getState().project.tracks.find((t) => t.instrument === pv.patchId);
    const params = track?.params ?? pv.params;
    const reps = Math.ceil((horizon - pv.startTime) / pv.periodSec) + 1;
    for (let r = 0; r < reps; r++) {
      const base = pv.startTime + r * pv.periodSec;
      for (const n of pv.notes) {
        const when = base + n.start;
        if (when < pv.scheduledUntil || when >= horizon) continue;
        const v = playNote(ctx, pv.dest, pv.patchId, n.pitch, n.velocity / 127, when, n.len, params);
        v.scheduleStop(when + n.len);
        this.voices.push({ handle: v, until: when + n.len + 4 });
      }
    }
    pv.scheduledUntil = horizon;
  }

  // ---------------- Live Loops clip launcher ----------------

  getLiveClipTrackIds(): string[] {
    return Array.from(this.liveClips.keys());
  }

  getLiveClipRefs(): LiveClipRef[] {
    return Array.from(this.liveClips.values()).map((clip) => ({
      trackId: clip.kind === "midi" ? clip.track.id : clip.trackId,
      regionId: clip.regionId,
    }));
  }

  isLiveClipActive(trackId: string, regionId: string): boolean {
    const active = this.liveClips.get(trackId);
    return !!active && active.regionId === regionId;
  }

  async launchLiveScene(clips: LiveClipRef[]): Promise<void> {
    this.stopLiveLoops();
    const ctx = this.ensure();
    const project = useDAW.getState().project;
    this.sync(project);
    await this.prepareLiveClipAssets(clips, project, ctx);
    const launchTime = ctx.currentTime + 0.1;
    this.liveGridStartTime = launchTime;
    await this.addLiveClips(clips, launchTime, project, ctx);
  }

  async launchLiveClip(trackId: string, regionId: string): Promise<void> {
    const ctx = this.ensure();
    const project = useDAW.getState().project;
    this.sync(project);
    const refs = [{ trackId, regionId }];
    await this.prepareLiveClipAssets(refs, project, ctx);
    this.stopLiveClip(trackId);
    const barSeconds = tickToSec(barTicks(project.timeSig), project.tempo);
    if (this.liveGridStartTime <= 0 || ctx.currentTime < this.liveGridStartTime) {
      this.liveGridStartTime = ctx.currentTime + 0.05;
    }
    const elapsed = Math.max(0, ctx.currentTime - this.liveGridStartTime);
    const launchTime =
      this.liveGridStartTime + (Math.floor(elapsed / barSeconds) + 1) * barSeconds;
    await this.addLiveClips(refs, launchTime, project, ctx);
  }

  private async prepareLiveClipAssets(
    clips: LiveClipRef[],
    project: Project,
    ctx: AudioContext
  ) {
    const loads = clips.map(async (ref) => {
      const track = project.tracks.find((item) => item.id === ref.trackId);
      const region = track?.regions.find((item) => item.id === ref.regionId);
      if (!track || !region) return;

      const bufferId = getRegionPlaybackBufferId(region);
      if (region.type === "audio" && bufferId) {
        const stored = await this.ensureBufferLoaded(bufferId);
        if (!stored) throw new Error(`Could not load audio clip ${region.name}`);
        return;
      }

      if (region.type !== "midi") return;
      const customSampleIds = [
        track.sampleBufferId,
        ...(track.sampleZones ?? []).map((zone) => zone.bufferId),
      ].filter((id): id is string => !!id);
      if (customSampleIds.length) {
        const buffers = await Promise.all(
          [...new Set(customSampleIds)].map((id) => this.ensureBufferLoaded(id))
        );
        if (buffers.some((buffer) => !buffer)) {
          throw new Error(`Could not load sampler sources for ${track.name}`);
        }
        return;
      }

      const patch = trackPatch(track);
      const nodes = this.tracks.get(track.id);
      if (patch?.sampled && nodes) await warmSampledPatch(ctx, nodes.input, patch, false, track.id);
    });
    await Promise.all(loads);
  }

  private async addLiveClips(
    clips: LiveClipRef[],
    launchTime: number,
    project: Project,
    ctx: AudioContext
  ) {
    for (const ref of clips) {
      const track = project.tracks.find((item) => item.id === ref.trackId);
      const region = track?.regions.find((item) => item.id === ref.regionId);
      if (!track || !region || region.muted || track.role === "folder" || track.role === "vca" || track.role === "aux") {
        continue;
      }
      const nodes = this.tracks.get(track.id);
      if (!nodes) continue;

      if (region.type === "audio") {
        const bufferId = getRegionPlaybackBufferId(region);
        if (!bufferId) continue;
        const stored = await this.ensureBufferLoaded(bufferId);
        if (!stored) {
          toast.error(`Could not load the audio clip ${region.name}`);
          continue;
        }
        const buffer = this.bufferFor(ctx, bufferId);
        if (!buffer) continue;

        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        const startOffset = clamp(region.sampleStart ?? 0, 0, Math.max(0, buffer.duration - 0.01));
        const available = Math.max(0.01, buffer.duration - startOffset);
        const loopLength = clamp(region.sampleLength ?? available, 0.01, available);
        source.buffer = buffer;
        source.playbackRate.value = clamp(region.playbackRate ?? 1, 0.5, 2);
        source.loop = true;
        source.loopStart = startOffset;
        source.loopEnd = startOffset + loopLength;
        gain.gain.setValueAtTime(0.0001, launchTime);
        gain.gain.linearRampToValueAtTime(clamp(region.gain ?? 1, 0, 2), launchTime + 0.008);
        source.connect(gain).connect(nodes.input);
        source.start(launchTime, startOffset);
        this.liveClips.set(track.id, {
          kind: "audio",
          trackId: track.id,
          regionId: region.id,
          source,
          gain,
        });
        continue;
      }

      const customSampleIds = [
        track.sampleBufferId,
        ...(track.sampleZones ?? []).map((zone) => zone.bufferId),
      ].filter((id): id is string => !!id);
      if (customSampleIds.length) {
        try {
          const buffers = await Promise.all(
            [...new Set(customSampleIds)].map((id) => this.ensureBufferLoaded(id))
          );
          if (buffers.some((buffer) => !buffer)) throw new Error("Missing sampler source");
        } catch {
          toast.error(`Could not load sampler audio for ${track.name}`);
          continue;
        }
      } else {
        const patch = trackPatch(track);
        if (patch?.sampled) {
          try {
            await warmSampledPatch(ctx, nodes.input, patch, false, track.id);
          } catch {
            toast.error(`Could not load ${patch.name} samples`);
            continue;
          }
        }
      }

      const notes = applyMidiPlugins(
        region.notes ?? [],
        track.midiPlugins ?? [],
        project.keyTonic,
        project.keyMode
      );
      const periodTicks = region.looped && region.coreLength ? region.coreLength : region.length;
      if (periodTicks <= 0 || !notes.length) continue;
      this.liveClips.set(track.id, {
        kind: "midi",
        track,
        region,
        regionId: region.id,
        notes,
        startTime: launchTime,
        periodTicks,
        periodSec: tickToSec(periodTicks, project.tempo),
        scheduledUntil: launchTime,
        voices: [],
      });
    }

    if (Array.from(this.liveClips.values()).some((clip) => clip.kind === "midi")) {
      this.scheduleLiveLoops();
      if (this.liveLoopTimer) clearInterval(this.liveLoopTimer);
      this.liveLoopTimer = setInterval(() => this.scheduleLiveLoops(), TICK_INTERVAL_MS);
    }
  }

  private scheduleLiveLoops() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const project = useDAW.getState().project;
    const horizon = ctx.currentTime + LOOKAHEAD_SEC;

    for (const clip of this.liveClips.values()) {
      if (clip.kind !== "midi") continue;
      const nodes = this.tracks.get(clip.track.id);
      if (!nodes) continue;

      const repeats = Math.max(
        1,
        Math.ceil((horizon - clip.startTime) / clip.periodSec) + 1
      );
      for (let repeat = 0; repeat < repeats; repeat++) {
        const base = clip.startTime + repeat * clip.periodSec;
        for (const note of clip.notes) {
          if (note.start >= clip.periodTicks) continue;
          const when = base + tickToSec(note.start, project.tempo);
          if (when < clip.scheduledUntil || when >= horizon) continue;
          const durationTicks = Math.min(note.length, clip.periodTicks - note.start);
          if (durationTicks <= 0) continue;
          const duration = tickToSec(durationTicks, project.tempo);
          const voice = this.playTrackNote(
            ctx,
            nodes.input,
            clip.track,
            note.pitch,
            note.velocity / 127,
            Math.max(when, ctx.currentTime),
            duration
          );
          voice.scheduleStop(when + duration);
          clip.voices.push({ handle: voice, until: when + duration + 6 });
        }
      }
      clip.scheduledUntil = horizon;
      clip.voices = clip.voices.filter((voice) => voice.until > ctx.currentTime - 2);
    }
  }

  stopLiveClip(trackId: string) {
    const clip = this.liveClips.get(trackId);
    if (!clip) return;
    if (clip.kind === "audio") {
      const now = this.ctx?.currentTime ?? 0;
      try {
        clip.gain.gain.cancelScheduledValues(now);
        clip.gain.gain.setValueAtTime(Math.max(0.0001, clip.gain.gain.value), now);
        clip.gain.gain.linearRampToValueAtTime(0.0001, now + 0.025);
        clip.source.stop(now + 0.03);
      } catch { /* already ended */ }
    } else {
      for (const voice of clip.voices) voice.handle.kill();
    }
    this.liveClips.delete(trackId);
    if (this.liveClips.size === 0) {
      if (this.liveLoopTimer) clearInterval(this.liveLoopTimer);
      this.liveLoopTimer = null;
      this.liveGridStartTime = 0;
    }
  }

  stopLiveLoops() {
    for (const trackId of Array.from(this.liveClips.keys())) {
      this.stopLiveClip(trackId);
    }
    if (this.liveLoopTimer) clearInterval(this.liveLoopTimer);
    this.liveLoopTimer = null;
    this.liveGridStartTime = 0;
  }

  // ---------------- audio capture ----------------

  async startAudioCapture(
    trackId: string,
    monitor: boolean,
    inputDeviceId?: string | null,
    capture = true
  ): Promise<void> {
    const existing = this.audioInputs.get(trackId);
    if (existing) {
      existing.monitorGain.gain.setTargetAtTime(monitor ? 1 : 0, this.ctx!.currentTime, 0.01);
      if (capture && !existing.captureNode) this.attachCaptureNode(trackId, existing);
      return;
    }
    const ctx = this.ensure();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(inputDeviceId ? { deviceId: { exact: inputDeviceId } } : {}),
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    const source = ctx.createMediaStreamSource(stream);
    const monitorGain = ctx.createGain();
    monitorGain.gain.value = monitor ? 1 : 0;
    const tn = this.tracks.get(trackId);
    source.connect(monitorGain);
    if (tn) monitorGain.connect(tn.input);
    const session: AudioInputSession = {
      stream,
      source,
      monitorGain,
      captureNode: null,
      sink: null,
      chunks: [],
      sampleRate: ctx.sampleRate,
      startCtxTime: ctx.currentTime,
    };
    this.audioInputs.set(trackId, session);
    if (capture) this.attachCaptureNode(trackId, session);
  }

  setTrackInputMonitor(trackId: string, enabled: boolean) {
    const track = useDAW.getState().project.tracks.find((item) => item.id === trackId);
    if (!track || track.type !== "audio") return;
    if (enabled) {
      void this.startAudioCapture(track.id, true, track.inputDeviceId, false).catch((error: unknown) => {
        console.error(`Could not monitor ${track.name}.`, error);
        toast.error(`Could not monitor ${track.name}. Check microphone permissions.`);
        useDAW.getState().updateTrack(track.id, { inputMonitor: false }, false);
      });
    } else {
      const session = this.audioInputs.get(trackId);
      if (session) {
        session.monitorGain.gain.setTargetAtTime(0, this.ctx?.currentTime ?? 0, 0.01);
        if (!this.recordingAudioTrackIds.has(trackId)) this.finishAudioCapture(trackId);
      }
    }
  }

  private attachCaptureNode(trackId: string, session: AudioInputSession) {
    if (!this.ctx || session.captureNode) return;
    const node = this.ctx.createScriptProcessor(4096, 1, 1);
    session.chunks = [];
    session.startCtxTime = this.ctx.currentTime;
    node.onaudioprocess = (event) => {
      session.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    session.source.connect(node);
    node.connect(sink);
    sink.connect(this.ctx.destination);
    session.captureNode = node;
    session.sink = sink;
    this.audioInputs.set(trackId, session);
  }

  finishAudioCapture(trackId: string): Omit<RecordedAudio, "trackId"> | null {
    const session = this.audioInputs.get(trackId);
    if (!session || !this.ctx) return null;
    const { captureNode, chunks, sampleRate, startCtxTime } = session;
    if (!captureNode) {
      this.disposeAudioInput(trackId, session);
      return null;
    }
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const mono = new Float32Array(total);
    let off = 0;
    for (const c of chunks) {
      mono.set(c, off);
      off += c.length;
    }
    const offsetSec = Math.max(0, this.passStartTime - startCtxTime);
    // gentle stereo: duplicate mono
    const stored: StoredBuffer = {
      sampleRate,
      channels: [mono, mono],
      name: "Recording",
    };
    try {
      captureNode.disconnect();
      session.sink?.disconnect();
    } catch { /* nodes may already be disconnected */ }
    session.captureNode = null;
    session.sink = null;
    session.chunks = [];
    const track = useDAW.getState().project.tracks.find((item) => item.id === trackId);
    if (!track?.inputMonitor) this.disposeAudioInput(trackId, session);
    return { stored, offsetSec, durationSec: total / sampleRate - offsetSec };
  }

  private disposeAudioInput(trackId: string, session: AudioInputSession) {
    try {
      session.captureNode?.disconnect();
      session.sink?.disconnect();
      session.source.disconnect();
      session.monitorGain.disconnect();
    } catch { /* nodes may already be disconnected */ }
    session.stream.getTracks().forEach((track) => track.stop());
    this.audioInputs.delete(trackId);
  }

  // ---------------- levels ----------------

  private levelBuf = new Float32Array(512);

  getTrackLevel(trackId: string): number {
    const tn = this.tracks.get(trackId);
    if (!tn || !this.ctx) return 0;
    tn.analyser.getFloatTimeDomainData(this.levelBuf as unknown as Float32Array<ArrayBuffer>);
    let peak = 0;
    for (let i = 0; i < this.levelBuf.length; i++) {
      const v = Math.abs(this.levelBuf[i]);
      if (v > peak) peak = v;
    }
    return peak;
  }

  getMasterLevel(): [number, number] {
    if (!this.master || !this.ctx) return [0, 0];
    this.master.analyser.getFloatTimeDomainData(this.levelBuf as unknown as Float32Array<ArrayBuffer>);
    let peak = 0;
    for (let i = 0; i < this.levelBuf.length; i++) {
      const v = Math.abs(this.levelBuf[i]);
      if (v > peak) peak = v;
    }
    return [peak, peak];
  }

  // ---------------- offline render ----------------

  async renderProject(
    sourceProject: Project,
    onProgress?: (p: number) => void,
    options: OfflineRenderOptions = {},
  ): Promise<{ channels: Float32Array[]; sampleRate: number } | null> {
    onProgress?.(0.02);
    options.signal?.throwIfAborted();
    const projectEnd = projectLengthTicks(sourceProject);
    const startTick = clamp(options.startTick ?? 0, 0, projectEnd);
    const endTick = clamp(options.endTick ?? projectEnd, startTick + 1, projectEnd);
    if (endTick <= startTick) throw new RangeError("Bounce range must end after it starts.");
    const includeTrackIds = options.includeTrackIds
      ? new Set(options.includeTrackIds)
      : undefined;
    const project: Project = includeTrackIds
      ? {
          ...sourceProject,
          tracks: sourceProject.tracks.map((track) => ({
            ...track,
            solo: false,
            ...((track.role ?? "track") === "track"
              ? { mute: track.mute || !includeTrackIds.has(track.id) }
              : {}),
          })),
        }
      : sourceProject;
    const tempoLane = this.activeTempoLane(project);
    const renderSeconds = (from: number, to: number) => tempoLane
      ? this.integrateTempo(from, to, project, tempoLane)
      : tickToSec(to - from, project.tempo);
    // load all audio buffers
    const bufferIds = new Set<string>();
    for (const t of project.tracks) {
      if (t.sampleBufferId) bufferIds.add(t.sampleBufferId);
      for (const zone of t.sampleZones ?? []) bufferIds.add(zone.bufferId);
      for (const r of t.regions) {
        const bufferId = getRegionPlaybackBufferId(r);
        if (bufferId) bufferIds.add(bufferId);
      }
    }
    await Promise.all(Array.from(bufferIds).map((id) => this.ensureBufferLoaded(id)));
    options.signal?.throwIfAborted();

    const sr = options.sampleRate ?? 44100;
    let quickSamplerTailSec = 0;
    for (const track of project.tracks) {
      if (track.type !== "midi") continue;
      for (const region of track.regions) {
        if (region.type !== "midi") continue;
        for (const note of region.notes ?? []) {
          const noteStart = region.start + note.start;
          if (noteStart + note.length <= startTick || noteStart >= endTick) continue;
          const zone = selectSamplerZone(track.sampleZones, note.pitch, note.velocity);
          const sampleId = zone?.bufferId ?? track.sampleBufferId;
          const mode = zone?.playbackMode ?? track.samplePlaybackMode ?? "one-shot";
          if (!sampleId || mode !== "one-shot") continue;
          const stored = this.bufferCache.get(sampleId);
          if (!stored) continue;
          const sampleDuration = stored.channels[0]?.length
            ? stored.channels[0].length / stored.sampleRate
            : 0;
          const root = clamp(zone?.rootPitch ?? track.sampleRootPitch ?? 60, 0, 127);
          const rate = clamp(Math.pow(2, (note.pitch - root) / 12), 0.25, 4);
          quickSamplerTailSec = Math.max(quickSamplerTailSec, sampleDuration / rate);
        }
      }
    }
    const tailSeconds = options.tailSeconds ?? 3.2;
    const totalSec =
      renderSeconds(startTick, endTick) +
      Math.max(tailSeconds, quickSamplerTailSec + 0.25) + 0.1;
    const length = Math.ceil(totalSec * sr);
    const offline = new OfflineAudioContext(2, length, sr);
    const offlineAutomation = new AutomationEngine();
    onProgress?.(0.08);

    const master = buildMaster(offline);
    master.volume.gain.value = clamp(project.masterVolume, 0, 1.25);
    master.delay.delayTime.value = Math.min(1.9, (60 / project.tempo) * 0.75);

    const trackNodes = new Map<string, TrackNodes>();
    let done = 0;
    const total = project.tracks.reduce((a, t) => a + Math.max(1, t.regions.length), 1);

    const timeAt = (tick: number) => renderSeconds(startTick, tick) + 0.05;


    for (const track of project.tracks) {
      options.signal?.throwIfAborted();
      const folderStack = track.role === "folder"
        ? project.stacks?.find((stack) => stack.folderTrackId === track.id)
        : undefined;
      if (track.role === "vca" || (track.role === "folder" && folderStack?.type !== "folder")) continue;
      const tn = buildTrack(offline, master);
      applyTrackAudioPlugins(tn, track);
      tn.gain.gain.value = folderStack?.type === "folder"
        ? track.mute ? 0 : 1
        : isTrackAudible(track, project.tracks)
          ? getEffectiveTrackGain(track, project.tracks)
          : 0;
      tn.pedalboard.sync(
        track.pedalboard ?? [],
        activeAudioPlugin(track, "pedalboard")?.enabled === true,
      );
      applyTrackSpatialPanning(tn, track);
      trackNodes.set(track.id, tn);
      if (track.type === "midi") {
        // WAV bounces use the same SoundFont and multi-sampled patches as live playback.
        const patch = trackPatch(track);
        if (patch?.sampled) await warmSampledPatch(offline, tn.input, patch, true, track.id);
      }

    }

    offlineAutomation.bindParameter("master", "volume", master.volume.gain);
    offlineAutomation.bindParameter("master", "pan", master.panner.pan);
    offlineAutomation.bindParameter("master", "filterCutoff", master.filter.frequency);
    offlineAutomation.bindParameter("master", "reverbWet", master.reverbReturn.gain);
    for (const [trackId, tn] of trackNodes) {
      offlineAutomation.bindParameter(trackId, "volume", tn.gain.gain);
      offlineAutomation.bindParameter(trackId, "pan", tn.panner.pan);
      offlineAutomation.bindParameter(trackId, "mute", tn.muteGain.gain);
      offlineAutomation.bindParameter(trackId, "filterCutoff", tn.highPass.frequency);
      offlineAutomation.bindParameter(trackId, "param:cutoff", tn.highPass.frequency);
      offlineAutomation.bindParameter(trackId, "param:resonance", tn.highPass.Q);
      offlineAutomation.bindParameter(trackId, "param:chorusDepth", tn.chorusDepth.gain);
      offlineAutomation.bindParameter(trackId, "param:reverb", tn.reverbSend.gain);
      offlineAutomation.bindParameter(trackId, "param:delay", tn.delaySend.gain);
      offlineAutomation.bindParameter(trackId, "eq:lowGain", tn.eqLow.gain);
      offlineAutomation.bindParameter(trackId, "eq:midGain", tn.eqMid.gain);
      offlineAutomation.bindParameter(trackId, "eq:highGain", tn.eqHigh.gain);
      offlineAutomation.bindParameter(trackId, "send:reverb", tn.reverbSend.gain);
      offlineAutomation.bindParameter(trackId, "send:delay", tn.delaySend.gain);
      for (const binding of tn.pedalboard.getAutomationBindings(
        project.tracks.find((track) => track.id === trackId)?.pedalboard ?? [],
      )) {
        offlineAutomation.bindParameter(
          trackId,
          binding.parameterId,
          binding.parameter,
          binding.transform,
        );
      }
    }

    offlineAutomation.scheduleWindow(
      project.automationLanes ?? [],
      project.automationModes ?? {},
      startTick,
      endTick + 1,
      timeAt,
      (regionId) => {
        const region = project.tracks.flatMap((track) => track.regions)
          .find((item) => item.id === regionId);
        return region ? { start: region.start, end: region.start + region.length } : undefined;
      },
    );

    // Route offline channels through the same Aux and folder buses as live playback.
    for (const track of project.tracks) {
      options.signal?.throwIfAborted();
      const nodes = trackNodes.get(track.id);
      if (!nodes) continue;
      let target: AudioNode = master.input;
      const parentStack = track.parentTrackId
        ? project.stacks?.find((stack) =>
            stack.folderTrackId === track.parentTrackId && stack.type === "folder",
          )
        : undefined;
      if (parentStack && track.id !== parentStack.folderTrackId) {
        const parentNodes = trackNodes.get(parentStack.folderTrackId);
        if (parentNodes && parentNodes !== nodes) target = parentNodes.input;
      } else {
        const bus = resolveOutputBus(track, project.tracks);
        if (bus) {
          const busNodes = trackNodes.get(bus.id);
          if (busNodes && busNodes !== nodes) target = busNodes.input;
        }
      }
      try { nodes.output.disconnect(); } catch { /* no previous route */ }
      nodes.output.connect(target);
    }

    for (const track of project.tracks) {
      const tn = trackNodes.get(track.id);
      if (!tn) continue;
      for (const region of track.regions) {
        if (region.muted) { done++; continue; }
        const regionEnd = Math.min(region.start + region.length, endTick);
        const playbackBufferId = getRegionPlaybackBufferId(region);
        if (region.start >= endTick || regionEnd <= startTick) {
          done++;
          continue;
        }
        if (region.type === "midi") {
          const notes = applyMidiPlugins(
            region.notes ?? [],
            track.midiPlugins ?? [],
            project.keyTonic,
            project.keyMode
          );
          const period = region.looped && region.coreLength ? region.coreLength : 0;
          const reps = period ? Math.ceil((regionEnd - region.start) / period) + 1 : 1;
          for (let k = 0; k < reps; k++) {
            const base = region.start + k * period;
            for (const n of notes) {
              const absStart = base + n.start;
              const absEnd = Math.min(absStart + n.length, regionEnd);
              const scheduledStart = Math.max(absStart, startTick);
              if (scheduledStart >= absEnd) continue;
              const durTicks = absEnd - scheduledStart;
              if (durTicks <= 0) continue;
              const noteStart = timeAt(scheduledStart);
              const noteDuration = renderSeconds(scheduledStart, scheduledStart + durTicks);
              const voice = this.playTrackNote(
                offline,
                tn.input,
                track,
                n.pitch,
                n.velocity / 127,
                noteStart,
                noteDuration
              );
              // Match live playback: release sustained patches at MIDI note-off.
              voice.scheduleStop(noteStart + noteDuration);
            }
          }
        } else if (playbackBufferId) {
          const buf = this.bufferFor(offline, playbackBufferId);
          if (buf) {
            const contentSec = region.sampleLength ?? buf.duration;
            const playbackRate = clamp(region.playbackRate ?? 1, 0.5, 2);
            const contentPlaySec = contentSec / playbackRate;
            const periodTicks = region.looped ? secToTick(contentPlaySec, project.tempo) : 0;
            const reps = periodTicks ? Math.ceil((regionEnd - region.start) / periodTicks) + 1 : 1;
            for (let k = 0; k < reps; k++) {
              const occStart = region.start + k * periodTicks;
              const occEnd = Math.min(regionEnd, occStart + (periodTicks || regionEnd - occStart));
              const playStart = Math.max(occStart, startTick);
              if (playStart >= occEnd) continue;
              const elapsedSec = tickToSec(playStart - occStart, project.tempo);
              const remainTicks = occEnd - playStart;
              const durSec = Math.min(contentPlaySec - elapsedSec, tickToSec(remainTicks, project.tempo));
              if (durSec <= 0.005) continue;
              // Offline varispeed follows the same playback-rate automation as live playback.
              const src = offline.createBufferSource();
              src.buffer = buf;
              src.playbackRate.value = playbackRate;
              const g = offline.createGain();
              const gainVal = region.gain ?? 1;
              const fi = Math.min(Math.max(0, (region.fadeIn ?? 0) - elapsedSec), durSec);
              const fo = Math.min(region.fadeOut ?? 0, durSec);
              const when = timeAt(playStart);
              const end = when + durSec;
              let t = when;
              if (fi > 0) {
                g.gain.setValueAtTime(0.0001, when);
                g.gain.linearRampToValueAtTime(gainVal, when + fi);
                t = when + fi;
              } else {
                g.gain.setValueAtTime(gainVal, when);
              }
              if (fo > 0) {
                const foStart = Math.max(t, end - fo);
                g.gain.setValueAtTime(gainVal, foStart);
                g.gain.linearRampToValueAtTime(0.0001, end);
              }
              src.connect(g).connect(tn.input);
              src.start(when, (region.sampleStart ?? 0) + elapsedSec * playbackRate, durSec * playbackRate + 0.02);
            }
          }
        }
        done++;
        onProgress?.(0.1 + 0.7 * (done / total));
      }
    }
    onProgress?.(0.85);
    const rendered = await offline.startRendering();
    options.signal?.throwIfAborted();
    onProgress?.(0.98);
    const channels: Float32Array[] = [];
    for (let c = 0; c < rendered.numberOfChannels; c++) {
      channels.push(new Float32Array(rendered.getChannelData(c)));
    }
    onProgress?.(1);
    return { channels, sampleRate: sr };
  }
}

// quiet wrapper to avoid importing saveBuffer at top (keeps engine tree-shakeable in SSR)
async function saveBufferQuiet(id: string, buf: StoredBuffer): Promise<void> {
  const { saveBuffer } = await import("./idb");
  try {
    await saveBuffer(id, buf);
  } catch {
    /* storage full - keep in memory */
  }
}

export const engine = new AudioEngine();
