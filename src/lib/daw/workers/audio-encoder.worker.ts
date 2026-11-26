import { Mp3Encoder } from "@breezystack/lamejs";

interface EncodeMessage {
  channels: Float32Array[];
  sampleRate: number;
  formats: ("wav" | "mp3")[];
  bitDepth: 16 | 24;
  bitrate: 128 | 192 | 320;
}

interface EncodeResult {
  type: "file";
  format: "wav" | "mp3";
  blob: Blob;
}

self.onmessage = (event: MessageEvent<EncodeMessage>) => {
  void encode(event.data);
};

async function encode(request: EncodeMessage): Promise<void> {
  try {
    const [left, right] = request.channels;
    if (!left || !right || left.length !== right.length) {
      throw new Error("Audio export requires two equal-length stereo channels.");
    }
    for (const format of request.formats) {
      const blob = format === "wav"
        ? await encodeWav(request.channels, request.sampleRate, request.bitDepth)
        : await encodeMp3(left, right, request.sampleRate, request.bitrate);
      self.postMessage({ type: "file", format, blob } satisfies EncodeResult);
    }
    self.postMessage({ type: "done" });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Audio encoding failed.",
    });
  }
}

async function encodeWav(
  channels: Float32Array[],
  sampleRate: number,
  bitDepth: 16 | 24,
): Promise<Blob> {
  const length = channels[0].length;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channels.length * bytesPerSample;
  const dataSize = length * blockAlign;
  if (dataSize > 0xffff_ffff - 36) {
    throw new RangeError("PCM WAV output exceeds the RIFF size limit; choose a shorter range.");
  }
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const framesPerBlock = 65_536;
  let offset = 44;
  for (let start = 0; start < length; start += framesPerBlock) {
    const end = Math.min(length, start + framesPerBlock);
    for (let frame = start; frame < end; frame++) {
      for (const channel of channels) {
        const sample = Math.max(-1, Math.min(1, channel[frame]));
        if (bitDepth === 16) {
          view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
          offset += 2;
        } else {
          const value = Math.round(sample < 0 ? sample * 0x800000 : sample * 0x7fffff);
          view.setUint8(offset, value & 0xff);
          view.setUint8(offset + 1, (value >> 8) & 0xff);
          view.setUint8(offset + 2, (value >> 16) & 0xff);
          offset += 3;
        }
      }
    }
    self.postMessage({ type: "progress", format: "wav", value: end / length });
    await yieldToWorker();
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function encodeMp3(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  bitrate: number,
): Promise<Blob> {
  const encoder = new Mp3Encoder(2, sampleRate, bitrate);
  const chunks: Uint8Array[] = [];
  const frameSamples = 1152;
  for (let offset = 0; offset < left.length; offset += frameSamples * 128) {
    const blockEnd = Math.min(left.length, offset + frameSamples * 128);
    for (let start = offset; start < blockEnd; start += frameSamples) {
      const end = Math.min(start + frameSamples, blockEnd);
      const encoded = encoder.encodeBuffer(toPcm16(left.subarray(start, end)), toPcm16(right.subarray(start, end)));
      if (encoded.length) chunks.push(new Uint8Array(encoded));
    }
    self.postMessage({ type: "progress", format: "mp3", value: blockEnd / left.length });
    await yieldToWorker();
  }
  const flush = encoder.flush();
  if (flush.length) chunks.push(new Uint8Array(flush));
  const parts: BlobPart[] = chunks.map((chunk) => {
    const bytes = new Uint8Array(chunk.length);
    bytes.set(chunk);
    return bytes.buffer;
  });
  return new Blob(parts, { type: "audio/mpeg" });
}

function toPcm16(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
  }
  return pcm;
}

function writeString(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
}

function yieldToWorker(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
