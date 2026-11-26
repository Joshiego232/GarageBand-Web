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
      const mixControl = definition.controls.find((control) =>
        control.id === "mix" || control.id === "intensity",
      );
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
      const mixControl = definition.controls.find((control) =>
        control.id === "mix" || control.id === "intensity",
      );
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
