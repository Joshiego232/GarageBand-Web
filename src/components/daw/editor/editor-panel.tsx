"use client";
// ============================================================
// Editor panel - bottom panel container. Hosts the piano roll,
// the audio editor or the smart controls for the active region.
// ============================================================

import { useEffect } from "react";
import { MousePointerClick, X } from "lucide-react";
import { useDAW } from "@/lib/daw/store";
import type { EditorMode } from "@/lib/daw/types";
import { PianoRoll, findActiveRegion } from "./piano-roll";
import { AudioEditor } from "./audio-editor";
import { SmartControls } from "../mixer/smart-controls";
import { DrumStepSequencer } from "./drum-step-sequencer";
import { PATCHES } from "@/lib/daw/instruments";

export function EditorPanel() {
  const region = useDAW((s) =>
    findActiveRegion(s.project, s.ui.editorRegionId, s.ui.selectedRegionIds, s.ui.selectedTrackId)?.region ?? null
  );
  const track = useDAW((s) =>
    findActiveRegion(s.project, s.ui.editorRegionId, s.ui.selectedRegionIds, s.ui.selectedTrackId)?.track ?? null
  );
  const editorMode = useDAW((s) => s.ui.editorMode);
  const setEditorMode = useDAW((s) => s.setEditorMode);
  const togglePanel = useDAW((s) => s.togglePanel);
  const isDrumTrack = !!track && !!PATCHES[track.instrument]?.isDrum;

  // Keep the mode valid for the active region type. Drum tracks may use the
  // dedicated step grid, while every step remains an ordinary editable MIDI note.
  useEffect(() => {
    if (!region || editorMode === "smart") return;
    const want: EditorMode = region.type === "midi"
      ? (isDrumTrack && editorMode === "steps" ? "steps" : "piano")
      : "audio";
    if (editorMode !== want) setEditorMode(want);
  }, [region, isDrumTrack, editorMode, setEditorMode]);

  const tabs: { id: EditorMode; label: string }[] = region
    ? region.type === "audio"
      ? [
          { id: "audio", label: "Audio" },
          { id: "smart", label: "Smart Controls" },
        ]
      : [
          ...(isDrumTrack ? [{ id: "steps" as EditorMode, label: "Step Sequencer" }] : []),
          { id: "piano", label: "Piano Roll" },
          { id: "smart", label: "Smart Controls" },
        ]
    : [{ id: "smart", label: "Smart Controls" }];

  const info = region
    ? region.type === "midi"
      ? `${region.notes?.length ?? 0} ${region.notes?.length === 1 ? "note" : "notes"}`
      : `${(region.sampleLength ?? 0).toFixed(2)} s`
    : "";

  return (
    <section className="h-60 shrink-0 border-t border-black/60 bg-[#1d1d20] flex flex-col" aria-label="Editor panel">
      <header className="h-9 shrink-0 bg-[#232327] border-b border-black/50 flex items-center px-2 gap-2">
        <span className="text-[11px] font-medium text-zinc-200 truncate max-w-44" title={region?.name}>
          {region ? region.name : track ? track.name : "Editor"}
        </span>
        {region && track && (
          <>
            <span className="text-zinc-700" aria-hidden="true">
              /
            </span>
            <span className="text-[10px] text-zinc-500 truncate max-w-32" title={track.name}>
              {track.name}
            </span>
          </>
        )}
        <nav className="flex items-center gap-0.5 ml-1" aria-label="Editor mode">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setEditorMode(t.id)}
              className={`text-[11px] px-2.5 py-1 rounded transition-colors ${
                editorMode === t.id
                  ? "bg-[#3a3a41] text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 min-w-0">
          {info && <span className="text-[10px] text-zinc-500 tabular-nums whitespace-nowrap">{info}</span>}
          <button
            type="button"
            aria-label="Close editor panel"
            title="Close editor"
            onClick={() => togglePanel("editor")}
            className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-white/10 transition-colors"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </header>
      <div className="flex-1 min-h-0 flex flex-col">
        {editorMode === "smart" ? (
          <SmartControls />
        ) : editorMode === "piano" && region?.type === "midi" ? (
          <PianoRoll />
        ) : editorMode === "steps" && region?.type === "midi" && isDrumTrack ? (
          <DrumStepSequencer />
        ) : editorMode === "audio" && region?.type === "audio" ? (
          <AudioEditor />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-xs text-zinc-600 select-none">
            <MousePointerClick className="size-5 text-zinc-700" />
            <span>Select a region to edit</span>
          </div>
        )}
      </div>
    </section>
  );
}
