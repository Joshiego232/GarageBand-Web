"use client";

// ============================================================
// WebBand - a GarageBand / Logic Pro style DAW for the web
// Works on Windows, Chromebook and Mac
// ============================================================

import { useEffect } from "react";
import { Toaster } from "sonner";
import { useDAW } from "@/lib/daw/store";
import { engine } from "@/lib/daw/engine";
import { useShortcuts } from "@/hooks/use-shortcuts";
import { MenuBar } from "@/components/daw/menu-bar";
import { TopBar } from "@/components/daw/top-bar";
import { TimelineWorkspace } from "@/components/daw/timeline/timeline";
import { LibraryPanel } from "@/components/daw/library/library-panel";
import { LoopBrowser } from "@/components/daw/library/loop-browser";
import { EditorPanel } from "@/components/daw/editor/editor-panel";
import { MixerPanel } from "@/components/daw/mixer/mixer-panel";
import { OnscreenKeyboard } from "@/components/daw/panels/onscreen-keyboard";
import { ShortcutsOverlay } from "@/components/daw/panels/shortcuts-overlay";
import { NewProjectModal } from "@/components/daw/library/new-project-modal";
import { AddTrackDialog } from "@/components/daw/library/add-track-dialog";
import { ExportDialog } from "@/components/daw/panels/export-dialog";
import { MySongsModal } from "@/components/daw/library/my-songs-modal";
import { ComposerModal } from "@/components/daw/panels/composer-modal";
import { StatusBar } from "@/components/daw/status-bar";
import { CommandPalette } from "@/components/daw/panels/command-palette";

export default function Home() {
  const panels = useDAW((s) => s.ui.panels);
  const modal = useDAW((s) => s.ui.modal);
  const trackCount = useDAW((s) => s.project.tracks.length);

  useShortcuts();

  // init audio on first gesture + autoload welcome
  useEffect(() => {
    const unlock = () => engine.init();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });

    // debug/E2E handle
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __daw?: unknown }).__daw = { engine, useDAW };
    }

    const seen = localStorage.getItem("webband-seen-welcome");
    if (!seen) {
      useDAW.getState().setModal("newProject");
    }
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const showLeft = panels.library || panels.loops;

  return (
    <div className="h-screen flex flex-col bg-[#19191b] text-zinc-200 overflow-hidden select-none" style={{ fontFamily: "var(--font-geist-sans), system-ui, sans-serif" }}>
      <MenuBar />
      <TopBar />

      <div className="flex-1 flex min-h-0">
        {showLeft && (
          <div className="w-[248px] shrink-0 border-r border-black/60 bg-[#1d1d20] flex flex-col min-h-0">
            {panels.loops ? <LoopBrowser /> : <LibraryPanel />}
          </div>
        )}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <TimelineWorkspace />
          {panels.editor && <EditorPanel />}
          {panels.mixer && <MixerPanel />}
        </div>
      </div>

      {panels.keyboard && <OnscreenKeyboard />}
      {panels.help && <ShortcutsOverlay />}
      <StatusBar />
      <CommandPalette />

      {modal === "newProject" && <NewProjectModal />}
      {modal === "addTrack" && <AddTrackDialog />}
      {modal === "export" && <ExportDialog />}
      {modal === "mySongs" && <MySongsModal />}
      {modal === "composer" && <ComposerModal />}

      {trackCount === 0 && modal === "none" && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm pointer-events-none">
          <div className="text-center pointer-events-auto">
            <p className="text-zinc-400 mb-3">Choose a track to get started</p>
            <button
              className="px-4 py-2 rounded-md bg-[#2f2f34] border border-black/50 hover:bg-[#3a3a41] text-zinc-200"
              onClick={() => useDAW.getState().setModal("addTrack")}
            >
              Create a Track
            </button>
          </div>
        </div>
      )}

      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          style: {
            background: "#26262b",
            border: "1px solid #3a3a41",
            color: "#d4d4d8",
          },
        }}
      />
    </div>
  );
}
