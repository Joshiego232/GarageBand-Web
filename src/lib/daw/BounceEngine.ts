import JSZip from "jszip";
import { engine } from "./engine";
import { PPQ, type Project, type Track } from "./types";
import { barTicks, clamp, projectLengthTicks } from "./utils";
import { isTrackAudible } from "./routing";

export type BounceFormat = "wav" | "mp3";
export type BounceNormalization = "off" | "protection" | "on";
export type BounceMode = "stereo" | "stems";
export type BounceBitDepth = 16 | 24;
export type BounceSampleRate = 44100 | 48000;
export type BounceBitrate = 128 | 192 | 320;

export interface BounceSettings {
  formats: BounceFormat[];
  bitDepth: BounceBitDepth;
  sampleRate: BounceSampleRate;
  bitrate: BounceBitrate;
  startTick: number;
  endTick: number;
  includeTail: boolean;
  normalization: BounceNormalization;
  mode: BounceMode;
}

export interface BounceProgress {
  phase: "rendering" | "encoding" | "packaging";
  value: number;
  detail?: string;
}

interface StemTarget {
  name: string;
  trackIds: string[];
}

const TARGET_PEAK = 10 ** (-0.1 / 20);
const MAX_RANGE_TICKS = 100_000_000;

export async function exportBounce(
  project: Project,
  settings: BounceSettings,
  onProgress: (progress: BounceProgress) => void,
  signal: AbortSignal,
): Promise<{ blob: Blob; filename: string; previewBlob?: Blob }> {
  const projectEnd = projectLengthTicks(project);
  const startTick = clamp(Math.floor(settings.startTick), 0, projectEnd);
  const endTick = clamp(Math.floor(settings.endTick), 0, projectEnd);
  if (endTick <= startTick || endTick - startTick > MAX_RANGE_TICKS) {
    throw new RangeError("Choose a valid bounce range.");
  }
  signal.throwIfAborted();

  const tailSeconds = settings.includeTail
    ? (barTicks(project.timeSig) * 3 / PPQ) * (60 / project.tempo)
    : 0;

  if (settings.mode === "stereo") {
    const channels = await renderMix(project, settings, startTick, endTick, tailSeconds, signal, (value) => {
      onProgress({ phase: "rendering", value: value * 0.78 });
    });
    signal.throwIfAborted();
    onProgress({ phase: "encoding", value: 0.8 });
    const normalized = applyNormalization(channels, settings.normalization);
    if (!settings.formats.length) throw new Error("Select at least one output format.");
    const encoded = await encodeAudio(
      normalized,
      settings.sampleRate,
      settings.formats,
      settings.bitDepth,
      settings.bitrate,
      signal,
      (format, value) => {
        onProgress({
          phase: "encoding",
          value: 0.8 + (settings.formats.indexOf(format) + value) / settings.formats.length * 0.19,
          detail: format.toUpperCase(),
        });
      },
    );
    const files = settings.formats.map((format) => {
      const blob = encoded[format];
      if (!blob) throw new Error(`The ${format.toUpperCase()} encoder returned no output.`);
      return { name: `${safeName(project.name || "Untitled")}.${format}`, blob };
    });
    signal.throwIfAborted();
    let blob = files[0].blob;
    let filename = files[0].name;
    if (files.length > 1) {
      onProgress({ phase: "packaging", value: 0.99 });
      const zip = new JSZip();
      for (const file of files) zip.file(file.name, file.blob);
      blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 1 } });
      filename = `${safeName(project.name || "Untitled")}-bounce.zip`;
    }
    signal.throwIfAborted();
    onProgress({ phase: "encoding", value: 1 });
    return {
      blob,
      filename,
      previewBlob: files.find((file) => file.name.endsWith(".wav"))?.blob ?? files[0].blob,
    };
  }

  const targets = getStemTargets(project);
  if (!targets.length) throw new Error("There are no unmuted tracks to export as stems.");
  const zip = new JSZip();
  let previewBlob: Blob | undefined;
  for (let index = 0; index < targets.length; index++) {
    signal.throwIfAborted();
    const target = targets[index];
    const channels = await renderMix(
      project,
      settings,
      startTick,
      endTick,
      tailSeconds,
      signal,
      (value) => onProgress({
        phase: "rendering",
        value: (index + value) / targets.length * 0.78,
        detail: `${target.name} (${index + 1}/${targets.length})`,
      }),
      target.trackIds,
    );
    signal.throwIfAborted();
    const normalized = applyNormalization(channels, settings.normalization);
    const encoded = await encodeAudio(
      normalized,
      settings.sampleRate,
      ["wav"],
      settings.bitDepth,
      settings.bitrate,
      signal,
      (format, value) => onProgress({
        phase: "encoding",
        value: 0.78 + (index + value) / targets.length * 0.12,
        detail: `${target.name} · ${format.toUpperCase()}`,
      }),
    );
    const wav = encoded.wav;
    if (!wav) throw new Error(`The WAV encoder returned no output for ${target.name}.`);
    previewBlob ??= wav;
    zip.file(`${String(index + 1).padStart(2, "0")}-${safeName(target.name)}.wav`, wav);
    onProgress({
      phase: "encoding",
      value: 0.78 + (index + 1) / targets.length * 0.12,
      detail: `Prepared ${target.name}`,
    });
  }
  signal.throwIfAborted();
  onProgress({ phase: "packaging", value: 0.92 });
  const blob = await zip.generateAsync(
    { type: "blob", compression: "DEFLATE", compressionOptions: { level: 1 } },
    (metadata) => onProgress({ phase: "packaging", value: 0.92 + metadata.percent / 100 * 0.08 }),
  );
  signal.throwIfAborted();
  return {
    blob,
    filename: `${safeName(project.name || "Untitled")}-stems.zip`,
    previewBlob,
  };
}

async function renderMix(
  project: Project,
  settings: BounceSettings,
  startTick: number,
  endTick: number,
  tailSeconds: number,
  signal: AbortSignal,
  onProgress: (value: number) => void,
  includeTrackIds?: string[],
): Promise<Float32Array[]> {
  const result = await engine.renderProject(
    project,
    onProgress,
    {
      startTick,
      endTick,
      sampleRate: settings.sampleRate,
      tailSeconds,
      includeTrackIds,
      signal,
    },
  );
  if (!result?.channels.length) throw new Error("The project did not produce audio.");
  return result.channels;
}

export function applyNormalization(
  channels: Float32Array[],
  mode: BounceNormalization,
): Float32Array[] {
  if (mode === "off") return channels;
  let peak = 0;
  for (const channel of channels) {
    for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
  }
  if (peak <= 0) return channels;
  if (mode === "protection" && peak <= 0.99) return channels;
  const gain = TARGET_PEAK / peak;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) {
      channel[i] = Math.max(-1, Math.min(1, channel[i] * gain));
    }
  }
  return channels;
}

function getStemTargets(project: Project): StemTarget[] {
  const targets: StemTarget[] = [];
  const emittedStacks = new Set<string>();
  const audible = (track: Track) => isTrackAudible(track, project.tracks);
  for (const track of project.tracks) {
    if ((track.role ?? "track") !== "track" || !audible(track)) continue;
    const stack = project.stacks?.find(
      (item) => item.type === "summing" && item.trackIds.includes(track.id),
    );
    if (stack) {
      if (emittedStacks.has(stack.id)) continue;
      emittedStacks.add(stack.id);
      const trackIds = stack.trackIds.filter((id) => {
        const member = project.tracks.find((candidate) => candidate.id === id);
        return !!member && audible(member);
      });
      if (trackIds.length) targets.push({ name: stack.name, trackIds });
      continue;
    }
    targets.push({ name: track.name, trackIds: [track.id] });
  }
  return targets;
}

function safeName(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, " ").slice(0, 100) || "Untitled";
}

function encodeAudio(
  channels: Float32Array[],
  sampleRate: number,
  formats: BounceFormat[],
  bitDepth: BounceBitDepth,
  bitrate: BounceBitrate,
  signal: AbortSignal,
  onProgress: (format: BounceFormat, value: number) => void,
): Promise<Partial<Record<BounceFormat, Blob>>> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Bounce cancelled.", "AbortError"));
      return;
    }
    const worker = new Worker(new URL("./workers/audio-encoder.worker.ts", import.meta.url), { type: "module" });
    const files: Partial<Record<BounceFormat, Blob>> = {};
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      worker.terminate();
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Bounce cancelled.", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || "Audio encoder worker failed."));
    };
    worker.onmessage = (event: MessageEvent<{
      type: string;
      format?: BounceFormat;
      value?: number;
      blob?: Blob;
      message?: string;
    }>) => {
      if (event.data.type === "progress") {
        if (event.data.format) onProgress(event.data.format, event.data.value ?? 0);
      } else if (event.data.type === "file" && event.data.format && event.data.blob) {
        files[event.data.format] = event.data.blob;
      } else if (event.data.type === "done") {
        cleanup();
        resolve(files);
      } else if (event.data.type === "error") {
        cleanup();
        reject(new Error(event.data.message ?? "Audio encoding failed."));
      }
    };
    worker.postMessage(
      { channels, sampleRate, formats, bitDepth, bitrate },
      channels.map((channel) => channel.buffer),
    );
  });
}

export function downloadBounce(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}
