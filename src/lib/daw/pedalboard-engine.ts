import type { PedalId, PedalInstance } from "./types";
import { PEDAL_BY_ID } from "./pedalboard";
import { clamp, makeRng } from "./utils";

interface PedalUnit {
  input: GainNode;
  output: GainNode;
  wet: GainNode;
  dry: GainNode;
  automation: { controlId: string; parameter: AudioParam; transform?: (value: number) => number }[];
  effect: (pedal: PedalInstance, now: number) => void;
  dispose: () => void;
}

export interface PedalAutomationBinding {
  parameterId: string;
  parameter: AudioParam;
  transform?: (value: number) => number;
}

const value = (pedal: PedalInstance, key: string, fallback: number) =>
  clamp(pedal.params[key] ?? fallback, 0, 1);

function smooth(param: AudioParam, next: number, now: number, timeConstant = 0.025) {
  param.cancelScheduledValues(now);
  param.setTargetAtTime(next, now, timeConstant);
}

function makeSpringImpulse(ctx: BaseAudioContext, decay: number): AudioBuffer {
  const duration = 0.35 + decay * 3.65;
  const length = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  const random = makeRng(0x535052 + Math.round(decay * 1000));
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    let reflection = 0;
    for (let i = 0; i < length; i++) {
      const t = i / ctx.sampleRate;
      const noise = random() * 2 - 1;
      reflection += (noise - reflection) * (channel ? 0.29 : 0.34);
      const flutter = Math.sin(i * (channel ? 0.113 : 0.097)) * 0.22;
      data[i] = (reflection + flutter) * Math.exp(-t * (1.4 + (1 - decay) * 7));
    }
    data[Math.floor(ctx.sampleRate * 0.012)] += channel ? -0.5 : 0.5;
    data[Math.floor(ctx.sampleRate * 0.027)] += channel ? 0.22 : 0.3;
  }
  return buffer;
}

function makePedalUnit(ctx: BaseAudioContext, pedalId: PedalId): PedalUnit {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const effectInput = ctx.createGain();
  const effectOutput = ctx.createGain();
  const automation: PedalUnit["automation"] = [];
  const bindAutomation = (
    controlId: string,
    parameter: AudioParam,
    transform?: (value: number) => number,
  ) => automation.push({ controlId, parameter, transform });
  input.connect(dry).connect(output);
  input.connect(effectInput);
  effectOutput.connect(wet).connect(output);
  const disposers: (() => void)[] = [];

  const addOscillator = (type: OscillatorType, rate: number) => {
    const oscillator = ctx.createOscillator();
    oscillator.type = type;
    oscillator.frequency.value = rate;
    oscillator.start();
    disposers.push(() => oscillator.stop());
    return oscillator;
  };

  let configureEffect = (_pedal: PedalInstance, _now: number) => {};

  if (pedalId === "squash-compressor") {
    const compressor = ctx.createDynamicsCompressor();
    const level = ctx.createGain();
    effectInput.connect(compressor).connect(level).connect(effectOutput);
    bindAutomation("sustain", compressor.threshold, (v) => -8 - v * 48);
    bindAutomation("attack", compressor.attack, (v) => 0.001 + v * 0.18);
    bindAutomation("level", level.gain, (v) => 0.5 + v * 1.25);
    configureEffect = (pedal, now) => {
      smooth(compressor.threshold, -8 - value(pedal, "sustain", 0.48) * 48, now);
      smooth(compressor.ratio, 1.5 + value(pedal, "sustain", 0.48) * 10, now);
      smooth(compressor.knee, 3 + value(pedal, "sustain", 0.48) * 24, now);
      smooth(compressor.attack, 0.001 + value(pedal, "attack", 0.28) * 0.18, now);
      smooth(compressor.release, 0.06 + value(pedal, "sustain", 0.48) * 0.34, now);
      smooth(level.gain, 0.5 + value(pedal, "level", 0.62) * 1.25, now);
    };
  } else if (pedalId === "vintage-drive") {
    const shaper = ctx.createWaveShaper();
    shaper.oversample = "4x";
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    const outputLevel = ctx.createGain();
    effectInput.connect(shaper).connect(tone).connect(outputLevel).connect(effectOutput);
    bindAutomation("tone", tone.frequency, (v) => 450 + v * 11500);
    bindAutomation("output", outputLevel.gain, (v) => 0.45 + v * 0.9);
    configureEffect = (pedal, now) => {
      const drive = value(pedal, "drive", 0.4);
      const amount = 1 + drive * 32;
      const normalizer = Math.tanh(amount);
      const curve = new Float32Array(2048);
      for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = Math.tanh(x * amount) / normalizer;
      }
      shaper.curve = curve;
      smooth(tone.frequency, 450 + value(pedal, "tone", 0.56) * 11500, now);
      smooth(outputLevel.gain, 0.45 + value(pedal, "output", 0.68) * 0.9, now);
    };
  } else if (pedalId === "retro-chorus") {
    const delay = ctx.createDelay(0.08);
    const lfo = addOscillator("sine", 0.8);
    const depth = ctx.createGain();
    depth.gain.value = 0.004;
    lfo.connect(depth).connect(delay.delayTime);
    effectInput.connect(delay).connect(effectOutput);
    bindAutomation("rate", lfo.frequency, (v) => 0.08 + v * 5);
    bindAutomation("depth", depth.gain, (v) => 0.0004 + v * 0.008);
    configureEffect = (pedal, now) => {
      smooth(lfo.frequency, 0.08 + value(pedal, "rate", 0.3) * 5, now);
      smooth(depth.gain, 0.0004 + value(pedal, "depth", 0.52) * 0.008, now);
      smooth(delay.delayTime, 0.018, now);
    };
  } else if (pedalId === "phase-tripper") {
    const stages = Array.from({ length: 4 }, () => {
      const filter = ctx.createBiquadFilter();
      filter.type = "allpass";
      return filter;
    });
    effectInput.connect(stages[0]);
    for (let i = 0; i < stages.length - 1; i++) stages[i].connect(stages[i + 1]);
    const feedbackDelay = ctx.createDelay(0.04);
    const feedback = ctx.createGain();
    feedbackDelay.delayTime.value = 0.006;
    stages[3].connect(effectOutput);
    stages[3].connect(feedbackDelay).connect(feedback).connect(stages[0]);
    const lfo = addOscillator("sine", 0.3);
    const modulation = ctx.createGain();
    lfo.connect(modulation);
    bindAutomation("speed", lfo.frequency, (v) => 0.06 + v * 3.8);
    bindAutomation("feedback", feedback.gain, (v) => v * 0.72);
    bindAutomation("color", modulation.gain, (v) => 250 + v * 1600);
    stages.forEach((stage, index) => {
      const offset = ctx.createConstantSource();
      offset.offset.value = 500 + index * 190;
      offset.connect(stage.frequency);
      offset.start();
      modulation.connect(stage.frequency);
      bindAutomation("color", stage.frequency, (v) => 250 + v * 1900 + index * 180);
      disposers.push(() => offset.stop());
    });
    configureEffect = (pedal, now) => {
      const color = value(pedal, "color", 0.5);
      smooth(lfo.frequency, 0.06 + value(pedal, "speed", 0.26) * 3.8, now);
      smooth(modulation.gain, 250 + color * 1600, now);
      smooth(feedback.gain, value(pedal, "feedback", 0.28) * 0.72, now);
      stages.forEach((stage, index) => {
        smooth(stage.frequency, 250 + color * 1900 + index * 180, now);
        smooth(stage.Q, 0.5 + value(pedal, "feedback", 0.28) * 2.5, now);
      });
    };
  } else if (pedalId === "blue-echo") {
    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);
    const delays = [ctx.createDelay(1.95), ctx.createDelay(1.95)];
    const filters = [ctx.createBiquadFilter(), ctx.createBiquadFilter()];
    const feedback = [ctx.createGain(), ctx.createGain()];
    const lfo = addOscillator("sine", 0.8);
    const flutter = ctx.createGain();
    lfo.connect(flutter);
    effectInput.connect(splitter);
    for (let channel = 0; channel < 2; channel++) {
      filters[channel].type = "lowpass";
      filters[channel].frequency.value = 4200;
      splitter.connect(delays[channel], channel);
      delays[channel].connect(filters[channel]).connect(merger, 0, channel);
      filters[channel].connect(feedback[channel]).connect(delays[channel]);
      flutter.connect(delays[channel].delayTime);
    }
    merger.connect(effectOutput);
    delays.forEach((delay) => bindAutomation("time", delay.delayTime, (v) => 0.06 + v * 0.82));
    feedback.forEach((gain) => bindAutomation("feedback", gain.gain, (v) => v * 0.78));
    filters.forEach((filter) => bindAutomation("tone", filter.frequency, (v) => 1800 + v * 8000));
    bindAutomation("flutter", lfo.frequency, (v) => 2 + v * 8);
    bindAutomation("flutter", flutter.gain, (v) => v * 0.004);
    configureEffect = (pedal, now) => {
      const time = 0.06 + value(pedal, "time", 0.32) * 0.82;
      const flutterDepth = value(pedal, "flutter", 0.14) * 0.004;
      smooth(lfo.frequency, 2 + value(pedal, "flutter", 0.14) * 8, now);
      smooth(flutter.gain, flutterDepth, now);
      delays.forEach((delay) => smooth(delay.delayTime, time, now));
      feedback.forEach((gain) => smooth(gain.gain, value(pedal, "feedback", 0.34) * 0.78, now));
      filters.forEach((filter) => smooth(filter.frequency, 1800 + value(pedal, "tone", 0.55) * 8000, now));
    };
  } else if (pedalId === "spring-box") {
    const convolver = ctx.createConvolver();
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    effectInput.connect(convolver).connect(tone).connect(effectOutput);
    bindAutomation("tone", tone.frequency, (v) => 600 + v * 11500);
    let lastDecay = -1;
    configureEffect = (pedal, now) => {
      const decay = value(pedal, "decay", 0.46);
      if (Math.abs(decay - lastDecay) > 0.04) {
        convolver.buffer = makeSpringImpulse(ctx, decay);
        lastDecay = decay;
      }
      smooth(tone.frequency, 600 + value(pedal, "tone", 0.58) * 11500, now);
    };
  } else if (pedalId === "auto-funk") {
    const envelope = ctx.createAnalyser();
    envelope.fftSize = 256;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    effectInput.connect(envelope).connect(filter).connect(effectOutput);
    const samples = new Float32Array(envelope.fftSize);
    let frame = 0;
    const realtime = typeof window !== "undefined" && ctx.constructor.name !== "OfflineAudioContext";
    const followEnvelope = () => {
      envelope.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const rms = Math.sqrt(sum / samples.length);
      const sensitivity = activeSensitivity;
      const cutoff = 180 + activeRange * 1700 + Math.min(1, rms * sensitivity * 8) * (900 + activeRange * 8500);
      filter.frequency.setTargetAtTime(cutoff, ctx.currentTime, 0.025);
      frame = requestAnimationFrame(followEnvelope);
    };
    let activeSensitivity = 0.55;
    let activeRange = 0.54;
    if (realtime) frame = requestAnimationFrame(followEnvelope);
    disposers.push(() => cancelAnimationFrame(frame));
    configureEffect = (pedal, now) => {
      activeSensitivity = 0.15 + value(pedal, "sensitivity", 0.55) * 2.8;
      activeRange = value(pedal, "range", 0.54);
      smooth(filter.Q, 0.7 + value(pedal, "resonance", 0.62) * 18, now);
      if (!realtime) {
        smooth(filter.frequency, 180 + activeRange * 7000, now);
      }
    };
    bindAutomation("resonance", filter.Q, (v) => 0.7 + v * 18);
  } else if (pedalId === "fender-clean-booster") {
    const bright = ctx.createBiquadFilter();
    bright.type = "highshelf";
    const gain = ctx.createGain();
    effectInput.connect(bright).connect(gain).connect(effectOutput);
    bindAutomation("gain", gain.gain, (v) => 0.7 + v * 3);
    bindAutomation("bright", bright.frequency, (v) => 1800 + v * 9000);
    bindAutomation("level", gain.gain, (v) => 0.55 + v * 1.8);
    configureEffect = (pedal, now) => {
      smooth(bright.frequency, 1800 + value(pedal, "bright", 0.5) * 9000, now);
      bright.gain?.setTargetAtTime?.(value(pedal, "bright", 0.5) * 12 - 2, now, 0.02);
      smooth(gain.gain, (0.7 + value(pedal, "gain", 0.42) * 3) * (0.55 + value(pedal, "level", 0.68) * 1.8), now);
    };
  } else if (pedalId === "ibanez-green-screamer") {
    const shaper = ctx.createWaveShaper();
    shaper.oversample = "4x";
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    const level = ctx.createGain();
    effectInput.connect(shaper).connect(tone).connect(level).connect(effectOutput);
    bindAutomation("tone", tone.frequency, (v) => 900 + v * 11000);
    bindAutomation("level", level.gain, (v) => 0.5 + v * 1.5);
    configureEffect = (pedal, now) => {
      const drive = 1 + value(pedal, "drive", 0.48) * 20;
      const curve = new Float32Array(2048);
      for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
      }
      shaper.curve = curve;
      smooth(tone.frequency, 900 + value(pedal, "tone", 0.58) * 11000, now);
      smooth(level.gain, 0.5 + value(pedal, "level", 0.62) * 1.5, now);
    };
  } else if (pedalId === "garageband-fuzz") {
    const shaper = ctx.createWaveShaper();
    shaper.oversample = "4x";
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    const volume = ctx.createGain();
    effectInput.connect(shaper).connect(tone).connect(volume).connect(effectOutput);
    bindAutomation("tone", tone.frequency, (v) => 650 + v * 10500);
    bindAutomation("volume", volume.gain, (v) => 0.35 + v * 1.4);
    configureEffect = (pedal, now) => {
      const fuzz = value(pedal, "fuzz", 0.58);
      const amount = 2 + fuzz * 28;
      const curve = new Float32Array(2048);
      for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = Math.tanh(x * amount) > 0 ? 0.78 : -0.78;
      }
      shaper.curve = curve;
      smooth(tone.frequency, 650 + value(pedal, "tone", 0.48) * 10500, now);
      smooth(volume.gain, 0.35 + value(pedal, "volume", 0.66) * 1.4, now);
    };
  } else if (pedalId === "silk-noise-gate") {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const gate = ctx.createGain();
    effectInput.connect(analyser).connect(gate).connect(effectOutput);
    const samples = new Float32Array(analyser.fftSize);
    let activeThreshold = 0.42;
    let activeRelease = 0.32;
    let activeRange = 0.78;
    let frame = 0;
    const realtime = typeof window !== "undefined" && ctx.constructor.name !== "OfflineAudioContext";
    const followGate = () => {
      analyser.getFloatTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      const threshold = 0.001 + activeThreshold * 0.08;
      const open = peak > threshold;
      smooth(gate.gain, open ? 1 : activeRange * 0.04, ctx.currentTime, 0.005 + activeRelease * 0.12);
      frame = requestAnimationFrame(followGate);
    };
    if (realtime) frame = requestAnimationFrame(followGate);
    disposers.push(() => cancelAnimationFrame(frame));
    configureEffect = (pedal, now) => {
      activeThreshold = value(pedal, "threshold", 0.42);
      activeRelease = value(pedal, "release", 0.32);
      activeRange = value(pedal, "range", 0.78);
      if (!realtime) smooth(gate.gain, 1, now);
    };
  } else if (pedalId === "studio-tilt-eq") {
    const low = ctx.createBiquadFilter();
    low.type = "lowshelf";
    low.frequency.value = 420;
    const high = ctx.createBiquadFilter();
    high.type = "highshelf";
    high.frequency.value = 3200;
    const level = ctx.createGain();
    effectInput.connect(low).connect(high).connect(level).connect(effectOutput);
    bindAutomation("level", level.gain, (v) => 0.5 + v * 1.3);
    configureEffect = (pedal, now) => {
      const tilt = value(pedal, "tilt", 0.5) * 2 - 1;
      const width = 3 + value(pedal, "width", 0.52) * 9;
      low.gain.setTargetAtTime(-tilt * width, now, 0.025);
      high.gain.setTargetAtTime(tilt * width, now, 0.025);
      smooth(level.gain, 0.5 + value(pedal, "level", 0.68) * 1.3, now);
    };
  } else if (pedalId === "stereo-flanger") {
    const delay = ctx.createDelay(0.02);
    const feedback = ctx.createGain();
    const lfo = addOscillator("sine", 0.7);
    const depth = ctx.createGain();
    lfo.connect(depth).connect(delay.delayTime);
    effectInput.connect(delay).connect(effectOutput);
    delay.connect(feedback).connect(delay);
    feedback.connect(effectOutput);
    effectOutput.gain?.setValueAtTime?.(1, ctx.currentTime);
    bindAutomation("rate", lfo.frequency, (v) => 0.05 + v * 6);
    bindAutomation("depth", depth.gain, (v) => 0.0003 + v * 0.006);
    bindAutomation("feedback", feedback.gain, (v) => v * 0.72);
    configureEffect = (pedal, now) => {
      smooth(lfo.frequency, 0.05 + value(pedal, "rate", 0.31) * 6, now);
      smooth(depth.gain, 0.0003 + value(pedal, "depth", 0.5) * 0.006, now);
      smooth(feedback.gain, value(pedal, "feedback", 0.24) * 0.72, now);
      smooth(delay.delayTime, 0.004 + value(pedal, "depth", 0.5) * 0.006, now);
    };
  } else if (pedalId === "ping-pong-delay") {
    const left = ctx.createDelay(1.5);
    const right = ctx.createDelay(1.5);
    const leftGain = ctx.createGain();
    const rightGain = ctx.createGain();
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    effectInput.connect(left);
    effectInput.connect(right);
    left.connect(leftGain).connect(right);
    right.connect(rightGain).connect(left);
    leftGain.connect(tone).connect(effectOutput);
    rightGain.connect(effectOutput);
    bindAutomation("time", left.delayTime, (v) => 0.05 + v * 0.7);
    bindAutomation("time", right.delayTime, (v) => 0.08 + v * 0.9);
    bindAutomation("feedback", leftGain.gain, (v) => v * 0.82);
    bindAutomation("feedback", rightGain.gain, (v) => v * 0.82);
    bindAutomation("color", tone.frequency, (v) => 900 + v * 11000);
    configureEffect = (pedal, now) => {
      const time = value(pedal, "time", 0.28);
      const feedback = value(pedal, "feedback", 0.38) * 0.82;
      smooth(left.delayTime, 0.05 + time * 0.7, now);
      smooth(right.delayTime, 0.08 + time * 0.9, now);
      smooth(leftGain.gain, feedback, now);
      smooth(rightGain.gain, feedback, now);
      smooth(tone.frequency, 900 + value(pedal, "color", 0.55) * 11000, now);
    };
  } else if (pedalId === "cathedral-reverb") {
    const convolver = ctx.createConvolver();
    convolver.buffer = makeSpringImpulse(ctx, 0.68);
    let lastDecay = -1;
    const predelay = ctx.createDelay(0.5);
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    effectInput.connect(predelay).connect(convolver).connect(tone).connect(effectOutput);
    bindAutomation("predelay", predelay.delayTime, (v) => v * 0.35);
    bindAutomation("tone", tone.frequency, (v) => 700 + v * 13500);
    configureEffect = (pedal, now) => {
      const decay = value(pedal, "decay", 0.68);
      if (Math.abs(decay - lastDecay) > 0.04) {
        convolver.buffer = makeSpringImpulse(ctx, decay);
        lastDecay = decay;
      }
      smooth(predelay.delayTime, value(pedal, "predelay", 0.18) * 0.35, now);
      smooth(tone.frequency, 700 + value(pedal, "tone", 0.62) * 13500, now);
    };
  } else if (pedalId === "octave-down") {
    const rectifier = ctx.createWaveShaper();
    const subFilter = ctx.createBiquadFilter();
    subFilter.type = "lowpass";
    const direct = ctx.createGain();
    const subGain = ctx.createGain();
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    effectInput.connect(direct).connect(effectOutput);
    effectInput.connect(rectifier).connect(subFilter).connect(subGain).connect(tone).connect(effectOutput);
    bindAutomation("octave", subGain.gain, (v) => v);
    bindAutomation("direct", direct.gain, (v) => v);
    bindAutomation("tone", tone.frequency, (v) => 300 + v * 5000);
    configureEffect = (pedal, now) => {
      const curve = new Float32Array(2048);
      for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = x < 0 ? -1 : 1;
      }
      rectifier.curve = curve;
      smooth(subGain.gain, value(pedal, "octave", 0.72), now);
      smooth(direct.gain, value(pedal, "direct", 0.55), now);
      smooth(subFilter.frequency, 120 + value(pedal, "octave", 0.72) * 300, now);
      smooth(tone.frequency, 300 + value(pedal, "tone", 0.5) * 5000, now);
    };
  } else if (pedalId === "double-tracker") {
    const left = ctx.createDelay(0.04);
    const right = ctx.createDelay(0.04);
    const leftGain = ctx.createGain();
    const rightGain = ctx.createGain();
    effectInput.connect(left).connect(leftGain).connect(effectOutput);
    effectInput.connect(right).connect(rightGain).connect(effectOutput);
    bindAutomation("detune", left.delayTime, (v) => 0.008 + v * 0.02);
    bindAutomation("detune", right.delayTime, (v) => 0.018 - v * 0.012);
    bindAutomation("spread", leftGain.gain, (v) => 0.35 + v * 0.5);
    bindAutomation("spread", rightGain.gain, (v) => 0.35 + v * 0.5);
    configureEffect = (pedal, now) => {
      const detune = value(pedal, "detune", 0.35);
      const spread = value(pedal, "spread", 0.62);
      smooth(left.delayTime, 0.006 + detune * 0.018, now);
      smooth(right.delayTime, 0.014 - detune * 0.008, now);
      smooth(leftGain.gain, 0.35 + spread * 0.5, now);
      smooth(rightGain.gain, 0.35 + spread * 0.5, now);
    };
  } else if (pedalId === "master-limiter") {
    const compressor = ctx.createDynamicsCompressor();
    const level = ctx.createGain();
    effectInput.connect(compressor).connect(level).connect(effectOutput);
    bindAutomation("ceiling", compressor.threshold, (v) => -18 + v * 17);
    bindAutomation("release", compressor.release, (v) => 0.03 + v * 0.65);
    bindAutomation("level", level.gain, (v) => 0.5 + v * 1.25);
    configureEffect = (pedal, now) => {
      smooth(compressor.threshold, -18 + value(pedal, "ceiling", 0.78) * 17, now);
      smooth(compressor.ratio, 12 + value(pedal, "ceiling", 0.78) * 8, now);
      smooth(compressor.attack, 0.001, now);
      smooth(compressor.release, 0.03 + value(pedal, "release", 0.42) * 0.65, now);
      smooth(level.gain, 0.5 + value(pedal, "level", 0.72) * 1.25, now);
    };
  } else if (pedalId === "bass-presence") {
    const body = ctx.createBiquadFilter();
    body.type = "lowshelf";
    body.frequency.value = 150;
    const presence = ctx.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.value = 2200;
    presence.Q.value = 1.2;
    const level = ctx.createGain();
    effectInput.connect(body).connect(presence).connect(level).connect(effectOutput);
    bindAutomation("body", body.gain, (v) => -6 + v * 14);
    bindAutomation("presence", presence.gain, (v) => -5 + v * 12);
    bindAutomation("level", level.gain, (v) => 0.5 + v * 1.4);
    configureEffect = (pedal, now) => {
      smooth(body.gain, -6 + value(pedal, "body", 0.5) * 14, now);
      smooth(presence.gain, -5 + value(pedal, "presence", 0.46) * 12, now);
      smooth(level.gain, 0.5 + value(pedal, "level", 0.68) * 1.4, now);
    };
  } else {
    const tremolo = ctx.createGain();
    tremolo.gain.value = 1;
    effectInput.connect(tremolo).connect(effectOutput);
    const lfo = addOscillator("sine", 2);
    const depth = ctx.createGain();
    lfo.connect(depth).connect(tremolo.gain);
    bindAutomation("rate", lfo.frequency, (v) => 0.5 + v * 12);
    bindAutomation("depth", tremolo.gain, (v) => 1 - v * 0.5);
    bindAutomation("depth", depth.gain, (v) => v * 0.5);
    configureEffect = (pedal, now) => {
      const amount = value(pedal, "depth", 0.48);
      const shape = value(pedal, "shape", 0.12);
      lfo.type = shape < 0.34 ? "sine" : shape < 0.67 ? "triangle" : "square";
      smooth(lfo.frequency, 0.5 + value(pedal, "rate", 0.32) * 12, now);
      smooth(tremolo.gain, 1 - amount * 0.5, now);
      smooth(depth.gain, amount * 0.5, now);
    };
  }

  const now = ctx.currentTime;
  return {
    input,
    output,
    wet,
    dry,
    automation,
    effect: (pedal, time) => {
      configureEffect(pedal, time);
      const definition = PEDAL_BY_ID[pedal.pedalId];
      const mixControl = definition.controls.find((control) => control.id === "mix") ??
        definition.controls.find((control) => control.id === "intensity");
      if (!pedal.enabled) {
        smooth(dry.gain, 1, time);
        smooth(wet.gain, 0, time);
      } else {
        const mix = mixControl ? value(pedal, mixControl.id, mixControl.defaultValue) : 1;
        smooth(dry.gain, 1 - mix, time);
        smooth(wet.gain, mix, time);
      }
    },
    dispose: () => {
      disposers.forEach((dispose) => dispose());
      input.disconnect();
      output.disconnect();
      dry.disconnect();
      wet.disconnect();
      effectInput.disconnect();
      effectOutput.disconnect();
    },
  };
}

export class PedalboardProcessor {
  readonly input: GainNode;
  readonly output: GainNode;
  private units: PedalUnit[] = [];
  private signature: string | null = null;

  constructor(private readonly context: BaseAudioContext) {
    this.input = context.createGain();
    this.output = context.createGain();
  }

  sync(pedals: PedalInstance[], slotEnabled: boolean) {
    const signature = pedals.map((pedal) => `${pedal.id}:${pedal.pedalId}`).join("|");
    const now = this.context.currentTime;
    if (signature !== this.signature) {
      this.input.disconnect();
      this.output.disconnect();
      this.units.forEach((unit) => unit.dispose());
      this.units = pedals.map((pedal) => makePedalUnit(this.context, pedal.pedalId));
      this.signature = signature;
      if (this.units.length === 0) this.input.connect(this.output);
      else {
        this.input.connect(this.units[0].input);
        for (let i = 0; i < this.units.length - 1; i++) {
          this.units[i].output.connect(this.units[i + 1].input);
        }
        this.units[this.units.length - 1].output.connect(this.output);
      }
    }
    pedals.forEach((pedal, index) => {
      const unit = this.units[index];
      if (unit) unit.effect({ ...pedal, enabled: pedal.enabled && slotEnabled }, now);
    });
  }

  getAutomationBindings(pedals: PedalInstance[]): PedalAutomationBinding[] {
    return this.units.flatMap((unit, index) => {
      const pedal = pedals[index];
      if (!pedal) return [];
      const definition = PEDAL_BY_ID[pedal.pedalId];
      const mixControl = definition.controls.find((control) => control.id === "mix") ??
        definition.controls.find((control) => control.id === "intensity");
      const controls = unit.automation.map((binding) => ({
        parameterId: `pedal:${pedal.id}:${binding.controlId}`,
        parameter: binding.parameter,
        transform: binding.transform,
      }));
      if (mixControl) {
        controls.push(
          {
            parameterId: `pedal:${pedal.id}:${mixControl.id}`,
            parameter: unit.wet.gain,
            transform: (value) => value,
          },
          {
            parameterId: `pedal:${pedal.id}:${mixControl.id}`,
            parameter: unit.dry.gain,
            transform: (value) => 1 - value,
          },
        );
      }
      return controls;
    });
  }

  dispose() {
    this.input.disconnect();
    this.output.disconnect();
    this.units.forEach((unit) => unit.dispose());
    this.units = [];
    this.signature = null;
  }
}
