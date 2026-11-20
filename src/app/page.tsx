"use client";

// ============================================================
// WebBand - a GarageBand / Logic Pro style DAW for the web
// Works on Windows, Chromebook and Mac
// ============================================================

import { useEffect, useState, useSyncExternalStore } from "react";
import { Toaster } from "sonner";
import { useDAW } from "@/lib/daw/store";
import { engine } from "@/lib/daw/engine";
import { useShortcuts } from "@/hooks/use-shortcuts";
import { MenuBar } from "@/components/daw/menu-bar";
import { TopBar } from "@/components/daw/top-bar";
import { TimelineWorkspace } from "@/components/daw/timeline/timeline";
import { SoundLibraryDrawer } from "@/components/daw/library/SoundLibraryDrawer";
import { LoopBrowser } from "@/components/daw/library/loop-browser";
import { EditorPanel } from "@/components/daw/editor/editor-panel";
import { MixerPanel } from "@/components/daw/mixer/mixer-panel";
import { OnscreenKeyboard } from "@/components/daw/panels/onscreen-keyboard";
import { ShortcutsOverlay } from "@/components/daw/panels/shortcuts-overlay";
import { NewProjectModal } from "@/components/daw/library/new-project-modal";
import { AddTrackDialog } from "@/components/daw/library/add-track-dialog";
import { BounceModal } from "@/components/daw/panels/BounceModal";
import { MySongsModal } from "@/components/daw/library/my-songs-modal";
import { ComposerModal } from "@/components/daw/panels/composer-modal";
import { StatusBar } from "@/components/daw/status-bar";
import { CommandPalette } from "@/components/daw/panels/command-palette";
import { LiveLoopsPanel } from "@/components/daw/panels/live-loops-panel";
import { PedalboardModal } from "@/components/daw/mixer/pedalboard-modal";
import { SoundFontImportHost } from "@/components/daw/library/soundfont-import-host";
import { ResizeHandle } from "@/components/daw/panels/resize-handle";
import { SoundLibrarySetup } from "@/components/daw/library/sound-library-setup";

const SOUND_SETUP_KEY = "webband-sound-library-setup-v1";
const SOUND_SETUP_EVENT = "webband:sound-library-setup-change";
let setupCompletedInMemory = false;

function subscribeToSoundSetup(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(SOUND_SETUP_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(SOUND_SETUP_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function getSoundSetupSnapshot(): "checking" | "required" | "complete" {
  if (setupCompletedInMemory) return "complete";
  try {
    return window.localStorage.getItem(SOUND_SETUP_KEY) === "done"
      ? "complete"
      : "required";
  } catch {
    return "required";
  }
}

function getServerSoundSetupSnapshot(): "checking" {
  return "checking";
}

export default function Home() {
  const panels = useDAW((s) => s.ui.panels);
  const modal = useDAW((s) => s.ui.modal);
  const trackCount = useDAW((s) => s.project.tracks.length);
  const [libraryWidth, setLibraryWidth] = useState(250);
  const setupStatus = useSyncExternalStore(
    subscribeToSoundSetup,
    getSoundSetupSnapshot,
    getServerSoundSetupSnapshot,
  );

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

  if (setupStatus === "checking") {
    return <div className="flex h-screen items-center justify-center bg-[#101114] text-sm text-zinc-400">Preparing your studio…</div>;
  }

  if (setupStatus === "required") {
    return (
      <SoundLibrarySetup
        onContinue={() => {
          setupCompletedInMemory = true;
          window.dispatchEvent(new Event(SOUND_SETUP_EVENT));
        }}
      />
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[#1e1e1e] text-zinc-200 overflow-hidden select-none">
      <MenuBar />
      <TopBar />

      <div
        className="relative grid flex-1 min-h-0 min-w-0 bg-[#1e1e1e]"
        style={{
          gridTemplateColumns: `5px ${panels.library ? `minmax(190px, ${libraryWidth}px)` : "0px"} ${panels.library ? "8px" : "0px"} minmax(0, 1fr) ${panels.loops ? "minmax(220px, 286px)" : "0px"} 5px`,
          gridTemplateRows: "minmax(0, 1fr)",
        }}
      >
        <div aria-hidden className="studio-wood z-20" style={{ gridColumn: 1 }} />
        <aside
          aria-hidden={!panels.library}
          className="overflow-hidden border-r border-black bg-[#222] flex flex-col min-h-0 min-w-0"
          style={{ gridColumn: 2, visibility: panels.library ? "visible" : "hidden", pointerEvents: panels.library ? "auto" : "none" }}
        >
          <SoundLibraryDrawer />
        </aside>
        {panels.library && (
          <ResizeHandle
            axis="vertical"
            value={libraryWidth}
            min={190}
            max={480}
            label="Resize sound library width"
            onChange={setLibraryWidth}
            gridColumn={3}
            className="bg-[#1e1e1e]"
          />
        )}
        <main className="flex flex-col min-w-0 min-h-0" style={{ gridColumn: 4 }}>
          {panels.liveLoops ? <LiveLoopsPanel /> : <TimelineWorkspace />}
          {!panels.liveLoops && panels.editor && <EditorPanel />}
          {!panels.liveLoops && panels.mixer && <MixerPanel />}
        </main>
        {panels.loops && (
          <aside className="border-l border-black bg-[#222] flex flex-col min-h-0 min-w-0" style={{ gridColumn: 5 }}>
            <LoopBrowser />
          </aside>
        )}
        <div aria-hidden className="studio-wood z-20" style={{ gridColumn: 6 }} />
      </div>

      {panels.keyboard && (
        <div className="shrink-0 max-h-[64vh] overflow-y-auto overscroll-contain border-t border-black/80 bg-[#1c1c1e]">
          <OnscreenKeyboard />
        </div>
      )}
      {panels.help && <ShortcutsOverlay />}
      <StatusBar />
      <CommandPalette />

      {modal === "newProject" && <NewProjectModal />}
      {modal === "addTrack" && <AddTrackDialog />}
      {modal === "export" && <BounceModal />}
      {modal === "mySongs" && <MySongsModal />}
      {modal === "composer" && <ComposerModal />}
      {modal === "pedalboard" && <PedalboardModal />}
      <SoundFontImportHost />

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
