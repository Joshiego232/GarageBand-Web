// ============================================================
// Instrument patches - procedural Web Audio synthesis
// Every patch works on any BaseAudioContext (live + offline export)
// ============================================================
import type { Patch, KnobDef } from "./types";
import { midiToFreq, clamp } from "./utils";
import { playSampledNote } from "./sampled-instruments";

export interface VoiceHandle {
  /** Schedule the release at absolute ctx time */
  scheduleStop(at: number): void;
  /** Hard stop with fade (transport stop) */
  kill(): void;
}

export interface NoteEvent {
  pitch: number;
  velocity: number; // 0..1
  when: number; // absolute ctx time
  dur: number; // seconds
}

type Params = Record<string, number>;

interface VoiceCtx {
  ctx: BaseAudioContext;
  dest: AudioNode;
  freq: number;
  vel: number;
  when: number;
  dur: number;
  p: Params;
}

function k(
  id: string,
  label: string,
  min: number,
  max: number,
  def: number,
  extra?: Partial<KnobDef>
): KnobDef {
  return { id, label, min, max, def, ...extra };
}

const SEND_KNOBS: KnobDef[] = [
  k("reverb", "Reverb", 0, 1, 0.12),
  k("delay", "Delay", 0, 1, 0),
];

// ---------- envelope helper ----------
function adsrGain(ctx: BaseAudioContext, when: number, a: number, d: number, s: number, r: number, peak: number) {
  const g = ctx.createGain();
  const t = when;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(Math.max(peak * s, 0.0002), t + a + d);
  return { g, release: (at: number) => {
    const rel = Math.max(at, t + a + 0.01);
    g.gain.cancelScheduledValues(rel);
    g.gain.setValueAtTime(Math.max(g.gain.value, 0.0002), rel);
    g.gain.exponentialRampToValueAtTime(0.0001, rel + r);
  }};
}

function makeVoice(
  nodes: { stop: (t: number) => void }[],
  gainRelease: (at: number) => void,
  ctx: BaseAudioContext,
  out: AudioNode,
  tailSec = 0
): VoiceHandle {
  const fade = ctx.createGain();
  fade.gain.value = 1;
  fade.connect(out);
  // we re-parent: nodes connect into fade instead of out - handled by callers
  return {
    scheduleStop(at: number) {
      gainRelease(at);
      const stopAt = at + tailSec;
      for (const n of nodes) {
        try { n.stop(stopAt); } catch { /* already stopped */ }
      }
    },
    kill() {
      const now = ctx.currentTime;
      fade.gain.cancelScheduledValues(now);
      fade.gain.setValueAtTime(fade.gain.value, now);
      fade.gain.linearRampToValueAtTime(0.0001, now + 0.015);
      for (const n of nodes) {
        try { n.stop(now + 0.03); } catch { /* noop */ }
      }
    },
  };
}

// ============================================================
// Patches
// ============================================================

function pianoWave(ctx: BaseAudioContext): PeriodicWave {
  const n = 16;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  const amps = [0, 1, 0.6, 0.38, 0.22, 0.15, 0.09, 0.06, 0.05, 0.04, 0.03, 0.025, 0.02, 0.015, 0.012, 0.01];
  for (let i = 1; i < n; i++) imag[i] = amps[i] ?? 0.01;
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

function playPiano(v: VoiceCtx): VoiceHandle {
  const { ctx, dest, freq, vel, when, dur, p } = v;
  const bright = clamp(p.brightness ?? 0.6, 0, 1);
  const wave = pianoWave(ctx);
  const osc = ctx.createOscillator();
  osc.setPeriodicWave(wave);
  osc.frequency.value = freq;
  const osc2 = ctx.createOscillator();
  osc2.type = "sine";
  osc2.frequency.value = freq * 2.001;

  const filt = ctx.createBiquadFilter();
  filt.type = "lowpass";
  const cut = freq * (3 + bright * 11);
  filt.frequency.setValueAtTime(Math.min(cut, 16000), when);
  filt.frequency.exponentialRampToValueAtTime(Math.min(freq * 2.2 + 200, 14000), when + 1.2);
  filt.Q.value = 0.4;

  const g = ctx.createGain();
  const peak = 0.5 * vel;
  const decay = clamp(3.2 - (freq / 440) * 1.2, 0.7, 3.2); // lower notes ring longer
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(peak, when + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, when + decay);

  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(peak * 0.25 * bright, when);
  g2.gain.exponentialRampToValueAtTime(0.0001, when + 0.4);

  osc.connect(filt).connect(g);
  osc2.connect(g2).connect(g);
  const out = ctx.createGain();
  g.connect(out);
  g2.connect(out);
  out.connect(dest);
  osc.start(when);
  osc2.start(when);

  const release = clamp(p.release ?? 0.12, 0.05, 1.5);
  return {
    scheduleStop(at: number) {
      const rel = Math.max(at, when + 0.02);
      g.gain.cancelScheduledValues(rel);
      g.gain.setValueAtTime(Math.max(g.gain.value, 0.0002), rel);
      g.gain.exponentialRampToValueAtTime(0.0001, rel + release);
      try { osc.stop(rel + release + 0.05); } catch { /* noop */ }
      try { osc2.stop(rel + release + 0.05); } catch { /* noop */ }
    },
    kill() {
      const now = ctx.currentTime;
      [g, g2, out].forEach((gg) => {
        gg.gain.cancelScheduledValues(now);
        gg.gain.setValueAtTime(gg.gain.value, now);
        gg.gain.linearRampToValueAtTime(0.0001, now + 0.015);
      });
      try { osc.stop(now + 0.03); } catch { /* noop */ }
      try { osc2.stop(now + 0.03); } catch { /* noop */ }
    },
  };
}

function playEPiano(v: VoiceCtx): VoiceHandle {
  const { ctx, dest, freq, vel, when, dur, p } = v;
  // FM rhodes: carrier + tine modulator
  const carrier = ctx.createOscillator();
  carrier.type = "sine";
  carrier.frequency.value = freq;
  const mod = ctx.createOscillator();
  mod.type = "sine";
  mod.frequency.value = freq * 14;
  const modGain = ctx.createGain();
  const idx = (p.tine ?? 0.5) * 3.2 * freq * vel;
  modGain.gain.setValueAtTime(idx, when);
  modGain.gain.exponentialRampToValueAtTime(1, when + 0.18);
  mod.connect(modGain).connect(carrier.frequency);

  // body
  const body = ctx.createOscillator();
  body.type = "sine";
  body.frequency.value = freq;

  const g = ctx.createGain();
  const peak = 0.45 * vel;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(peak, when + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 2.6);
  const gBody = ctx.createGain();
  gBody.gain.value = 0.35;

  carrier.connect(g);
  body.connect(gBody).connect(g);
  g.connect(dest);
  carrier.start(when);
  mod.start(when);
  body.start(when);

  // tremolo
  const trem = ctx.createGain();
  trem.gain.value = 1;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 4.5;
  const lfoG = ctx.createGain();
  lfoG.gain.value = (p.tremolo ?? 0.15) * 0.5;
  lfo.connect(lfoG).connect(trem.gain);
  lfo.start(when);
  g.disconnect();
  g.connect(trem).connect(dest);

  return {
    scheduleStop(at: number) {
      const rel = Math.max(at, when + 0.02);
      g.gain.cancelScheduledValues(rel);
      g.gain.setValueAtTime(Math.max(g.gain.value, 0.0002), rel);
      g.gain.exponentialRampToValueAtTime(0.0001, rel + 0.18);
      [carrier, mod, body, lfo].forEach((o) => { try { o.stop(rel + 0.25); } catch { /* noop */ } });
    },
    kill() {
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0.0001, now + 0.015);
      [carrier, mod, body, lfo].forEach((o) => { try { o.stop(now + 0.03); } catch { /* noop */ } });
    },
  };
}

function playLead(v: VoiceCtx): VoiceHandle {
  const { ctx, dest, freq, vel, when, dur, p } = v;
  const cutoff = clamp(p.cutoff ?? 4000, 80, 14000);
  const res = clamp(p.resonance ?? 4, 0.5, 20);
  const attack = clamp(p.attack ?? 0.01, 0.002, 1);
  const release = clamp(p.release ?? 0.25, 0.02, 2);

  const filt = ctx.createBiquadFilter();
  filt.type = "lowpass";
  filt.Q.value = res;
  filt.frequency.setValueAtTime(cutoff * 0.25, when);
  filt.frequency.exponentialRampToValueAtTime(cutoff, when + 0.05);
  filt.frequency.setTargetAtTime(cutoff * 0.55, when + 0.05, 0.3);

  const g = ctx.createGain();
  const peak = 0.32 * vel;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(peak, when + attack);
  g.gain.exponentialRampToValueAtTime(peak * 0.72, when + attack + 0.14);

  const oscs: OscillatorNode[] = [];
  for (const det of [-6, 6]) {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    o.detune.value = det;
    o.connect(filt);
    o.start(when);
    oscs.push(o);
  }
  const sub = ctx.createOscillator();
  sub.type = "square";
  sub.frequency.value = freq / 2;
  const subG = ctx.createGain();
  subG.gain.value = 0.12;
  sub.connect(subG).connect(filt);
  sub.start(when);
  oscs.push(sub);

  filt.connect(g).connect(dest);

  return {
    scheduleStop(at: number) {
      const rel = Math.max(at, when + attack + 0.01);
      g.gain.cancelScheduledValues(rel);
      g.gain.setValueAtTime(Math.max(g.gain.value, 0.0002), rel);
      g.gain.exponentialRampToValueAtTime(0.0001, rel + release);
      oscs.forEach((o) => { try { o.stop(rel + release + 0.05); } catch { /* noop */ } });
    },
    kill() {
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0.0001, now + 0.015);
      oscs.forEach((o) => { try { o.stop(now + 0.03); } catch { /* noop */ } });
    },
  };
}

function playPad(v: VoiceCtx): VoiceHandle {
  const { ctx, dest, freq, vel, when, dur, p } = v;
  const cutoff = clamp(p.cutoff ?? 2200, 100, 12000);
  const attack = clamp(p.attack ?? 0.6, 0.05, 3);
  const release = clamp(p.release ?? 1.4, 0.1, 4);
  const shimmer = clamp(p.shimmer ?? 0.4, 0, 1);

  const filt = ctx.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.value = cutoff;
  filt.Q.value = 0.8;

  // filter LFO
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.16;
  const lfoG = ctx.createGain();
  lfoG.gain.value = 500 * shimmer;
  lfo.connect(lfoG).connect(filt.frequency);
  lfo.start(when);

  const g = ctx.createGain();
  const peak = 0.14 * vel;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(peak, when + attack);

  const oscs: OscillatorNode[] = [];
  for (const det of [-11, 0, 9, 14]) {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    o.detune.value = det;
    o.connect(filt);
    o.start(when);
    oscs.push(o);
  }

  // chorus via short modulated delay
  const chorus = ctx.createDelay(0.05);
  chorus.delayTime.value = 0.018;
  const clfo = ctx.createOscillator();
  clfo.frequency.value = 0.9;
  const clfoG = ctx.createGain();
  clfoG.gain.value = 0.006 * (0.5 + shimmer);
  clfo.connect(clfoG).connect(chorus.delayTime);
  clfo.start(when);
  oscs.push(clfo);

  filt.connect(g).connect(dest);
  g.connect(chorus).connect(dest);

  return {
    scheduleStop(at: number) {
      const rel = Math.max(at, when + attack);
      g.gain.cancelScheduledValues(rel);
      g.gain.setValueAtTime(Math.max(g.gain.value, 0.0002), rel);
      g.gain.exponentialRampToValueAtTime(0.0001, rel + release);
      oscs.forEach((o) => { try { o.stop(rel + release + 0.1); } catch { /* noop */ } });
    },
    kill() {
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0.0001, now + 0.02);
      oscs.forEach((o) => { try { o.stop(now + 0.04); } catch { /* noop */ } });
    },
  };
}

function playStrings(v: VoiceCtx): VoiceHandle {
  const { ctx, dest, freq, vel, when, dur, p } = v;
  const bright = clamp(p.brightness ?? 0.5, 0, 1);
  const vib = clamp(p.vibrato ?? 0.35, 0, 1);
  const filt = ctx.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.value = 1600 + bright * 4200;

  const g = ctx.createGain();
  const peak = 0.16 * vel;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(peak, when + 0.22);

  const oscs: OscillatorNode[] = [];
  for (const det of [-8, 5]) {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    o.detune.value = det;
    o.connect(filt);
    o.start(when);
    oscs.push(o);
  }
  // vibrato
  const vfo = ctx.createOscillator();
  vfo.frequency.value = 5.2;
  const vfoG = ctx.createGain();
  vfoG.gain.setValueAtTime(0, when);
  vfoG.gain.linearRampToValueAtTime(vib * 9, when + 0.5);
  vfo.connect(vfoG);
  oscs.forEach((o) => vfoG.connect(o.detune));
  vfo.start(when);
  oscs.push(vfo);

  filt.connect(g).connect(dest);
  return {
    scheduleStop(at: number) {
      const rel = Math.max(at, when + 0.22);
      g.gain.cancelScheduledValues(rel);
      g.gain.setValueAtTime(Math.max(g.gain.value, 0.0002), rel);
      g.gain.exponentialRampToValueAtTime(0.0001, rel + 0.5);
      oscs.forEach((o) => { try { o.stop(rel + 0.55); } catch { /* noop */ } });
    },
    kill() {
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0.0001, now + 0.02);
      oscs.forEach((o) => { try { o.stop(now + 0.04); } catch { /* noop */ } });
    },
  };
}

function playOrgan(v: VoiceCtx): VoiceHandle {
  const { ctx, dest, freq, vel, when, p } = v;
  const mix = clamp(p.harmonics ?? 0.5, 0, 1);
  const chorus = clamp(p.chorale ?? 0.3, 0, 1);
  const drawbars: [number, number][] = [
    [0.5, 0.35],
    [1, 1],
    [2, 0.55 + mix * 0.3],
    [3, 0.3 * mix],
    [4, 0.35 * mix],
    [6, 0.15 * mix],
    [8, 0.2 * mix],
  ];
  const g = ctx.createGain();
  const peak = 0.09 * vel;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(peak, when + 0.012);

  const trem = ctx.createGain();
  trem.gain.value = 1;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.5;
  const lfoG = ctx.createGain();
  lfoG.gain.value = 0.12 * chorus;
  lfo.connect(lfoG).connect(trem.gain);
  lfo.start(when);

  const oscs: OscillatorNode[] = [lfo];
  for (const [mult, amp] of drawbars) {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = freq * mult;
    const og = ctx.createGain();
    og.gain.value = amp;
    o.connect(og).connect(g);
    o.start(when);
    oscs.push(o);
  }
  g.connect(trem).connect(dest);
  return {
    scheduleStop(at: number) {
      const rel = Math.max(at, when + 0.02);
      g.gain.cancelScheduledValues(rel);
      g.gain.setValueAtTime(Math.max(g.gain.value, 0.0002), rel);
      g.gain.exponentialRampToValueAtTime(0.0001, rel + 0.09);
      oscs.forEach((o) => { try { o.stop(rel + 0.12); } catch { /* noop */ } });
    },
    kill() {
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0.0001, now + 0.015);
      oscs.forEach((o) => { try { o.stop(now + 0.03); } catch { /* noop */ } });
    },
  };
}

function playSubBass(v: VoiceCtx): VoiceHandle {
  const { ctx, dest, freq, vel, when, dur, p } = v;
  const drive = clamp(p.drive ?? 0.2, 0, 1);
  const decay = clamp(p.decay ?? 0.6, 0.1, 2.5);
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.value = freq;
  const o2 = ctx.createOscillator();
  o2.type = "triangle";
  o2.frequency.value = freq * 2;
  const g = ctx.createGain();
  const peak = 0.55 * vel;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(peak, when + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
  const g2 = ctx.createGain();
  g2.gain.value = 0.12 + drive * 0.2;

  const shaper = ctx.createWaveShaper();
  const n = 256;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * (1 + drive * 5));
  }
  shaper.curve = curve;

  o.connect(g);
  o2.connect(g2).connect(g);
  g.connect(shaper).connect(dest);
  o.start(when);
  o2.start(when);
  return {
    scheduleStop(at: number) {
      const rel = Math.max(at, when + 0.02);
      g.gain.cancelScheduledValues(rel);
      g.gain.setValueAtTime(Math.max(g.gain.value, 0.0002), rel);
      g.gain.exponentialRampToValueAtTime(0.0001, rel + 0.09);
      try { o.stop(rel + 0.12); } catch { /* noop */ }
      try { o2.stop(rel + 0.12); } catch { /* noop */ }
    },
    kill() {
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0.0001, now + 0.015);
      try { o.stop(now + 0.03); } catch { /* noop */ }
      try { o2.stop(now + 0.03); } catch { /* noop */ }
    },
  };
}

function playPluckBass(v: VoiceCtx): VoiceHandle {
  const { ctx, dest, freq, vel, when, p } = v;
  const punch = clamp(p.punch ?? 0.5, 0, 1);
  const tone = clamp(p.tone ?? 0.5, 0, 1);
  const filt = ctx.createBiquadFilter();
  filt.type = "lowpass";
  filt.Q.value = 2 + punch * 4;
  const hi = 400 + tone * 3200;
  filt.frequency.setValueAtTime(hi, when);
  filt.frequency.exponentialRampToValueAtTime(Math.max(freq * 1.5, 120), when + 0.16);

  const g = ctx.createGain();
  const peak = 0.42 * vel;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(peak, when + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.5);

  const oscs: OscillatorNode[] = [];
  const o1 = ctx.createOscillator();
  o1.type = "sawtooth";
  o1.frequency.value = freq;
  const o2 = ctx.createOscillator();
  o2.type = "square";
  o2.frequency.value = freq;
  const g2 = ctx.createGain();
  g2.gain.value = 0.4;
  o1.connect(filt);
  o2.connect(g2).connect(filt);
  o1.start(when);
  o2.start(when);
  oscs.push(o1, o2);
  filt.connect(g).connect(dest);
  return {
    scheduleStop(at: number) {
      const rel = Math.max(at, when + 0.03);
      g.gain.cancelScheduledValues(rel);
      g.gain.setValueAtTime(Math.max(g.gain.value, 0.0002), rel);
      g.gain.exponentialRampToValueAtTime(0.0001, rel + 0.12);
      oscs.forEach((o) => { try { o.stop(rel + 0.15); } catch { /* noop */ } });
    },
    kill() {
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0.0001, now + 0.015);
      oscs.forEach((o) => { try { o.stop(now + 0.03); } catch { /* noop */ } });
    },
  };
}

function play808(v: VoiceCtx): VoiceHandle {
  const { ctx, dest, freq, vel, when, p } = v;
  const decay = clamp(p.decay ?? 1.0, 0.2, 3);
  const drive = clamp(p.drive ?? 0.3, 0, 1);
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(freq * 2.2, when);
  o.frequency.exponentialRampToValueAtTime(freq, when + 0.055);

  const g = ctx.createGain();
  const peak = 0.65 * vel;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(peak, when + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, when + decay);

  const shaper = ctx.createWaveShaper();
  const n = 256;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * (1 + drive * 6));
  }
  shaper.curve = curve;

  o.connect(g).connect(shaper).connect(dest);
  o.start(when);
  return {
    scheduleStop(at: number) {
      const rel = Math.max(at, when + 0.05);
      g.gain.cancelScheduledValues(rel);
      g.gain.setValueAtTime(Math.max(g.gain.value, 0.0002), rel);
      g.gain.exponentialRampToValueAtTime(0.0001, rel + 0.15);
      try { o.stop(rel + 0.2); } catch { /* noop */ }
    },
    kill() {
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0.0001, now + 0.015);
      try { o.stop(now + 0.03); } catch { /* noop */ }
    },
  };
}

// ---------- Karplus-Strong guitar ----------
const ksCache = new Map<string, Float32Array>();

function ksString(freq: number, damp: number, bright: number, seed = 1): Float32Array {
  const key = `${Math.round(freq)}|${damp.toFixed(2)}|${bright.toFixed(2)}`;
  const cached = ksCache.get(key);
  if (cached) return cached;
  const sr = 44100;
  const N = Math.max(2, Math.round(sr / freq));
  const dur = 3.2;
  const len = Math.floor(sr * dur);
  const out = new Float32Array(len);
  const buf = new Float32Array(N);
  // seed noise excitation with lowpass for softness
  let rndState = (Math.round(freq) * 2654435761 + seed) >>> 0;
  const rand = () => {
    rndState = (rndState * 1664525 + 1013904223) >>> 0;
    return (rndState / 4294967296) * 2 - 1;
  };
  let lp = 0;
  for (let i = 0; i < N; i++) {
    const white = rand();
    lp = lp + bright * (white - lp);
    buf[i] = lp;
  }
  // pick-direction comb for pluck character
  const pick = Math.floor(N * 0.28);
  for (let i = pick; i < N; i++) buf[i] *= 0.55;

  let idx = 0;
  let last = 0;
  const decay = damp; // 0.994..0.9995
  for (let i = 0; i < len; i++) {
    const cur = buf[idx];
    const nxt = buf[(idx + 1) % N];
    const avg = (cur + nxt) * 0.5;
    const filtered = last + 0.6 * (avg - last); // extra body lowpass
    last = filtered;
    buf[idx] = filtered * decay;
    out[i] = cur;
    idx = (idx + 1) % N;
  }
  ksCache.set(key, out);
  return out;
}

function playGuitar(v: VoiceCtx): VoiceHandle {
  const { ctx, dest, freq, vel, when, p } = v;
  const tone = clamp(p.tone ?? 0.5, 0, 1); // brightness of excitation
  const damp = clamp(p.damp ?? 0.5, 0, 1); // decay length
  const data = ksString(freq, 0.9965 + damp * 0.003, 0.35 + tone * 0.6);
  const src = ctx.createBufferSource();
  const buf = ctx.createBuffer(1, data.length, 44100);
  buf.copyToChannel(new Float32Array(data), 0);
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = 0.55 * vel;
  const filt = ctx.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.value = 2800 + tone * 5200;
  src.connect(filt).connect(g).connect(dest);
  src.start(when);
  return {
    scheduleStop() { /* string decays naturally */ },
    kill() {
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0.0001, now + 0.015);
      try { src.stop(now + 0.03); } catch { /* noop */ }
    },
  };
}

function playMarimba(v: VoiceCtx): VoiceHandle {
  const { ctx, dest, freq, vel, when, p } = v;
  const tone = clamp(p.tone ?? 0.5, 0, 1);
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.value = freq;
  const o2 = ctx.createOscillator();
  o2.type = "sine";
  o2.frequency.value = freq * 4;
  const g = ctx.createGain();
  const peak = 0.5 * vel;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(peak, when + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.35 + tone * 0.3);
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(peak * 0.22, when);
  g2.gain.exponentialRampToValueAtTime(0.0001, when + 0.09);
  o.connect(g).connect(dest);
  o2.connect(g2).connect(dest);
  o.start(when);
  o2.start(when);
  return {
    scheduleStop(at: number) {
      const rel = Math.max(at, when + 0.02);
      [g, g2].forEach((gg) => {
        gg.gain.cancelScheduledValues(rel);
        gg.gain.setValueAtTime(Math.max(gg.gain.value, 0.0002), rel);
        gg.gain.exponentialRampToValueAtTime(0.0001, rel + 0.08);
      });
      try { o.stop(rel + 0.1); } catch { /* noop */ }
      try { o2.stop(rel + 0.1); } catch { /* noop */ }
    },
    kill() {
      const now = ctx.currentTime;
      [g, g2].forEach((gg) => {
        gg.gain.cancelScheduledValues(now);
        gg.gain.setValueAtTime(gg.gain.value, now);
        gg.gain.linearRampToValueAtTime(0.0001, now + 0.015);
      });
      try { o.stop(now + 0.03); } catch { /* noop */ }
      try { o2.stop(now + 0.03); } catch { /* noop */ }
    },
  };
}

function playCelesta(v: VoiceCtx): VoiceHandle {
  const { ctx, dest, freq, vel, when, p } = v;
  const tone = clamp(p.tone ?? 0.5, 0, 1);
  const carrier = ctx.createOscillator();
  carrier.type = "sine";
  carrier.frequency.value = freq;
  const mod = ctx.createOscillator();
  mod.type = "sine";
  mod.frequency.value = freq * 3.51;
  const modG = ctx.createGain();
  modG.gain.setValueAtTime(freq * 2.4 * tone, when);
  modG.gain.exponentialRampToValueAtTime(1, when + 0.12);
  mod.connect(modG).connect(carrier.frequency);
  const g = ctx.createGain();
  const peak = 0.4 * vel;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(peak, when + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 1.4);
  carrier.connect(g).connect(dest);
  carrier.start(when);
  mod.start(when);
  return {
    scheduleStop(at: number) {
      const rel = Math.max(at, when + 0.02);
      g.gain.cancelScheduledValues(rel);
      g.gain.setValueAtTime(Math.max(g.gain.value, 0.0002), rel);
      g.gain.exponentialRampToValueAtTime(0.0001, rel + 0.25);
      try { carrier.stop(rel + 0.3); } catch { /* noop */ }
      try { mod.stop(rel + 0.3); } catch { /* noop */ }
    },
    kill() {
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0.0001, now + 0.015);
      try { carrier.stop(now + 0.03); } catch { /* noop */ }
      try { mod.stop(now + 0.03); } catch { /* noop */ }
    },
  };
}

function playFlute(v: VoiceCtx): VoiceHandle {
  const { ctx, dest, freq, vel, when, p } = v;
  const breath = clamp(p.breath ?? 0.3, 0, 1);
  const vib = clamp(p.vibrato ?? 0.3, 0, 1);
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.value = freq;
  const g = ctx.createGain();
  const peak = 0.32 * vel;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(peak, when + 0.09);
  // breath noise
  const nb = ctx.createBufferSource();
  const nlen = Math.floor(ctx.sampleRate * 0.5);
  const nbuf = ctx.createBuffer(1, nlen, ctx.sampleRate);
  const nd = nbuf.getChannelData(0);
  for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;
  nb.buffer = nbuf;
  nb.loop = true;
  const nf = ctx.createBiquadFilter();
  nf.type = "bandpass";
  nf.frequency.value = freq * 2.4;
  nf.Q.value = 1.5;
  const ng = ctx.createGain();
  ng.gain.value = breath * 0.05;
  nb.connect(nf).connect(ng).connect(dest);
  // vibrato
  const vfo = ctx.createOscillator();
  vfo.frequency.value = 5;
  const vfoG = ctx.createGain();
  vfoG.gain.value = vib * 7;
  vfo.connect(vfoG).connect(o.detune);
  o.connect(g).connect(dest);
  o.start(when);
  vfo.start(when);
  nb.start(when);
  return {
    scheduleStop(at: number) {
      const rel = Math.max(at, when + 0.1);
      g.gain.cancelScheduledValues(rel);
      g.gain.setValueAtTime(Math.max(g.gain.value, 0.0002), rel);
      g.gain.exponentialRampToValueAtTime(0.0001, rel + 0.14);
      ng.gain.linearRampToValueAtTime(0.0001, rel + 0.1);
      [o, vfo, nb].forEach((x) => { try { x.stop(rel + 0.2); } catch { /* noop */ } });
    },
    kill() {
      const now = ctx.currentTime;
      [g, ng].forEach((gg) => {
        gg.gain.cancelScheduledValues(now);
        gg.gain.setValueAtTime(gg.gain.value, now);
        gg.gain.linearRampToValueAtTime(0.0001, now + 0.015);
      });
      [o, vfo, nb].forEach((x) => { try { x.stop(now + 0.03); } catch { /* noop */ } });
    },
  };
}

function playChip(v: VoiceCtx): VoiceHandle {
  const { ctx, dest, freq, vel, when, p } = v;
  const duty = clamp(p.duty ?? 0.25, 0.1, 0.5);
  const n = 32;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    imag[i] = (2 / (i * Math.PI)) * Math.sin(Math.PI * i * duty);
  }
  const wave = ctx.createPeriodicWave(real, imag);
  const o = ctx.createOscillator();
  o.setPeriodicWave(wave);
  o.frequency.value = freq;
  const g = ctx.createGain();
  const peak = 0.18 * vel;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(peak, when + 0.004);
  g.gain.setValueAtTime(peak, Math.max(when + 0.004, when + 0.25));
  o.connect(g).connect(dest);
  o.start(when);
  return {
    scheduleStop(at: number) {
      const rel = Math.max(at, when + 0.01);
      g.gain.cancelScheduledValues(rel);
      g.gain.setValueAtTime(Math.max(g.gain.value, 0.0002), rel);
      g.gain.exponentialRampToValueAtTime(0.0001, rel + 0.06);
      try { o.stop(rel + 0.08); } catch { /* noop */ }
    },
    kill() {
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0.0001, now + 0.015);
      try { o.stop(now + 0.03); } catch { /* noop */ }
    },
  };
}

// ============================================================
// Drum synthesis
// ============================================================

export const DRUM_MAP: Record<number, string> = {
  36: "Kick",
  38: "Snare",
  42: "Hi-Hat",
  46: "Open Hat",
  39: "Clap",
  43: "Low Tom",
  45: "Mid Tom",
  47: "Hi Tom",
  49: "Crash",
  51: "Ride",
  37: "Rim",
  56: "Cowbell",
};

function noiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return buf;
}

function playAcousticDrum(v: VoiceCtx, piece: string): VoiceHandle {
  const { ctx, dest, vel, when, p } = v;
  const tune = clamp(p.tune ?? 0.5, 0, 1);
  const snap = clamp(p.snap ?? 0.5, 0, 1);
  const decay = clamp(p.decay ?? 0.5, 0, 1);
  const out = ctx.createGain();
  out.gain.value = 0.9;
  out.connect(dest);
  const sources: AudioScheduledSourceNode[] = [];
  const rate = 0.85 + tune * 0.35;

  const env = (peak: number, dc: number) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(peak * vel, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dc);
    return g;
  };

  switch (piece) {
    case "Kick": {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(160 * rate, when);
      o.frequency.exponentialRampToValueAtTime(48 * rate, when + 0.09);
      const g = env(1.0, 0.32 + decay * 0.25);
      o.connect(g).connect(out);
      o.start(when);
      o.stop(when + 0.7);
      sources.push(o);
      if (snap > 0.15) {
        const n = ctx.createBufferSource();
        n.buffer = noiseBuffer(ctx, 0.03);
        const nf = ctx.createBiquadFilter();
        nf.type = "highpass";
        nf.frequency.value = 1500;
        const ng = env(snap * 0.4, 0.025);
        n.connect(nf).connect(ng).connect(out);
        n.start(when);
        sources.push(n);
      }
      break;
    }
    case "Snare": {
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer(ctx, 0.3);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1900 * rate;
      bp.Q.value = 0.8;
      const ng = env(0.55, 0.16 + decay * 0.12);
      n.connect(bp).connect(ng).connect(out);
      n.start(when);
      sources.push(n);
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(240 * rate, when);
      o.frequency.exponentialRampToValueAtTime(170 * rate, when + 0.08);
      const og = env(0.4, 0.09);
      o.connect(og).connect(out);
      o.start(when);
      o.stop(when + 0.2);
      sources.push(o);
      break;
    }
    case "Hi-Hat":
    case "Open Hat": {
      const open = piece === "Open Hat";
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer(ctx, 0.6);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 7200 * rate;
      const g = env(0.35, open ? 0.32 + decay * 0.3 : 0.055);
      n.connect(hp).connect(g).connect(out);
      n.start(when);
      sources.push(n);
      break;
    }
    case "Clap": {
      for (let i = 0; i < 3; i++) {
        const n = ctx.createBufferSource();
        n.buffer = noiseBuffer(ctx, 0.15);
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 1400 * rate;
        bp.Q.value = 1.6;
        const g = ctx.createGain();
        const t0 = when + i * 0.012;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(0.4 * vel, t0 + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + (i === 2 ? 0.18 : 0.03));
        n.connect(bp).connect(g).connect(out);
        n.start(t0);
        sources.push(n);
      }
      break;
    }
    case "Low Tom":
    case "Mid Tom":
    case "Hi Tom": {
      const f = piece === "Low Tom" ? 130 : piece === "Mid Tom" ? 190 : 260;
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(f * 1.4 * rate, when);
      o.frequency.exponentialRampToValueAtTime(f * rate, when + 0.12);
      const g = env(0.6, 0.3 + decay * 0.2);
      o.connect(g).connect(out);
      o.start(when);
      o.stop(when + 0.6);
      sources.push(o);
      break;
    }
    case "Crash":
    case "Ride": {
      const isCrash = piece === "Crash";
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer(ctx, 2.2);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = (isCrash ? 4500 : 3800) * rate;
      const g = env(isCrash ? 0.32 : 0.2, isCrash ? 1.4 + decay : 0.7 + decay * 0.6);
      n.connect(hp).connect(g).connect(out);
      n.start(when);
      sources.push(n);
      if (!isCrash) {
        // ride ping
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = 1050 * rate;
        const og = env(0.12, 0.5);
        o.connect(og).connect(out);
        o.start(when);
        o.stop(when + 0.6);
        sources.push(o);
      }
      break;
    }
    case "Rim": {
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.value = 1700 * rate;
      const g = env(0.25, 0.03);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1700 * rate;
      bp.Q.value = 3;
      o.connect(bp).connect(g).connect(out);
      o.start(when);
      o.stop(when + 0.1);
      sources.push(o);
      break;
    }
    case "Cowbell": {
      for (const f of [545, 815]) {
        const o = ctx.createOscillator();
        o.type = "square";
        o.frequency.value = f * rate;
        const g = env(0.2, 0.25);
        o.connect(g).connect(out);
        o.start(when);
        o.stop(when + 0.35);
        sources.push(o);
      }
      break;
    }
    default: {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = 220;
      const g = env(0.4, 0.2);
      o.connect(g).connect(out);
      o.start(when);
      o.stop(when + 0.3);
      sources.push(o);
    }
  }
  return {
    scheduleStop() { /* drums are one-shots */ },
    kill() {
      const now = ctx.currentTime;
      out.gain.cancelScheduledValues(now);
      out.gain.setValueAtTime(out.gain.value, now);
      out.gain.linearRampToValueAtTime(0.0001, now + 0.012);
      sources.forEach((s) => { try { s.stop(now + 0.025); } catch { /* noop */ } });
    },
  };
}

function play808Drum(v: VoiceCtx, piece: string): VoiceHandle {
  const { ctx, dest, vel, when, p } = v;
  const tune = clamp(p.tune ?? 0.5, 0, 1);
  const decay = clamp(p.decay ?? 0.5, 0, 1);
  const snap = clamp(p.snap ?? 0.4, 0, 1);
  const out = ctx.createGain();
  out.gain.value = 0.95;
  out.connect(dest);
  const sources: AudioScheduledSourceNode[] = [];
  const rate = 0.85 + tune * 0.35;

  const env = (peak: number, dc: number, a = 0.002) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(peak * vel, when + a);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dc);
    return g;
  };

  switch (piece) {
    case "Kick": {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(130 * rate, when);
      o.frequency.exponentialRampToValueAtTime(38 * rate, when + 0.16);
      const g = env(1.1, 0.5 + decay * 0.7);
      const sh = ctx.createWaveShaper();
      const curve = new Float32Array(128);
      for (let i = 0; i < 128; i++) curve[i] = Math.tanh(((i / 127) * 2 - 1) * 3);
      sh.curve = curve;
      o.connect(g).connect(sh).connect(out);
      o.start(when);
      o.stop(when + 1.6);
      sources.push(o);
      break;
    }
    case "Snare": {
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer(ctx, 0.35);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 1200 * rate;
      const ng = env(0.45, 0.14 + decay * 0.1);
      n.connect(hp).connect(ng).connect(out);
      n.start(when);
      sources.push(n);
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(200 * rate, when);
      o.frequency.exponentialRampToValueAtTime(150 * rate, when + 0.1);
      const og = env(0.3, 0.1);
      o.connect(og).connect(out);
      o.start(when);
      o.stop(when + 0.25);
      sources.push(o);
      break;
    }
    case "Clap": {
      for (let i = 0; i < 4; i++) {
        const n = ctx.createBufferSource();
        n.buffer = noiseBuffer(ctx, 0.2);
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 1100 * rate;
        bp.Q.value = 2;
        const g = ctx.createGain();
        const t0 = when + i * 0.01;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(0.42 * vel, t0 + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + (i === 3 ? 0.2 : 0.025));
        n.connect(bp).connect(g).connect(out);
        n.start(t0);
        sources.push(n);
      }
      break;
    }
    case "Hi-Hat":
    case "Open Hat": {
      const open = piece === "Open Hat";
      // 808 hats: 6 stacked square oscs through bandpass + highpass
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 10000 * rate;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 7000 * rate;
      const g = env(0.22 + snap * 0.12, open ? 0.4 + decay * 0.4 : 0.05);
      bp.connect(hp).connect(g).connect(out);
      for (const f of [263, 400, 421, 474, 587, 845]) {
        const o = ctx.createOscillator();
        o.type = "square";
        o.frequency.value = f * rate;
        o.connect(bp);
        o.start(when);
        o.stop(when + (open ? 1 : 0.15));
        sources.push(o);
      }
      break;
    }
    case "Cowbell": {
      for (const f of [560, 845]) {
        const o = ctx.createOscillator();
        o.type = "square";
        o.frequency.value = f * rate;
        const g = env(0.25, 0.3 + decay * 0.2);
        o.connect(g).connect(out);
        o.start(when);
        o.stop(when + 0.5);
        sources.push(o);
      }
      break;
    }
    case "Crash":
    case "Ride": {
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer(ctx, 1.8);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 5000 * rate;
      const g = env(piece === "Crash" ? 0.3 : 0.18, 1.2 + decay * 0.5);
      n.connect(hp).connect(g).connect(out);
      n.start(when);
      sources.push(n);
      break;
    }
    default:
      return playAcousticDrum(v, piece);
  }
  return {
    scheduleStop() { /* one-shots */ },
    kill() {
      const now = ctx.currentTime;
      out.gain.cancelScheduledValues(now);
      out.gain.setValueAtTime(out.gain.value, now);
      out.gain.linearRampToValueAtTime(0.0001, now + 0.012);
      sources.forEach((s) => { try { s.stop(now + 0.025); } catch { /* noop */ } });
    },
  };
}

// ============================================================
// Patch registry
// ============================================================

export const PATCHES: Record<string, Patch> = {
  "grand-piano": {
    id: "grand-piano",
    name: "Grand Piano",
    category: "Piano & Keys",
    icon: "piano",
    desc: "Velocity-layered, multi-sampled concert grand piano",
    knobs: [k("brightness", "Tone", 0, 1, 0.6), k("release", "Release", 0.05, 1.5, 0.12, { unit: "s" }), ...SEND_KNOBS],
  },
  "bright-piano": {
    id: "bright-piano",
    name: "Bright Piano",
    category: "Piano & Keys",
    icon: "piano",
    desc: "Bright velocity-layered sampled grand piano",
    knobs: [k("brightness", "Tone", 0, 1, 0.92), k("release", "Release", 0.05, 1.5, 0.1, { unit: "s" }), ...SEND_KNOBS],
  },
  "stage-epiano": {
    id: "stage-epiano",
    name: "Stage Electric Piano",
    category: "Piano & Keys",
    icon: "piano",
    desc: "Vintage tine electric piano",
    knobs: [k("tine", "Tine", 0, 1, 0.55), k("tremolo", "Tremolo", 0, 1, 0.2), ...SEND_KNOBS],
  },
  "saw-lead": {
    id: "saw-lead",
    name: "Analog Saw Lead",
    category: "Synthesizer",
    icon: "audio-waveform",
    desc: "Fat detuned lead synth",
    knobs: [
      k("cutoff", "Cutoff", 120, 12000, 4200, { curve: "log", unit: "Hz" }),
      k("resonance", "Reso", 0.5, 18, 4),
      k("attack", "Attack", 0.002, 0.8, 0.012, { unit: "s", curve: "log" }),
      k("release", "Release", 0.02, 2, 0.24, { unit: "s", curve: "log" }),
      ...SEND_KNOBS,
    ],
  },
  "warm-pad": {
    id: "warm-pad",
    name: "Warm Analog Pad",
    category: "Synthesizer",
    icon: "audio-waveform",
    desc: "Lush evolving pad",
    knobs: [
      k("cutoff", "Cutoff", 150, 9000, 2200, { curve: "log", unit: "Hz" }),
      k("attack", "Attack", 0.05, 3, 0.6, { unit: "s" }),
      k("release", "Release", 0.1, 4, 1.4, { unit: "s" }),
      k("shimmer", "Shimmer", 0, 1, 0.4),
      ...SEND_KNOBS,
    ],
  },
  "retro-chip": {
    id: "retro-chip",
    name: "Retro Chip Lead",
    category: "Synthesizer",
    icon: "gamepad-2",
    desc: "8-bit pulse wave",
    knobs: [k("duty", "Pulse", 0.1, 0.5, 0.25), ...SEND_KNOBS],
  },
  "sub-bass": {
    id: "sub-bass",
    name: "Deep Sub Bass",
    category: "Bass",
    icon: "speaker",
    desc: "Clean sub sine bass",
    knobs: [k("drive", "Drive", 0, 1, 0.2), k("decay", "Decay", 0.1, 2.5, 0.6, { unit: "s" }), ...SEND_KNOBS],
  },
  "pluck-bass": {
    id: "pluck-bass",
    name: "Fingered Bass",
    category: "Bass",
    icon: "speaker",
    desc: "Plucked electric bass",
    knobs: [k("punch", "Punch", 0, 1, 0.55), k("tone", "Tone", 0, 1, 0.5), ...SEND_KNOBS],
  },
  "808-bass": {
    id: "808-bass",
    name: "808 Bass",
    category: "Bass",
    icon: "speaker",
    desc: "Hip-hop sub with glide",
    knobs: [k("decay", "Decay", 0.2, 3, 1.0, { unit: "s" }), k("drive", "Drive", 0, 1, 0.3), ...SEND_KNOBS],
  },
  "string-ensemble": {
    id: "string-ensemble",
    name: "String Ensemble",
    category: "Orchestral",
    icon: "music",
    desc: "Looped, sampled orchestral string ensemble",
    knobs: [k("brightness", "Tone", 0, 1, 0.5), k("vibrato", "Vibrato", 0, 1, 0.35), ...SEND_KNOBS],
  },
  "tonewheel-organ": {
    id: "tonewheel-organ",
    name: "Tonewheel Organ",
    category: "Piano & Keys",
    icon: "piano",
    desc: "Drawbar organ",
    knobs: [k("harmonics", "Drawbars", 0, 1, 0.5), k("chorale", "Chorale", 0, 1, 0.3), ...SEND_KNOBS],
  },
  "nylon-guitar": {
    id: "nylon-guitar",
    name: "Nylon Guitar",
    category: "Guitar",
    icon: "guitar",
    desc: "Soft classical strings",
    knobs: [k("tone", "Tone", 0, 1, 0.45), k("damp", "Sustain", 0, 1, 0.55), ...SEND_KNOBS],
  },
  "steel-guitar": {
    id: "steel-guitar",
    name: "Steel-String Guitar",
    category: "Guitar",
    icon: "guitar",
    desc: "Bright acoustic pluck",
    knobs: [k("tone", "Tone", 0, 1, 0.75), k("damp", "Sustain", 0, 1, 0.6), ...SEND_KNOBS],
  },
  marimba: {
    id: "marimba",
    name: "Marimba",
    category: "Mallets",
    icon: "grid-3x3",
    desc: "Wooden mallet tones",
    knobs: [k("tone", "Tone", 0, 1, 0.5), ...SEND_KNOBS],
  },
  celesta: {
    id: "celesta",
    name: "Celesta & Bells",
    category: "Mallets",
    icon: "bell",
    desc: "Sparkling bell tones",
    knobs: [k("tone", "Tone", 0, 1, 0.5), ...SEND_KNOBS],
  },
  "wood-flute": {
    id: "wood-flute",
    name: "Wood Flute",
    category: "Orchestral",
    icon: "wind",
    desc: "Breathy flute",
    knobs: [k("breath", "Breath", 0, 1, 0.3), k("vibrato", "Vibrato", 0, 1, 0.3), ...SEND_KNOBS],
  },
  "drum-kit": {
    id: "drum-kit",
    name: "Acoustic Drums",
    category: "Drums",
    icon: "drum",
    desc: "Full acoustic kit",
    isDrum: true,
    knobs: [k("tune", "Tune", 0, 1, 0.5), k("snap", "Snap", 0, 1, 0.5), k("decay", "Decay", 0, 1, 0.5), ...SEND_KNOBS],
  },
  "808-kit": {
    id: "808-kit",
    name: "808 Electronic Kit",
    category: "Drums",
    icon: "drum",
    desc: "Classic drum machine",
    isDrum: true,
    knobs: [k("tune", "Tune", 0, 1, 0.5), k("snap", "Snap", 0, 1, 0.4), k("decay", "Decay", 0, 1, 0.5), ...SEND_KNOBS],
  },
};

export const PATCH_CATEGORIES = Array.from(
  new Set(Object.values(PATCHES).map((p) => p.category))
);

/** Default param values for a patch */
export function defaultParams(patchId: string): Record<string, number> {
  const patch = PATCHES[patchId];
  if (!patch) return { reverb: 0.12, delay: 0 };
  const p: Record<string, number> = {};
  for (const kn of patch.knobs) p[kn.id] = kn.def;
  return p;
}

/** Play one note on any patch. Returns a voice handle. */
export function playNote(
  ctx: BaseAudioContext,
  dest: AudioNode,
  patchId: string,
  pitch: number,
  velocity: number,
  when: number,
  dur: number,
  params: Params
): VoiceHandle {
  const freq = midiToFreq(pitch);
  const safeVelocity = clamp(velocity, 0.02, 1);
  if (patchId === "grand-piano" || patchId === "bright-piano" || patchId === "string-ensemble") {
    const sampled = playSampledNote(ctx, dest, patchId, pitch, safeVelocity, when, dur, params);
    if (sampled) return sampled;
  }
  const vc: VoiceCtx = { ctx, dest, freq, vel: safeVelocity, when, dur, p: params };
  switch (patchId) {
    case "grand-piano":
    case "bright-piano":
      return playPiano(vc);
    case "stage-epiano":
      return playEPiano(vc);
    case "saw-lead":
      return playLead(vc);
    case "warm-pad":
      return playPad(vc);
    case "string-ensemble":
      return playStrings(vc);
    case "tonewheel-organ":
      return playOrgan(vc);
    case "sub-bass":
      return playSubBass(vc);
    case "pluck-bass":
      return playPluckBass(vc);
    case "808-bass":
      return play808(vc);
    case "nylon-guitar":
    case "steel-guitar":
      return playGuitar(vc);
    case "marimba":
      return playMarimba(vc);
    case "celesta":
      return playCelesta(vc);
    case "wood-flute":
      return playFlute(vc);
    case "retro-chip":
      return playChip(vc);
    case "drum-kit": {
      const piece = DRUM_MAP[pitch] ?? "Snare";
      return playAcousticDrum(vc, piece);
    }
    case "808-kit": {
      const piece = DRUM_MAP[pitch] ?? "Snare";
      return play808Drum(vc, piece);
    }
    default:
      return playPiano(vc);
  }
}
