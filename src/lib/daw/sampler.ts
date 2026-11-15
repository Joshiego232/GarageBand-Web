import type { SamplerZone } from "./types";

/**
 * Select the most specific sample zone for a MIDI pitch and velocity.
 * Narrow key ranges win, then narrower velocity ranges.
 */
export function selectSamplerZone(
  zones: SamplerZone[] | undefined,
  pitch: number,
  velocity: number
): SamplerZone | undefined {
  return (zones ?? [])
    .filter((zone) =>
      pitch >= zone.lowKey &&
      pitch <= zone.highKey &&
      velocity >= zone.velocityLow &&
      velocity <= zone.velocityHigh
    )
    .sort((a, b) => {
      const keyRange = (a.highKey - a.lowKey) - (b.highKey - b.lowKey);
      if (keyRange !== 0) return keyRange;
      return (a.velocityHigh - a.velocityLow) - (b.velocityHigh - b.velocityLow);
    })[0];
}

/** One-shot samples ignore MIDI note-off; looped samples release with the note. */
export function shouldReleaseSamplerOnNoteOff(
  playbackMode: "one-shot" | "loop"
): boolean {
  return playbackMode === "loop";
}
