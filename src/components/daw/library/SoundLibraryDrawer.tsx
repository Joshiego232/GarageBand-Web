"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  AudioLines,
  AudioWaveform,
  Bell,
  Church,
  Disc3,
  Drum,
  FolderOpen,
  Gamepad2,
  Guitar,
  Grid3x3,
  Music2,
  Piano,
  Search,
  Sparkles,
  UserRound,
  Waves,
  Wind,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ResizeHandle } from "@/components/daw/panels/resize-handle";
import { engine } from "@/lib/daw/engine";
import { PATCHES } from "@/lib/daw/instruments";
import {
  INSTRUMENT_CATEGORIES,
  toInstrumentPreset,
  type InstrumentArtworkKind,
  type InstrumentPreset,
} from "@/lib/daw/instrumentPresets";
import {
  makeImportedSoundFontPatch,
} from "@/lib/daw/soundfont-catalog";
import {
  listImportedSoundFonts,
  type ImportedSoundFontRecord,
} from "@/lib/daw/soundfont-cache";
import {
  makeUserPatch,
  readUserPatches,
  writeUserPatches,
  type UserPatch,
} from "@/lib/daw/user-patches";
import { useDAW } from "@/lib/daw/store";
import { uid, type Patch } from "@/lib/daw/types";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  "user-round": UserRound,
  church: Church,
  "audio-lines": AudioLines,
  "disc-3": Disc3,
  sparkles: Sparkles,
  piano: Piano,
  guitar: Guitar,
  "grid-3x3": Grid3x3,
  "gamepad-2": Gamepad2,
  "audio-waveform": AudioWaveform,
  drum: Drum,
  "music-2": Music2,
  bell: Bell,
  wind: Wind,
  waves: Waves,
  "folder-open": FolderOpen,
};

const ARTWORK_COLORS: Record<InstrumentArtworkKind, [string, string]> = {
  piano: ["#d9b879", "#473929"],
  guitar: ["#e8a56c", "#55351f"],
  drums: ["#ed8c67", "#4b2929"],
  synth: ["#8cc6ff", "#29394e"],
  organ: ["#c2a8ff", "#3b3155"],
  brass: ["#f1cb73", "#54462c"],
  strings: ["#c4a8e8", "#40334c"],
  bass: ["#7fc4b7", "#293f40"],
  bells: ["#f0d47a", "#51472c"],
  turntable: ["#aeb4c3", "#353943"],
};

const SCROLL_CLASS =
  "overflow-y-auto [scrollbar-color:#45454d_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#45454d]";

function InstrumentArtwork({ kind }: { kind: InstrumentArtworkKind }) {
  const [light, dark] = ARTWORK_COLORS[kind];
  return (
    <svg
      viewBox="0 0 96 96"
      role="img"
      aria-label={`${kind} instrument artwork placeholder`}
      className="size-full"
    >
      <defs>
        <linearGradient id={`art-${kind}`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor={light} stopOpacity=".95" />
          <stop offset="1" stopColor={dark} />
        </linearGradient>
        <radialGradient id="art-glow">
          <stop stopColor={light} stopOpacity=".35" />
          <stop offset="1" stopColor={dark} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="96" height="96" rx="18" fill={`url(#art-${kind})`} />
      <circle cx="48" cy="40" r="44" fill="url(#art-glow)" />
      <g stroke="#f8f6f1" strokeLinecap="round" strokeLinejoin="round">
        {kind === "piano" && (
          <>
            <path d="M17 33h62v31H17z" fill="#17191d" strokeWidth="2" />
            <path d="M22 38v23m9-23v23m9-23v23m9-23v23m9-23v23m9-23v23m9-23v23" stroke="#dedbd4" strokeWidth="2" />
            <path d="M27 37v13m18-13v13m9-13v13m18-13v13" stroke="#1b1b1c" strokeWidth="5" />
            <path d="M12 67h72" stroke={light} strokeWidth="3" />
          </>
        )}
        {kind === "guitar" && (
          <>
            <path d="M56 23 71 12l6 6-11 15-8 7c7 12 4 25-6 34-10 9-24 8-32 0s-7-22 2-32c9-10 22-13 34-6z" fill="#b86537" strokeWidth="2" />
            <path d="m55 39 22-22M31 48l28 25M43 40l-8 36m12-39-8 38m12-37-8 35" stroke="#f5ddbd" strokeWidth="1.5" />
            <circle cx="42" cy="57" r="7" fill="#25252a" strokeWidth="2" />
          </>
        )}
        {kind === "drums" && (
          <>
            <path d="M15 28h31l-5 5H20zM54 19h27l-4 5H57z" fill="#e7c56e" strokeWidth="2" />
            <path d="M28 34v12m36-19v13" strokeWidth="2" />
            <ellipse cx="46" cy="59" rx="23" ry="15" fill="#c9534d" strokeWidth="2" />
            <path d="M23 58v10m46-10v10M38 73l-3 10m20-10 3 10" strokeWidth="2" />
            <ellipse cx="20" cy="48" rx="8" ry="5" fill="#d8dce2" strokeWidth="2" />
          </>
        )}
        {kind === "synth" && (
          <>
            <path d="M14 30h68v39H14z" rx="5" fill="#202936" strokeWidth="2" />
            <path d="M19 54h57v10H19z" fill="#e7e5df" strokeWidth="1.5" />
            <path d="M26 54v6m8-6v6m8-6v6m16-6v6m8-6v6" stroke="#262832" strokeWidth="2" />
            <circle cx="27" cy="43" r="4" fill="#79c5ff" strokeWidth="1.5" />
            <circle cx="43" cy="43" r="4" fill="#b59aff" strokeWidth="1.5" />
            <path d="M55 43h19" stroke={light} strokeWidth="2" />
          </>
        )}
        {kind === "organ" && (
          <>
            <path d="M19 20h58v50H19z" fill="#382f31" strokeWidth="2" />
            <path d="M25 29h46v10H25z" fill="#17191d" strokeWidth="1.5" />
            <path d="M27 47h42v16H27z" fill="#eee9dc" strokeWidth="1.5" />
            <path d="M34 47v9m9-9v9m9-9v9m9-9v9" stroke="#27252a" strokeWidth="3" />
            <path d="M13 73h70m-60 0v8m50-8v8" strokeWidth="2" />
          </>
        )}
        {kind === "brass" && (
          <>
            <path d="M25 68V31h30v12H39v25z" fill="#d5a840" strokeWidth="2" />
            <path d="m54 31 16-9 10 5-18 17" fill="#e6bd55" strokeWidth="2" />
            <path d="M26 34H17m9 10H17m9 10H17m9 10H17" strokeWidth="2" />
            <path d="M56 43v11m-9-11v11m-9-11v11" stroke="#72572d" strokeWidth="2" />
          </>
        )}
        {kind === "strings" && (
          <>
            <path d="M50 19c-4 6-8 8-14 11-7 4-9 15-5 22l13 22h12l13-22c4-7 2-18-5-22-6-3-10-5-14-11z" fill="#936c4c" strokeWidth="2" />
            <path d="m48 28-3 48m6-48 3 48m-6-48 9 44m-12-44-9 44" stroke="#f4e7ca" strokeWidth="1" />
            <path d="M38 43h24M35 55h30" strokeWidth="2" />
          </>
        )}
        {kind === "bass" && (
          <>
            <path d="m58 24 19-9 5 6-18 14m-8 0c-11-8-24-4-29 5-5 8-2 17 6 22-2 7 1 14 8 17 8 3 16-2 17-11 12-6 15-19 6-28z" fill="#458c82" strokeWidth="2" />
            <path d="m53 36 27-19M32 46l26 26m-21-31-7 38m13-40-7 39m13-37-8 34" stroke="#e4e6d9" strokeWidth="1.5" />
          </>
        )}
        {kind === "bells" && (
          <>
            <path d="M25 34h47l-5 30H30z" fill="#d6b457" strokeWidth="2" />
            <path d="M37 34V22h23v12M20 70h56" strokeWidth="2" />
            <path d="m34 47 5 5 5-5m6 0 5 5 5-5" fill="none" stroke="#745d2e" strokeWidth="2" />
            <path d="M48 64v8m-8-8v8m16-8v8" strokeWidth="2" />
          </>
        )}
        {kind === "turntable" && (
          <>
            <path d="M14 27h68v44H14z" fill="#22252d" strokeWidth="2" />
            <circle cx="41" cy="49" r="17" fill="#15171b" strokeWidth="2" />
            <circle cx="41" cy="49" r="9" stroke={light} strokeWidth="2" />
            <circle cx="41" cy="49" r="2" fill="#eee" />
            <path d="m68 35 6 7-11 16m0 0 8 3" fill="none" stroke={light} strokeWidth="2" />
          </>
        )}
      </g>
      <circle cx="75" cy="75" r="2" fill="#fff" fillOpacity=".75" />
    </svg>
  );
}

function PreviewArt({ preset, height }: { preset: InstrumentPreset; height: number }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const imageFailed = !!preset.previewImageUrl && failedUrl === preset.previewImageUrl;
  return (
    <div
      className="relative w-full shrink-0 overflow-hidden bg-[#232426] px-3 pt-3"
      style={{ height }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 65%, rgba(116,128,153,.14), transparent 68%)",
        }}
      />
      {preset.previewImageUrl && !imageFailed ? (
        <img
          src={preset.previewImageUrl}
          alt={`${preset.name} instrument artwork`}
          className="relative h-full w-full select-none object-contain drop-shadow-[0_10px_18px_rgba(0,0,0,0.65)]"
          draggable={false}
          onError={() => setFailedUrl(preset.previewImageUrl ?? null)}
        />
      ) : (
        <div className="relative flex h-full w-full items-center justify-center">
          <div className="h-full max-h-28 w-full max-w-28">
            <InstrumentArtwork kind={preset.artwork} />
          </div>
        </div>
      )}
    </div>
  );
}

type BrowserItem =
  | { kind: "instrument"; preset: InstrumentPreset; patch: Patch }
  | { kind: "user"; userPatch: UserPatch };

function getUserPatchArtwork(patch: UserPatch): InstrumentPreset {
  const track = patch.track;
  const instrument = track?.instrument ? PATCHES[track.instrument] : undefined;
  const preset = instrument
    ? toInstrumentPreset(instrument)
    : toInstrumentPreset(PATCHES["grand-piano"]);
  return {
    ...preset,
    id: patch.id,
    name: patch.name,
    category: patch.category,
    artwork: instrument ? preset.artwork : "synth",
    previewImageUrl: undefined,
  };
}

function patchMatches(preset: InstrumentPreset, query: string) {
  const text = `${preset.name} ${preset.category} ${preset.description}`.toLowerCase();
  return text.includes(query);
}

export function SoundLibraryDrawer() {
  const [category, setCategory] = useState("Piano & Keys");
  const [query, setQuery] = useState("");
  const [previewState, setPreviewState] = useState<{
    preset: InstrumentPreset;
    trackId: string | null;
    instrument: string | null;
  } | null>(null);
  const [userPatches, setUserPatches] = useState<UserPatch[]>([]);
  const [soundFonts, setSoundFonts] = useState<ImportedSoundFontRecord[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveTrackId, setSaveTrackId] = useState<string | null>(null);
  const [previewHeight, setPreviewHeight] = useState(144);
  const [visibleLimit, setVisibleLimit] = useState(150);
  const [activeIndex, setActiveIndex] = useState(0);
  const trackRefs = useRef(new Map<string, HTMLButtonElement>());
  const categoryRefs = useRef(new Map<string, HTMLButtonElement>());
  const searchRef = useRef<HTMLInputElement>(null);
  const track = useDAW((state) =>
    state.project.tracks.find((item) => item.id === state.ui.selectedTrackId) ?? null,
  );
  const saveTrack = useDAW((state) =>
    state.project.tracks.find((item) => item.id === saveTrackId) ?? null,
  );
  const selectedTrackId = useDAW((state) => state.ui.selectedTrackId);

  const refresh = useCallback(() => {
    setUserPatches(readUserPatches());
    void listImportedSoundFonts().then(setSoundFonts).catch((error: unknown) => {
      console.error("Could not read imported SoundFont metadata.", error);
    });
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(refresh);
    const handleSaveRequest = (event: Event) => {
      const request = (event as CustomEvent<{ trackId?: string }>).detail;
      const targetId = request?.trackId ?? useDAW.getState().ui.selectedTrackId;
      const target = useDAW.getState().project.tracks.find((item) => item.id === targetId);
      if (!target) {
        toast.info("Select a track to save a patch");
        return;
      }
      setSaveTrackId(target.id);
      setSaveName(target.name);
      setSaveOpen(true);
    };
    window.addEventListener("webband:user-patches-updated", refresh);
    window.addEventListener("webband:soundfonts-updated", refresh);
    window.addEventListener("webband:save-user-patch", handleSaveRequest);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("webband:user-patches-updated", refresh);
      window.removeEventListener("webband:soundfonts-updated", refresh);
      window.removeEventListener("webband:save-user-patch", handleSaveRequest);
    };
  }, [refresh]);

  const allPatches = useMemo(() => {
    const builtIn = Object.values(PATCHES);
    const imported = soundFonts.flatMap((font) =>
      font.presets.map((preset) =>
        makeImportedSoundFontPatch({
          ...preset,
          fileId: font.id,
          fileName: font.fileName,
        }),
      ),
    );
    return [...builtIn, ...imported];
  }, [soundFonts]);

  const allPresets = useMemo(
    () => allPatches.map(toInstrumentPreset),
    [allPatches],
  );
  const queryText = query.trim().toLowerCase();
  const categories = useMemo(() => {
    const discovered = [...new Set(allPresets.map((preset) => preset.category))];
    return [
      ...INSTRUMENT_CATEGORIES.filter((item) => item.name === "My Instruments"),
      ...INSTRUMENT_CATEGORIES.filter((item) => item.name !== "My Instruments"),
      ...discovered
        .filter((name) => !INSTRUMENT_CATEGORIES.some((item) => item.name === name))
        .map((name) => ({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, icon: "music-2" })),
    ];
  }, [allPresets]);

  const browserItems = useMemo<BrowserItem[]>(() => {
    if (queryText) {
      const instruments = allPatches.flatMap((patch) => {
        const preset = toInstrumentPreset(patch);
        return patchMatches(preset, queryText)
          ? [{ kind: "instrument" as const, preset, patch }]
          : [];
      });
      const saved = userPatches
        .filter((item) => `${item.name} ${item.category}`.toLowerCase().includes(queryText))
        .map((userPatch) => ({ kind: "user" as const, userPatch }));
      return [...saved, ...instruments];
    }
    if (category === "My Instruments") {
      return userPatches.map((userPatch) => ({ kind: "user" as const, userPatch }));
    }
    return allPatches.flatMap((patch) => {
      const preset = toInstrumentPreset(patch);
      return preset.category === category
        ? [{ kind: "instrument" as const, preset, patch }]
        : [];
    });
  }, [allPatches, allPresets, category, queryText, userPatches]);

  const visibleCategories = useMemo(() => {
    if (!queryText) return categories;
    return categories.filter((item) =>
      item.name === "My Instruments"
        ? userPatches.some((saved) =>
            `${saved.name} ${saved.category}`.toLowerCase().includes(queryText),
          )
        : allPresets.some((preset) =>
            preset.category === item.name && patchMatches(preset, queryText),
          ),
    );
  }, [allPresets, categories, queryText, userPatches]);

  const selectedInstrument = track?.type === "midi"
    ? allPresets.find((preset) => preset.id === track.instrument) ?? null
    : null;
  const preview = previewState &&
    previewState.trackId === (track?.id ?? null) &&
    previewState.instrument === (track?.instrument ?? null)
    ? previewState.preset
    : selectedInstrument ?? allPresets[0];
  const currentPatch = track?.type === "midi"
    ? allPatches.find((patch) => patch.id === track.instrument)
    : undefined;

  const audition = useCallback((patch: Patch) => {
    engine.auditionNote(patch.id, 60, 100, undefined, patch);
    setPreviewState({
      preset: toInstrumentPreset(patch),
      trackId: track?.id ?? null,
      instrument: track?.instrument ?? null,
    });
  }, [track?.id, track?.instrument]);

  const assignInstrument = (patch: Patch) => {
    audition(patch);
    if (!track) {
      toast.info("Select a track first");
      return;
    }
    if (track.type !== "midi") {
      toast.info("Pick a software-instrument track");
      return;
    }
    if (track.instrument === patch.id) return;

    const previousName = track.soundFontPreset?.presetName ??
      PATCHES[track.instrument]?.name ??
      track.name;
    const shouldRename = track.name === previousName;
    const imported = patch.soundfont?.source === "imported" && patch.soundfont.fileId;
    useDAW.getState().updateTrack(track.id, {
      instrument: patch.id,
      soundFontPreset: imported && patch.soundfont
        ? {
            fileId: patch.soundfont.fileId!,
            fileName: patch.soundfont.fileName ?? patch.soundfont.name,
            presetName: patch.soundfont.name,
            bank: patch.soundfont.bank,
            program: patch.soundfont.program,
          }
        : undefined,
      params: Object.fromEntries(patch.knobs.map((knob) => [knob.id, knob.def])),
      icon: patch.icon,
      ...(shouldRename ? { name: patch.name } : {}),
    });
    toast.success(`Changed to ${patch.name}`);
  };

  const loadUserPatch = (patch: UserPatch) => {
    const state = useDAW.getState();
    if (patch.kind === "pedalboard" && patch.pedalboard) {
      const selected = state.project.tracks.find((item) => item.id === state.ui.selectedTrackId);
      if (!selected) {
        toast.info("Select a channel before loading a pedalboard preset");
        return;
      }
      const slot = selected.audioPlugins?.find((plugin) => plugin.pluginId === "pedalboard");
      state.updateTrack(selected.id, {
        pedalboard: patch.pedalboard.map((pedal) => ({
          ...pedal,
          id: uid(),
          params: { ...pedal.params },
        })),
        audioPlugins: slot
          ? selected.audioPlugins?.map((plugin) =>
              plugin.id === slot.id ? { ...plugin, enabled: true } : plugin,
            )
          : [...(selected.audioPlugins ?? []), {
              id: uid(),
              pluginId: "pedalboard",
              enabled: true,
              params: {},
            }],
      });
      toast.success(`Loaded ${patch.name} on ${selected.name}`);
      return;
    }
    if (patch.kind === "track" && patch.track) {
      state.addTrack({ ...patch.track, id: uid(), name: patch.name, regions: [] });
      toast.success(`Loaded ${patch.name}`);
      return;
    }
    if (patch.kind === "stack" && patch.stack) {
      const start = state.project.tracks.length;
      state.addTracks(patch.stack.tracks.map((item) => ({
        ...item,
        id: undefined,
        role: "track",
        stackId: null,
        parentTrackId: null,
        regions: [],
      })));
      const created = useDAW.getState().project.tracks.slice(start);
      const stackId = useDAW.getState().createTrackStack(
        patch.name,
        patch.stack.definition.type,
        created.map((item) => item.id),
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
            false,
          );
        }
      }
      toast.success(`Loaded ${patch.name}`);
    }
  };

  const activateItem = (item: BrowserItem) => {
    if (item.kind === "instrument") {
      assignInstrument(item.patch);
    } else {
      const instrument = item.userPatch.track?.instrument;
      if (instrument && PATCHES[instrument]) {
        audition(PATCHES[instrument]);
      }
      setPreviewState({
        preset: getUserPatchArtwork(item.userPatch),
        trackId: track?.id ?? null,
        instrument: track?.instrument ?? null,
      });
      loadUserPatch(item.userPatch);
    }
  };

  const openSave = () => {
    if (!track) {
      toast.info("Select a track to save a patch");
      return;
    }
    setSaveTrackId(track.id);
    setSaveName(track.name);
    setSaveOpen(true);
  };

  const saveCurrentPatch = () => {
    if (!saveTrack || !saveName.trim()) return;
    const state = useDAW.getState();
    const stack = saveTrack.role === "folder"
      ? state.project.stacks?.find((item) => item.folderTrackId === saveTrack.id)
      : undefined;
    const stackTracks = stack
      ? state.project.tracks.filter((item) => stack.trackIds.includes(item.id))
      : [];
    const busTrack = stack?.busTrackId
      ? state.project.tracks.find((item) => item.id === stack.busTrackId)
      : undefined;
    try {
      const userPatch = makeUserPatch(
        saveName.trim(),
        "My Instruments",
        saveTrack,
        stack,
        stackTracks,
        busTrack,
      );
      const next = [userPatch, ...userPatches];
      writeUserPatches(next);
      setUserPatches(next);
      setCategory("My Instruments");
      setQuery("");
      setVisibleLimit(150);
      setSaveOpen(false);
      window.dispatchEvent(new CustomEvent("webband:user-patches-updated"));
      toast.success(`${userPatch.name} saved to My Instruments`);
    } catch (error) {
      console.error("Could not save user patch.", error);
      toast.error(error instanceof Error ? error.message : "Could not save the patch.");
    }
  };

  const handleBrowserKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement) {
      if (event.key === "Escape") event.currentTarget.blur();
      return;
    }
    const target = event.target;
    const categoryHasFocus = target instanceof HTMLElement &&
      !!target.closest('nav[aria-label="Instrument categories"]');
    if ((event.key === "ArrowUp" || event.key === "ArrowDown") && categoryHasFocus) {
      if (!visibleCategories.length) return;
      event.preventDefault();
      const currentIndex = visibleCategories.findIndex((item) => item.name === category);
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const index = (Math.max(0, currentIndex) + delta + visibleCategories.length) % visibleCategories.length;
      const next = visibleCategories[index];
      setCategory(next.name);
      setVisibleLimit(150);
      setActiveIndex(0);
      categoryRefs.current.get(next.name)?.focus();
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      if (!browserItems.length) return;
      event.preventDefault();
      const visibleBrowserItems = browserItems.slice(0, visibleLimit);
      if (!visibleBrowserItems.length) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const index = (activeIndex + delta + visibleBrowserItems.length) % visibleBrowserItems.length;
      setActiveIndex(index);
      const item = visibleBrowserItems[index];
      trackRefs.current.get(item.kind === "instrument" ? item.preset.id : item.userPatch.id)?.focus();
      if (item.kind === "instrument") audition(item.patch);
      else {
        setPreviewState({
          preset: getUserPatchArtwork(item.userPatch),
          trackId: track?.id ?? null,
          instrument: track?.instrument ?? null,
        });
      }
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const currentIndex = visibleCategories.findIndex((item) => item.name === category);
      if (event.key === "ArrowLeft" && !categoryHasFocus) {
        event.preventDefault();
        categoryRefs.current.get(category)?.focus();
      } else if (event.key === "ArrowRight" && categoryHasFocus) {
        event.preventDefault();
        const visibleBrowserItems = browserItems.slice(0, visibleLimit);
        const item = visibleBrowserItems[activeIndex] ?? visibleBrowserItems[0];
        if (item) {
          trackRefs.current.get(
            item.kind === "instrument" ? item.preset.id : item.userPatch.id,
          )?.focus();
        }
      } else if (event.key === "ArrowLeft" && categoryHasFocus && currentIndex > 0) {
        event.preventDefault();
        const previous = visibleCategories[currentIndex - 1];
        setCategory(previous.name);
          setVisibleLimit(150);
        categoryRefs.current.get(previous.name)?.focus();
      }
    }
  };

  const renderItemName = (item: BrowserItem) =>
    item.kind === "instrument" ? item.preset.name : item.userPatch.name;
  const visibleBrowserItemsForId = browserItems.slice(0, visibleLimit);
  const activeId = visibleBrowserItemsForId[activeIndex]
    ? visibleBrowserItemsForId[activeIndex].kind === "instrument"
      ? visibleBrowserItemsForId[activeIndex].preset.id
      : visibleBrowserItemsForId[activeIndex].userPatch.id
    : "";

  return (
    <section
      aria-label="Sound Library"
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#1d1e20] text-zinc-200"
      onKeyDown={handleBrowserKeyDown}
    >
      <header className="shrink-0 border-b border-[#111214] bg-[#232426]">
        {preview ? (
          <PreviewArt preset={preview} height={previewHeight} />
        ) : (
          <div className="w-full bg-[#232426] px-3 pt-3" style={{ height: previewHeight }}>
            <div className="h-full w-full rounded-md bg-[#202123]" />
          </div>
        )}
        <div className="flex min-w-0 items-start gap-2.5 px-3 pb-3 pt-2">
          <div className="min-w-0 flex-1">
            <h1
              className="line-clamp-2 font-bold leading-tight text-white"
              style={{ fontSize: Math.min(22, 15 + (previewHeight - 144) / 45) }}
            >
              {preview?.name ?? "Choose an Instrument"}
            </h1>
            <p
              className="mt-1 truncate font-medium text-[#aeb2bb]"
              style={{ fontSize: Math.min(13, 10 + (previewHeight - 144) / 90) }}
            >
              {preview
                ? `${preview.category} · ${preview.patch?.subcategory ?? (preview.patch?.synthEngine ? "Morph Synth" : "SoundFont")}`
                : "Select a sound to preview"}
            </p>
            {preview && (
              <p className="mt-0.5 truncate text-[9px] text-zinc-500">
                {preview.description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={openSave}
            disabled={!track}
            className="mt-0.5 inline-flex h-6 shrink-0 items-center rounded-full border border-white/10 bg-black/20 px-2.5 text-[9px] font-medium text-zinc-300 transition hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save Patch...
          </button>
        </div>
        <ResizeHandle
          axis="horizontal"
          value={previewHeight}
          min={144}
          max={420}
          label="Resize instrument preview card"
          onChange={setPreviewHeight}
          className="bg-[#232426]"
        />
      </header>

      <div className="shrink-0 border-b border-black/40 bg-[#202123] px-2.5 py-2">
        <div className="relative">
          <Search
            aria-hidden
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
          />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setVisibleLimit(150);
              setActiveIndex(0);
            }}
            placeholder="Search Sounds..."
            aria-label="Search sounds across all categories"
            className="h-[30px] w-full rounded-full border border-black/60 bg-[#161719] pl-8 pr-8 text-[11px] text-zinc-200 outline-none transition placeholder:text-zinc-600 focus:border-[#5795ff]/60 focus:ring-2 focus:ring-[#2563eb]/15"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setVisibleLimit(150);
                setActiveIndex(0);
                searchRef.current?.focus();
              }}
              aria-label="Clear sound search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-zinc-500 hover:bg-white/10 hover:text-zinc-100"
            >
              <X size={12} />
            </button>
          )}
        </div>
        <p className="mt-1 px-1 text-[9px] text-zinc-600" aria-live="polite">
          {browserItems.length} {browserItems.length === 1 ? "sound" : "sounds"}
          {queryText ? " across all categories" : ""}
        </p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[45%_55%]">
        <nav
          aria-label="Instrument categories"
          className={cn(SCROLL_CLASS, "border-r border-[#141415] bg-[#1e1f21] p-1.5")}
        >
          {visibleCategories.map((item) => {
            const Icon = CATEGORY_ICONS[item.icon] ?? Music2;
            const selected = category === item.name;
            return (
              <button
                key={item.id}
                ref={(element) => {
                  if (element) categoryRefs.current.set(item.name, element);
                  else categoryRefs.current.delete(item.name);
                }}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  setCategory(item.name);
                  setVisibleLimit(150);
                  setActiveIndex(0);
                }}
                className={cn(
                  "mb-0.5 flex min-h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[9px] leading-tight transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#60a5fa]",
                  selected
                    ? "bg-[#2563eb] font-medium text-white shadow-[0_1px_4px_rgba(0,0,0,.32)]"
                    : "text-[#a5a7ad] hover:bg-white/[.07] hover:text-zinc-100",
                )}
              >
                <Icon size={13} strokeWidth={1.8} className="shrink-0" aria-hidden />
                <span className="min-w-0 truncate">{item.name}</span>
              </button>
            );
          })}
          {visibleCategories.length === 0 && (
            <p className="px-1.5 py-3 text-[9px] leading-relaxed text-zinc-600">
              No categories match this search.
            </p>
          )}
        </nav>

        <div
          role="listbox"
          aria-label={queryText ? "Matching sounds from all categories" : `${category} sounds`}
          className={cn(SCROLL_CLASS, "bg-[#222325] p-1.5")}
        >
          {browserItems.slice(0, visibleLimit).map((item, index) => {
            const id = item.kind === "instrument" ? item.preset.id : item.userPatch.id;
            const iconKey = item.kind === "instrument" ? item.preset.icon : "music";
            const Icon = CATEGORY_ICONS[iconKey] ?? (iconKey === "guitar" ? Guitar : Music2);
            const isCurrent = item.kind === "instrument" &&
              track?.type === "midi" && track.instrument === item.patch.id;
            return (
              <button
                key={`${item.kind}-${id}`}
                ref={(element) => {
                  if (element) trackRefs.current.set(id, element);
                  else trackRefs.current.delete(id);
                }}
                type="button"
                role="option"
                aria-selected={isCurrent || index === activeIndex}
                tabIndex={activeId === id ? 0 : -1}
                onFocus={() => setActiveIndex(index)}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => activateItem(item)}
                title={item.kind === "instrument" ? item.preset.description : item.userPatch.name}
                className={cn(
                  "mb-0.5 flex min-h-[38px] w-full items-center gap-1.5 rounded-md border px-1.5 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#60a5fa]",
                  isCurrent
                    ? "border-[#5795ff]/40 bg-[#2563eb]/15"
                    : index === activeIndex
                      ? "border-white/10 bg-white/[.07]"
                      : "border-transparent hover:bg-white/[.06]",
                )}
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-black/25 text-zinc-300">
                  <Icon size={13} strokeWidth={1.8} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[10px] font-medium text-zinc-200">
                    {renderItemName(item)}
                  </span>
                  <span className="block truncate text-[8px] text-zinc-600">
                    {item.kind === "instrument"
                      ? queryText ? item.preset.category : item.preset.description
                      : `${item.userPatch.category} · ${item.userPatch.kind === "stack" ? "Track Stack" : item.userPatch.kind === "pedalboard" ? "Pedalboard" : "User Patch"}`}
                  </span>
                </span>
                {isCurrent && <span className="size-1.5 shrink-0 rounded-full bg-[#70adff]" />}
              </button>
            );
          })}
          {browserItems.length === 0 && (
            <p className="px-1 py-4 text-center text-[9px] leading-relaxed text-zinc-600">
              {queryText
                ? "No sounds match your search."
                : category === "My Instruments"
                  ? "Save a track or stack to build your collection."
                  : "No sounds in this category."}
            </p>
          )}
          {browserItems.length > visibleLimit && (
            <button
              type="button"
              onClick={() => setVisibleLimit((limit) => limit + 150)}
              className="mx-auto my-1 block rounded border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[9px] text-zinc-400 hover:bg-white/[0.08]"
            >
              Load 150 more ({browserItems.length - visibleLimit} remaining)
            </button>
          )}
          <p className="px-1 pt-1 text-center text-[8px] text-zinc-700">
            ↑ ↓ Preview · ← → Browse · Return Load
          </p>
        </div>
      </div>

      <footer className="flex h-9 shrink-0 items-center justify-between border-t border-[#111214] bg-[#232426] px-2">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("webband:import-soundfont", {
            detail: { trackId: selectedTrackId ?? undefined },
          }))}
          className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[9px] font-medium text-[#a9cfff] transition hover:bg-[#67b7ff]/10"
          title="Import and scan an .sf2 or .sf3 file"
        >
          <span className="text-[13px] leading-none">+</span>
          Import .SF2/.SF3
        </button>
        <button
          type="button"
          onClick={openSave}
          disabled={!track}
          className="h-6 rounded border border-white/10 bg-white/[.05] px-2 text-[9px] font-medium text-zinc-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Save...
        </button>
      </footer>

      {saveOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="sound-library-save-title"
            onSubmit={(event) => {
              event.preventDefault();
              saveCurrentPatch();
            }}
            className="w-full max-w-sm rounded-xl border border-white/10 bg-[#29292d] p-5 text-zinc-200 shadow-[0_20px_70px_rgba(0,0,0,.7)]"
          >
            <h2 id="sound-library-save-title" className="text-sm font-semibold">Save to My Instruments</h2>
            <p className="mt-1 text-[11px] text-zinc-500">
              Saves the selected track’s instrument, controls, and pedalboard.
            </p>
            <label className="mt-4 block text-[10px] uppercase tracking-wider text-zinc-500">
              Patch name
              <input
                autoFocus
                value={saveName}
                onChange={(event) => setSaveName(event.target.value)}
                required
                maxLength={64}
                className="mt-1 h-8 w-full rounded-md border border-black/60 bg-[#19191c] px-2 text-xs text-zinc-100 outline-none focus:border-[#5795ff]/60"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSaveOpen(false)}
                className="h-7 rounded px-3 text-[11px] text-zinc-400 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-7 rounded bg-[#3478e5] px-3 text-[11px] font-semibold text-white hover:brightness-110"
              >
                Save Patch
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
