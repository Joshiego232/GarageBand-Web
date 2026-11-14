import type { Track } from "./types";

function routeChain(track: Track, tracks: Track[]): Track[] | null {
  const byId = new Map(tracks.map((item) => [item.id, item]));
  const visited = new Set<string>([track.id]);
  const chain: Track[] = [];
  let nextId = track.outputBusId ?? null;

  while (nextId) {
    if (visited.has(nextId)) return null;
    visited.add(nextId);
    const target = byId.get(nextId);
    if (!target || target.role !== "aux") return null;
    chain.push(target);
    nextId = target.outputBusId ?? null;
  }

  return chain;
}

/** First Aux input in a safe route chain. Null means Stereo Out or invalid route. */
export function resolveOutputBus(track: Track, tracks: Track[]): Track | null {
  if (!track.outputBusId) return null;
  const chain = routeChain(track, tracks);
  return chain?.[0] ?? null;
}

/** Whether this channel ultimately feeds the requested Aux bus. */
export function isRoutedThroughBus(
  track: Track,
  busId: string,
  tracks: Track[],
): boolean {
  return routeChain(track, tracks)?.some((bus) => bus.id === busId) ?? false;
}

/** VCA-controlled gain multiplier. The member track's own fader is never mutated. */
export function getVcaMultiplier(track: Track, tracks: Track[]): number {
  if (!track.vcaId) return 1;
  const vca = tracks.find((item) => item.id === track.vcaId && item.role === "vca");
  return vca ? Math.min(1.25, Math.max(0, vca.volume)) : 1;
}

export function getEffectiveTrackGain(track: Track, tracks: Track[]): number {
  if (track.role === "vca") return 0;
  return Math.min(1.5625, Math.max(0, track.volume * getVcaMultiplier(track, tracks)));
}

/** Solo logic follows VCA assignments and Aux routing while respecting mute states. */
export function isTrackAudible(track: Track, tracks: Track[]): boolean {
  if (track.role === "vca" || track.mute) return false;
  const vca = track.vcaId
    ? tracks.find((item) => item.id === track.vcaId && item.role === "vca")
    : undefined;
  if (vca?.mute) return false;

  const anySolo = tracks.some((item) => item.solo);
  if (!anySolo) return true;
  if (track.solo || vca?.solo) return true;

  const chain = routeChain(track, tracks);
  return !!chain?.some((bus) => bus.solo);
}
