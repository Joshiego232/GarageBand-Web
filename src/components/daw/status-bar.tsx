"use client";

// ============================================================
// StatusBar - bottom strip of the app: audio context stats on
// the left, the shortcuts hint in the middle, tagline right.
// ============================================================

import { useEffect, useState } from "react";
import { engine } from "@/lib/daw/engine";
import { PPQ } from "@/lib/daw/types";

export function StatusBar() {
  const [sampleRate, setSampleRate] = useState(44100);
  const [voices, setVoices] = useState(0);

  // Poll engine stats (the AudioContext appears after the first
  // user gesture, so keep checking until it exists).
  useEffect(() => {
    const id = window.setInterval(() => {
      setVoices(engine.getVoiceCount());
      if (engine.ctx) setSampleRate(engine.ctx.sampleRate);
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  return (
    <footer className="h-6 shrink-0 bg-[#1d1d20] border-t border-black/60 text-[10px] text-zinc-500 flex items-center justify-between px-3 gap-3">
      <div className="flex items-center gap-3 shrink-0 min-w-0">
        <span className="tabular-nums whitespace-nowrap">{(sampleRate / 1000).toFixed(1)} kHz</span>
        <span className="tabular-nums whitespace-nowrap">Voices: {voices}</span>
        <span className="tabular-nums whitespace-nowrap hidden sm:inline">Ticks: PPQ {PPQ}</span>
      </div>
      <div className="hidden md:block truncate">Press ? for keyboard shortcuts</div>
      <div className="shrink-0 truncate">
        WebBand Studio — a GarageBand-style DAW for Windows, Chromebook &amp; Mac
      </div>
    </footer>
  );
}
