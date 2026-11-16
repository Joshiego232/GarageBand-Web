"use client";

// ============================================================
// Library panel - browse instrument patches. Clicking a patch
// changes the selected software-instrument track's sound and
// auditions a short note (GarageBand-style).
// ============================================================

import { useEffect, useMemo, useState } from "react";
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
  Star,
  Search,
  X,
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
  "Stage Keys": "#d2a24c",
  "Layered Keys": "#d2769c",
};
const FALLBACK_COLOR = "#3f9d8b";
const FAVORITES_KEY = "webband-library-favorites";
const RECENTS_KEY = "webband-library-recents";
const MAX_RECENTS = 12;

function readPatchIds(key: string): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(saved)) return [];
    return [...new Set(saved.filter(
      (id): id is string => typeof id === "string" && id in PATCHES,
    ))];
  } catch (error) {
    console.error(`Could not read instrument library preference "${key}"`, error);
    return [];
  }
}

export function LibraryPanel() {
  const [category, setCategory] = useState<string>("All");
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const tracks = useDAW((s) => s.project.tracks);
  const selectedTrackId = useDAW((s) => s.ui.selectedTrackId);
  const setTrackInstrument = useDAW((s) => s.setTrackInstrument);

  useEffect(() => {
    setFavorites(readPatchIds(FAVORITES_KEY));
    setRecents(readPatchIds(RECENTS_KEY).slice(0, MAX_RECENTS));
    setPreferencesLoaded(true);
  }, []);

  useEffect(() => {
    if (!preferencesLoaded) return;
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
      localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
    } catch (error) {
      console.error("Could not save instrument library preferences", error);
    }
  }, [favorites, recents, preferencesLoaded]);

  const selectedTrack =
    tracks.find((t) => t.id === selectedTrackId) ?? null;

  const patches = useMemo(() => {
    let all = Object.values(PATCHES);
    if (category === "Favorites") {
      all = all.filter((patch) => favorites.includes(patch.id));
    } else if (category === "Recent") {
      all = recents.flatMap((id) => PATCHES[id] ? [PATCHES[id]] : []);
    } else if (category !== "All") {
      all = all.filter((patch) => patch.category === category);
    }
    const normalizedQuery = query.trim().toLowerCase();
    return normalizedQuery
      ? all.filter((patch) =>
          [patch.name, patch.category, patch.desc].some((value) =>
            value.toLowerCase().includes(normalizedQuery),
          ),
        )
      : all;
  }, [category, favorites, query, recents]);

  const handlePatchClick = (patch: Patch) => {
    setRecents((current) => [
      patch.id,
      ...current.filter((id) => id !== patch.id),
    ].slice(0, MAX_RECENTS));
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
        {["All", "Favorites", "Recent", ...PATCH_CATEGORIES].map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            aria-pressed={category === c}
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

      <div className="shrink-0 px-2 py-2 border-b border-black/40">
        <div className="relative">
          <Search
            aria-hidden
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
            size={13}
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search instruments"
            aria-label="Search instruments"
            className="h-8 w-full rounded-md border border-black/40 bg-[#17171a] pl-8 pr-8 text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-[#ffb648]/50"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear instrument search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <p className="px-0.5 pt-1.5 text-[9px] text-zinc-600" aria-live="polite">
          {patches.length} {patches.length === 1 ? "instrument" : "instruments"}
        </p>
      </div>

      {/* Patch list */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1 [scrollbar-color:#3f3f46_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#3a3a41] [&::-webkit-scrollbar-track]:bg-transparent">
        {patches.length === 0 && (
          <p className="px-1 py-3 text-[11px] text-zinc-600">
            {query
              ? "No instruments match your search."
              : category === "Favorites"
                ? "Star an instrument to add it to Favorites."
                : category === "Recent"
                  ? "Audition an instrument to see it here."
                  : "No patches in this category."}
          </p>
        )}
        {patches.map((patch) => {
          const isCurrent =
            selectedTrack?.type === "midi" && selectedTrack.instrument === patch.id;
          const color = CATEGORY_COLORS[patch.category] ?? FALLBACK_COLOR;
          const Icon = PATCH_ICONS[patch.icon] ?? Music;
          return (
            <div
              key={patch.id}
              className={cn(
                "group flex items-center rounded-md border transition-colors",
                isCurrent
                  ? "border-[#ffb648]/50 bg-[#ffb648]/5"
                  : "border-transparent hover:bg-[#2c2c33]",
              )}
            >
              <button
                type="button"
                onClick={() => handlePatchClick(patch)}
                title={`${patch.name}: ${patch.desc}`}
                aria-pressed={isCurrent}
                className="min-w-0 flex flex-1 items-center gap-2.5 p-1.5 text-left"
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
                  {patch.sampled?.layers?.length
                    ? "Layered"
                    : patch.sampled
                      ? "Sampled"
                      : "Synth"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setFavorites((current) =>
                  current.includes(patch.id)
                    ? current.filter((id) => id !== patch.id)
                    : [...current, patch.id],
                )}
                aria-label={`${favorites.includes(patch.id) ? "Remove" : "Add"} ${patch.name} ${favorites.includes(patch.id) ? "from" : "to"} favorites`}
                aria-pressed={favorites.includes(patch.id)}
                title={favorites.includes(patch.id) ? "Remove from Favorites" : "Add to Favorites"}
                className="mr-1.5 rounded p-1 text-zinc-600 hover:text-[#ffcb78] aria-pressed:text-[#ffb648]"
              >
                <Star size={13} fill={favorites.includes(patch.id) ? "currentColor" : "none"} />
              </button>
            </div>
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
