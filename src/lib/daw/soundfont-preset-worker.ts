interface PresetHeader {
  bank: number;
  program: number;
  presetName: string;
}

interface ScanRequest {
  id: number;
  buffer: ArrayBuffer;
}

interface ScanResponse {
  id: number;
  presets?: PresetHeader[];
  error?: string;
}

function readText(bytes: DataView, offset: number, length: number): string {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    const code = bytes.getUint8(offset + index);
    if (code === 0) break;
    value += String.fromCharCode(code);
  }
  return value.trim();
}

function scanPresets(buffer: ArrayBuffer): PresetHeader[] {
  const view = new DataView(buffer);
  if (view.byteLength < 12 || readText(view, 0, 4) !== "RIFF" || readText(view, 8, 4) !== "sfbk") {
    throw new Error("This file is not a valid SF2/SF3 SoundFont bank.");
  }

  let pdtaStart = -1;
  let pdtaEnd = -1;
  for (let offset = 12; offset + 8 <= view.byteLength;) {
    const id = readText(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    if (dataEnd > view.byteLength) throw new Error("The SoundFont contains an invalid RIFF chunk.");
    if (id === "LIST" && size >= 4 && readText(view, dataStart, 4) === "pdta") {
      pdtaStart = dataStart + 4;
      pdtaEnd = dataEnd;
      break;
    }
    offset = dataEnd + (size & 1);
  }
  if (pdtaStart < 0) throw new Error("The SoundFont has no preset metadata list.");

  for (let offset = pdtaStart; offset + 8 <= pdtaEnd;) {
    const id = readText(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    if (dataEnd > pdtaEnd) throw new Error("The SoundFont preset list is malformed.");
    if (id === "phdr") {
      const recordSize = 38;
      if (size < recordSize || size % recordSize !== 0) {
        throw new Error("The SoundFont preset headers are malformed.");
      }
      const presets: PresetHeader[] = [];
      for (let index = 0; index < size / recordSize - 1; index += 1) {
        const record = dataStart + index * recordSize;
        const presetName = readText(view, record, 20);
        const program = view.getUint16(record + 20, true);
        const bank = view.getUint16(record + 22, true);
        if (presetName && program < 128) presets.push({ bank, program, presetName });
      }
      if (!presets.length) throw new Error("No usable presets were found in this SoundFont.");
      return presets;
    }
    offset = dataEnd + (size & 1);
  }
  throw new Error("The SoundFont does not contain preset headers.");
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<ScanRequest>) => void) | null;
  postMessage: (message: ScanResponse) => void;
};
workerScope.onmessage = (event: MessageEvent<ScanRequest>) => {
  const { id, buffer } = event.data;
  let response: ScanResponse;
  try {
    response = { id, presets: scanPresets(buffer) };
  } catch (error) {
    response = {
      id,
      error: error instanceof Error ? error.message : "Could not read the SoundFont preset list.",
    };
  }
  workerScope.postMessage(response);
};
