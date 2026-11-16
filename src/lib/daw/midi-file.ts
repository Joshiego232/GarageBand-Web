import { PPQ, uid } from "./types";

export interface ImportedMidiNote {
  pitch: number;
  velocity: number;
  start: number;
  length: number;
  channel: number;
}

export interface ImportedMidiTrack {
  name: string;
  notes: ImportedMidiNote[];
}

export interface ParsedMidiFile {
  format: 0 | 1;
  tracks: ImportedMidiTrack[];
  tempo: number | null;
  timeSig: [number, number] | null;
  hasTempoChanges: boolean;
}

class MidiParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MidiParseError";
  }
}

export function parseStandardMidiFile(bytes: Uint8Array): ParsedMidiFile {
  let offset = 0;
  const ensureAvailable = (length: number, limit = bytes.length) => {
    if (length < 0 || offset + length > limit) {
      throw new MidiParseError("The MIDI file is truncated or malformed");
    }
  };
  const readU16 = (limit = bytes.length) => {
    ensureAvailable(2, limit);
    const value = (bytes[offset] << 8) | bytes[offset + 1];
    offset += 2;
    return value;
  };
  const readU32 = (limit = bytes.length) => {
    ensureAvailable(4, limit);
    const value = bytes[offset] * 0x1000000 +
      (bytes[offset + 1] << 16) +
      (bytes[offset + 2] << 8) +
      bytes[offset + 3];
    offset += 4;
    return value;
  };
  const readText = (length: number, limit = bytes.length) => {
    ensureAvailable(length, limit);
    const text = String.fromCharCode(...bytes.subarray(offset, offset + length));
    offset += length;
    return text;
  };
  const readVlq = (limit: number) => {
    let value = 0;
    for (let count = 0; count < 4; count++) {
      ensureAvailable(1, limit);
      const byte = bytes[offset++];
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    throw new MidiParseError("The MIDI file contains an invalid variable-length value");
  };

  if (readText(4) !== "MThd") {
    throw new MidiParseError("This is not a Standard MIDI File");
  }
  const headerLength = readU32();
  if (headerLength < 6) throw new MidiParseError("The MIDI file header is invalid");
  ensureAvailable(headerLength);
  const headerEnd = offset + headerLength;
  const format = readU16();
  const trackCount = readU16();
  const division = readU16();
  offset = headerEnd;

  if (format !== 0 && format !== 1) {
    throw new MidiParseError("Only MIDI file formats 0 and 1 are supported");
  }
  if (trackCount === 0 || (format === 0 && trackCount !== 1)) {
    throw new MidiParseError("The MIDI file has an invalid track count");
  }
  if (division === 0 || (division & 0x8000) !== 0) {
    throw new MidiParseError("SMPTE-timed MIDI files are not supported");
  }

  const tracks: ImportedMidiTrack[] = [];
  const tempos: number[] = [];
  let timeSig: [number, number] | null = null;
  let parsedTrackChunks = 0;

  while (offset + 8 <= bytes.length && parsedTrackChunks < trackCount) {
    const chunkType = readText(4);
    const chunkLength = readU32();
    ensureAvailable(chunkLength);
    const chunkEnd = offset + chunkLength;
    if (chunkType !== "MTrk") {
      offset = chunkEnd;
      continue;
    }
    parsedTrackChunks++;
    let tick = 0;
    let runningStatus = 0;
    let name = "";
    const notes: ImportedMidiNote[] = [];
    const active = new Map<string, { tick: number; velocity: number }[]>();

    while (offset < chunkEnd) {
      tick += readVlq(chunkEnd);
      ensureAvailable(1, chunkEnd);
      let status = bytes[offset];
      if (status & 0x80) {
        offset++;
        if (status < 0xf0) runningStatus = status;
      } else {
        if (runningStatus < 0x80) {
          throw new MidiParseError("The MIDI file uses running status without a prior event");
        }
        status = runningStatus;
      }

      if (status === 0xff) {
        ensureAvailable(1, chunkEnd);
        const metaType = bytes[offset++];
        const length = readVlq(chunkEnd);
        ensureAvailable(length, chunkEnd);
        const payload = bytes.subarray(offset, offset + length);
        if (metaType === 0x03 && !name) {
          name = new TextDecoder().decode(payload).replace(/\0/g, "").trim();
        } else if (metaType === 0x51 && length === 3) {
          const micros = payload[0] * 0x10000 + payload[1] * 0x100 + payload[2];
          if (micros > 0) tempos.push(Math.round(60000000 / micros));
        } else if (metaType === 0x58 && length >= 2 && !timeSig) {
          const denominator = 2 ** payload[1];
          if (Number.isInteger(denominator) && denominator <= 64) {
            timeSig = [payload[0], denominator];
          }
        }
        offset += length;
        if (metaType === 0x2f) break;
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        const length = readVlq(chunkEnd);
        ensureAvailable(length, chunkEnd);
        offset += length;
        runningStatus = 0;
        continue;
      }
      if (status >= 0xf0) {
        throw new MidiParseError("The MIDI file contains an unsupported system event");
      }

      const eventType = status & 0xf0;
      const channel = status & 0x0f;
      const dataLength = eventType === 0xc0 || eventType === 0xd0 ? 1 : 2;
      ensureAvailable(dataLength, chunkEnd);
      const first = bytes[offset++];
      const second = dataLength === 2 ? bytes[offset++] : 0;
      if (first & 0x80 || second & 0x80) {
        throw new MidiParseError("The MIDI file contains an invalid event");
      }

      if (eventType === 0x90 && second > 0) {
        const key = `${channel}:${first}`;
        const queue = active.get(key) ?? [];
        queue.push({ tick, velocity: second });
        active.set(key, queue);
      } else if (eventType === 0x80 || (eventType === 0x90 && second === 0)) {
        const key = `${channel}:${first}`;
        const queue = active.get(key);
        const started = queue?.shift();
        if (started) {
          notes.push({
            pitch: first,
            velocity: started.velocity,
            start: Math.round(started.tick * PPQ / division),
            length: Math.max(1, Math.round((tick - started.tick) * PPQ / division)),
            channel,
          });
          if (!queue?.length) active.delete(key);
        }
      }
    }
    offset = chunkEnd;
    if (notes.length) {
      tracks.push({
        name: name || `MIDI Track ${parsedTrackChunks}`,
        notes: notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch),
      });
    }
  }

  if (parsedTrackChunks !== trackCount) {
    throw new MidiParseError("The MIDI file is missing one or more track chunks");
  }
  if (!tracks.length) throw new MidiParseError("The MIDI file contains no note events");

  const uniqueTempos = new Set(tempos);
  return {
    format,
    tracks,
    tempo: tempos[0] ?? null,
    timeSig,
    hasTempoChanges: uniqueTempos.size > 1,
  };
}

export function createImportedMidiNotes(notes: ImportedMidiNote[]) {
  return notes.map((note) => ({
    id: uid(),
    pitch: note.pitch,
    velocity: note.velocity,
    start: note.start,
    length: note.length,
  }));
}
