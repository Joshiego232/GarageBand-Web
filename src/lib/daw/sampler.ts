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
