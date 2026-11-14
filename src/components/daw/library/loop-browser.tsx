"use client";

// ============================================================
// Loop browser - searchable/filterable list of generative MIDI
// loops. Preview with the play button, drag onto a track to drop
// (timeline handles the "application/x-webband-loop" drop).
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { Play, Search, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useDAW } from "@/lib/daw/store";
import {
  LOOPS,
  LOOP_CATEGORIES,
  generateLoopNotes,
} from "@/lib/daw/loops";
import { defaultParams } from "@/lib/daw/instruments";
import { engine } from "@/lib/daw/engine";
import { keyLabel } from "@/lib/daw/utils";
import type { LoopDef } from "@/lib/daw/types";

export function LoopBrowser() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  const keyTonic = useDAW((s) => s.project.keyTonic);
  const keyMode = useDAW((s) => s.project.keyMode);
  const tempo = useDAW((s) => s.project.tempo);

  // stop any preview when the browser unmounts (e.g. switching to Library)
  useEffect(() => {
    return () => {
      engine.stopPreview();
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return LOOPS.filter((l) => {
      if (category !== "All" && l.category !== category) return false;
      if (!q) return true;
      return (
        l.name.toLowerCase().includes(q) ||
        l.genre.toLowerCase().includes(q) ||
        l.category.toLowerCase().includes(q) ||
        (l.desc ?? "").toLowerCase().includes(q)
      );
    });
  }, [query, category]);

  const togglePreview = (loop: LoopDef) => {
    if (previewingId === loop.id && engine.previewActive) {
      engine.stopPreview();
      setPreviewingId(null);
      return;
    }
    engine.startPreview(
      loop.instrument,
      generateLoopNotes(loop, keyTonic, keyMode),
      loop.bars * 4 * (60 / tempo),
      defaultParams(loop.instrument)
    );
    setPreviewingId(loop.id);
  };

  const stopPreview = () => {
    engine.stopPreview();
    setPreviewingId(null);
  };

  const handleDragStart = (loop: LoopDef) => (e: React.DragEvent) => {
    e.dataTransfer.setData("application/x-webband-loop", loop.id);
    e.dataTransfer.setData("text/plain", loop.id);
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.dropEffect = "copy";
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <header className="h-9 shrink-0 px-3 bg-[#232327] border-b border-black/50 flex items-center gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
          Loops
        </h2>
        <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full bg-[#2a2a2f] text-zinc-500">
          {filtered.length}
        </span>
      </header>

      {/* Search + category chips */}
      <div className="shrink-0 px-2 py-2 space-y-1.5 border-b border-black/40">
        <div className="relative">
          <Search
            size={12}
            aria-hidden
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search loops"
            aria-label="Search loops"
            className="h-7 pl-7 pr-2 text-[12px] rounded-md bg-[#232327] border-black/60 text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-[#ffb648]/30 focus-visible:border-[#ffb648]/40"
          />
        </div>
        <div className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {LOOP_CATEGORIES.map((c) => (
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
      </div>

      {/* Loop list */}
      <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-0.5 [scrollbar-color:#3f3f46_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#3a3a41] [&::-webkit-scrollbar-track]:bg-transparent">
        {filtered.length === 0 && (
          <p className="px-2 py-3 text-[11px] text-zinc-600">
            No loops match your search.
          </p>
        )}
        {filtered.map((loop) => {
          const isPreviewing = previewingId === loop.id;
          return (
            <div
              key={loop.id}
              draggable
              onDragStart={handleDragStart(loop)}
              className={cn(
                "flex items-start gap-2 p-2 rounded-md border cursor-grab active:cursor-grabbing transition-colors",
                isPreviewing
                  ? "bg-[#2a2a2f] border-[#ffb648]/40"
                  : "border-transparent hover:bg-[#2a2a2f]"
              )}
            >
              <button
                onClick={() => togglePreview(loop)}
                aria-label={isPreviewing ? `Stop previewing ${loop.name}` : `Preview ${loop.name}`}
                className="h-6 w-6 shrink-0 rounded-full bg-[#2f2f34] border border-black/40 flex items-center justify-center hover:bg-[#3a3a41] transition-colors"
              >
                {isPreviewing ? (
                  <Square size={12} fill="currentColor" className="text-[#ffb648]" />
                ) : (
                  <Play size={12} fill="currentColor" className="text-zinc-300" />
                )}
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium text-zinc-200 truncate">
                  {loop.name}
                </p>
                <div className="flex items-center gap-1 flex-wrap mt-0.5">
                  <span className="text-[9px] px-1.5 rounded-full bg-[#2a2a2f] text-zinc-400">
                    {loop.category}
                  </span>
                  <span className="text-[9px] px-1.5 rounded-full bg-[#2a2a2f] text-zinc-400">
                    {loop.bars} bars
                  </span>
                  {loop.keyAgnostic ? (
                    <span className="text-[9px] px-1.5 rounded-full bg-[#2a2a2f] text-zinc-400">
                      Any key
                    </span>
                  ) : (
                    <span className="text-[9px] px-1.5 rounded-full bg-[#8fb44a]/15 text-[#8fb44a]">
                      {keyLabel(keyTonic, loop.mode ?? keyMode)}
                    </span>
                  )}
                  {loop.tempoHint ? (
                    <span className="text-[9px] px-1.5 rounded-full bg-[#2a2a2f] text-zinc-400">
                      {loop.tempoHint} BPM
                    </span>
                  ) : null}
                </div>
                {loop.desc ? (
                  <p className="text-[10px] text-zinc-500 truncate mt-0.5">
                    {loop.desc}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <footer className="shrink-0 h-8 px-3 flex items-center gap-2 border-t border-black/50 bg-[#232327]">
        <p className="flex-1 text-[10px] leading-tight text-zinc-500 truncate">
          Drag loops onto a track. Green loops follow your project key and tempo.
        </p>
        {previewingId !== null && (
          <button
            onClick={stopPreview}
            className="h-6 shrink-0 px-2 rounded-md bg-[#2f2f34] border border-black/40 text-[10px] text-zinc-300 hover:bg-[#3a3a41] transition-colors flex items-center gap-1"
          >
            <Square size={9} fill="currentColor" aria-hidden />
            Stop
          </button>
        )}
      </footer>
    </div>
  );
}
