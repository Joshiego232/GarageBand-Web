"use client";

// ============================================================
// ExportDialog: offline WAV export with bit-depth choice,
// progress feedback and estimated file size.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { AudioLines, Download, Info, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { engine } from "@/lib/daw/engine";
import { useDAW } from "@/lib/daw/store";
import { formatTime, keyLabel, projectLengthTicks, tickToSec } from "@/lib/daw/utils";
import { downloadBlob, encodeWav } from "@/lib/daw/wav";
import { cn } from "@/lib/utils";

type Phase = "idle" | "rendering" | "encoding" | "done";
type BitDepth = 16 | 24;

const SAMPLE_RATE = 44100;
const CHANNELS = 2;

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ExportDialog() {
  const open = useDAW((s) => s.ui.modal === "export");
  const project = useDAW((s) => s.project);
  const setModal = useDAW((s) => s.setModal);

  const [visible, setVisible] = useState(true);
  const [bitDepth, setBitDepth] = useState<BitDepth>(16);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const closeTimer = useRef<number | null>(null);

  const busy = phase === "rendering" || phase === "encoding";

  // Reset the form each time the dialog opens (reset happens on close,
  // so a fresh open always starts idle without setState-in-effect)
  const reset = () => {
    setBitDepth(16);
    setPhase("idle");
    setProgress(0);
  };

  // Clear any pending delayed close on unmount
  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    []
  );

  // Close with the dialog's exit animation, then drop the modal state
  const close = () => {
    if (busy) return;
    setVisible(false);
    reset();
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      useDAW.getState().setModal("none");
    }, 200);
  };

  const runExport = async () => {
    if (busy) return;
    setPhase("rendering");
    setProgress(0);
    try {
      const result = await engine.renderProject(project, (p) => setProgress(p));
      if (!result) {
        toast.error("Render failed");
        setPhase("idle");
        setProgress(0);
        return;
      }
      setPhase("encoding");
      setProgress(1);
      // Yield once so the "Encoding" state paints before the blocking encoder runs
      await new Promise((resolve) => setTimeout(resolve, 30));
      const blob = encodeWav(result.channels, result.sampleRate, bitDepth);
      downloadBlob(blob, `${project.name || "song"}.wav`);
      setPhase("done");
      toast.success("Exported WAV");
      close();
    } catch {
      toast.error("Render failed");
      setPhase("idle");
      setProgress(0);
    }
  };

  const lengthTicks = projectLengthTicks(project);
  const durationSec = tickToSec(lengthTicks, project.tempo);
  const estimate = (depth: BitDepth) =>
    durationSec * SAMPLE_RATE * CHANNELS * (depth / 8);

  const statusLabel =
    phase === "rendering"
      ? progress < 0.05
        ? "Preparing…"
        : "Rendering…"
      : phase === "encoding"
        ? "Encoding…"
        : phase === "done"
          ? "Done"
          : "Ready to export";

  if (!open) return null;

  return (
    <Dialog open={visible} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}
        onPointerDownOutside={(e) => { if (busy) e.preventDefault(); }}
        onInteractOutside={(e) => { if (busy) e.preventDefault(); }}
        className="gap-4 rounded-xl border-black/60 bg-[#232327] p-5 text-zinc-200 sm:max-w-md"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-black/50 bg-[#2f2f34]">
              <AudioLines className="size-4 text-[#ffb648]" />
            </span>
            <div>
              <DialogTitle className="text-[15px] font-semibold leading-tight text-zinc-100">
                Export Song as WAV
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-[11px] leading-snug text-zinc-500">
                Exports the full arrangement with all effects. Reverb tail included.
              </DialogDescription>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close export dialog"
            onClick={close}
            disabled={busy}
            className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Song info */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 rounded-lg border border-black/50 bg-[#1d1d20] p-3.5">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Song</div>
            <div className="truncate text-[12px] text-zinc-200">{project.name || "Untitled"}</div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Duration</div>
            <div className="font-mono text-[12px] text-zinc-200">
              {formatTime(lengthTicks, project.tempo)}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Tempo · Key</div>
            <div className="text-[12px] text-zinc-200">
              {project.tempo} BPM · {keyLabel(project.keyTonic, project.keyMode)}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Tracks</div>
            <div className="text-[12px] text-zinc-200">{project.tracks.length}</div>
          </div>
        </div>

        {/* Format selector */}
        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Format
          </div>
          <RadioGroup
            value={String(bitDepth)}
            onValueChange={(v) => { if (!busy) setBitDepth(v === "24" ? 24 : 16); }}
            disabled={busy}
            className="grid grid-cols-2 gap-3"
          >
            <label
              className={cn(
                "flex items-start gap-2.5 rounded-lg border p-3 transition-colors",
                bitDepth === 16
                  ? "border-[#ffb648]/60 bg-[#ffb648]/[0.07]"
                  : "border-black/50 bg-[#1d1d20] hover:border-zinc-600/70",
                busy && "cursor-not-allowed opacity-60"
              )}
            >
              <RadioGroupItem
                value="16"
                className="mt-0.5 border-zinc-600 text-[#ffb648] data-[state=checked]:border-[#ffb648] [&_svg]:fill-[#ffb648]"
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-zinc-100">CD Quality</span>
                <span className="block text-[11px] text-zinc-500">16-bit · 44.1 kHz · stereo</span>
                <span className="mt-1 block text-[11px] font-medium text-[#ffb648]/90">
                  ≈ {formatMb(estimate(16))}
                </span>
              </span>
            </label>
            <label
              className={cn(
                "flex items-start gap-2.5 rounded-lg border p-3 transition-colors",
                bitDepth === 24
                  ? "border-[#ffb648]/60 bg-[#ffb648]/[0.07]"
                  : "border-black/50 bg-[#1d1d20] hover:border-zinc-600/70",
                busy && "cursor-not-allowed opacity-60"
              )}
            >
              <RadioGroupItem
                value="24"
                className="mt-0.5 border-zinc-600 text-[#ffb648] data-[state=checked]:border-[#ffb648] [&_svg]:fill-[#ffb648]"
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-zinc-100">Studio</span>
                <span className="block text-[11px] text-zinc-500">24-bit · 44.1 kHz · stereo</span>
                <span className="mt-1 block text-[11px] font-medium text-[#ffb648]/90">
                  ≈ {formatMb(estimate(24))}
                </span>
              </span>
            </label>
          </RadioGroup>
        </div>

        {/* Progress */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className={cn("text-zinc-400", busy && "text-[#ffb648]")}>{statusLabel}</span>
            <span className="font-mono text-zinc-500">
              {phase === "idle" ? "" : `${Math.min(100, Math.round(progress * 100))}%`}
            </span>
          </div>
          <Progress
            value={Math.min(100, progress * 100)}
            className="h-1.5 bg-black/60 [&_[data-slot=progress-indicator]]:bg-[#ffb648]"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-start gap-1.5 text-[11px] leading-snug text-zinc-500">
            <Info className="mt-px size-3.5 shrink-0" />
            Estimate excludes the reverb tail; the rendered file may be slightly larger.
          </span>
          <div className="flex shrink-0 gap-2.5">
            <Button
              variant="ghost"
              onClick={close}
              disabled={busy}
              className="text-zinc-300 hover:bg-white/5 hover:text-zinc-100"
            >
              Cancel
            </Button>
            <Button
              onClick={() => void runExport()}
              disabled={busy}
              className="gap-1.5 bg-[#ffb648] text-[#2b1c04] hover:bg-[#ffc670]"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
              {busy ? "Exporting…" : "Export WAV"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
