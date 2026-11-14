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
  uid,
} from "./types";
import { playNote, PATCHES, type VoiceHandle } from "./instruments";
import { warmSampledPatch } from "./sampled-instruments";
import { useDAW } from "./store";
import {
  tickToSec,
  secToTick,
  clamp,
  barTicks,
} from "./utils";
import type { StoredBuffer } from "./idb";
import { loadBuffer } from "./idb";

const LOOKAHEAD_SEC = 0.18;
const TICK_INTERVAL_MS = 40;

interface TrackNodes {
  input: GainNode;
  eqLow: BiquadFilterNode;
  eqMid: BiquadFilterNode;
  eqHigh: BiquadFilterNode;
  comp: DynamicsCompressorNode;
  gain: GainNode;
  panner: StereoPannerNode;
  analyser: AnalyserNode;
  reverbSend: GainNode;
  delaySend: GainNode;
}

interface MasterNodes {
  input: GainNode;
  limiter: DynamicsCompressorNode;
  volume: GainNode;
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

function makeImpulse(ctx: BaseAudioContext, seconds = 2.6): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const decay = Math.pow(1 - t, 2.4) * Math.exp(-2.2 * t);
      const white = Math.random() * 2 - 1;
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
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;

  input.connect(limiter).connect(volume).connect(analyser);
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

  return { input, limiter, volume, analyser, reverbConv, reverbReturn, delay, delayFb, delayFilter, delayReturn, click };
}

function buildTrack(ctx: BaseAudioContext, master: MasterNodes): TrackNodes {
  const input = ctx.createGain();
  const eqLow = ctx.createBiquadFilter();
  eqLow.type = "lowshelf";
  const eqMid = ctx.createBiquadFilter();
  eqMid.type = "peaking";
  const eqHigh = ctx.createBiquadFilter();
  eqHigh.type = "highshelf";
  const comp = ctx.createDynamicsCompressor();
  setComp(comp, false);
  const gain = ctx.createGain();
  const panner = ctx.createStereoPanner();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  const reverbSend = ctx.createGain();
  reverbSend.gain.value = 0;
  const delaySend = ctx.createGain();
  delaySend.gain.value = 0;

  input.connect(eqLow).connect(eqMid).connect(eqHigh).connect(comp);
  comp.connect(gain).connect(panner).connect(analyser).connect(master.input);
  panner.connect(reverbSend).connect(master.reverbConv);
  panner.connect(delaySend).connect(master.delay);
  return { input, eqLow, eqMid, eqHigh, comp, gain, panner, analyser, reverbSend, delaySend };
}

function setComp(comp: DynamicsCompressorNode, on: boolean) {
  comp.threshold.value = on ? -18 : 0;
  comp.ratio.value = on ? 2.5 : 1;
  comp.knee.value = on ? 6 : 0;
  comp.attack.value = 0.006;
  comp.release.value = 0.18;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master: MasterNodes | null = null;
  private tracks = new Map<string, TrackNodes>();
  private voices: ActiveVoice[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  // transport
  playing = false;
  recording = false;
  private passStartTime = 0;
  private passStartTick = 0;
  private scheduledUntilTick = 0;
  private countInBeats = 0;
  private countInStartTime = 0;
  private stoppedAtTick = 0;

  // MIDI live input + recording
  private openInputNotes = new Map<
    number,
    { voice: VoiceHandle; startTick: number; velocity: number }
  >();
  recordedMidi: { pitch: number; velocity: number; start: number; length: number }[] = [];
  private recordTargetTrack: string | null = null;

  // audio capture
  private mediaStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private monitorGain: GainNode | null = null;
  private captureNode: ScriptProcessorNode | null = null;
  private captureChunks: Float32Array[] = [];
  captureStartCtxTime = 0;
  captureSampleRate = 44100;

  // buffer cache
  private bufferCache = new Map<string, StoredBuffer>();
  private pendingLoads = new Set<string>();
  private ctxBufferCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

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

  // ---------------- lifecycle ----------------

  init() {
    if (this.inited || typeof window === "undefined") return;
    this.inited = true;
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    this.master = buildMaster(this.ctx);
    // sync whenever the project changes
    this.unsub = useDAW.subscribe((state, prev) => {
      if (state.project !== prev.project) this.sync(state.project);
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
    const beat = 60 / project.tempo;
    m.delay.delayTime.value = Math.min(1.9, beat * 0.75); // dotted 8th
    m.click.gain.value = 0.9;

    const anySolo = project.tracks.some((t) => t.solo);
    const seen = new Set<string>();
    for (const track of project.tracks) {
      seen.add(track.id);
      let tn = this.tracks.get(track.id);
      if (!tn) {
        tn = buildTrack(ctx, m);
        this.tracks.set(track.id, tn);
      }
      if (track.type === "midi") void warmSampledPatch(ctx, tn.input, track.instrument);
      const eq = track.eq;
      tn.eqLow.frequency.value = eq.lowFreq;
      tn.eqLow.gain.value = eq.lowGain;
      tn.eqMid.frequency.value = eq.midFreq;
      tn.eqMid.Q.value = eq.midQ;
      tn.eqMid.gain.value = eq.midGain;
      tn.eqHigh.frequency.value = eq.highFreq;
      tn.eqHigh.gain.value = eq.highGain;
      setComp(tn.comp, track.compressor);
      const audible = !track.mute && (!anySolo || track.solo);
      tn.gain.gain.value = audible ? clamp(track.volume, 0, 1.25) : 0;
      tn.panner.pan.value = clamp(track.pan, -1, 1);
      tn.reverbSend.gain.value = clamp((track.params.reverb ?? 0) * 0.9, 0, 1);
      tn.delaySend.gain.value = clamp((track.params.delay ?? 0) * 0.9, 0, 1);
      // prefetch audio buffers
      for (const r of track.regions) {
        if (r.bufferId && !this.bufferCache.has(r.bufferId) && !this.pendingLoads.has(r.bufferId)) {
          this.pendingLoads.add(r.bufferId);
          loadBuffer(r.bufferId)
            .then((b) => {
              if (b) this.bufferCache.set(r.bufferId as string, b);
            })
            .catch(() => undefined)
            .finally(() => this.pendingLoads.delete(r.bufferId as string));
        }
      }
    }
    // remove stale track nodes
    for (const id of Array.from(this.tracks.keys())) {
      if (!seen.has(id)) {
        const tn = this.tracks.get(id);
        if (tn) {
          try {
            tn.input.disconnect();
            tn.analyser.disconnect();
            tn.reverbSend.disconnect();
            tn.delaySend.disconnect();
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

  hasBuffer(id: string): boolean {
    return this.bufferCache.has(id);
  }

  /** Public read access to cached PCM (for waveform drawing) */
  getStoredBuffer(id: string): StoredBuffer | undefined {
    return this.bufferCache.get(id);
  }

  async ensureBufferLoaded(id: string): Promise<StoredBuffer | undefined> {
    if (this.bufferCache.has(id)) return this.bufferCache.get(id);
    if (this.pendingLoads.has(id)) return undefined;
    this.pendingLoads.add(id);
    try {
      const b = await loadBuffer(id);
      if (b) this.bufferCache.set(id, b);
      return b;
    } finally {
      this.pendingLoads.delete(id);
    }
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
    const st = useDAW.getState();
    const project = st.project;
    const start = fromTick ?? this.stoppedAtTick ?? 0;
    const beatSec = 60 / project.tempo;
    const countIn = this.recording && project.countIn ? project.timeSig[0] : 0;
    const now = ctx.currentTime + 0.08;
    this.countInBeats = countIn;
    this.countInStartTime = now;
    this.passStartTime = now + countIn * beatSec;
    this.passStartTick = start;
    this.scheduledUntilTick = start;
    this.playing = true;
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
    const wasPlaying = this.playing;
    if (!wasPlaying) return;
    const tick = this.currentTick();
    this.stoppedAtTick = tick;
    this.playing = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // finalize open input notes
    for (const [pitch, n] of this.openInputNotes) {
      const len = Math.max(PPQ / 8, tick - n.startTick);
      this.recordedMidi.push({ pitch, velocity: n.velocity, start: n.startTick, length: len });
      try { n.voice.scheduleStop(this.ctx ? this.ctx.currentTime : 0); } catch { /* noop */ }
    }
    this.openInputNotes.clear();
    for (const v of this.voices) v.handle.kill();
    this.voices = [];
    this.countInBeats = 0;
    useDAW.getState().setTransport({ playing: false, recording: false, countInRemaining: 0 });
    this.recording = false;
  }

  togglePlay() {
    if (this.playing) this.stop();
    else this.play(this.stoppedAtTick ?? 0);
  }

  startRecording() {
    const st = useDAW.getState();
    const armed = st.project.tracks.find((t) => t.armed);
    const track = armed ?? st.project.tracks.find((t) => t.id === st.ui.selectedTrackId);
    this.recordTargetTrack = track?.id ?? null;
    this.recording = true;
    this.recordedMidi = [];
    if (track?.type === "audio") {
      this.startAudioCapture(track.id, track.inputMonitor).catch(() => {
        this.recording = false;
      });
    }
    useDAW.getState().setTransport({ recording: true });
    this.play(this.stoppedAtTick ?? 0);
  }

  stopRecording() {
    const startTick = this.passStartTick;
    const endTick = this.currentTick();
    const midi = [...this.recordedMidi];
    this.recordedMidi = [];
    const trackId = this.recordTargetTrack;
    this.recording = false;
    this.stop();
    let audio: { stored: StoredBuffer; offsetSec: number; durationSec: number } | null = null;
    if (this.captureNode) {
      audio = this.finishAudioCapture();
    }
    return { midi, audio, trackId, startTick, endTick };
  }

  currentTick(): number {
    if (!this.ctx) return this.stoppedAtTick ?? 0;
    if (!this.playing) return this.stoppedAtTick ?? 0;
    const now = this.ctx.currentTime;
    const project = useDAW.getState().project;
    const tps = (project.tempo / 60) * PPQ; // ticks per second
    if (now < this.passStartTime) {
      // during count-in
      return this.passStartTick;
    }
    return this.passStartTick + (now - this.passStartTime) * tps;
  }

  setPlayhead(tick: number) {
    this.stoppedAtTick = Math.max(0, tick);
    if (this.playing) {
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
    const horizon = ctx.currentTime + LOOKAHEAD_SEC;
    // prune old voices
    if (this.voices.length > 0) {
      this.voices = this.voices.filter((v) => v.until > ctx.currentTime - 2);
    }
    // loop preview scheduling
    if (this.preview) this.previewTick();

    let guard = 0;
    while (guard++ < 16) {
      const passEndTick = project.cycleOn
        ? Math.max(project.cycleStart + PPQ, project.cycleEnd)
        : Infinity;
      const passEndTime =
        project.cycleOn && Number.isFinite(passEndTick)
          ? this.passStartTime + tickToSec(passEndTick - this.passStartTick, project.tempo)
          : Infinity;
      const sliceEnd = Math.min(horizon, passEndTime);
      const fromTick = this.scheduledUntilTick;
      const toTick =
        Number.isFinite(sliceEnd)
          ? this.passStartTick + secToTick(sliceEnd - this.passStartTime, project.tempo)
          : fromTick;
      if (toTick > fromTick && Number.isFinite(sliceEnd)) {
        this.scheduleRange(fromTick, toTick, sliceEnd - tickToSec(toTick - fromTick, project.tempo), project);
        this.scheduledUntilTick = toTick;
      }
      if (horizon < passEndTime || !Number.isFinite(passEndTime)) break;
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
    const timeAt = (tick: number) => timeAtFrom + tickToSec(tick - fromTick, project.tempo);

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
      if (track.mute || (anySolo && !track.solo)) continue;
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

  private scheduleMidiRegion(
    region: Region,
    track: Track,
    tn: TrackNodes,
    fromTick: number,
    toTick: number,
    timeAt: (t: number) => number,
    project: Project
  ) {
    const notes = region.notes ?? [];
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
        const dur = tickToSec(durTicks, project.tempo);
        const voice = playNote(
          this.ctx as AudioContext,
          tn.input,
          track.instrument,
          n.pitch,
          n.velocity / 127,
          Math.max(when, (this.ctx as AudioContext).currentTime),
          dur,
          track.params
        );
        this.voices.push({ handle: voice, until: when + dur + 6 });
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
    if (!region.bufferId) return;
    const buf = this.bufferFor(this.ctx as AudioContext, region.bufferId);
    if (!buf) return;
    const regionEnd = region.start + region.length;
    const contentSec = region.sampleLength ?? buf.duration;
    const periodTicks = region.looped ? secToTick(contentSec, project.tempo) : 0;
    const reps = periodTicks ? Math.ceil(region.length / periodTicks) + 1 : 1;
    for (let k = 0; k < reps; k++) {
      const occStart = region.start + k * periodTicks;
      if (occStart >= toTick || occStart >= regionEnd) continue;
      if (occStart < fromTick) continue;
      const when = timeAt(occStart);
      const remainTicks = Math.min(regionEnd - occStart, periodTicks || regionEnd - occStart);
      const durSec = Math.min(contentSec, tickToSec(remainTicks, project.tempo));
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
    const g = ctx.createGain();
    const gainVal = region.gain ?? 1;
    const fi = Math.min(region.fadeIn ?? 0, durSec);
    const fo = Math.min(region.fadeOut ?? 0, durSec);
    const fiRemain = Math.max(0, fi - offsetIntoContentSec);
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
    src.start(Math.max(when, ctx.currentTime), sampleStart, durSec + 0.02);
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
        if (region.type !== "audio" || !region.bufferId) continue;
        if (atTick <= region.start || atTick >= regionEnd) continue;
        const buf = this.bufferFor(this.ctx as AudioContext, region.bufferId);
        if (!buf) continue;
        const contentSec = region.sampleLength ?? buf.duration;
        const periodTicks = region.looped ? secToTick(contentSec, project.tempo) : 0;
        let occStart = region.start;
        if (periodTicks) {
          occStart = region.start + Math.floor((atTick - region.start) / periodTicks) * periodTicks;
        }
        const offsetIntoContent = tickToSec(atTick - occStart, project.tempo);
        const remainRegionSec = tickToSec(regionEnd - atTick, project.tempo);
        const durSec = Math.max(0, Math.min(contentSec - offsetIntoContent, remainRegionSec));
        if (durSec > 0.005) {
          this.playAudioSlice(region, buf, tn.input, atTime, offsetIntoContent, durSec);
        }
      }
    }
  }

  // ---------------- live input (musical typing / onscreen keys) ----------------

  noteOn(pitch: number, velocity: number) {
    const ctx = this.ensure();
    const st = useDAW.getState();
    const track = st.project.tracks.find((t) => t.id === st.ui.selectedTrackId);
    if (!track || track.type !== "midi") return;
    if (this.openInputNotes.has(pitch)) return;
    const voice = playNote(ctx, this.tracks.get(track.id)?.input ?? this.master?.input ?? ctx.destination, track.instrument, pitch, velocity / 127, ctx.currentTime, 3600, track.params);
    const startTick = this.playing ? this.currentTick() : this.stoppedAtTick ?? 0;
    this.openInputNotes.set(pitch, { voice, startTick, velocity });
  }

  noteOff(pitch: number) {
    const n = this.openInputNotes.get(pitch);
    if (!n || !this.ctx) return;
    const tick = this.playing ? this.currentTick() : (this.stoppedAtTick ?? 0) + PPQ / 4;
    if (this.recording && this.playing) {
      const len = Math.max(PPQ / 8, tick - n.startTick);
      this.recordedMidi.push({ pitch, velocity: n.velocity, start: n.startTick, length: len });
    }
    n.voice.scheduleStop(this.ctx.currentTime);
    this.openInputNotes.delete(pitch);
  }

  /** One-shot audition (piano roll keys, library preview) */
  auditionNote(patchId: string, pitch: number, velocity = 100, params?: Record<string, number>) {
    const ctx = this.ensure();
    if (!this.master) return;
    const st = useDAW.getState();
    const p = params ?? st.project.tracks.find((t) => t.instrument === patchId)?.params ?? {};
    const g = ctx.createGain();
    g.gain.value = 1;
    g.connect(this.master.input);
    const v = playNote(ctx, g, patchId, pitch, velocity / 127, ctx.currentTime, 0.5, p);
    this.voices.push({ handle: v, until: ctx.currentTime + 6 });
    setTimeout(() => { try { g.disconnect(); } catch { /* noop */ } }, 6000);
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
    if (this.playing) this.stop();
    const dest = ctx.createGain();
    dest.gain.value = 0.9;
    dest.connect(this.master?.input ?? ctx.destination);
    this.preview = {
      patchId,
      params: params ?? {},
      notes,
      periodSec,
      startTime: ctx.currentTime + 0.05,
      scheduledUntil: ctx.currentTime + 0.05,
      dest,
    };
    this.previewTick();
  }

  stopPreview() {
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
        if (when < ctx.currentTime || when >= horizon) continue;
        const v = playNote(ctx, pv.dest, pv.patchId, n.pitch, n.velocity / 127, when, n.len, params);
        this.voices.push({ handle: v, until: when + n.len + 4 });
      }
    }
    pv.scheduledUntil = horizon;
  }

  // ---------------- audio capture ----------------

  async startAudioCapture(trackId: string, monitor: boolean): Promise<void> {
    const ctx = this.ensure();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    this.mediaStream = stream;
    this.micSource = ctx.createMediaStreamSource(stream);
    this.monitorGain = ctx.createGain();
    this.monitorGain.gain.value = monitor ? 1 : 0;
    const tn = this.tracks.get(trackId);
    this.micSource.connect(this.monitorGain);
    if (tn) this.monitorGain.connect(tn.input);
    // capture via ScriptProcessor (universal support)
    this.captureNode = ctx.createScriptProcessor(4096, 1, 1);
    this.captureChunks = [];
    this.captureSampleRate = ctx.sampleRate;
    this.captureStartCtxTime = ctx.currentTime;
    this.captureNode.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      this.captureChunks.push(new Float32Array(input));
    };
    const sink = ctx.createGain();
    sink.gain.value = 0;
    this.micSource.connect(this.captureNode);
    this.captureNode.connect(sink);
    sink.connect(ctx.destination);
  }

  finishAudioCapture(): { stored: StoredBuffer; offsetSec: number; durationSec: number } | null {
    if (!this.captureNode || !this.ctx) return null;
    const total = this.captureChunks.reduce((a, c) => a + c.length, 0);
    const mono = new Float32Array(total);
    let off = 0;
    for (const c of this.captureChunks) {
      mono.set(c, off);
      off += c.length;
    }
    const offsetSec = Math.max(0, this.passStartTime - this.captureStartCtxTime);
    // gentle stereo: duplicate mono
    const stored: StoredBuffer = {
      sampleRate: this.captureSampleRate,
      channels: [mono, mono],
      name: "Recording",
    };
    try {
      this.captureNode.disconnect();
      this.micSource?.disconnect();
      this.monitorGain?.disconnect();
    } catch { /* noop */ }
    this.mediaStream?.getTracks().forEach((t) => t.stop());
    this.captureNode = null;
    this.micSource = null;
    this.mediaStream = null;
    return { stored, offsetSec, durationSec: total / this.captureSampleRate - offsetSec };
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
    project: Project,
    onProgress?: (p: number) => void
  ): Promise<{ channels: Float32Array[]; sampleRate: number } | null> {
    onProgress?.(0.02);
    // load all audio buffers
    const bufferIds = new Set<string>();
    for (const t of project.tracks) {
      for (const r of t.regions) if (r.bufferId) bufferIds.add(r.bufferId);
    }
    await Promise.all(Array.from(bufferIds).map((id) => this.ensureBufferLoaded(id)));

    const sr = 44100;
    let endTick = 0;
    for (const t of project.tracks) {
      for (const r of t.regions) endTick = Math.max(endTick, r.start + r.length);
    }
    const totalSec = tickToSec(endTick, project.tempo) + 3.2; // reverb tail
    const length = Math.ceil(totalSec * sr);
    const offline = new OfflineAudioContext(2, length, sr);
    onProgress?.(0.08);

    const master = buildMaster(offline);
    master.volume.gain.value = clamp(project.masterVolume, 0, 1.25);
    master.delay.delayTime.value = Math.min(1.9, (60 / project.tempo) * 0.75);

    const anySolo = project.tracks.some((t) => t.solo);
    const trackNodes = new Map<string, TrackNodes>();
    let done = 0;
    const total = project.tracks.reduce((a, t) => a + Math.max(1, t.regions.length), 1);

    const timeAt = (tick: number) => tickToSec(tick, project.tempo) + 0.05;

    for (const track of project.tracks) {
      if (track.mute || (anySolo && !track.solo)) continue;
      const tn = buildTrack(offline, master);
      const eq = track.eq;
      tn.eqLow.frequency.value = eq.lowFreq;
      tn.eqLow.gain.value = eq.lowGain;
      tn.eqMid.frequency.value = eq.midFreq;
      tn.eqMid.Q.value = eq.midQ;
      tn.eqMid.gain.value = eq.midGain;
      tn.eqHigh.frequency.value = eq.highFreq;
      tn.eqHigh.gain.value = eq.highGain;
      setComp(tn.comp, track.compressor);
      tn.gain.gain.value = clamp(track.volume, 0, 1.25);
      tn.panner.pan.value = clamp(track.pan, -1, 1);
      tn.reverbSend.gain.value = clamp((track.params.reverb ?? 0) * 0.9, 0, 1);
      tn.delaySend.gain.value = clamp((track.params.delay ?? 0) * 0.9, 0, 1);
      trackNodes.set(track.id, tn);
      if (track.type === "midi") {
        // OfflineAudioContext is supported by smplr, so WAV bounces use the same
        // sampled piano/string patches as live playback (with synth fallback on load failure).
        await warmSampledPatch(offline, tn.input, track.instrument);
      }

      for (const region of track.regions) {
        if (region.muted) { done++; continue; }
        const regionEnd = region.start + region.length;
        if (region.type === "midi") {
          const notes = region.notes ?? [];
          const period = region.looped && region.coreLength ? region.coreLength : 0;
          const reps = period ? Math.ceil(region.length / period) + 1 : 1;
          for (let k = 0; k < reps; k++) {
            const base = region.start + k * period;
            for (const n of notes) {
              const absStart = base + n.start;
              if (absStart >= regionEnd) continue;
              const durTicks = Math.min(n.length, regionEnd - absStart);
              if (durTicks <= 0) continue;
              playNote(offline, tn.input, track.instrument, n.pitch, n.velocity / 127, timeAt(absStart), tickToSec(durTicks, project.tempo), track.params);
            }
          }
        } else if (region.bufferId) {
          const buf = this.bufferFor(offline, region.bufferId);
          if (buf) {
            const contentSec = region.sampleLength ?? buf.duration;
            const periodTicks = region.looped ? secToTick(contentSec, project.tempo) : 0;
            const reps = periodTicks ? Math.ceil(region.length / periodTicks) + 1 : 1;
            for (let k = 0; k < reps; k++) {
              const occStart = region.start + k * periodTicks;
              if (occStart >= regionEnd) continue;
              const remainTicks = Math.min(regionEnd - occStart, periodTicks || regionEnd - occStart);
              const durSec = Math.min(contentSec, tickToSec(remainTicks, project.tempo));
              if (durSec <= 0.005) continue;
              // offline version of playAudioSlice
              const src = offline.createBufferSource();
              src.buffer = buf;
              const g = offline.createGain();
              const gainVal = region.gain ?? 1;
              const fi = Math.min(region.fadeIn ?? 0, durSec);
              const fo = Math.min(region.fadeOut ?? 0, durSec);
              const when = timeAt(occStart);
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
              src.start(when, region.sampleStart ?? 0, durSec + 0.02);
            }
          }
        }
        done++;
        onProgress?.(0.1 + 0.7 * (done / total));
      }
    }

    onProgress?.(0.85);
    const rendered = await offline.startRendering();
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
