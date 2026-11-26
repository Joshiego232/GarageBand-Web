export {};

type DenoiseWorkerRequest =
  | {
      id: number;
      kind: "learn";
      channels: ArrayBuffer[];
      frameCount: number;
      startFrame: number;
      endFrame: number;
    }
  | {
      id: number;
      kind: "process";
      channels: ArrayBuffer[];
      frameCount: number;
      amount: number;
      noiseFingerprint?: number[][];
    };

const FFT_SIZE = 2048;
const HOP_SIZE = FFT_SIZE / 4;

function fft(real: Float64Array, imag: Float64Array, inverse = false) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = (inverse ? 2 : -2) * Math.PI / length;
    const stepR = Math.cos(angle);
    const stepI = Math.sin(angle);
    for (let base = 0; base < n; base += length) {
      let wr = 1;
      let wi = 0;
      for (let offset = 0; offset < length / 2; offset += 1) {
        const even = base + offset;
        const odd = even + length / 2;
        const tr = wr * real[odd] - wi * imag[odd];
        const ti = wr * imag[odd] + wi * real[odd];
        real[odd] = real[even] - tr;
        imag[odd] = imag[even] - ti;
        real[even] += tr;
        imag[even] += ti;
        const nextWr = wr * stepR - wi * stepI;
        wi = wr * stepI + wi * stepR;
        wr = nextWr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i += 1) {
      real[i] /= n;
      imag[i] /= n;
    }
  }
}

function hann(index: number) {
  return 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (FFT_SIZE - 1));
}

function getFrames(channel: Float32Array, start = 0, end = channel.length) {
  const frames: { start: number; rms: number }[] = [];
  for (let frameStart = start - FFT_SIZE / 2; frameStart < end; frameStart += HOP_SIZE) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < FFT_SIZE; i += 1) {
      const sampleIndex = frameStart + i;
      if (sampleIndex < start || sampleIndex >= end) continue;
      const sample = channel[sampleIndex];
      sum += sample * sample;
      count += 1;
    }
    if (count) frames.push({ start: frameStart, rms: Math.sqrt(sum / count) });
  }
  return frames;
}

function spectrum(channel: Float32Array, start: number) {
  const real = new Float64Array(FFT_SIZE);
  const imag = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i += 1) {
    const index = start + i;
    real[i] = (index >= 0 && index < channel.length ? channel[index] : 0) * hann(i);
  }
  fft(real, imag);
  const magnitude = new Float32Array(FFT_SIZE / 2 + 1);
  for (let i = 0; i < magnitude.length; i += 1) {
    magnitude[i] = Math.hypot(real[i], imag[i]);
  }
  return { real, imag, magnitude };
}

function learnProfile(channel: Float32Array, start: number, end: number) {
  const frames = getFrames(channel, start, end);
  if (!frames.length) throw new Error("The selected noise-print range contains no audio frames.");
  const selected = frames.sort((a, b) => a.rms - b.rms).slice(0, Math.max(1, Math.ceil(frames.length * 0.05)));
  const profile = new Float64Array(FFT_SIZE / 2 + 1);
  for (const frame of selected) {
    const { magnitude } = spectrum(channel, frame.start);
    for (let bin = 0; bin < profile.length; bin += 1) profile[bin] += magnitude[bin];
  }
  for (let bin = 0; bin < profile.length; bin += 1) profile[bin] /= selected.length;
  return profile;
}

function processChannel(
  channel: Float32Array,
  amount: number,
  profileValues?: number[],
  onProgress?: (progress: number) => void,
) {
  const frames = getFrames(channel);
  const profile = profileValues
    ? Float64Array.from(profileValues)
    : learnProfile(channel, 0, channel.length);
  const output = new Float32Array(channel.length);
  const weights = new Float32Array(channel.length);
  const scale = Math.max(0, Math.min(1, amount)) * 1.15;
  const floor = 0.08 + (1 - scale / 1.15) * 0.3;
  const step = Math.max(1, Math.floor(frames.length / 20));
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const start = frames[frameIndex].start;
    const { real, imag, magnitude } = spectrum(channel, start);
    for (let bin = 0; bin <= FFT_SIZE / 2; bin += 1) {
      const noise = profile[bin] ?? 0;
      const current = magnitude[bin];
      const reduction = Math.max(current - noise * scale, current * floor);
      const ratio = current > 1e-12 ? reduction / current : 0;
      real[bin] *= ratio;
      imag[bin] *= ratio;
      if (bin > 0 && bin < FFT_SIZE / 2) {
        real[FFT_SIZE - bin] *= ratio;
        imag[FFT_SIZE - bin] *= ratio;
      }
    }
    fft(real, imag, true);
    const first = Math.max(0, start);
    const last = Math.min(channel.length, start + FFT_SIZE);
    for (let index = first; index < last; index += 1) {
      const windowIndex = index - start;
      const weight = hann(windowIndex);
      output[index] += real[windowIndex] * weight;
      weights[index] += weight * weight;
    }
    if (frameIndex % step === 0) onProgress?.(frameIndex / frames.length);
  }
  for (let i = 0; i < output.length; i += 1) {
    if (weights[i] > 1e-8) output[i] /= weights[i];
    else output[i] = channel[i];
  }
  const quietFrames = frames
    .slice()
    .sort((a, b) => a.rms - b.rms)
    .slice(0, Math.max(1, Math.ceil(frames.length * 0.05)));
  let beforeNoise = 0;
  let afterNoise = 0;
  for (const frame of quietFrames) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < FFT_SIZE; i += 1) {
      const index = frame.start + i;
      if (index < 0 || index >= channel.length) continue;
      sum += output[index] * output[index];
      count += 1;
    }
    beforeNoise += frame.rms;
    afterNoise += Math.sqrt(sum / Math.max(1, count));
  }
  const reductionDb = Math.max(
    0,
    20 * Math.log10(
      beforeNoise / Math.max(afterNoise, 1e-9),
    ),
  );
  return { output, profile: Array.from(profile), reductionDb };
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<DenoiseWorkerRequest>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

workerScope.onmessage = (event: MessageEvent<DenoiseWorkerRequest>) => {
  const request = event.data;
  try {
    const channels = request.channels.map((channel) => new Float32Array(channel));
    if (request.kind === "learn") {
      const fingerprints = channels.map((channel) =>
        Array.from(learnProfile(channel, request.startFrame, request.endFrame)),
      );
      workerScope.postMessage({ id: request.id, kind: "learn", fingerprints });
      return;
    }

    const outputChannels: Float32Array[] = [];
    const fingerprints: number[][] = [];
    let reductionDb = 0;
    channels.forEach((channel, index) => {
      const result = processChannel(
        channel,
        request.amount,
        request.noiseFingerprint?.[index],
        (progress) => workerScope.postMessage({
          id: request.id,
          kind: "progress",
          progress: (index + progress) / channels.length,
        }),
      );
      outputChannels.push(result.output);
      fingerprints.push(result.profile);
      reductionDb += result.reductionDb / channels.length;
    });
    workerScope.postMessage({
      id: request.id,
      kind: "complete",
      channels: outputChannels.map((channel) => channel.buffer),
      fingerprints,
      reductionDb,
    }, outputChannels.map((channel) => channel.buffer as ArrayBuffer));
  } catch (error) {
    workerScope.postMessage({
      id: request.id,
      kind: "error",
      message: error instanceof Error ? error.message : "Audio denoising failed.",
    });
  }
};
