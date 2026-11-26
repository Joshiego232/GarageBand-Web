"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Download, Loader2, Share2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  downloadBounce,
  exportBounce,
  type BounceBitDepth,
  type BounceBitrate,
  type BounceFormat,
  type BounceMode,
  type BounceNormalization,
  type BounceProgress,
  type BounceSampleRate,
} from "@/lib/daw/BounceEngine";
import { useDAW } from "@/lib/daw/store";
import { PPQ } from "@/lib/daw/types";
import { barTicks, projectLengthTicks } from "@/lib/daw/utils";
import { cn } from "@/lib/utils";

type BouncePhase = "settings" | "rendering" | "encoding" | "packaging" | "done";
type Position = [number, number, number, number];

const initialSettings = {
  formats: ["wav"] as BounceFormat[],
  bitDepth: 24 as BounceBitDepth,
  sampleRate: 44100 as BounceSampleRate,
  bitrate: 192 as BounceBitrate,
  includeTail: true,
  normalization: "protection" as BounceNormalization,
  mode: "stereo" as BounceMode,
};

function projectEndTick(project: ReturnType<typeof useDAW.getState>["project"]): number {
  let end = 0;
  for (const track of project.tracks) {
    for (const region of track.regions) end = Math.max(end, region.start + region.length);
  }
  if (!end) return projectLengthTicks(project);
  const bar = barTicks(project.timeSig);
  return Math.ceil(end / bar) * bar;
}

function tickToPosition(tick: number, timeSig: [number, number]): Position {
  const beatLength = PPQ * (4 / timeSig[1]);
  const barLength = barTicks(timeSig);
  const safeTick = Math.max(0, Math.floor(tick));
  const bar = Math.floor(safeTick / barLength);
  const inBar = safeTick - bar * barLength;
  const beat = Math.floor(inBar / beatLength);
  const inBeat = inBar - beat * beatLength;
  const subdivisionLength = beatLength / 4;
  const subdivision = Math.floor(inBeat / subdivisionLength);
  const division = Math.floor((inBeat - subdivision * subdivisionLength) / (beatLength / 16));
  return [bar + 1, beat + 1, subdivision + 1, division + 1];
}

function positionToTick(position: Position, timeSig: [number, number]): number {
  const [bar, beat, subdivision, division] = position.map((value) => Math.max(1, Math.floor(value)));
  const beatLength = PPQ * (4 / timeSig[1]);
  return (
    (bar - 1) * barTicks(timeSig) +
    (beat - 1) * beatLength +
    (subdivision - 1) * beatLength / 4 +
    (division - 1) * beatLength / 16
  );
}

function BarPositionInput({
  label,
  parts,
  onChange,
  disabled,
}: {
  label: string;
  parts: Position;
  onChange: (index: number, value: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-[11px] text-zinc-400">{label}</span>
      <div className="flex items-center gap-1 rounded-md border border-black/60 bg-[#17171a] px-2 py-1">
        {parts.map((part, index) => (
          <div key={index} className="flex items-center gap-1">
            {index > 0 && <span className="text-[10px] text-zinc-600">.</span>}
            <input
              aria-label={`${label} ${["bar", "beat", "subdivision", "division"][index]}`}
              type="number"
              min={1}
              value={part}
              disabled={disabled}
              onChange={(event) => onChange(index, Number(event.target.value) || 1)}
              className="w-10 bg-transparent text-center font-mono text-[12px] text-zinc-200 outline-none disabled:opacity-50"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function BounceModal() {
  const project = useDAW((state) => state.project);
  const open = useDAW((state) => state.ui.modal === "export");
  const setModal = useDAW((state) => state.setModal);
  const [visible, setVisible] = useState(true);
  const [phase, setPhase] = useState<BouncePhase>("settings");
  const [progress, setProgress] = useState<BounceProgress>({ phase: "rendering", value: 0 });
  const [rangeMode, setRangeMode] = useState<"cycle" | "project" | "custom">("project");
  const initialEnd = projectEndTick(project);
  const [startParts, setStartParts] = useState<Position>(() => tickToPosition(0, project.timeSig));
  const [endParts, setEndParts] = useState<Position>(() => tickToPosition(initialEnd, project.timeSig));
  const [startTick, setStartTick] = useState(0);
  const [endTick, setEndTick] = useState(initialEnd);
  const [formats, setFormats] = useState<BounceFormat[]>(initialSettings.formats);
  const [bitDepth, setBitDepth] = useState<BounceBitDepth>(initialSettings.bitDepth);
  const [sampleRate, setSampleRate] = useState<BounceSampleRate>(initialSettings.sampleRate);
  const [bitrate, setBitrate] = useState<BounceBitrate>(initialSettings.bitrate);
  const [includeTail, setIncludeTail] = useState(initialSettings.includeTail);
  const [normalization, setNormalization] = useState<BounceNormalization>(initialSettings.normalization);
  const [mode, setMode] = useState<BounceMode>(initialSettings.mode);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const busy = phase === "rendering" || phase === "encoding" || phase === "packaging";
  const fullEndTick = useMemo(() => projectEndTick(project), [project]);
  const cycleAvailable = project.cycleOn && project.cycleEnd > project.cycleStart;

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const selectRange = (next: "cycle" | "project" | "custom") => {
    setRangeMode(next);
    if (next === "cycle" && cycleAvailable) {
      setStartTick(project.cycleStart);
      setEndTick(project.cycleEnd);
      setStartParts(tickToPosition(project.cycleStart, project.timeSig));
      setEndParts(tickToPosition(project.cycleEnd, project.timeSig));
    } else if (next === "project") {
      setStartTick(0);
      setEndTick(fullEndTick);
      setStartParts(tickToPosition(0, project.timeSig));
      setEndParts(tickToPosition(fullEndTick, project.timeSig));
    }
  };

  const updatePosition = (side: "start" | "end", index: number, value: number) => {
    const source = side === "start" ? startParts : endParts;
    const next = [...source] as Position;
    next[index] = Math.max(1, Math.floor(value));
    if (side === "start") {
      setStartParts(next);
      setStartTick(positionToTick(next, project.timeSig));
    } else {
      setEndParts(next);
      setEndTick(positionToTick(next, project.timeSig));
    }
    setRangeMode("custom");
  };

  const toggleFormat = (format: BounceFormat, checked: boolean | "indeterminate") => {
    setFormats((current) => {
      const selected = current.includes(format);
      const shouldSelect = checked === true;
      if (selected === shouldSelect) return current;
      const next = shouldSelect ? [...current, format] : current.filter((item) => item !== format);
      return next.length ? next : current;
    });
  };

  const handleProgress = (next: BounceProgress) => {
    setProgress(next);
    setPhase(next.phase);
  };

  const runBounce = async () => {
    if (busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setCancelRequested(false);
    setPhase("rendering");
    setProgress({ phase: "rendering", value: 0 });
    try {
      const result = await exportBounce(
        project,
        {
          formats,
          bitDepth,
          sampleRate,
          bitrate,
          startTick,
          endTick,
          includeTail,
          normalization,
          mode,
        },
        handleProgress,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      downloadBounce(result.blob, result.filename);
      if (result.previewBlob) setPreviewUrl(URL.createObjectURL(result.previewBlob));
      setPhase("done");
      setProgress({ phase: "encoding", value: 1 });
      toast.success(`Bounce exported: ${result.filename}`);
    } catch (error) {
      if (controller.signal.aborted) {
        setPhase("settings");
        setCancelRequested(false);
        toast.info("Bounce cancelled.");
      } else {
        setPhase("settings");
        toast.error(error instanceof Error ? error.message : "Bounce export failed.");
      }
    } finally {
      abortRef.current = null;
    }
  };

  const close = () => {
    if (busy) {
      abortRef.current?.abort();
      setCancelRequested(true);
      return;
    }
    setVisible(false);
    setModal("none");
  };

  if (!open) return null;

  const phaseLabel = cancelRequested
    ? "Cancellation requested…"
    : phase === "rendering"
      ? "Rendering audio graph…"
      : phase === "encoding"
        ? progress.detail === "MP3" ? "Encoding MP3…" : "Encoding PCM WAV…"
        : phase === "packaging"
          ? "Packaging ZIP archive…"
          : phase === "done"
            ? "Bounce complete"
            : "Ready to bounce";
  const stemMode = mode === "stems";

  return (
    <Dialog open={visible} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}
        onInteractOutside={(event) => { if (busy) event.preventDefault(); }}
        className="max-h-[90vh] gap-4 overflow-y-auto rounded-xl border-black/60 bg-[#232327] p-5 text-zinc-200 sm:max-w-[620px]"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-black/50 bg-[#2f2f34]">
              <Share2 className="size-4 text-[#ffb648]" />
            </span>
            <div>
              <DialogTitle className="text-[15px] font-semibold leading-tight text-zinc-100">
                Bounce “{project.name || "Untitled"}”
              </DialogTitle>
              <DialogDescription className="mt-1 text-[11px] text-zinc-500">
                Offline render · {project.tracks.length} tracks · Master processing included
              </DialogDescription>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close bounce dialog"
            onClick={close}
            className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100"
          >
            <X className="size-4" />
          </button>
        </div>

        {phase === "settings" && (
          <>
            <section className="grid gap-3 rounded-lg border border-black/50 bg-[#1d1d20] p-3.5 sm:grid-cols-2">
              <div>
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Destination</h3>
                <label className="flex items-center gap-2 py-1 text-[12px]">
                  <Checkbox checked={formats.includes("wav")} onCheckedChange={(checked) => toggleFormat("wav", checked)} />
                  <span>PCM (WAV)</span>
                </label>
                <label className="flex items-center gap-2 py-1 text-[12px]">
                  <Checkbox checked={formats.includes("mp3")} onCheckedChange={(checked) => toggleFormat("mp3", checked)} disabled={stemMode} />
                  <span>MP3</span>
                </label>
                {stemMode && <p className="mt-1 text-[10px] text-zinc-500">Stem archives are exported as aligned PCM WAV files.</p>}
                {!stemMode && formats.length > 1 && <p className="mt-1 text-[10px] text-zinc-500">Selected formats are bundled into one ZIP download.</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <SettingSelect label="Resolution" value={String(bitDepth)} onValueChange={(value) => setBitDepth(Number(value) as BounceBitDepth)}>
                  <SelectItem value="16">16-bit</SelectItem>
                  <SelectItem value="24">24-bit</SelectItem>
                </SettingSelect>
                <SettingSelect label="Sample Rate" value={String(sampleRate)} onValueChange={(value) => setSampleRate(Number(value) as BounceSampleRate)}>
                  <SelectItem value="44100">44.1 kHz</SelectItem>
                  <SelectItem value="48000">48 kHz</SelectItem>
                </SettingSelect>
                <SettingSelect label="MP3 Bit Rate" value={String(bitrate)} onValueChange={(value) => setBitrate(Number(value) as BounceBitrate)}>
                  <SelectItem value="128">128 kbps · Stereo</SelectItem>
                  <SelectItem value="192">192 kbps · Stereo</SelectItem>
                  <SelectItem value="320">320 kbps · Stereo</SelectItem>
                </SettingSelect>
                <SettingSelect label="Normalize" value={normalization} onValueChange={(value) => setNormalization(value as BounceNormalization)}>
                  <SelectItem value="off">Off</SelectItem>
                  <SelectItem value="protection">Overload Protection Only</SelectItem>
                  <SelectItem value="on">On · -0.1 dBFS</SelectItem>
                </SettingSelect>
              </div>
            </section>

            <section className="rounded-lg border border-black/50 bg-[#1d1d20] p-3.5">
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Bounce Range</h3>
              <div className="mb-3 grid grid-cols-3 gap-2">
                <RangeButton selected={rangeMode === "cycle"} disabled={!cycleAvailable} onClick={() => selectRange("cycle")}>Cycle Region</RangeButton>
                <RangeButton selected={rangeMode === "project"} onClick={() => selectRange("project")}>Entire Project</RangeButton>
                <RangeButton selected={rangeMode === "custom"} onClick={() => setRangeMode("custom")}>Custom</RangeButton>
              </div>
              <div className="flex flex-wrap gap-3">
                <BarPositionInput label="Start" parts={startParts} onChange={(index, value) => updatePosition("start", index, value)} disabled={busy} />
                <BarPositionInput label="End" parts={endParts} onChange={(index, value) => updatePosition("end", index, value)} disabled={busy} />
              </div>
              {endTick <= startTick && <p className="mt-2 text-[10px] text-red-400">End position must be after start.</p>}
            </section>

            <section className="grid gap-3 rounded-lg border border-black/50 bg-[#1d1d20] p-3.5 sm:grid-cols-2">
              <div>
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Export Mode</h3>
                <div className="grid grid-cols-2 gap-2">
                  <RangeButton selected={mode === "stereo"} onClick={() => setMode("stereo")}>Stereo Out</RangeButton>
                  <RangeButton selected={mode === "stems"} onClick={() => setMode("stems")}>Track Stems · ZIP</RangeButton>
                </div>
              </div>
              <label className="flex cursor-pointer items-start gap-2.5 pt-1 text-[12px]">
                <Checkbox checked={includeTail} onCheckedChange={(checked) => setIncludeTail(checked === true)} className="mt-0.5" />
                <span>
                  Include Audio Tail
                  <span className="mt-0.5 block text-[10px] leading-snug text-zinc-500">
                    Adds three bars for reverb and delay decay.
                  </span>
                </span>
              </label>
            </section>
          </>
        )}

        {busy && (
          <section className="space-y-2 rounded-lg border border-black/50 bg-[#1d1d20] p-4">
            <div className="flex items-center justify-between gap-3 text-[11px]">
              <span className="flex items-center gap-2 text-[#ffb648]">
                <Loader2 className="size-3.5 animate-spin" />
                {phaseLabel}
              </span>
              <span className="font-mono text-zinc-500">{Math.round(progress.value * 100)}%</span>
            </div>
            {progress.detail && <div className="text-[10px] text-zinc-500">{progress.detail}</div>}
            <Progress value={progress.value * 100} className="h-1.5 bg-black/60 [&_[data-slot=progress-indicator]]:bg-[#ffb648]" />
            <p className="text-[10px] leading-relaxed text-zinc-500">
              {phase === "rendering"
                ? "The offline graph renders independently of live playback. Web Audio cannot interrupt a render already in progress, so a cancellation request discards it when the pass completes."
                : phase === "encoding"
                  ? "PCM and MP3 conversion run in a worker and can be stopped immediately."
                  : "ZIP packaging runs asynchronously and can only be discarded after archive generation completes."}
            </p>
          </section>
        )}

        {phase === "done" && (
          <section className="space-y-3 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
            <div className="flex items-center gap-2 text-[12px] font-medium text-emerald-300">
              <AudioLines className="size-4" />
              Bounce completed and downloaded.
            </div>
            {previewUrl && (
              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Audition bounced audio
                </label>
                <audio controls preload="metadata" src={previewUrl} className="h-9 w-full" />
              </div>
            )}
          </section>
        )}

        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] leading-relaxed text-zinc-500">
            {stemMode ? "Each stem uses the same range and includes master processing." : "Normalization targets -0.1 dBFS when enabled."}
          </span>
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" onClick={close} className="text-zinc-300 hover:bg-white/5 hover:text-zinc-100">
              {busy ? "Cancel Bounce" : "Close"}
            </Button>
            {!busy && phase !== "done" && (
              <Button
                onClick={() => void runBounce()}
                disabled={endTick <= startTick || (mode === "stereo" && !formats.length)}
                className="gap-1.5 bg-[#ffb648] text-[#2b1c04] hover:bg-[#ffc670]"
              >
                <Download className="size-3.5" />
                Bounce
              </Button>
            )}
            {phase === "done" && (
              <Button onClick={() => { setPreviewUrl(null); setPhase("settings"); }} className="bg-[#ffb648] text-[#2b1c04] hover:bg-[#ffc670]">
                New Bounce
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingSelect({
  label,
  children,
  ...props
}: React.ComponentProps<typeof Select> & { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label className="mb-1 block text-[9px] uppercase tracking-wider text-zinc-500">{label}</label>
      <Select {...props}>
        <SelectTrigger className="h-8 border-black/60 bg-[#29292e] text-[11px] text-zinc-200">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="border-black/60 bg-[#29292e] text-zinc-200">
          {children}
        </SelectContent>
      </Select>
    </div>
  );
}

function RangeButton({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "min-h-8 rounded-md border px-2 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        selected
          ? "border-[#ffb648]/60 bg-[#ffb648]/10 text-[#ffcf85]"
          : "border-black/50 bg-[#29292e] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200",
      )}
    >
      {children}
    </button>
  );
}
