import type { MidiCCTarget } from "./types";

/** Convert a 7-bit MIDI CC (0..127) into a DAW parameter value. */
export function midiCCToValue(target: MidiCCTarget, rawValue: number): number {
  const value = Math.max(0, Math.min(127, Math.round(rawValue)));
  const normalized = value / 127;

  if (target === "track-pan") return normalized * 2 - 1;
  return normalized * 1.25;
}

/** Format a MIDI CC target for the control-surface panel. */
export function midiCCTargetLabel(target: MidiCCTarget): string {
  switch (target) {
    case "master-volume":
      return "Master Volume";
    case "track-volume":
      return "Track Volume";
    case "track-pan":
      return "Track Pan";
  }
}
