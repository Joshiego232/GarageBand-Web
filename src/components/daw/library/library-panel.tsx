"use client";

// ============================================================
// Library panel - browse instrument patches. Clicking a patch
// changes the selected software-instrument track's sound and
// auditions a short note (GarageBand-style).
// ============================================================

import { useMemo, useState } from "react";
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
import { cn } from "@/lib/utils";
import { useDAW } from "@/lib/daw/store";
import { PATCHES, PATCH_CATEGORIES } from "@/lib/daw/instruments";
import { engine } from "@/lib/daw/engine";
import type { Patch } from "@/lib/daw/types";

/** lucide icon lookup for patch.icon keys */
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

/** soft accent color per patch category (track palette) */
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

export function LibraryPanel() {
  const [category, setCategory] = useState<string>("All");
  const tracks = useDAW((s) => s.project.tracks);
  const selectedTrackId = useDAW((s) => s.ui.selectedTrackId);
  const setTrackInstrument = useDAW((s) => s.setTrackInstrument);

  const selectedTrack =
    tracks.find((t) => t.id === selectedTrackId) ?? null;

  const patches = useMemo(() => {
    const all = Object.values(PATCHES);
    return category === "All" ? all : all.filter((p) => p.category === category);
  }, [category]);

  const handlePatchClick = (patch: Patch) => {
    // Audition the sound on every click, like GarageBand
    engine.auditionNote(patch.id, 60, 100);

    if (!selectedTrack) {
      toast.info("Select a track first");
      return;
    }
    if (selectedTrack.type === "audio") {
      toast.info("Pick a software instrument track");
      return;
    }
    if (selectedTrack.instrument === patch.id) return; // already using it
    setTrackInstrument(selectedTrack.id, patch.id);
    toast.success(`Changed to ${patch.name}`);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <header className="h-9 shrink-0 px-3 bg-[#232327] border-b border-black/50 flex items-center gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
          Library
        </h2>
        <span
          className="ml-auto text-[10px] text-zinc-500 truncate"
          title={selectedTrack ? `for: ${selectedTrack.name}` : undefined}
        >
          for: {selectedTrack ? selectedTrack.name : "no track"}
        </span>
      </header>

      {/* Category rail */}
      <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-black/40 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {["All", ...PATCH_CATEGORIES].map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={cn(
              "h-6 shrink-0 px-2.5 rounded-full border text-[10px] whitespace-nowrap transition-colors",
              category === c
                ? "bg-[#ffb648]/15 text-[#ffb648] border-[#ffb648]/40"
                : "bg-[#2a2a2f] text-zinc-400 border-transparent hover:text-zinc-200"
            )}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Patch list */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1 [scrollbar-color:#3f3f46_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#3a3a41] [&::-webkit-scrollbar-track]:bg-transparent">
        {patches.length === 0 && (
          <p className="px-1 py-3 text-[11px] text-zinc-600">
            No patches in this category.
          </p>
        )}
        {patches.map((patch) => {
          const isCurrent =
            selectedTrack?.type === "midi" && selectedTrack.instrument === patch.id;
          const color = CATEGORY_COLORS[patch.category] ?? FALLBACK_COLOR;
          const Icon = PATCH_ICONS[patch.icon] ?? Music;
          return (
            <button
              key={patch.id}
              onClick={() => handlePatchClick(patch)}
              title={patch.desc}
              className={cn(
                "w-full flex items-center gap-2.5 p-1.5 rounded-md border text-left transition-colors",
                isCurrent
                  ? "border-[#ffb648]/50 bg-[#ffb648]/5"
                  : "border-transparent hover:bg-[#2c2c33]"
              )}
            >
              <span
                aria-hidden
                className="h-8 w-8 shrink-0 rounded-[10px] flex items-center justify-center border border-black/40"
                style={{
                  background: `linear-gradient(135deg, ${color}38, ${color}12)`,
                  color,
                }}
              >
                <Icon size={15} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[12px] font-medium text-zinc-200 truncate">
                  {patch.name}
                </span>
                <span className="block text-[10px] text-zinc-500 truncate">
                  {patch.desc}
                </span>
              </span>
              <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-[#2a2a2f] text-zinc-500">
                {patch.category}
              </span>
            </button>
          );
        })}
      </div>

      {/* Footer hint */}
      <footer className="shrink-0 h-7 px-3 flex items-center border-t border-black/50 bg-[#232327]">
        <p className="text-[10px] text-zinc-500 truncate">
          Click to change the selected track&apos;s instrument
        </p>
      </footer>
    </div>
  );
}
