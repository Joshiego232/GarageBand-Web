export interface DetectedPitchSegment {
  id: string;
  startSec: number;
  endSec: number;
  detectedPitch: number;
  detectedMidi: number;
  targetMidi: number;
  confidence: number;
}

interface PitchFrame {
  time: number;
  pitch: number;
  midi: number;
  confidence: number;
}

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

export function snapMidiPitchToScale(
  midiPitch: number,
  tonic: number,
  mode: "major" | "minor"
): number {
  const allowed = mode === "major" ? MAJOR_SCALE : MINOR_SCALE;
  const root = ((Math.round(tonic) % 12) + 12) % 12;
  let best = Math.round(midiPitch);
  let bestDistance = Infinity;
  for (let candidate = Math.round(midiPitch) - 12; candidate <= Math.round(midiPitch) + 12; candidate++) {
    const pitchClass = ((candidate % 12) + 12) % 12;
    const scaleClass = ((pitchClass - root) % 12 + 12) % 12;
    if (!allowed.includes(scaleClass)) continue;
    const distance = Math.abs(candidate - midiPitch);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Monophonic pitch detection for voice and single-note recordings.
 * Uses a decimated YIN-style difference analysis; stereo channels are folded
 * to mono for analysis only. Times returned are relative to the selected range.
 */
export function detectMonophonicPitchSegments(
  channels: Float32Array[],
  sampleRate: number,
  startSec = 0,
  lengthSec?: number
): DetectedPitchSegment[] {
  if (!channels.length || sampleRate < 8000) return [];
  const sourceLength = Math.min(...channels.map((channel) => channel.length));
  const startFrame = Math.max(0, Math.min(sourceLength, Math.floor(startSec * sampleRate)));
  const availableFrames = Math.max(0, sourceLength - startFrame);
  const requestedFrames = lengthSec === undefined
    ? availableFrames
    : Math.min(availableFrames, Math.max(0, Math.floor(lengthSec * sampleRate)));
  if (requestedFrames < sampleRate * 0.16) return [];

  const decimation = Math.max(2, Math.round(sampleRate / 11025));
  const analysisRate = sampleRate / decimation;
  const mono = new Float32Array(Math.ceil(requestedFrames / decimation));
  for (let i = 0, source = startFrame; source < startFrame + requestedFrames; source += decimation, i++) {
    let sum = 0;
    for (const channel of channels) sum += channel[source] ?? 0;
    mono[i] = sum / channels.length;
  }

  const frameSize = 512;
  const hop = 128;
  const minLag = Math.max(8, Math.floor(analysisRate / 1000));
  const maxLag = Math.min(Math.floor(frameSize / 2), Math.ceil(analysisRate / 65));
  const rawFrames: PitchFrame[] = [];

  for (let frameStart = 0; frameStart + frameSize < mono.length; frameStart += hop) {
    const frame = mono.subarray(frameStart, frameStart + frameSize);
    let energy = 0;
    for (let i = 0; i < frame.length; i += 2) energy += frame[i] * frame[i];
    const rms = Math.sqrt(energy / Math.ceil(frame.length / 2));
    if (rms < 0.008) continue;

    const difference = new Float64Array(maxLag + 1);
    let cumulative = 0;
    const normalized = new Float64Array(maxLag + 1);
    for (let lag = 1; lag <= maxLag; lag++) {
      let sum = 0;
      for (let i = 0; i < frameSize - lag; i += 2) {
        const delta = frame[i] - frame[i + lag];
        sum += delta * delta;
      }
      difference[lag] = sum;
      cumulative += sum;
      normalized[lag] = cumulative > 1e-12 ? (sum * lag) / cumulative : 1;
    }

    let bestLag = -1;
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (normalized[lag] < 0.18) {
        bestLag = lag;
        while (bestLag + 1 <= maxLag && normalized[bestLag + 1] < normalized[bestLag]) bestLag++;
        break;
      }
    }
    if (bestLag < 0) {
      let bestValue = Infinity;
      for (let lag = minLag; lag <= maxLag; lag++) {
        if (normalized[lag] < bestValue) {
          bestValue = normalized[lag];
          bestLag = lag;
        }
      }
    }

    const confidence = Math.max(0, Math.min(1, 1 - normalized[bestLag]));
    if (bestLag < minLag || confidence < 0.56) continue;
    const frequency = analysisRate / bestLag;
    const pitch = 69 + 12 * Math.log2(frequency / 440);
    if (!Number.isFinite(pitch) || pitch < 28 || pitch > 100) continue;

    rawFrames.push({
      time: (frameStart + frameSize / 2) / analysisRate,
      pitch,
      midi: Math.round(pitch),
      confidence,
    });
  }

  if (!rawFrames.length) return [];

  // Median smoothing removes isolated octave jumps without flattening vibrato.
  const frames = rawFrames.map((frame, index) => {
    const neighborhood = rawFrames
      .slice(Math.max(0, index - 1), Math.min(rawFrames.length, index + 2))
      .map((item) => item.pitch)
      .sort((a, b) => a - b);
    const pitch = neighborhood[Math.floor(neighborhood.length / 2)] ?? frame.pitch;
    return { ...frame, pitch, midi: Math.round(pitch) };
  });

  const segments: DetectedPitchSegment[] = [];
  let group: PitchFrame[] = [];
  const finishGroup = () => {
    if (!group.length) return;
    const duration = hop / analysisRate;
    const start = Math.max(0, group[0].time - duration * 0.6);
    const end = Math.min(requestedFrames / sampleRate, group[group.length - 1].time + duration * 0.6);
    if (end - start >= 0.085) {
      const detectedPitch = group.reduce((sum, item) => sum + item.pitch, 0) / group.length;
      const confidence = group.reduce((sum, item) => sum + item.confidence, 0) / group.length;
      const detectedMidi = Math.round(detectedPitch);
      segments.push({
        id: `pitch-${segments.length + 1}-${Math.round(start * 1000)}`,
        startSec: start,
        endSec: end,
        detectedPitch,
        detectedMidi,
        targetMidi: detectedMidi,
        confidence,
      });
    }
    group = [];
  };

  for (const frame of frames) {
    const previous = group[group.length - 1];
    if (previous && Math.abs(frame.pitch - previous.pitch) > 0.72) finishGroup();
    group.push(frame);
  }
  finishGroup();
  return segments;
}

function interpolateSample(data: Float32Array, position: number): number {
  const bounded = Math.max(0, Math.min(data.length - 1.001, position));
  const index = Math.floor(bounded);
  const fraction = bounded - index;
  const a = data[index] ?? 0;
  const b = data[index + 1] ?? a;
  return a + (b - a) * fraction;
}

function granularPitchShift(
  input: Float32Array,
  sampleRate: number,
  semitones: number
): Float32Array {
  if (Math.abs(semitones) < 0.04 || input.length < 128) return input.slice();
  const ratio = Math.pow(2, semitones / 12);
  const grainSize = Math.min(input.length, Math.max(128, Math.round(sampleRate * 0.045)));
  const hop = Math.max(32, Math.floor(grainSize / 2));
  const sum = new Float64Array(input.length);
  const weights = new Float64Array(input.length);

  for (let grainStart = 0; grainStart < input.length; grainStart += hop) {
    const grainLength = Math.min(grainSize, input.length - grainStart);
    for (let index = 0; index < grainLength; index++) {
      const outputIndex = grainStart + index;
      const sourcePosition = grainStart + index * ratio;
      const phase = grainSize <= 1 ? 0 : index / (grainSize - 1);
      const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
      sum[outputIndex] += interpolateSample(input, sourcePosition) * window;
      weights[outputIndex] += window;
    }
  }

  const shifted = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    shifted[i] = weights[i] > 1e-5 ? sum[i] / weights[i] : input[i] ?? 0;
  }

  const edge = Math.min(Math.floor(sampleRate * 0.012), Math.floor(input.length / 4));
  for (let i = 0; i < edge; i++) {
    const mix = i / Math.max(1, edge);
    shifted[i] = (input[i] ?? 0) * (1 - mix) + shifted[i] * mix;
    const tail = input.length - 1 - i;
    shifted[tail] = (input[tail] ?? 0) * (1 - mix) + shifted[tail] * mix;
  }
  return shifted;
}

/**
 * Correct selected monophonic note segments with overlapping granular pitch
 * shifting. Returns a new PCM copy cropped to the region's selected sample range.
 * The original recording is never mutated.
 */
export function applyMonophonicPitchCorrection(
  channels: Float32Array[],
  sampleRate: number,
  startSec: number,
  lengthSec: number,
  segments: DetectedPitchSegment[],
  strength = 1
): Float32Array[] {
  const totalFrames = Math.min(...channels.map((channel) => channel.length));
  const startFrame = Math.max(0, Math.min(totalFrames, Math.floor(startSec * sampleRate)));
  const endFrame = Math.max(startFrame, Math.min(totalFrames, Math.ceil((startSec + lengthSec) * sampleRate)));
  const amount = Math.max(0, Math.min(1, strength));

  return channels.map((channel) => {
    const output = channel.slice(startFrame, endFrame);
    for (const segment of segments) {
      const localStart = Math.max(0, Math.floor(segment.startSec * sampleRate));
      const localEnd = Math.min(output.length, Math.ceil(segment.endSec * sampleRate));
      if (localEnd - localStart < 128) continue;
      const source = output.slice(localStart, localEnd);
      const shift = (segment.targetMidi - segment.detectedPitch) * amount;
      const corrected = granularPitchShift(source, sampleRate, shift);
      output.set(corrected, localStart);
    }
    return output;
  });
}
