/**
 * Transient detection for the audio editor's Slicing workflow.
 * Returns cut times relative to the selected sample range.
 */
export function detectTransientCuts(
  channels: Float32Array[],
  sampleRate: number,
  startSec: number,
  lengthSec: number,
  sensitivityDb = -18,
  minimumGapSec = 0.085
): number[] {
  if (!channels.length || sampleRate < 8000 || lengthSec <= 0) return [];
  const sourceLength = Math.min(...channels.map((channel) => channel.length));
  const startFrame = Math.max(0, Math.min(sourceLength, Math.floor(startSec * sampleRate)));
  const endFrame = Math.max(startFrame, Math.min(
    sourceLength,
    Math.ceil((startSec + lengthSec) * sampleRate)
  ));
  const totalFrames = endFrame - startFrame;
  const frameSize = Math.max(256, Math.round(sampleRate * 0.012));
  const hop = Math.max(128, Math.round(sampleRate * 0.005));
  if (totalFrames < frameSize * 2) return [];

  const rmsFrames: { time: number; rms: number }[] = [];
  let maxRms = 0;
  for (let offset = 0; offset + frameSize <= totalFrames; offset += hop) {
    const absoluteStart = startFrame + offset;
    let sumSquares = 0;
    let count = 0;
    for (const channel of channels) {
      for (let frame = 0; frame < frameSize; frame += 4) {
        const value = channel[absoluteStart + frame] ?? 0;
        sumSquares += value * value;
        count++;
      }
    }
    const rms = count ? Math.sqrt(sumSquares / count) : 0;
    rmsFrames.push({ time: offset / sampleRate, rms });
    maxRms = Math.max(maxRms, rms);
  }
  if (maxRms < 1e-5) return [];

  const threshold = maxRms * Math.pow(10, Math.max(-48, Math.min(-3, sensitivityDb)) / 20);
  const gapFrames = Math.max(1, Math.round(minimumGapSec * sampleRate));
  const candidates: { frame: number; strength: number }[] = [];
  for (let index = 2; index < rmsFrames.length - 1; index++) {
    const current = rmsFrames[index];
    const previous = rmsFrames[index - 1];
    const before = rmsFrames[index - 2];
    const next = rmsFrames[index + 1];
    const rise = current.rms - previous.rms;
    const ratio = current.rms / Math.max(1e-5, before.rms);
    const isLocalPeak = current.rms >= next.rms;
    if (
      current.rms >= threshold &&
      rise >= maxRms * 0.035 &&
      ratio >= 1.45 &&
      isLocalPeak
    ) {
      const candidateFrame = Math.max(0, Math.round(current.time * sampleRate));
      const last = candidates[candidates.length - 1];
      if (last && candidateFrame - last.frame < gapFrames) {
        if (current.rms > last.strength) {
          last.frame = candidateFrame;
          last.strength = current.rms;
        }
      } else {
        candidates.push({ frame: candidateFrame, strength: current.rms });
      }
    }
  }

  return candidates
    .map((candidate) => candidate.frame / sampleRate)
    .filter((time) => time >= 0.04 && time < lengthSec - 0.04);
}
