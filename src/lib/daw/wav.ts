// ============================================================
// WAV encoding + audio buffer helpers
// ============================================================

export function encodeWav(
  channels: Float32Array[],
  sampleRate: number,
  bitDepth: 16 | 24 = 16
): Blob {
  const numCh = channels.length;
  const len = channels[0]?.length ?? 0;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = len * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let off = 44;
  if (bitDepth === 16) {
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < numCh; c++) {
        const s = Math.max(-1, Math.min(1, channels[c][i]));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      }
    }
  } else {
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < numCh; c++) {
        const s = Math.max(-1, Math.min(1, channels[c][i]));
        const val = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
        view.setUint8(off, val & 0xff);
        view.setUint8(off + 1, (val >> 8) & 0xff);
        view.setUint8(off + 2, (val >> 16) & 0xff);
        off += 3;
      }
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Compute min/max peak pairs for waveform drawing */
export function computePeaks(
  channels: Float32Array[],
  startSample: number,
  endSample: number,
  buckets: number
): Float32Array {
  const peaks = new Float32Array(buckets * 2);
  const len = channels[0]?.length ?? 0;
  const s0 = Math.max(0, Math.floor(startSample));
  const s1 = Math.min(len, Math.ceil(endSample));
  const step = Math.max(1, (s1 - s0) / buckets);
  for (let b = 0; b < buckets; b++) {
    let min = 0;
    let max = 0;
    const from = Math.floor(s0 + b * step);
    const to = Math.min(s1, Math.floor(s0 + (b + 1) * step));
    for (let s = from; s < to; s++) {
      for (let c = 0; c < channels.length; c++) {
        const v = channels[c][s];
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    peaks[b * 2] = min;
    peaks[b * 2 + 1] = max;
  }
  return peaks;
}
