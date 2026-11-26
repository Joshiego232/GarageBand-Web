"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, Waves } from "lucide-react";
import { toast } from "sonner";
import { useDAW } from "@/lib/daw/store";
import { engine } from "@/lib/daw/engine";
import { computePeaks } from "@/lib/daw/wav";
import { getRegionSourceBufferId, uid, type Region } from "@/lib/daw/types";
import {
  denoiseEngine,
  getDenoiseCacheKey,
} from "@/lib/daw/DenoiseEngine";

interface DenoisePanelProps {
  region: Region;
  compact?: boolean;
}

function peakPath(
  channels: Float32Array[],
  width: number,
  height: number,
  startSeconds: number,
  durationSeconds: number,
  sampleRate: number,
) {
  const length = channels[0]?.length ?? 0;
  if (!length) return "";
  const start = Math.max(0, Math.floor(startSeconds * sampleRate));
  const end = Math.min(length, Math.ceil((startSeconds + durationSeconds) * sampleRate));
  if (end <= start) return "";
  const peaks = computePeaks(channels, start, end, width);
  const center = height / 2;
  let path = "";
  for (let x = 0; x < peaks.length / 2; x += 1) {
    const min = peaks[x * 2];
    const max = peaks[x * 2 + 1];
    path += `M${x} ${center - max * center}L${x} ${center - min * center}`;
  }
  return path;
}

export function DenoisePanel({ region, compact = false }: DenoisePanelProps) {
  const updateRegion = useDAW((state) => state.updateRegion);
  const commit = useDAW((state) => state.commit);
  const sourceId = getRegionSourceBufferId(region);
  const amount = region.denoiseAmount ?? 50;
  const highPass = region.denoiseHighPass ?? true;
  const enabled = region.denoiseEnabled ?? false;
  const [sourceState, setSourceState] = useState<{
    id: string;
    buffer: ReturnType<typeof engine.getStoredBuffer>;
  }>();
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [noiseStart, setNoiseStart] = useState(region.sampleStart ?? 0);
  const [previewState, setPreviewState] = useState<{
    id: string;
    channels: Float32Array[] | null;
  }>();
  const generation = useRef(0);
  const source =
    sourceState && sourceState.id === sourceId ? sourceState.buffer : undefined;
  const options = useMemo(
    () => ({
      amount,
      highPass,
      noiseFingerprint: region.noiseFingerprint,
    }),
    [amount, highPass, region.noiseFingerprint],
  );
  const cacheKey = sourceId ? getDenoiseCacheKey(sourceId, options) : "";
  const processedPreview =
    previewState &&
    previewState.id === region.denoisedAudioBufferId &&
    region.denoiseCacheKey === cacheKey
      ? previewState.channels
      : null;

  useEffect(() => {
    if (!sourceId) return;
    let active = true;
    const cached = engine.getStoredBuffer(sourceId);
    void (cached ? Promise.resolve(cached) : engine.ensureBufferLoaded(sourceId))
      .then((buffer) => {
        if (active) setSourceState({ id: sourceId, buffer });
      })
      .catch((error: unknown) => {
        console.error("Could not load the source audio for denoising.", error);
        toast.error("Could not load the original audio for denoising.");
      });
    return () => {
      active = false;
    };
  }, [sourceId]);

  useEffect(() => {
    const outputId = region.denoisedAudioBufferId;
    if (!outputId) return;
    let active = true;
    const cached = engine.getStoredBuffer(outputId);
    void (cached ? Promise.resolve(cached) : engine.ensureBufferLoaded(outputId))
      .then((buffer) => {
        if (active) setPreviewState({ id: outputId, channels: buffer?.channels ?? null });
      })
      .catch((error: unknown) => {
        console.error("Could not load the cached denoised audio buffer.", error);
      });
    return () => {
      active = false;
    };
  }, [region.denoisedAudioBufferId]);

  useEffect(() => {
    if (!sourceId || !source || !enabled) return;
    if (region.denoisedAudioBufferId && region.denoiseCacheKey === cacheKey) return;

    const currentGeneration = ++generation.current;
    let active = true;
    const timer = window.setTimeout(() => {
      setProcessing(true);
      setProgress(0);
      void denoiseEngine.process(sourceId, source, options, (value) => {
        if (active && currentGeneration === generation.current) setProgress(value);
      })
        .then(async (result) => {
          if (!active || currentGeneration !== generation.current) return;
          const outputId = `denoised-${uid()}`;
          await engine.storePersistentBuffer(outputId, result.buffer);
          if (!active || currentGeneration !== generation.current) return;
          setPreviewState({ id: outputId, channels: result.buffer.channels });
          updateRegion(region.id, {
            originalAudioBufferId: sourceId,
            denoisedAudioBufferId: outputId,
            denoiseCacheKey: result.cacheKey,
            denoiseReductionDb: result.reductionDb,
          }, false);
        })
        .catch((error: unknown) => {
          if (!active || currentGeneration !== generation.current) return;
          console.error("Audio denoising failed.", error);
          toast.error(error instanceof Error ? error.message : "Audio denoising failed.");
        })
        .finally(() => {
          if (active && currentGeneration === generation.current) {
            setProcessing(false);
          }
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    amount,
    cacheKey,
    enabled,
    highPass,
    options,
    region.denoiseCacheKey,
    region.denoisedAudioBufferId,
    region.id,
    region.noiseFingerprint,
    source,
    sourceId,
    updateRegion,
  ]);

  const waveform = useMemo(() => {
    const channels = enabled && processedPreview
      ? processedPreview
      : source?.channels;
    return channels && source
      ? peakPath(
          channels,
          180,
          34,
          region.sampleStart ?? 0,
          region.sampleLength ?? source.channels[0].length / source.sampleRate,
          source.sampleRate,
        )
      : "";
  }, [enabled, processedPreview, region.sampleLength, region.sampleStart, source]);

  const setSettings = (patch: Partial<Region>) => {
    updateRegion(region.id, {
      ...patch,
      denoisedAudioBufferId: undefined,
      denoiseCacheKey: undefined,
    }, false);
  };

  const captureNoisePrint = async () => {
    if (!source) return;
    try {
      commit();
      const fingerprint = await denoiseEngine.learnNoisePrint(
        source,
        noiseStart,
        Math.min(1, Math.max(0.1, source.channels[0].length / source.sampleRate - noiseStart)),
      );
      setSettings({
        noiseFingerprint: fingerprint,
        denoiseAmount: amount,
        denoiseHighPass: highPass,
      });
      toast.success("Noise print learned from the selected audio range.");
    } catch (error) {
      console.error("Could not learn an audio noise print.", error);
      toast.error(error instanceof Error ? error.message : "Could not capture the noise print.");
    }
  };

  const zone = amount < 30 ? "Subtle" : amount < 70 ? "Balanced" : "Strong";
  const outputId = region.denoisedAudioBufferId;
  const reduction = region.denoiseReductionDb ?? 0;

  return (
    <section
      aria-label="Audio cleanup and denoise"
      className={`flex flex-col gap-2 rounded-lg border border-[#56b9e8]/20 bg-gradient-to-br from-[#16242e] to-[#1b1b20] p-2.5 ${
        compact ? "w-full" : ""
      }`}
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[#b8e4f7]">
          <Waves className="size-3.5 shrink-0" />
          <span className="truncate text-[10px] font-semibold">Audio Cleanup & Denoise</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Denoise audio"
          onClick={() => {
            commit();
            updateRegion(region.id, {
              denoiseEnabled: !enabled,
              denoiseAmount: amount,
              denoiseHighPass: highPass,
              originalAudioBufferId: sourceId,
            }, false);
          }}
          className={`relative h-[18px] w-9 shrink-0 rounded-full transition-colors ${
            enabled ? "bg-[#38bdf8] shadow-[0_0_10px_rgba(56,189,248,.35)]" : "bg-zinc-700"
          }`}
        >
          <span className={`absolute top-[2px] size-[14px] rounded-full bg-white transition-transform ${enabled ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
        </button>
      </header>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] text-zinc-400">Reduction</span>
        <span className="rounded-full bg-[#38bdf8]/10 px-1.5 py-0.5 font-mono text-[9px] text-[#8bd8fa]">
          {Math.round(amount)}% · {zone}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={amount}
        onPointerDown={commit}
        onChange={(event) => setSettings({ denoiseAmount: Number(event.target.value) })}
        aria-label="Denoise reduction amount"
        className="h-1.5 w-full accent-[#38bdf8]"
      />

      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-[9px] text-zinc-400">
          <input
            type="checkbox"
            checked={highPass}
            onChange={(event) => {
              commit();
              setSettings({ denoiseHighPass: event.target.checked });
            }}
            className="size-3 accent-[#38bdf8]"
          />
          75 Hz Low-Cut
        </label>
        <span className="rounded-full border border-white/10 bg-black/20 px-1.5 py-0.5 text-[9px] text-zinc-300">
          Noise Reduced: -{reduction.toFixed(1)} dB
        </span>
      </div>

      {!compact && (
        <div className="flex flex-col gap-1.5 border-t border-white/[.06] pt-2">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={`noise-start-${region.id}`} className="text-[9px] text-zinc-400">
              1-second room-tone range
            </label>
            <button
              type="button"
              onClick={() => void captureNoisePrint()}
              disabled={!source}
              className="rounded border border-white/10 bg-white/[.04] px-1.5 py-1 text-[9px] text-zinc-300 hover:bg-white/10 disabled:opacity-40"
            >
              {region.noiseFingerprint ? "Capture Noise Print ✓" : "Learn Selection"}
            </button>
          </div>
          <input
            id={`noise-start-${region.id}`}
            type="range"
            min={0}
            max={Math.max(0, (source?.channels[0].length ?? 0) / (source?.sampleRate ?? 1) - 1)}
            step={0.05}
            value={Math.min(noiseStart, Math.max(0, (source?.channels[0].length ?? 0) / (source?.sampleRate ?? 1) - 1))}
            onChange={(event) => setNoiseStart(Number(event.target.value))}
            aria-label="Select one second of room tone to learn"
            className="h-1 w-full accent-[#38bdf8]"
          />
          <p className="text-[8px] leading-snug text-zinc-500">
            Auto-learns from the quietest 5% of frames. Select a quiet range above for a custom noise print.
          </p>
        </div>
      )}

      <div className="overflow-hidden rounded bg-[#0e1318] px-1 py-1">
        <svg viewBox="0 0 180 34" preserveAspectRatio="none" className="h-8 w-full" aria-label="Denoised waveform preview">
          <path d={`M0 17H180 ${waveform}`} fill="none" stroke="#61c9f3" strokeWidth="0.7" />
        </svg>
      </div>
      {processing && (
        <div className="flex items-center gap-2 text-[9px] text-[#8bd8fa]" role="status">
          <LoaderCircle className="size-3 animate-spin" />
          Rendering noise reduction
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-[#38bdf8] transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
      )}
      {!enabled && (
        <p className="text-[8px] text-zinc-500">Bypassed · original audio remains untouched</p>
      )}
      {enabled && !processing && outputId && (
        <p className="text-[8px] text-zinc-600">Processed audio cached for instant playback and bounce</p>
      )}
    </section>
  );
}
