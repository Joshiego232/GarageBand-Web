"use client";

// ============================================================
// Add Track dialog - pick Software Instrument (with quick-pick
// patches), Audio, or Drummer. Mounted when ui.modal === 'addTrack'.
// ============================================================

import { toast } from "sonner";
import {
  AudioWaveform,
  Bell,
  Drum,
  Gamepad2,
  Grid3x3,
  Guitar,
  Mic,
  Music,
  Piano,
  Speaker,
  Wind,
  type LucideIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDAW } from "@/lib/daw/store";
import { PATCHES } from "@/lib/daw/instruments";

const PATCH_ICONS: Record<string, LucideIcon> = {
  piano: Piano,
  "audio-waveform": AudioWaveform,
  guitar: Guitar,
  drum: Drum,
  speaker: Speaker,
  bell: Bell,
  music: Music,
  wind: Wind,
  "grid-3x3": Grid3x3,
  "gamepad-2": Gamepad2,
  mic: Mic,
};

const CATEGORY_COLORS: Record<string, string> = {
  "Piano & Keys": "#8fb44a",
  Synthesizer: "#7a6fd0",
  Bass: "#e08e3c",
  Orchestral: "#3f9d8b",
  Guitar: "#e0533d",
  Mallets: "#c65cb8",
  Drums: "#d9b13b",
};
const FALLBACK_COLOR = "#3f9d8b";

/** Quick-pick patches shown on the Software Instrument card */
const QUICK_PICKS = [
  "grand-piano",
  "808-kit",
  "saw-lead",
  "pluck-bass",
  "warm-pad",
  "marimba",
] as const;

export function AddTrackDialog() {
  const modal = useDAW((s) => s.ui.modal);
  const addTrack = useDAW((s) => s.addTrack);
  const setModal = useDAW((s) => s.setModal);

  const open = modal === "addTrack";

  const addMidiTrack = (patchId: string) => {
    addTrack({ type: "midi", instrument: patchId });
    setModal("none");
    toast.success(`Added ${PATCHES[patchId]?.name ?? "instrument"} track`);
  };

  const addAudioTrack = () => {
    addTrack({ type: "audio" });
    setModal("none");
    toast.success("Audio track added");
  };

  const addDrummerTrack = () => {
    addTrack({ type: "midi", instrument: "drum-kit", name: "Drums" });
    setModal("none");
    toast.success("Drummer track added");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && setModal("none")}>
      <DialogContent className="sm:max-w-[580px] bg-[#1d1d20] border-black/60 text-zinc-200">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">Choose a Track Type</DialogTitle>
          <DialogDescription className="text-zinc-500">
            You can mix software instruments, audio and drummer tracks in the same
            project.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-stretch">
          {/* 1. Software Instrument */}
          <div className="rounded-lg border border-black/60 bg-[#232327] p-4 flex flex-col gap-3 transition hover:ring-1 hover:ring-[#ffb648]/40">
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="h-11 w-11 shrink-0 rounded-full flex items-center justify-center border border-black/40"
                style={{
                  background: "linear-gradient(135deg, #8fb44a38, #8fb44a12)",
                  color: "#8fb44a",
                }}
              >
                <Piano size={20} />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-zinc-100">
                  Software Instrument
                </p>
                <p className="text-[11px] text-zinc-400 leading-snug">
                  Play the built-in synths, pianos and drums with your keyboard
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5 mt-auto">
              {QUICK_PICKS.map((id) => {
                const patch = PATCHES[id];
                if (!patch) return null;
                const color = CATEGORY_COLORS[patch.category] ?? FALLBACK_COLOR;
                const Icon = PATCH_ICONS[patch.icon] ?? Music;
                return (
                  <button
                    key={id}
                    onClick={() => addMidiTrack(id)}
                    title={patch.desc}
                    className="h-7 px-2 rounded-md bg-[#2a2a2f] border border-black/40 hover:border-[#8fb44a]/50 hover:bg-[#31313a] text-[10px] text-zinc-300 flex items-center gap-1.5 transition-colors"
                  >
                    <Icon size={12} style={{ color }} aria-hidden />
                    <span className="truncate">{patch.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Audio */}
          <div className="rounded-lg border border-black/60 bg-[#232327] p-4 flex flex-col gap-3 transition hover:ring-1 hover:ring-[#ffb648]/40">
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="h-11 w-11 shrink-0 rounded-full flex items-center justify-center border border-black/40"
                style={{
                  background: "linear-gradient(135deg, #4a90d938, #4a90d912)",
                  color: "#4a90d9",
                }}
              >
                <Mic size={20} />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-zinc-100">Audio</p>
                <p className="text-[11px] text-zinc-400 leading-snug">
                  Record microphone or guitar, or drag audio files in
                </p>
              </div>
            </div>
            <button
              onClick={addAudioTrack}
              className="mt-auto h-8 rounded-md bg-[#2f2f34] border border-black/40 text-[11px] font-medium text-zinc-200 hover:bg-[#3a3a41] transition-colors"
            >
              Create Audio Track
            </button>
          </div>

          {/* 3. Drummer */}
          <button
            onClick={addDrummerTrack}
            className="rounded-lg border border-black/60 bg-[#232327] p-4 flex flex-col gap-3 text-left transition hover:ring-1 hover:ring-[#ffb648]/40 hover:bg-[#2c2c33] cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="h-11 w-11 shrink-0 rounded-full flex items-center justify-center border border-black/40"
                style={{
                  background: "linear-gradient(135deg, #d9b13b38, #d9b13b12)",
                  color: "#d9b13b",
                }}
              >
                <Drum size={20} />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-zinc-100">Drummer</p>
                <p className="text-[11px] text-zinc-400 leading-snug">
                  Instant drum kit with ready-made beats
                </p>
              </div>
            </div>
            <p className="mt-auto text-[10px] text-zinc-600">
              Click to add a Drummer track
            </p>
          </button>
        </div>

        <DialogFooter className="sm:justify-center border-t border-black/50 pt-3">
          <p className="text-[10px] text-zinc-600">
            You can add more tracks anytime (Ctrl/Cmd+Shift+N)
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
