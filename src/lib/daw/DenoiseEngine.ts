import type { StoredBuffer } from "./idb";

export interface DenoiseOptions {
  amount: number;
  highPass: boolean;
  noiseFingerprint?: number[][];
}

export interface DenoiseResult {
  buffer: StoredBuffer;
  noiseFingerprint: number[][];
  reductionDb: number;
  cacheKey: string;
}

type WorkerResponse =
  | { id: number; kind: "progress"; progress: number }
  | { id: number; kind: "learn"; fingerprints: number[][] }
  | { id: number; kind: "complete"; channels: ArrayBuffer[]; fingerprints: number[][]; reductionDb: number }
  | { id: number; kind: "error"; message: string };

type WorkerRequest =
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

let worker: Worker | null = null;
let requestId = 0;
const pending = new Map<number, {
  resolve: (value: WorkerResponse) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: number) => void;
}>();
const processedCache = new Map<string, DenoiseResult>();

function getWorker(): Worker {
  if (typeof Worker === "undefined") {
    throw new Error("Audio denoising requires Web Worker support in this browser.");
  }
  if (!worker) {
    worker = new Worker(new URL("./denoise.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      const task = pending.get(message.id);
      if (!task) return;
      if (message.kind === "progress") {
        task.onProgress?.(message.progress);
      } else {
        pending.delete(message.id);
        if (message.kind === "error") task.reject(new Error(message.message));
        else task.resolve(message);
      }
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || "The audio denoise worker stopped unexpectedly.");
      for (const task of pending.values()) task.reject(error);
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

function copyChannels(buffer: StoredBuffer) {
  return buffer.channels.map((channel) => channel.slice().buffer);
}

function hashFingerprint(fingerprint?: number[][]) {
  if (!fingerprint) return "auto";
  let hash = 2166136261;
  for (const channel of fingerprint) {
    for (const value of channel) {
      hash ^= Math.round(value * 1000);
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(36);
}

export function getDenoiseCacheKey(sourceId: string, options: DenoiseOptions) {
  const amount = Math.max(0, Math.min(100, Math.round(options.amount)));
  return `${sourceId}:${amount}:${options.highPass ? 1 : 0}:${hashFingerprint(options.noiseFingerprint)}`;
}

function runWorker(request: WorkerRequest, onProgress?: (progress: number) => void) {
  const id = request.id;
  return new Promise<WorkerResponse>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    try {
      const transfer = request.channels.slice();
      getWorker().postMessage(request, transfer);
    } catch (error) {
      pending.delete(id);
      reject(error instanceof Error ? error : new Error("Could not start the denoise worker."));
    }
  });
}

export class DenoiseEngine {
  async learnNoisePrint(
    source: StoredBuffer,
    startSeconds: number,
    durationSeconds = 1,
  ): Promise<number[][]> {
    const startFrame = Math.max(0, Math.floor(startSeconds * source.sampleRate));
    const endFrame = Math.min(
      source.channels[0]?.length ?? 0,
      Math.ceil((startSeconds + durationSeconds) * source.sampleRate),
    );
    if (endFrame - startFrame < source.sampleRate * 0.1) {
      throw new RangeError("Choose at least 0.1 seconds of room tone to learn a noise print.");
    }
    const result = await runWorker({
      id: ++requestId,
      kind: "learn",
      channels: copyChannels(source),
      frameCount: source.channels[0].length,
      startFrame,
      endFrame,
    });
    if (result.kind !== "learn") throw new Error("The noise print could not be captured.");
    return result.fingerprints;
  }

  async process(
    sourceId: string,
    source: StoredBuffer,
    options: DenoiseOptions,
    onProgress?: (progress: number) => void,
  ): Promise<DenoiseResult> {
    const amount = Math.max(0, Math.min(100, Math.round(options.amount)));
    const cacheKey = getDenoiseCacheKey(sourceId, options);
    const cached = processedCache.get(cacheKey);
    if (cached) {
      onProgress?.(1);
      return cached;
    }

    const response = await runWorker({
      id: ++requestId,
      kind: "process",
      channels: copyChannels(source),
      frameCount: source.channels[0].length,
      amount: amount / 100,
      noiseFingerprint: options.noiseFingerprint,
    }, (progress) => onProgress?.(progress * (options.highPass ? 0.8 : 1)));
    if (response.kind !== "complete") throw new Error("The denoise worker returned an invalid result.");

    let channels: StoredBuffer["channels"] = response.channels.map(
      (data) => new Float32Array(data),
    );
    if (options.highPass) channels = await this.applyHighPass(channels, source.sampleRate);
    const result: DenoiseResult = {
      buffer: { sampleRate: source.sampleRate, channels, name: `${source.name} (Denoised)` },
      noiseFingerprint: options.noiseFingerprint ?? response.fingerprints,
      reductionDb: response.reductionDb,
      cacheKey,
    };
    processedCache.set(cacheKey, result);
    onProgress?.(1);
    return result;
  }

  private async applyHighPass(
    channels: StoredBuffer["channels"],
    sampleRate: number,
  ): Promise<StoredBuffer["channels"]> {
    const length = channels[0]?.length ?? 0;
    if (!length) throw new Error("The selected audio region is empty.");
    const OfflineContext = globalThis.OfflineAudioContext;
    if (!OfflineContext) {
      throw new Error("OfflineAudioContext is unavailable; the 75 Hz rumble filter cannot be rendered.");
    }
    const context = new OfflineContext(channels.length, length, sampleRate);
    const source = context.createBufferSource();
    const audio = context.createBuffer(channels.length, length, sampleRate);
    channels.forEach((channel, index) =>
      audio.copyToChannel(new Float32Array(channel), index),
    );
    source.buffer = audio;
    const filter = context.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 75;
    filter.Q.value = 0.707;
    source.connect(filter).connect(context.destination);
    source.start();
    const rendered = await context.startRendering();
    return Array.from({ length: rendered.numberOfChannels }, (_, index) =>
      new Float32Array(rendered.getChannelData(index)),
    ) as StoredBuffer["channels"];
  }
}

export const denoiseEngine = new DenoiseEngine();
