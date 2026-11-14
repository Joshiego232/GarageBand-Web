// ============================================================
// Musical typing: computer keyboard as a piano (GarageBand style)
// A=C, W=C#, S=D, E=D#, D=E, F=F, T=F#, G=G, Y=G#, H=A, U=A#,
// J=B, K=C+1, O=C#+1, L=D+1, P=D#+1, ;=E+1, '=F+1
// Z/X = octave down/up, C/V = velocity down/up
// ============================================================
"use client";

import { engine } from "./engine";
import { useDAW } from "./store";

export const KEY_TO_SEMITONE: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15, ";": 16, "'": 17,
};

export const SEMITONE_TO_KEY: Record<number, string> = Object.fromEntries(
  Object.entries(KEY_TO_SEMITONE).map(([k, v]) => [v, k])
);

export function handleTypingKeyDown(key: string): boolean {
  const st = useDAW.getState();
  if (!st.ui.musicalTyping) return false;
  if (key === "z" || key === "x") {
    const oct = st.ui.octaveBase + (key === "x" ? 1 : -1);
    useDAW.setState({ ui: { ...st.ui, octaveBase: Math.min(7, Math.max(0, oct)) } });
    return true;
  }
  if (key === "c" || key === "v") {
    const vel = st.ui.velocity + (key === "v" ? 8 : -8);
    useDAW.setState({ ui: { ...st.ui, velocity: Math.min(127, Math.max(16, vel)) } });
    return true;
  }
  const semi = KEY_TO_SEMITONE[key];
  if (semi === undefined) return false;
  const pitch = (st.ui.octaveBase + 1) * 12 + semi; // C3 => 48 when octaveBase=3
  const track = st.project.tracks.find((t) => t.id === st.ui.selectedTrackId);
  if (!track || track.type !== "midi") return false;
  engine.noteOn(pitch, st.ui.velocity);
  return true;
}

export function handleTypingKeyUp(key: string): boolean {
  const semi = KEY_TO_SEMITONE[key];
  if (semi === undefined) return false;
  const st = useDAW.getState();
  const pitch = (st.ui.octaveBase + 1) * 12 + semi;
  engine.noteOff(pitch);
  return true;
}
