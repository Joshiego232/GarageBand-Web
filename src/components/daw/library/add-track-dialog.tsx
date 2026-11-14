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
import { engine } from "@/lib/daw/engine";
import { uid } from "@/lib/daw/types";

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
  "Worship Keys": "#9675d6",
  Organs: "#4ca8a0",
  Bass: "#e08e3c",
  Guitars: "#e0533d",
  "Strings & Orchestral": "#3f9d8b",
  "Bells & Mallets": "#c65cb8",
  "Brass & Winds": "#d29a52",
  "Drums & Percussion": "#d9b13b",
};
const FALLBACK_COLOR = "#3f9d8b";

/** Quick-pick patches shown on the Software Instrument card */
const QUICK_PICKS = [
  "grand-piano",
  "stage-epiano",
  "saw-lead",
  "warm-pad",
  "tonewheel-organ",
  "pluck-bass",
  "nylon-guitar",
  "string-ensemble",
  "celesta",
  "808-kit",
] as const;

export function AddTrackDialog() {
  const modal = useDAW((s) => s.ui.modal);
  const addTrack = useDAW((s) => s.addTrack);
  const setModal = useDAW((s) => s.setModal);
  const sampleInputRef = useRef<HTMLInputElement>(null);
  const [importingSample, setImportingSample] = useState(false);

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

  const importQuickSampler = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    if (!file.type.startsWith("audio/")) {
      toast.error("Choose an audio file for Quick Sampler");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast.error("Quick Sampler files must be 25 MB or smaller");
      return;
    }

    setImportingSample(true);
    try {
      const decoded = await engine.decodeAudioFile(file);
      const duration = decoded.channels[0]?.length
        ? decoded.channels[0].length / decoded.sampleRate
        : 0;
      if (duration <= 0 || duration > 60) {
        toast.error("Quick Sampler supports audio samples up to 60 seconds");
        return;
      }

      const bufferId = `quick-sampler-${uid()}`;
      await engine.storeBuffer(bufferId, decoded);
      const instrument = `quick-sampler-${bufferId}`;
      const name = file.name.replace(/\.[^.]+$/, "").trim() || "Quick Sampler";
      addTrack({
        type: "midi",
        instrument,
        name,
        icon: "audio-waveform",
        color: "#4a90d9",
        sampleBufferId: bufferId,
        sampleRootPitch: 60,
        samplePlaybackMode: "one-shot",
        sampleName: file.name,
      });
      setModal("none");
      toast.success(`Loaded ${file.name} into Quick Sampler`);
    } catch (error) {
      console.error("Quick Sampler import failed", error);
      toast.error("Could not decode this audio file. Try WAV, MP3 or OGG.");
    } finally {
      setImportingSample(false);
    }
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
            <input
              ref={sampleInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={importQuickSampler}
              aria-label="Choose audio file for Quick Sampler"
            />
            <button
              type="button"
              disabled={importingSample}
              onClick={() => sampleInputRef.current?.click()}
              className="h-8 rounded-md border border-[#4a90d9]/40 bg-[#4a90d9]/10 text-[10px] font-medium text-[#9dc8f0] hover:bg-[#4a90d9]/20 disabled:opacity-50 transition-colors"
            >
              {importingSample ? "Loading sample…" : "Create Quick Sampler from Audio"}
            </button>
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
