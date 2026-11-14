// ============================================================
// Global keyboard shortcut dispatcher
// When Musical Typing is ON and a MIDI track is selected, letter
// keys play notes (GarageBand behavior); otherwise they trigger
// single-key commands.
// ============================================================
"use client";

import { useEffect } from "react";
import { COMMANDS } from "@/lib/daw/commands";
import { handleTypingKeyDown, handleTypingKeyUp } from "@/lib/daw/input";
import { useDAW } from "@/lib/daw/store";

function isTypingTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}

export function useShortcuts() {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      const st = useDAW.getState();
      const hasMods = e.metaKey || e.ctrlKey || e.altKey || e.shiftKey;
      const track = st.project.tracks.find((t) => t.id === st.ui.selectedTrackId);
      const typingActive = st.ui.musicalTyping && track?.type === "midi";
      // normalize: e.key for space is " "
      const rawKey = e.key === " " ? "Space" : e.key;
      const keyLower = rawKey.length === 1 ? rawKey.toLowerCase() : rawKey;

      if (hasMods) {
        // command matches with modifiers
        for (const c of COMMANDS) {
          if (!c.keys) continue;
          const mod = e.metaKey || e.ctrlKey;
          if (keyLower.length === 1 && c.keys.key.length === 1) {
            if (keyLower !== c.keys.key.toLowerCase()) continue;
          } else if (rawKey !== c.keys.key) {
            continue;
          }
          if (!!c.keys.mod !== mod) continue;
          if (!!c.keys.shift !== e.shiftKey) continue;
          if (!!c.keys.alt !== e.altKey) continue;
          e.preventDefault();
          c.run();
          return;
        }
        return;
      }

      // musical typing first when active (single printable chars)
      if (typingActive && keyLower.length === 1) {
        if (handleTypingKeyDown(keyLower)) {
          e.preventDefault();
          return;
        }
      }

      // no-modifier command match
      for (const c of COMMANDS) {
        if (!c.keys) continue;
        if (c.keys.mod || c.keys.shift || c.keys.alt) continue;
        if (rawKey === c.keys.key || (keyLower.length === 1 && c.keys.key.length === 1 && keyLower === c.keys.key.toLowerCase())) {
          e.preventDefault();
          c.run();
          return;
        }
      }
    };
    const up = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      handleTypingKeyUp(e.key.toLowerCase());
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
}
