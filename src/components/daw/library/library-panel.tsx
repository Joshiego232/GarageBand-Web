"use client";

// ============================================================
// Library panel - browse instrument patches. Clicking a patch
// changes the selected software-instrument track's sound without
// automatically playing a preview note.
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
  Upload,
  Wind,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDAW } from "@/lib/daw/store";
import { PATCHES, PATCH_CATEGORIES } from "@/lib/daw/instruments";
import {
  makeImportedSoundFontPatch,
  SOUNDFONT_CATEGORIES,
} from "@/lib/daw/soundfont-catalog";
import {
  listImportedSoundFonts,
  type ImportedSoundFontRecord,
} from "@/lib/daw/soundfont-cache";
import { engine } from "@/lib/daw/engine";
import type { Patch } from "@/lib/daw/types";
import { uid } from "@/lib/daw/types";
import { makeUserPatch, readUserPatches, writeUserPatches, type UserPatch } from "@/lib/daw/user-patches";

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
  const [userPatches, setUserPatches] = useState<UserPatch[]>([]);
  const [importedSoundFonts, setImportedSoundFonts] = useState<ImportedSoundFontRecord[]>([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [patchName, setPatchName] = useState("");
  const [patchCategory, setPatchCategory] = useState("My Instruments");
  const [saveTrackId, setSaveTrackId] = useState<string | null>(null);
  const tracks = useDAW((s) => s.project.tracks);
  const selectedTrackId = useDAW((s) => s.ui.selectedTrackId);
  const setTrackInstrument = useDAW((s) => s.setTrackInstrument);

  useEffect(() => {
    const refreshSoundFonts = () => {
      void listImportedSoundFonts().then(setImportedSoundFonts).catch((error: unknown) => {
        console.error("Could not read imported SoundFont metadata.", error);
      });
    };
    const frame = window.requestAnimationFrame(() => {
      setFavorites(readPatchIds(FAVORITES_KEY));
      setRecents(readPatchIds(RECENTS_KEY).slice(0, MAX_RECENTS));
      setUserPatches(readUserPatches());
      refreshSoundFonts();
      setPreferencesLoaded(true);
    });
    window.addEventListener("webband:soundfonts-updated", refreshSoundFonts);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("webband:soundfonts-updated", refreshSoundFonts);
    };
  }, []);

  useEffect(() => {
    const openSaveDialog = (event: Event) => {
      const detail = (event as CustomEvent<{ trackId?: string }>).detail;
      if (!useDAW.getState().ui.panels.library) useDAW.getState().togglePanel("library");
      setSaveTrackId(detail?.trackId ?? selectedTrackId);
      setPatchName("");
      setPatchCategory("My Instruments");
      setSaveDialogOpen(true);
    };
    window.addEventListener("webband:save-user-patch", openSaveDialog);
    const refreshUserPatches = () => setUserPatches(readUserPatches());
    window.addEventListener("webband:user-patches-updated", refreshUserPatches);
    return () => {
      window.removeEventListener("webband:save-user-patch", openSaveDialog);
      window.removeEventListener("webband:user-patches-updated", refreshUserPatches);
    };
  }, [selectedTrackId]);

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

  const importedPatches = useMemo(
    () => importedSoundFonts.flatMap((font) =>
      font.presets.map((preset) => makeImportedSoundFontPatch({
        ...preset,
        fileId: font.id,
        fileName: font.fileName,
      })),
    ),
    [importedSoundFonts],
  );
  const categories = useMemo(
    () => [...new Set([...PATCH_CATEGORIES, ...SOUNDFONT_CATEGORIES, "Imported SoundFonts"])],
    [],
  );

  const patches = useMemo(() => {
    if (category === "My Instruments") return [];
    let all = [...Object.values(PATCHES), ...importedPatches];
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
  }, [category, favorites, importedPatches, query, recents]);
  const filteredUserPatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return userPatches.filter((patch) =>
      (category === "My Instruments" || patch.category === category) &&
      (!q || patch.name.toLowerCase().includes(q) || patch.category.toLowerCase().includes(q))
    );
  }, [category, query, userPatches]);

  const handlePatchClick = (patch: Patch) => {
    setRecents((current) => [
      patch.id,
      ...current.filter((id) => id !== patch.id),
    ].slice(0, MAX_RECENTS));
    if (!selectedTrack) {
      toast.info("Select a track first");
      return;
    }
    if (selectedTrack.type === "audio") {
      toast.info("Pick a software instrument track");
      return;
    }
    if (selectedTrack.instrument === patch.id) return; // already using it
    if (patch.soundfont?.source === "imported" && patch.soundfont.fileId) {
      const preset = {
        fileId: patch.soundfont.fileId,
        fileName: patch.soundfont.fileName ?? patch.soundfont.name,
        presetName: patch.soundfont.name,
        bank: patch.soundfont.bank,
        program: patch.soundfont.program,
      };
      useDAW.getState().commit();
      useDAW.getState().updateTrack(selectedTrack.id, {
        instrument: patch.id,
        soundFontPreset: preset,
        params: Object.fromEntries(patch.knobs.map((knob) => [knob.id, knob.def])),
        icon: patch.icon,
        name: patch.name,
      }, false);
    } else {
      setTrackInstrument(selectedTrack.id, patch.id);
    }
    toast.success(`Changed to ${patch.name}`);
  };

  const saveCurrentPatch = () => {
    const selected = tracks.find((track) => track.id === saveTrackId);
    if (!selected || !patchName.trim()) return;
    const stack = selected.role === "folder"
      ? useDAW.getState().project.stacks?.find((item) => item.folderTrackId === selected.id)
      : undefined;
    const stackTracks = stack
      ? tracks.filter((track) => stack.trackIds.includes(track.id))
      : [];
    const busTrack = stack?.busTrackId
      ? tracks.find((track) => track.id === stack.busTrackId)
      : undefined;
    try {
      const patch = makeUserPatch(patchName.trim(), patchCategory, selected, stack, stackTracks, busTrack);
      const next = [patch, ...userPatches];
      writeUserPatches(next);
      setUserPatches(next);
      setCategory("My Instruments");
      setSaveDialogOpen(false);
      toast.success(`${patch.name} saved to ${patch.category}`);
    } catch (error) {
      console.error("Could not save user patch.", error);
      toast.error(error instanceof Error ? error.message : "Could not save the patch.");
    }
  };

  const loadUserPatch = (patch: UserPatch) => {
    const state = useDAW.getState();
    if (patch.kind === "pedalboard" && patch.pedalboard) {
      const selected = state.project.tracks.find((track) => track.id === state.ui.selectedTrackId);
      if (!selected) {
        toast.info("Select a channel before loading a pedalboard preset");
        return;
      }
      const stack = selected.role === "folder"
        ? state.project.stacks?.find((item) => item.folderTrackId === selected.id)
        : undefined;
      const target = stack?.type === "summing" && stack.busTrackId
        ? state.project.tracks.find((track) => track.id === stack.busTrackId)
        : selected;
      if (!target) {
        toast.error("Could not find the selected stack's insert channel");
        return;
      }
      const plugins = target.audioPlugins ?? [];
      const slot = plugins.find((plugin) => plugin.pluginId === "pedalboard");
      state.updateTrack(target.id, {
        pedalboard: patch.pedalboard.map((pedal) => ({
          ...pedal,
          id: uid(),
          params: { ...pedal.params },
        })),
        audioPlugins: slot
          ? plugins.map((plugin) => plugin.id === slot.id ? { ...plugin, enabled: true } : plugin)
          : [...plugins, { id: uid(), pluginId: "pedalboard", enabled: true, params: {} }],
      });
      toast.success(`Loaded ${patch.name} on ${target.name}`);
      return;
    }
    if (patch.kind === "track" && patch.track) {
      state.addTrack({ ...patch.track, id: uid(), name: patch.name, regions: [] });
      toast.success(`Loaded ${patch.name}`);
      return;
    }
    if (patch.kind === "stack" && patch.stack) {
      const startingCount = state.project.tracks.length;
      state.addTracks(patch.stack.tracks.map((track) => ({
        ...track,
        id: undefined,
        role: "track",
        stackId: null,
        parentTrackId: null,
        regions: [],
      })));
      const created = useDAW.getState().project.tracks.slice(startingCount);
      const stackId = useDAW.getState().createTrackStack(
        patch.name,
        patch.stack.definition.type,
        created.map((track) => track.id)
      );
      if (!stackId) {
        toast.error("Could not reconstruct this track stack.");
        return;
      }
      const loadedStack = useDAW.getState().project.stacks?.find((item) => item.id === stackId);
      if (loadedStack) {
        useDAW.getState().setTrackStackColor(stackId, patch.color);
        useDAW.getState().renameTrackStack(stackId, patch.name);
        const savedBus = patch.stack.bus;
        if (savedBus && loadedStack.busTrackId) {
          useDAW.getState().updateTrack(
            loadedStack.busTrackId,
            {
              ...savedBus,
              role: "aux",
              name: `${patch.name} Bus`,
              regions: [],
              stackId: null,
              parentTrackId: null,
            },
            false
          );
        }
      }
      toast.success(`Loaded ${patch.name}`);
    }
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

      <div className="flex flex-1 min-h-0">
        {/* Finder-style category column */}
        <nav aria-label="Instrument categories" className="w-[96px] shrink-0 overflow-y-auto border-r border-black/50 bg-[#202022] p-1.5">
          {["All", "My Instruments", "Favorites", "Recent", ...categories].map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
              title={c}
              className={cn(
                "mb-0.5 w-full truncate rounded px-2 py-1.5 text-left text-[10px] transition-colors",
                category === c
                  ? "bg-[#ffffff]/10 text-zinc-100 shadow-[inset_2px_0_#67b7ff]"
                  : "text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
              )}
            >
              {c}
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
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
        {category === "My Instruments" && filteredUserPatches.map((patch) => (
          <button
            key={patch.id}
            type="button"
            onClick={() => loadUserPatch(patch)}
            className="group flex w-full items-center gap-2 rounded-md border border-transparent p-1.5 text-left hover:border-[#ffb648]/30 hover:bg-[#2c2c33]"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-black/40 text-[11px] font-semibold" style={{ backgroundColor: `${patch.color}30`, color: patch.color }}>
              {patch.kind === "stack" ? "▤" : patch.kind === "pedalboard" ? "◉" : "♪"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-medium text-zinc-200">{patch.name}</span>
              <span className="block truncate text-[9px] text-zinc-500">{patch.category} · {patch.kind === "stack" ? "Track Stack" : patch.kind === "pedalboard" ? "Pedalboard" : "Instrument"}</span>
            </span>
          </button>
        ))}
        {category === "My Instruments" && filteredUserPatches.length === 0 && (
          <p className="px-1 py-3 text-[11px] text-zinc-600">Save a track or stack to build your user patch library.</p>
        )}
        {patches.length === 0 && (
          category !== "My Instruments" &&
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
        </div>
      </div>

      {/* Footer hint */}
      <footer className="shrink-0 h-7 px-3 flex items-center border-t border-black/50 bg-[#232327]">
        <p className="min-w-0 flex-1 text-[10px] text-zinc-500 truncate">
          Click to change the selected track&apos;s instrument
        </p>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("webband:import-soundfont", {
            detail: { trackId: selectedTrackId ?? undefined },
          }))}
          className="ml-1 shrink-0 rounded border border-[#67b7ff]/25 bg-[#67b7ff]/10 px-2 py-1 text-[9px] font-medium text-[#9dcfff] hover:bg-[#67b7ff]/20"
          title="Import and scan an .sf2 or .sf3 file"
        >
          <Upload size={11} className="inline -mt-px mr-1" />
          Import SF
        </button>
        <button
          type="button"
          onClick={() => {
            setSaveTrackId(selectedTrackId);
            setPatchName("");
            setSaveDialogOpen(true);
          }}
          disabled={!selectedTrack}
          className="ml-2 shrink-0 rounded border border-white/10 bg-white/5 px-2 py-1 text-[9px] font-medium text-zinc-300 hover:bg-white/10 disabled:opacity-40"
        >
          Save...
        </button>
      </footer>
      {saveDialogOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-patch-title"
            onSubmit={(event) => {
              event.preventDefault();
              saveCurrentPatch();
            }}
            className="w-full max-w-sm rounded-xl border border-white/10 bg-[#29292d] p-5 text-zinc-200 shadow-[0_20px_70px_rgba(0,0,0,.7),inset_0_1px_rgba(255,255,255,.07)]"
          >
            <h2 id="save-patch-title" className="text-sm font-semibold">Save User Patch</h2>
            <p className="mt-1 text-[11px] text-zinc-500">Save instrument settings or the selected stack for reuse.</p>
            <label className="mt-4 block text-[10px] uppercase tracking-wider text-zinc-500">
              Patch name
              <input autoFocus value={patchName} onChange={(event) => setPatchName(event.target.value)} required maxLength={64} className="mt-1 h-8 w-full rounded-md border border-black/60 bg-[#19191c] px-2 text-xs text-zinc-100 outline-none focus:border-[#ffb648]/50" />
            </label>
            <label className="mt-3 block text-[10px] uppercase tracking-wider text-zinc-500">
              Category
              <select value={patchCategory} onChange={(event) => setPatchCategory(event.target.value)} className="mt-1 h-8 w-full rounded-md border border-black/60 bg-[#19191c] px-2 text-xs text-zinc-200 outline-none">
                <option>My Instruments</option>
                <option>User Patches</option>
                {PATCH_CATEGORIES.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setSaveDialogOpen(false)} className="h-7 rounded px-3 text-[11px] text-zinc-400 hover:bg-white/5">Cancel</button>
              <button type="submit" className="h-7 rounded bg-[#e6a845] px-3 text-[11px] font-semibold text-[#19191b] hover:brightness-110">Save Patch</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
