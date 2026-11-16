interface PresetHeader {
  bank: number;
  program: number;
  presetName: string;
}

interface ScanResponse {
  id: number;
  presets?: PresetHeader[];
  error?: string;
}

let nextRequestId = 0;

export function scanSoundFontPresets(buffer: ArrayBuffer): Promise<PresetHeader[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./soundfont-preset-worker.ts", import.meta.url),
      { type: "module" },
    );
    const id = ++nextRequestId;
    const cleanup = () => worker.terminate();
    worker.onmessage = (event: MessageEvent<ScanResponse>) => {
      if (event.data.id !== id) return;
      cleanup();
      if (event.data.error) {
        reject(new Error(event.data.error));
        return;
      }
      if (!event.data.presets?.length) {
        reject(new Error("No playable presets were found in this SoundFont."));
        return;
      }
      resolve(event.data.presets);
    };
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || "SoundFont preset scanning failed."));
    };
    const scanCopy = buffer.slice(0);
    worker.postMessage({ id, buffer: scanCopy }, [scanCopy]);
  });
}
