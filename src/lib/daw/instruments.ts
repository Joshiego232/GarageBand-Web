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

function soundfontPatch(
  id: string,
  name: string,
  category: string,
  instrument: string,
  icon: string,
  desc: string,
  options: { loop?: boolean; brightness?: number; release?: number } = {}
): Patch {
  return {
    id,
    name,
    category,
    icon,
    desc,
    sampled: {
      engine: "soundfont",
      instrument,
      kit: "MusyngKite",
      loop: options.loop ?? false,
    },
    knobs: [
      k("brightness", "Tone", 0, 1, options.brightness ?? 0.68),
      k("release", "Release", 0.05, 2.5, options.release ?? 0.28, { unit: "s" }),
      ...SEND_KNOBS,
    ],
  };
}

function electricPianoPatch(
  id: string,
  name: string,
  instrument: string,
  desc: string
): Patch {
  return {
    id,
    name,
    category: "Piano & Keys",
    icon: "piano",
    desc,
    sampled: { engine: "electric-piano", instrument },
    knobs: [
      k("brightness", "Tone", 0, 1, 0.7),
      k("release", "Release", 0.05, 1.5, 0.22, { unit: "s" }),
      ...SEND_KNOBS,
    ],
  };
}

function drumMachinePatch(
  id: string,
  name: string,
  instrument: string,
  desc: string
): Patch {
  return {
    id,
    name,
    category: "Drums & Percussion",
    icon: "drum",
    desc,
    isDrum: true,
    sampled: { engine: "drum-machine", instrument },
    knobs: [
      k("brightness", "Tone", 0, 1, 0.72),
      ...SEND_KNOBS,
    ],
  };
}

const morphWaveCache = new WeakMap<BaseAudioContext, Map<string, PeriodicWave>>();

function morphPeriodicWave(
  ctx: BaseAudioContext,
  morph: number,
  harmonics: number
): PeriodicWave {
  const morphStep = Math.round(morph * 24);
  const harmonicStep = Math.round(harmonics * 24);
  const key = `${morphStep}:${harmonicStep}`;
  let cache = morphWaveCache.get(ctx);
  if (!cache) {
    cache = new Map();
    morphWaveCache.set(ctx, cache);
  }
  const cached = cache.get(key);
  if (cached) return cached;

  const m = morphStep / 24;
  const h = harmonicStep / 24;
  const count = 64;
  const real = new Float32Array(count);
  const imag = new Float32Array(count);

  for (let partial = 1; partial < count; partial++) {
    const n = partial;
    const saw = 1 / n;
    const oddOrgan = n % 2 === 1 ? 1 / n : 0;
    const bell = Math.exp(-Math.pow((Math.log(n) - 1.35) / 0.78, 2)) / Math.sqrt(n);
    const glass = Math.exp(-Math.pow((n - (2 + m * 25)) / (1.4 + m * 2.8), 2)) / Math.sqrt(n);
    const organBell = oddOrgan * (1 - m) + bell * m;
    const spectral = organBell * (1 - m * 0.55) + glass * m * 0.55;
    const body = saw * (1 - m) + spectral * m;
    const rolloff = Math.pow(1 - (n - 1) / count, 0.3 + (1 - h) * 2.4);
    imag[partial] = body * rolloff * (0.35 + h * 1.65);
  }

  const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  cache.set(key, wave);
  return wave;
}

function playMorphAdditive(v: VoiceCtx): VoiceHandle {
  const { ctx, dest, freq, vel, when, p } = v;
  const morph = clamp(p.morph ?? 0.5, 0, 1);
  const harmonics = clamp(p.harmonics ?? 0.7, 0.1, 1);
  const cutoff = clamp(p.cutoff ?? 6000, 80, 16000);
  const resonance = clamp(p.resonance ?? 1.2, 0.1, 16);
  const attack = clamp(p.attack ?? 0.03, 0.001, 4);
  const decay = clamp(p.decay ?? 0.45, 0.02, 5);
  const sustain = clamp(p.sustain ?? 0.65, 0, 1);
  const release = clamp(p.release ?? 0.5, 0.03, 8);
  const detune = clamp(p.detune ?? 6, 0, 40);
  const subLevel = clamp(p.sub ?? 0.1, 0, 1);
  const lfoRate = clamp(p.lfoRate ?? 0.25, 0.05, 12);
  const lfoDepth = clamp(p.lfoDepth ?? 0.1, 0, 1);
  const noiseLevel = clamp(p.noise ?? 0, 0, 1);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = resonance;
  const envelopePeak = Math.min(18000, cutoff * (1.2 + (1 - sustain) * 2.2));
  filter.frequency.setValueAtTime(Math.max(80, cutoff * 0.45), when);
  filter.frequency.exponentialRampToValueAtTime(Math.max(90, envelopePeak), when + attack);
  filter.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff), when + attack + decay);

  const amp = ctx.createGain();
  const peak = 0.28 * vel;
  const sustainLevel = Math.max(0.0002, peak * sustain);
  amp.gain.setValueAtTime(0.0001, when);
  amp.gain.linearRampToValueAtTime(peak, when + attack);
  amp.gain.exponentialRampToValueAtTime(sustainLevel, when + attack + decay);
  filter.connect(amp).connect(dest);

  const oscillators: OscillatorNode[] = [];
  const sources: AudioScheduledSourceNode[] = [];
  const main = ctx.createOscillator();
  main.setPeriodicWave(morphPeriodicWave(ctx, morph, harmonics));
  main.frequency.value = freq;
  main.connect(filter);
  main.start(when);
  oscillators.push(main);

  const unison = ctx.createOscillator();
  unison.type = "sawtooth";
  unison.frequency.value = freq;
  unison.detune.value = detune;
  const unisonGain = ctx.createGain();
  unisonGain.gain.value = 0.08 + detune * 0.004;
  unison.connect(unisonGain).connect(filter);
  unison.start(when);
  oscillators.push(unison);

  if (subLevel > 0.001) {
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.value = freq / 2;
    const subGain = ctx.createGain();
    subGain.gain.value = subLevel * 0.38;
    sub.connect(subGain).connect(filter);
    sub.start(when);
    oscillators.push(sub);
  }

  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = lfoRate;
  const filterLfo = ctx.createGain();
  filterLfo.gain.value = cutoff * 0.42 * lfoDepth;
  lfo.connect(filterLfo).connect(filter.frequency);
  lfo.start(when);
  oscillators.push(lfo);

  if (noiseLevel > 0.001) {
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx, 1.5);
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "highpass";
    noiseFilter.frequency.value = 900 + morph * 2800;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = noiseLevel * 0.075 * vel;
    noise.connect(noiseFilter).connect(noiseGain).connect(filter);
    noise.start(when);
    sources.push(noise);
  }

  const stopSources = (at: number) => {
    for (const source of [...oscillators, ...sources]) {
      try { source.stop(at); } catch { /* already stopped */ }
    }
  };

  return {
    scheduleStop(at: number) {
      const releaseAt = Math.max(at, when + attack * 0.5);
      amp.gain.cancelScheduledValues(releaseAt);
      amp.gain.setValueAtTime(Math.max(amp.gain.value, 0.0002), releaseAt);
      amp.gain.exponentialRampToValueAtTime(0.0001, releaseAt + release);
      stopSources(releaseAt + release + 0.04);
    },
    kill() {
      const now = ctx.currentTime;
      amp.gain.cancelScheduledValues(now);
      amp.gain.setValueAtTime(Math.max(amp.gain.value, 0.0002), now);
      amp.gain.linearRampToValueAtTime(0.0001, now + 0.018);
      stopSources(now + 0.04);
    },
  };
}

function morphSynthPatch(
  id: string,
  name: string,
  desc: string,
  defaults: {
    morph: number;
    harmonics: number;
    cutoff: number;
    resonance: number;
    attack: number;
    decay: number;
    sustain: number;
    release: number;
    detune: number;
    sub: number;
    lfoRate: number;
    lfoDepth: number;
    noise: number;
  }
): Patch {
  return {
    id,
    name,
    category: "Alchemy Synth",
    icon: "audio-waveform",
    desc,
    synthEngine: "morph-additive",
    knobs: [
      k("morph", "Spectral Morph", 0, 1, defaults.morph),
      k("harmonics", "Harmonics", 0.1, 1, defaults.harmonics),
      k("cutoff", "Filter Cutoff", 80, 16000, defaults.cutoff, { curve: "log", unit: "Hz" }),
      k("resonance", "Resonance", 0.1, 16, defaults.resonance),
      k("attack", "Attack", 0.001, 4, defaults.attack, { unit: "s" }),
      k("decay", "Decay", 0.02, 5, defaults.decay, { unit: "s" }),
      k("sustain", "Sustain", 0, 1, defaults.sustain),
      k("release", "Release", 0.03, 8, defaults.release, { unit: "s" }),
      k("detune", "Unison Detune", 0, 40, defaults.detune, { unit: "ct" }),
      k("sub", "Sub Layer", 0, 1, defaults.sub),
      k("lfoRate", "LFO Rate", 0.05, 12, defaults.lfoRate, { unit: "Hz" }),
      k("lfoDepth", "LFO Depth", 0, 1, defaults.lfoDepth),
      k("noise", "Noise Layer", 0, 1, defaults.noise),
      ...SEND_KNOBS,
    ],
  };
}

export const PATCHES: Record<string, Patch> = {
  // Piano & Keys — ten playable sampled instruments
  "grand-piano": {
    id: "grand-piano",
    name: "Concert Grand Piano",
    category: "Piano & Keys",
    icon: "piano",
    desc: "Detailed multi-sampled concert grand piano",
    sampled: { engine: "splendid-piano", instrument: "grand-piano" },
    knobs: [
      k("brightness", "Tone", 0, 1, 0.72),
      k("release", "Release", 0.05, 1.5, 0.18, { unit: "s" }),
      ...SEND_KNOBS,
    ],
  },
  "bright-piano": soundfontPatch("bright-piano", "Bright Acoustic Piano", "Piano & Keys", "bright_acoustic_piano", "piano", "Bright, forward acoustic piano"),
  "stage-epiano": electricPianoPatch("stage-epiano", "Wurlitzer EP-200", "WurlitzerEP200", "Biting, warm sampled Wurlitzer electric piano"),
  "cp80-ep": electricPianoPatch("cp80-ep", "Yamaha CP-80", "CP80", "Bright sampled CP-80 electric grand"),
  "pianet-t-ep": electricPianoPatch("pianet-t-ep", "Hohner Pianet T", "PianetT", "Soft, bell-like sampled Pianet electric piano"),
  "tx81z-ep": electricPianoPatch("tx81z-ep", "FM Electric Piano", "TX81Z", "Sampled FM electric piano from the VCSL library"),
  "electric-grand": soundfontPatch("electric-grand", "Electric Grand Piano", "Piano & Keys", "electric_grand_piano", "piano", "Clear, bright electric grand piano"),
  "honky-tonk-piano": soundfontPatch("honky-tonk-piano", "Honky-Tonk Piano", "Piano & Keys", "honkytonk_piano", "piano", "Characterful detuned honky-tonk piano"),
  harpsichord: soundfontPatch("harpsichord", "Harpsichord", "Piano & Keys", "harpsichord", "piano", "Crisp plucked baroque keyboard"),
  clavinet: soundfontPatch("clavinet", "Clavinet", "Piano & Keys", "clavinet", "piano", "Percussive funk clavinet"),

  // Synthesizers — ten distinct General MIDI synth programs
  "saw-lead": soundfontPatch("saw-lead", "Analog Saw Lead", "Synthesizer", "lead_2_sawtooth", "audio-waveform", "Strong sawtooth lead synth", { loop: true, release: 0.32 }),
  "retro-chip": soundfontPatch("retro-chip", "Square Wave Lead", "Synthesizer", "lead_1_square", "gamepad-2", "Classic square-wave synth lead", { loop: true, release: 0.16 }),
  "lead-calliope": soundfontPatch("lead-calliope", "Calliope Lead", "Synthesizer", "lead_3_calliope", "audio-waveform", "Bright calliope-style synth"),
  "lead-chiff": soundfontPatch("lead-chiff", "Chiff Lead", "Synthesizer", "lead_4_chiff", "audio-waveform", "Breathy chiff synth lead"),
  "lead-charang": soundfontPatch("lead-charang", "Charang Lead", "Synthesizer", "lead_5_charang", "audio-waveform", "Buzzy digital synth lead"),
  "lead-voice": soundfontPatch("lead-voice", "Voice Lead", "Synthesizer", "lead_6_voice", "audio-waveform", "Vocal-like synth lead"),
  "lead-fifths": soundfontPatch("lead-fifths", "Fifths Lead", "Synthesizer", "lead_7_fifths", "audio-waveform", "Layered fifths synth voice"),
  "lead-bass": soundfontPatch("lead-bass", "Bass + Lead", "Synthesizer", "lead_8_bass__lead", "audio-waveform", "Combined bass and lead synthesizer"),
  "synth-brass-1": soundfontPatch("synth-brass-1", "Synth Brass 1", "Synthesizer", "synth_brass_1", "audio-waveform", "Classic analog-style synth brass", { loop: true }),
  "synth-brass-2": soundfontPatch("synth-brass-2", "Synth Brass 2", "Synthesizer", "synth_brass_2", "audio-waveform", "Bright layered synth brass", { loop: true }),

  // Worship Keys — ten pads, choirs and ambient keyboard layers
  "warm-pad": soundfontPatch("warm-pad", "Warm Worship Pad", "Worship Keys", "pad_2_warm", "audio-waveform", "Warm sustained pad for worship arrangements", { loop: true, release: 1.2 }),
  "choir-ahs": soundfontPatch("choir-ahs", "Choir Aahs", "Worship Keys", "choir_aahs", "music", "Sampled choir vowel ensemble", { loop: true, release: 0.9 }),
  "voice-oohs": soundfontPatch("voice-oohs", "Voice Oohs", "Worship Keys", "voice_oohs", "music", "Soft sampled vocal ooh texture", { loop: true, release: 0.9 }),
  "synth-choir": soundfontPatch("synth-choir", "Synth Choir", "Worship Keys", "synth_choir", "music", "Blended synthetic choir texture", { loop: true }),
  "pad-new-age": soundfontPatch("pad-new-age", "New Age Pad", "Worship Keys", "pad_1_new_age", "audio-waveform", "Soft evolving ambient pad", { loop: true, release: 1.1 }),
  "pad-polysynth": soundfontPatch("pad-polysynth", "Poly Synth Pad", "Worship Keys", "pad_3_polysynth", "audio-waveform", "Wide polyphonic synth pad", { loop: true }),
  "pad-choir": soundfontPatch("pad-choir", "Choir Pad", "Worship Keys", "pad_4_choir", "music", "Choir-infused sustained pad", { loop: true, release: 1 }),
  "pad-bowed": soundfontPatch("pad-bowed", "Bowed Pad", "Worship Keys", "pad_5_bowed", "audio-waveform", "Slow bowed synth texture", { loop: true, release: 1.2 }),
  "pad-halo": soundfontPatch("pad-halo", "Halo Pad", "Worship Keys", "pad_7_halo", "audio-waveform", "Airy halo-style ambient layer", { loop: true, release: 1.2 }),
  "pad-sweep": soundfontPatch("pad-sweep", "Sweep Pad", "Worship Keys", "pad_8_sweep", "audio-waveform", "Slow-moving sweeping pad", { loop: true, release: 1.1 }),

  // Organs & Free-Reed — ten keyboard-friendly organ-family sounds
  "tonewheel-organ": soundfontPatch("tonewheel-organ", "Tonewheel Drawbar Organ", "Organs", "drawbar_organ", "piano", "Drawbar tonewheel organ with a full fundamental", { loop: true, release: 0.12 }),
  "church-organ": soundfontPatch("church-organ", "Church Pipe Organ", "Organs", "church_organ", "piano", "Sustained pipe-organ registration", { loop: true, release: 0.3 }),
  "percussive-organ": soundfontPatch("percussive-organ", "Percussive Organ", "Organs", "percussive_organ", "piano", "Percussive organ attack with clear harmonics", { loop: true }),
  "rock-organ": soundfontPatch("rock-organ", "Rock Organ", "Organs", "rock_organ", "piano", "Bright rock and gospel organ", { loop: true }),
  "reed-organ": soundfontPatch("reed-organ", "Reed Organ", "Organs", "reed_organ", "piano", "Warm reed-organ keyboard voice", { loop: true }),
  accordion: soundfontPatch("accordion", "Accordion", "Organs", "accordion", "music", "Sampled accordion reeds", { loop: true }),
  "tango-accordion": soundfontPatch("tango-accordion", "Tango Accordion", "Organs", "tango_accordion", "music", "Expressive tango accordion samples", { loop: true }),
  harmonica: soundfontPatch("harmonica", "Harmonica", "Organs", "harmonica", "wind", "Blues harmonica voice"),
  "jazz-organ": soundfontPatch("jazz-organ", "Jazz Drawbar Organ", "Organs", "drawbar_organ", "piano", "Jazz drawbar registration with a brighter preset", { loop: true, brightness: 0.9 }),
  "cathedral-organ": soundfontPatch("cathedral-organ", "Cathedral Organ", "Organs", "church_organ", "piano", "Full pipe-organ preset with a longer release", { loop: true, brightness: 0.82, release: 1.5 }),

  // Bass — ten electric, acoustic and synth bass sounds
  "sub-bass": soundfontPatch("sub-bass", "Deep Synth Bass", "Bass", "synth_bass_1", "speaker", "Deep sampled synthesizer bass"),
  "pluck-bass": soundfontPatch("pluck-bass", "Fingered Electric Bass", "Bass", "electric_bass_finger", "speaker", "Sampled fingerstyle electric bass"),
  "808-bass": soundfontPatch("808-bass", "Synth 808 Bass", "Bass", "synth_bass_2", "speaker", "Punchy sampled synth bass"),
  "acoustic-bass": soundfontPatch("acoustic-bass", "Upright Acoustic Bass", "Bass", "acoustic_bass", "speaker", "Sampled upright bass"),
  "picked-bass": soundfontPatch("picked-bass", "Picked Electric Bass", "Bass", "electric_bass_pick", "speaker", "Sampled picked electric bass"),
  "fretless-bass": soundfontPatch("fretless-bass", "Fretless Bass", "Bass", "fretless_bass", "speaker", "Smooth fretless electric bass"),
  "slap-bass-1": soundfontPatch("slap-bass-1", "Slap Bass 1", "Bass", "slap_bass_1", "speaker", "Punchy slap bass"),
  "slap-bass-2": soundfontPatch("slap-bass-2", "Slap Bass 2", "Bass", "slap_bass_2", "speaker", "Bright popping slap bass"),
  "synth-bass-deep": soundfontPatch("synth-bass-deep", "Deep Synth Bass 1", "Bass", "synth_bass_1", "speaker", "Deep-filtered synth bass preset", { brightness: 0.3 }),
  "contrabass": soundfontPatch("contrabass", "Orchestral Contrabass", "Bass", "contrabass", "speaker", "Sampled orchestral double bass"),

  // Guitars — ten acoustic, electric and world guitar voices
  "nylon-guitar": soundfontPatch("nylon-guitar", "Nylon-String Guitar", "Guitars", "acoustic_guitar_nylon", "guitar", "Warm sampled nylon-string guitar"),
  "steel-guitar": soundfontPatch("steel-guitar", "Steel-String Acoustic Guitar", "Guitars", "acoustic_guitar_steel", "guitar", "Bright sampled steel-string acoustic guitar"),
  "jazz-guitar": soundfontPatch("jazz-guitar", "Jazz Electric Guitar", "Guitars", "electric_guitar_jazz", "guitar", "Round hollow-body jazz guitar"),
  "clean-guitar": soundfontPatch("clean-guitar", "Clean Electric Guitar", "Guitars", "electric_guitar_clean", "guitar", "Clean electric guitar"),
  "muted-guitar": soundfontPatch("muted-guitar", "Muted Electric Guitar", "Guitars", "electric_guitar_muted", "guitar", "Tight muted electric guitar"),
  "overdrive-guitar": soundfontPatch("overdrive-guitar", "Overdriven Guitar", "Guitars", "overdriven_guitar", "guitar", "Driven electric guitar"),
  "distortion-guitar": soundfontPatch("distortion-guitar", "Distortion Guitar", "Guitars", "distortion_guitar", "guitar", "Saturated electric guitar"),
  "guitar-harmonics": soundfontPatch("guitar-harmonics", "Guitar Harmonics", "Guitars", "guitar_harmonics", "guitar", "Natural guitar harmonic chimes"),
  banjo: soundfontPatch("banjo", "Banjo", "Guitars", "banjo", "guitar", "Bright plucked banjo"),
  sitar: soundfontPatch("sitar", "Sitar", "Guitars", "sitar", "guitar", "Resonant sampled sitar"),

  // Strings & Orchestral — ten sampled orchestral voices
  "string-ensemble": soundfontPatch("string-ensemble", "String Ensemble", "Strings & Orchestral", "string_ensemble_1", "music", "Layered sampled orchestral strings", { loop: true, release: 1.1 }),
  "string-ensemble-2": soundfontPatch("string-ensemble-2", "String Ensemble 2", "Strings & Orchestral", "string_ensemble_2", "music", "Second sampled orchestral string ensemble", { loop: true, release: 1.1 }),
  violin: soundfontPatch("violin", "Solo Violin", "Strings & Orchestral", "violin", "music", "Sampled solo violin", { loop: true, release: 0.65 }),
  viola: soundfontPatch("viola", "Solo Viola", "Strings & Orchestral", "viola", "music", "Sampled solo viola", { loop: true, release: 0.65 }),
  cello: soundfontPatch("cello", "Solo Cello", "Strings & Orchestral", "cello", "music", "Sampled solo cello", { loop: true, release: 0.7 }),
  "tremolo-strings": soundfontPatch("tremolo-strings", "Tremolo Strings", "Strings & Orchestral", "tremolo_strings", "music", "Sampled tremolo string section", { loop: true, release: 0.8 }),
  "pizzicato-strings": soundfontPatch("pizzicato-strings", "Pizzicato Strings", "Strings & Orchestral", "pizzicato_strings", "music", "Plucked orchestral strings"),
  "orchestral-harp": soundfontPatch("orchestral-harp", "Orchestral Harp", "Strings & Orchestral", "orchestral_harp", "music", "Sampled concert harp"),
  "string-fiddle": soundfontPatch("string-fiddle", "Fiddle", "Strings & Orchestral", "fiddle", "music", "Fiddle articulation sample set", { loop: true, release: 0.55 }),
  timpani: soundfontPatch("timpani", "Timpani", "Strings & Orchestral", "timpani", "drum", "Sampled orchestral timpani"),

  // Bells & Mallets — ten pitched bell and mallet instruments
  marimba: soundfontPatch("marimba", "Marimba", "Bells & Mallets", "marimba", "grid-3x3", "Warm wooden mallet instrument"),
  celesta: soundfontPatch("celesta", "Celesta", "Bells & Mallets", "celesta", "bell", "Sparkling sampled celesta"),
  glockenspiel: soundfontPatch("glockenspiel", "Glockenspiel", "Bells & Mallets", "glockenspiel", "bell", "Bright orchestral glockenspiel"),
  vibraphone: soundfontPatch("vibraphone", "Vibraphone", "Bells & Mallets", "vibraphone", "bell", "Metallic vibraphone with gentle sustain"),
  xylophone: soundfontPatch("xylophone", "Xylophone", "Bells & Mallets", "xylophone", "grid-3x3", "Bright wooden xylophone"),
  "tubular-bells": soundfontPatch("tubular-bells", "Tubular Bells", "Bells & Mallets", "tubular_bells", "bell", "Large sampled tubular bells"),
  "music-box": soundfontPatch("music-box", "Music Box", "Bells & Mallets", "music_box", "bell", "Delicate music-box tones"),
  kalimba: soundfontPatch("kalimba", "Kalimba", "Bells & Mallets", "kalimba", "grid-3x3", "Warm thumb-piano tones"),
  dulcimer: soundfontPatch("dulcimer", "Dulcimer", "Bells & Mallets", "dulcimer", "grid-3x3", "Plucked dulcimer tones"),
  "steel-drums": soundfontPatch("steel-drums", "Steel Drums", "Bells & Mallets", "steel_drums", "grid-3x3", "Sampled steel pan ensemble"),

  // Brass & Winds — ten sampled acoustic voices
  "wood-flute": soundfontPatch("wood-flute", "Concert Flute", "Brass & Winds", "flute", "wind", "Sampled concert flute", { loop: true, release: 0.45 }),
  trumpet: soundfontPatch("trumpet", "Trumpet", "Brass & Winds", "trumpet", "wind", "Sampled trumpet", { loop: true, release: 0.4 }),
  "muted-trumpet": soundfontPatch("muted-trumpet", "Muted Trumpet", "Brass & Winds", "muted_trumpet", "wind", "Muted sampled trumpet"),
  trombone: soundfontPatch("trombone", "Trombone", "Brass & Winds", "trombone", "wind", "Sampled trombone", { loop: true, release: 0.45 }),
  tuba: soundfontPatch("tuba", "Tuba", "Brass & Winds", "tuba", "wind", "Sampled tuba", { loop: true, release: 0.5 }),
  "french-horn": soundfontPatch("french-horn", "French Horn", "Brass & Winds", "french_horn", "wind", "Sampled French horn", { loop: true, release: 0.5 }),
  "brass-section": soundfontPatch("brass-section", "Brass Section", "Brass & Winds", "brass_section", "wind", "Layered sampled brass section", { loop: true, release: 0.45 }),
  "alto-sax": soundfontPatch("alto-sax", "Alto Saxophone", "Brass & Winds", "alto_sax", "wind", "Sampled alto saxophone", { loop: true, release: 0.45 }),
  "tenor-sax": soundfontPatch("tenor-sax", "Tenor Saxophone", "Brass & Winds", "tenor_sax", "wind", "Sampled tenor saxophone", { loop: true, release: 0.45 }),
  clarinet: soundfontPatch("clarinet", "Clarinet", "Brass & Winds", "clarinet", "wind", "Sampled clarinet", { loop: true, release: 0.45 }),

  // Drums & Percussion — ten sampled drum machines and percussion patches
  "drum-kit": drumMachinePatch("drum-kit", "Linn-Style Sampled Drum Kit", "LM-2", "Classic sampled LM-2 drum machine"),
  "808-kit": drumMachinePatch("808-kit", "Roland TR-808", "TR-808", "Classic sampled TR-808 drum machine"),
  "casio-rz1-kit": drumMachinePatch("casio-rz1-kit", "Casio RZ-1", "Casio-RZ1", "Sampled Casio RZ-1 drum machine"),
  "mfb-512-kit": drumMachinePatch("mfb-512-kit", "MFB-512", "MFB-512", "Sampled MFB-512 drum machine"),
  "cr-8000-kit": drumMachinePatch("cr-8000-kit", "Roland CR-8000", "Roland CR-8000", "Sampled Roland CR-8000 drum machine"),
  "taiko-drums": soundfontPatch("taiko-drums", "Taiko Drums", "Drums & Percussion", "taiko_drum", "drum", "Sampled Japanese taiko drum", { release: 0.1 }),
  "melodic-toms": soundfontPatch("melodic-toms", "Melodic Toms", "Drums & Percussion", "melodic_tom", "drum", "Sampled tuned tom drums", { release: 0.1 }),
  "synth-drums": soundfontPatch("synth-drums", "Synth Drums", "Drums & Percussion", "synth_drum", "drum", "Sampled electronic percussion tones", { release: 0.1 }),
  "woodblock-drums": soundfontPatch("woodblock-drums", "Woodblock", "Drums & Percussion", "woodblock", "drum", "Sampled woodblock percussion", { release: 0.08 }),
  "reverse-cymbal": soundfontPatch("reverse-cymbal", "Reverse Cymbal", "Drums & Percussion", "reverse_cymbal", "drum", "Sampled reverse cymbal swell", { release: 0.08 }),
  // Alchemy Synth — original spectral/additive morph presets, no external samples.
  "alchemy-glass-orbit": morphSynthPatch(
    "alchemy-glass-orbit", "Glass Orbit", "Bright inharmonic-style additive shimmer with a soft evolving filter",
    { morph: 0.82, harmonics: 0.8, cutoff: 9200, resonance: 2.4, attack: 0.08, decay: 1.8, sustain: 0.64, release: 2.4, detune: 7, sub: 0.08, lfoRate: 0.22, lfoDepth: 0.24, noise: 0.02 }
  ),
  "alchemy-solar-pad": morphSynthPatch(
    "alchemy-solar-pad", "Solar Pad", "Wide evolving pad with slow attack, a soft sub layer and gentle motion",
    { morph: 0.48, harmonics: 0.58, cutoff: 4200, resonance: 1.2, attack: 1.4, decay: 2.8, sustain: 0.82, release: 3.8, detune: 12, sub: 0.22, lfoRate: 0.16, lfoDepth: 0.34, noise: 0.04 }
  ),
  "alchemy-prism-keys": morphSynthPatch(
    "alchemy-prism-keys", "Prism Keys", "Percussive digital keys with a clear harmonic attack and short release",
    { morph: 0.72, harmonics: 0.72, cutoff: 11200, resonance: 1.8, attack: 0.004, decay: 0.48, sustain: 0.12, release: 0.42, detune: 3, sub: 0.04, lfoRate: 3.2, lfoDepth: 0.08, noise: 0.015 }
  ),
  "alchemy-neon-lead": morphSynthPatch(
    "alchemy-neon-lead", "Neon Lead", "Focused unison lead with bright upper partials and expressive filter movement",
    { morph: 0.24, harmonics: 0.9, cutoff: 7800, resonance: 4.2, attack: 0.012, decay: 0.52, sustain: 0.76, release: 0.32, detune: 16, sub: 0.12, lfoRate: 5.1, lfoDepth: 0.14, noise: 0.01 }
  ),
  "alchemy-sub-motion": morphSynthPatch(
    "alchemy-sub-motion", "Sub Motion", "Deep bass synth with a restrained harmonic edge and subtle modulation",
    { morph: 0.12, harmonics: 0.42, cutoff: 1250, resonance: 1.1, attack: 0.006, decay: 0.34, sustain: 0.7, release: 0.22, detune: 2, sub: 0.9, lfoRate: 0.8, lfoDepth: 0.06, noise: 0 }
  ),
  "alchemy-crystal-bell": morphSynthPatch(
    "alchemy-crystal-bell", "Crystal Bell", "Bell-like additive partials with a long decaying metallic tail",
    { morph: 0.96, harmonics: 0.94, cutoff: 14800, resonance: 2.8, attack: 0.002, decay: 3.4, sustain: 0.04, release: 2.8, detune: 1.5, sub: 0, lfoRate: 0.12, lfoDepth: 0.16, noise: 0.03 }
  ),
  "alchemy-vapor-brass": morphSynthPatch(
    "alchemy-vapor-brass", "Vapor Brass", "Layered synthetic brass with a rising filter envelope and mild unison",
    { morph: 0.34, harmonics: 0.76, cutoff: 5200, resonance: 2.1, attack: 0.035, decay: 0.62, sustain: 0.72, release: 0.48, detune: 9, sub: 0.18, lfoRate: 0.32, lfoDepth: 0.08, noise: 0.035 }
  ),
  "alchemy-choir-flux": morphSynthPatch(
    "alchemy-choir-flux", "Choir Flux", "Vocal-like additive pad with airy noise and slow spectral motion",
    { morph: 0.68, harmonics: 0.52, cutoff: 3600, resonance: 1.4, attack: 0.65, decay: 1.5, sustain: 0.84, release: 3.2, detune: 6, sub: 0.08, lfoRate: 0.28, lfoDepth: 0.4, noise: 0.12 }
  ),
  "alchemy-spectral-dream": morphSynthPatch(
    "alchemy-spectral-dream", "Spectral Dream", "Soft ambient texture combining evolving partials, subharmonics and filtered noise",
    { morph: 0.9, harmonics: 0.62, cutoff: 6200, resonance: 0.9, attack: 1.9, decay: 3.4, sustain: 0.72, release: 5.5, detune: 4, sub: 0.14, lfoRate: 0.09, lfoDepth: 0.52, noise: 0.2 }
  ),
  "alchemy-digital-pluck": morphSynthPatch(
    "alchemy-digital-pluck", "Digital Pluck", "Fast plucked synth tone with a bright morphing spectrum and tight bass foundation",
    { morph: 0.58, harmonics: 0.88, cutoff: 9800, resonance: 3.1, attack: 0.002, decay: 0.26, sustain: 0.06, release: 0.3, detune: 2, sub: 0.28, lfoRate: 2.4, lfoDepth: 0.1, noise: 0.025 }
  ),
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
  params: Params,
  noteOffControlled = false
): VoiceHandle {
  const freq = midiToFreq(pitch);
  const safeVelocity = clamp(velocity, 0.02, 1);
  const patch = PATCHES[patchId];
  if (patch?.synthEngine === "morph-additive") {
    return playMorphAdditive({ ctx, dest, freq, vel: safeVelocity, when, dur, p: params });
  }
  if (patch?.sampled) {
    const sampled = playSampledNote(
      ctx,
      dest,
      patch,
      pitch,
      safeVelocity,
      when,
      dur,
      params,
      noteOffControlled
    );
    // Sample-backed patches deliberately do not fall back to an unrelated
    // oscillator sound while their real samples are loading or unavailable.
    return sampled ?? {
      scheduleStop() { /* sample is not ready yet */ },
      kill() { /* sample is not ready yet */ },
    };
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
