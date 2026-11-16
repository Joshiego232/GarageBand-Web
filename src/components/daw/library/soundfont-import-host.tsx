"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { LoaderCircle, Music, X } from "lucide-react";
import { toast } from "sonner";
import { useDAW } from "@/lib/daw/store";
import {
  makeImportedSoundFontPatch,
  type ImportedSoundFontPreset,
} from "@/lib/daw/soundfont-catalog";
import {
  listImportedSoundFonts,
  saveImportedSoundFont,
  type ImportedSoundFontRecord,
} from "@/lib/daw/soundfont-cache";
import { scanSoundFontPresets } from "@/lib/daw/scan-soundfont";

interface ImportRequest {
  file?: File;
  trackId?: string;
}

export function SoundFontImportHost() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [targetTrackId, setTargetTrackId] = useState<string | undefined>();
  const [record, setRecord] = useState<ImportedSoundFontRecord | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const selectedTrackId = useDAW((state) => state.ui.selectedTrackId);

  const presets = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (record?.presets ?? []).filter((preset) =>
      !normalized ||
      preset.presetName.toLowerCase().includes(normalized) ||
      String(preset.bank).includes(normalized) ||
      String(preset.program).includes(normalized),
    );
  }, [query, record]);

  const importFile = useCallback(async (file: File) => {
    if (!/\.sf[23]$/i.test(file.name)) {
      toast.error("Choose an .sf2 or .sf3 SoundFont file.");
      return;
    }
    setBusy(true);
    try {
      const bytes = await file.arrayBuffer();
      const headers = await scanSoundFontPresets(bytes);
      const saved = await saveImportedSoundFont(file.name, bytes, headers);
      setRecord(saved);
      setQuery("");
      setPickerOpen(false);
      window.dispatchEvent(new CustomEvent("webband:soundfonts-updated"));
      toast.success(`Scanned ${headers.length} presets from ${file.name}`);
    } catch (error) {
      console.error("Could not import the SoundFont.", error);
      toast.error(error instanceof Error ? error.message : "Could not import this SoundFont.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, []);

  useEffect(() => {
    const handleRequest = (event: Event) => {
      const request = (event as CustomEvent<ImportRequest>).detail;
      setTargetTrackId(request?.trackId);
      setRecord(null);
      setQuery("");
      if (request?.file) {
        void importFile(request.file);
      } else {
        setPickerOpen(true);
        inputRef.current?.click();
      }
    };
    window.addEventListener("webband:import-soundfont", handleRequest);
    return () => window.removeEventListener("webband:import-soundfont", handleRequest);
  }, [importFile]);

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void importFile(file);
  };

  const assignPreset = (item: ImportedSoundFontPreset) => {
    const trackId = targetTrackId ?? selectedTrackId;
    const state = useDAW.getState();
    const track = state.project.tracks.find((candidate) => candidate.id === trackId);
    if (!track || track.type !== "midi" || track.role !== "track") {
      toast.error("Select a software-instrument track before applying this preset.");
      return;
    }

    const patch = makeImportedSoundFontPatch(item);
    state.commit();
    state.updateTrack(track.id, {
      instrument: patch.id,
      soundFontPreset: item,
      params: Object.fromEntries(patch.knobs.map((knob) => [knob.id, knob.def])),
      icon: patch.icon,
      name: patch.name,
    }, false);
    setRecord(null);
    toast.success(`Loaded ${patch.name} on ${track.name}`);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".sf2,.sf3,application/octet-stream"
        className="hidden"
        aria-label="Import SoundFont"
        onChange={handleFile}
      />
      {pickerOpen && !record && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-sm rounded-xl border border-white/10 bg-[#29292d] p-5 text-zinc-200 shadow-[0_20px_70px_rgba(0,0,0,.7),inset_0_1px_rgba(255,255,255,.07)]">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[#67b7ff]/20 bg-[#67b7ff]/10 text-[#9dcfff]">
                <Music size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold">Import SoundFont</h2>
                <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                  Choose an .sf2 or .sf3 file to scan its Bank:Program presets.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close SoundFont import"
                onClick={() => setPickerOpen(false)}
                className="rounded p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
              >
                <X size={15} />
              </button>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setPickerOpen(false)} className="h-7 rounded px-3 text-[11px] text-zinc-400 hover:bg-white/5">
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
                className="inline-flex h-7 items-center gap-1.5 rounded bg-[#67b7ff] px-3 text-[11px] font-semibold text-[#111820] hover:brightness-110 disabled:opacity-50"
              >
                {busy && <LoaderCircle size={12} className="animate-spin" />}
                Choose File
              </button>
            </div>
          </div>
        </div>
      )}
      {record && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="soundfont-presets-title"
            className="flex max-h-[min(80vh,680px)] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-white/10 bg-[#29292d] text-zinc-200 shadow-[0_20px_70px_rgba(0,0,0,.7),inset_0_1px_rgba(255,255,255,.07)]"
          >
            <header className="flex items-center gap-3 border-b border-black/40 p-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[#67b7ff]/20 bg-[#67b7ff]/10 text-[#9dcfff]">
                <Music size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 id="soundfont-presets-title" className="text-sm font-semibold">SoundFont Presets</h2>
                <p className="truncate text-[10px] text-zinc-500">{record.fileName} · {record.presets.length} presets</p>
              </div>
              <button
                type="button"
                aria-label="Close preset list"
                onClick={() => setRecord(null)}
                className="rounded p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
              >
                <X size={15} />
              </button>
            </header>
            <label className="border-b border-black/40 p-3">
              <span className="sr-only">Search presets</span>
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search presets or Bank:Program"
                className="h-8 w-full rounded-md border border-black/40 bg-[#17171a] px-3 text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-[#67b7ff]/50"
              />
            </label>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {presets.map((preset) => {
                const item = { ...preset, fileId: record.id, fileName: record.fileName };
                return (
                  <button
                    key={`${preset.bank}:${preset.program}:${preset.presetName}`}
                    type="button"
                    onClick={() => assignPreset(item)}
                    className="flex w-full items-center gap-3 rounded-md border border-transparent px-3 py-2 text-left hover:border-[#67b7ff]/25 hover:bg-[#67b7ff]/[0.07]"
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-white/5 text-[#9dcfff]">
                      <Music size={13} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px]">{preset.presetName}</span>
                    <span className="shrink-0 rounded bg-black/20 px-2 py-1 font-mono text-[9px] text-zinc-500">
                      {preset.bank}:{preset.program}
                    </span>
                  </button>
                );
              })}
              {presets.length === 0 && (
                <p className="px-3 py-6 text-center text-[11px] text-zinc-500">No presets match this search.</p>
              )}
            </div>
            <footer className="flex items-center justify-between border-t border-black/40 px-4 py-3 text-[10px] text-zinc-500">
              <span>{targetTrackId ? "Click a preset to apply it to the dropped track." : "Click a preset to apply it to the selected track."}</span>
              <button type="button" onClick={() => setRecord(null)} className="rounded px-2 py-1 hover:bg-white/5 hover:text-zinc-200">Close</button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
