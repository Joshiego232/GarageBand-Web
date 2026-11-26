import type { StoredBuffer } from "./idb";

const HEADER_SIZE = 18;
const MAGIC = "WBA1";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function encodeStoredBuffer(buffer: StoredBuffer): Blob {
  const frameCount = buffer.channels[0]?.length ?? 0;
  if (
    !Number.isSafeInteger(buffer.sampleRate) ||
    buffer.sampleRate <= 0 ||
    buffer.channels.length === 0 ||
    buffer.channels.length > 0xffff ||
    frameCount === 0 ||
    buffer.channels.some((channel) => channel.length !== frameCount)
  ) {
    throw new Error("Audio data has an invalid format");
  }

  const name = textEncoder.encode(buffer.name);
  const payloadOffset = Math.ceil((HEADER_SIZE + name.length) / 4) * 4;
  const header = new Uint8Array(payloadOffset);
  header.set(textEncoder.encode(MAGIC), 0);

  const view = new DataView(header.buffer);
  view.setUint32(4, buffer.sampleRate, true);
  view.setUint16(8, buffer.channels.length, true);
  view.setUint32(10, frameCount, true);
  view.setUint32(14, name.length, true);
  header.set(name, HEADER_SIZE);

  const parts: BlobPart[] = [header];
  for (const channel of buffer.channels) {
    const channelBytes = new Uint8Array(channel.byteLength);
    channelBytes.set(
      new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength),
    );
    parts.push(channelBytes.buffer);
  }
  return new Blob(parts, { type: "application/octet-stream" });
}

export async function decodeStoredBuffer(blob: Blob): Promise<StoredBuffer> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length < HEADER_SIZE || textDecoder.decode(bytes.subarray(0, 4)) !== MAGIC) {
    throw new Error("Cloud audio file has an invalid header");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sampleRate = view.getUint32(4, true);
  const channelCount = view.getUint16(8, true);
  const frameCount = view.getUint32(10, true);
  const nameLength = view.getUint32(14, true);
  const payloadOffset = Math.ceil((HEADER_SIZE + nameLength) / 4) * 4;
  const expectedLength = payloadOffset + channelCount * frameCount * Float32Array.BYTES_PER_ELEMENT;

  if (
    sampleRate === 0 ||
    channelCount === 0 ||
    frameCount === 0 ||
    payloadOffset > bytes.length ||
    expectedLength !== bytes.length
  ) {
    throw new Error("Cloud audio file is incomplete or invalid");
  }

  const channels: Float32Array[] = [];
  for (let channel = 0; channel < channelCount; channel++) {
    const start = payloadOffset + channel * frameCount * Float32Array.BYTES_PER_ELEMENT;
    const data = bytes.slice(start, start + frameCount * Float32Array.BYTES_PER_ELEMENT);
    channels.push(new Float32Array(data.buffer));
  }

  return {
    sampleRate,
    channels,
    name: textDecoder.decode(bytes.subarray(HEADER_SIZE, HEADER_SIZE + nameLength)),
  };
}
