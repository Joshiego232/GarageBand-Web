export type FlexTimeMode = "monophonic" | "polyphonic";

function clampFactor(factor: number) {
  return Math.max(0.5, Math.min(2, Number.isFinite(factor) ? factor : 1));
}

function sampleAt(data: Float32Array, position: number): number {
  const bounded = Math.max(0, Math.min(data.length - 1.001, position));
  const index = Math.floor(bounded);
  const mix = bounded - index;
  const a = data[index] ?? 0;
  const b = data[index + 1] ?? a;
  return a + (b - a) * mix;
}

function makeMonoReference(channels: Float32Array[], length: number) {
  const mono = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (const channel of channels) sum += channel[i] ?? 0;
    mono[i] = sum / Math.max(1, channels.length);
  }
  return mono;
}

function windowValue(index: number, size: number) {
  return 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / Math.max(1, size - 1));
}

/** WSOLA with shared stereo alignment, designed for monophonic voice and lead lines. */
function wsolaStretch(
  channels: Float32Array[],
  sampleRate: number,
  factor: number
): Float32Array[] {
  const inputLength = Math.min(...channels.map((channel) => channel.length));
  const outputLength = Math.max(1, Math.round(inputLength * factor));
  if (inputLength < 256 || Math.abs(factor - 1) < 0.001) {
    return channels.map((channel) => channel.slice(0, inputLength));
  }

  const windowSize = Math.min(inputLength, Math.max(256, Math.round(sampleRate * 0.04)));
  const synthesisHop = Math.max(64, Math.floor(windowSize / 2));
  const overlap = windowSize - synthesisHop;
  const analysisHop = synthesisHop / factor;
  const searchRadius = Math.max(24, Math.round(sampleRate * 0.009));
  const mono = makeMonoReference(channels, inputLength);
  const output = channels.map(() => new Float64Array(outputLength));
  const weight = new Float64Array(outputLength);
  let previousSource = 0;

  for (let frame = 0, outputStart = 0; outputStart < outputLength; frame++, outputStart += synthesisHop) {
    const expectedSource = Math.min(
      Math.max(0, inputLength - windowSize),
      Math.round(frame * analysisHop)
    );
    let selectedSource = expectedSource;

    if (frame > 0 && overlap > 48) {
      const referenceStart = previousSource + synthesisHop;
      const minimum = Math.max(0, expectedSource - searchRadius);
      const maximum = Math.min(inputLength - windowSize, expectedSource + searchRadius);
      let bestScore = -Infinity;

      for (let candidate = minimum; candidate <= maximum; candidate += 4) {
        let dot = 0;
        let sourceEnergy = 1e-9;
        let referenceEnergy = 1e-9;
        for (let index = 0; index < overlap; index += 8) {
          const reference = mono[referenceStart + index] ?? 0;
          const current = mono[candidate + index] ?? 0;
          dot += reference * current;
          sourceEnergy += current * current;
          referenceEnergy += reference * reference;
        }
        const score = dot / Math.sqrt(sourceEnergy * referenceEnergy);
        if (score > bestScore) {
          bestScore = score;
          selectedSource = candidate;
        }
      }
    }

    previousSource = selectedSource;
    const available = Math.min(windowSize, outputLength - outputStart);
    for (let index = 0; index < available; index++) {
      const weightValue = windowValue(index, windowSize);
      const target = outputStart + index;
      weight[target] += weightValue;
      for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
        output[channelIndex][target] +=
          sampleAt(channels[channelIndex], selectedSource + index) * weightValue;
      }
    }
  }

  return output.map((channel) => {
    const result = new Float32Array(outputLength);
    for (let i = 0; i < outputLength; i++) {
      result[i] = weight[i] > 1e-6 ? channel[i] / weight[i] : 0;
    }
    return result;
  });
}

function fft(real: Float64Array, imag: Float64Array, inverse: boolean) {
  const size = real.length;
  let j = 0;
  for (let i = 1; i < size; i++) {
    let bit = size >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  for (let length = 2; length <= size; length <<= 1) {
    const angle = (inverse ? 2 : -2) * Math.PI / length;
    const rootReal = Math.cos(angle);
    const rootImag = Math.sin(angle);
    for (let start = 0; start < size; start += length) {
      let phaseReal = 1;
      let phaseImag = 0;
      const half = length >> 1;
      for (let offset = 0; offset < half; offset++) {
        const even = start + offset;
        const odd = even + half;
        const oddReal = real[odd] * phaseReal - imag[odd] * phaseImag;
        const oddImag = real[odd] * phaseImag + imag[odd] * phaseReal;
        const evenReal = real[even];
        const evenImag = imag[even];
        real[even] = evenReal + oddReal;
        imag[even] = evenImag + oddImag;
        real[odd] = evenReal - oddReal;
        imag[odd] = evenImag - oddImag;
        const nextPhaseReal = phaseReal * rootReal - phaseImag * rootImag;
        phaseImag = phaseReal * rootImag + phaseImag * rootReal;
        phaseReal = nextPhaseReal;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < size; i++) {
      real[i] /= size;
      imag[i] /= size;
    }
  }
}

/** Phase-vocoder time stretch for polyphonic material; stereo channels share analysis timing. */
function phaseVocoderStretch(
  channels: Float32Array[],
  sampleRate: number,
  factor: number
): Float32Array[] {
  const inputLength = Math.min(...channels.map((channel) => channel.length));
  const outputLength = Math.max(1, Math.round(inputLength * factor));
  if (inputLength < 1024 || Math.abs(factor - 1) < 0.001) {
    return channels.map((channel) => channel.slice(0, inputLength));
  }

  const fftSize = Math.min(4096, Math.max(1024, 2 ** Math.floor(Math.log2(Math.min(inputLength, 4096)))));
  const synthesisHop = fftSize / 4;
  const analysisHop = synthesisHop / factor;
  const frameCount = Math.ceil((inputLength - 1) / analysisHop) + 1;
  const weight = new Float64Array(outputLength);
  const output = channels.map(() => new Float64Array(outputLength));
  const window = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) window[i] = windowValue(i, fftSize);

  for (const source of channels) {
    const channelIndex = channels.indexOf(source);
    const previousPhase = new Float64Array(fftSize / 2 + 1);
    const outputPhase = new Float64Array(fftSize / 2 + 1);
    let hasPrevious = false;

    for (let frame = 0; frame < frameCount; frame++) {
      const sourceStart = frame * analysisHop;
      const targetStart = frame * synthesisHop;
      if (targetStart >= outputLength) break;

      const real = new Float64Array(fftSize);
      const imag = new Float64Array(fftSize);
      for (let i = 0; i < fftSize; i++) {
        real[i] = sampleAt(source, sourceStart + i) * window[i];
      }
      fft(real, imag, false);

      for (let bin = 0; bin <= fftSize / 2; bin++) {
        const magnitude = Math.hypot(real[bin], imag[bin]);
        const phase = Math.atan2(imag[bin], real[bin]);
        if (!hasPrevious) {
          outputPhase[bin] = phase;
        } else {
          const expected = (2 * Math.PI * bin * analysisHop) / fftSize;
          let difference = phase - previousPhase[bin] - expected;
          while (difference > Math.PI) difference -= 2 * Math.PI;
          while (difference < -Math.PI) difference += 2 * Math.PI;
          const trueAdvance = expected + difference;
          outputPhase[bin] += trueAdvance * (synthesisHop / analysisHop);
        }
        previousPhase[bin] = phase;
        real[bin] = magnitude * Math.cos(outputPhase[bin]);
        imag[bin] = magnitude * Math.sin(outputPhase[bin]);
      }
      hasPrevious = true;

      // Rebuild the conjugate half-spectrum for a real-valued inverse transform.
      for (let bin = 1; bin < fftSize / 2; bin++) {
        real[fftSize - bin] = real[bin];
        imag[fftSize - bin] = -imag[bin];
      }
      fft(real, imag, true);

      const available = Math.min(fftSize, outputLength - targetStart);
      for (let i = 0; i < available; i++) {
        const windowWeight = window[i] * window[i];
        output[channelIndex][targetStart + i] += real[i] * window[i];
        if (channelIndex === 0) weight[targetStart + i] += windowWeight;
      }
    }
  }

  return output.map((channel) => {
    const result = new Float32Array(outputLength);
    for (let i = 0; i < outputLength; i++) {
      result[i] = weight[i] > 1e-7 ? channel[i] / weight[i] : 0;
    }
    // Soft fades avoid a discontinuity at the edges of the edited range.
    const fade = Math.min(Math.round(sampleRate * 0.008), Math.floor(outputLength / 4));
    for (let i = 0; i < fade; i++) {
      const amount = i / Math.max(1, fade);
      result[i] *= amount;
      result[outputLength - 1 - i] *= amount;
    }
    return result;
  });
}

/**
 * Apply pitch-preserving Flex Time to a selected PCM range.
 * factor > 1 makes the selected region longer; factor < 1 makes it shorter.
 */
export function stretchAudioChannels(
  channels: Float32Array[],
  sampleRate: number,
  factor: number,
  mode: FlexTimeMode
): Float32Array[] {
  if (!channels.length || sampleRate < 8000) return [];
  const targetFactor = clampFactor(factor);
  if (mode === "monophonic") {
    return wsolaStretch(channels, sampleRate, targetFactor);
  }
  return phaseVocoderStretch(channels, sampleRate, targetFactor);
}
