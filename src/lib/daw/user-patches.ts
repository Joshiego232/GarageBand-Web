import { uid, type PedalInstance, type Track, type TrackStack } from "./types";
import { PEDAL_BY_ID } from "./pedalboard";

const STORAGE_KEY = "webband-user-patches-v1";
type SavedTrack = Omit<Track, "id" | "regions" | "stackId" | "parentTrackId">;

export interface UserPatch {
  id: string;
  name: string;
  category: string;
  kind: "track" | "stack" | "pedalboard";
  color: string;
  track?: SavedTrack;
  pedalboard?: PedalInstance[];
  stack?: {
    definition: Omit<TrackStack, "trackIds" | "folderTrackId" | "busTrackId">;
    tracks: SavedTrack[];
    bus?: SavedTrack;
  };
}

export function readUserPatches(): UserPatch[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) throw new Error("Saved user patches must be a JSON array.");
    return value.filter(isUserPatch);
  } catch (error) {
    console.error("Could not read saved user patches.", error);
    return [];
  }
}

export function writeUserPatches(patches: UserPatch[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(patches));
  } catch (error) {
    console.error("Could not save user patches.", error);
    throw new Error("Could not save the patch. Browser storage may be full or unavailable.");
  }
}

export function makeUserPatch(
  name: string,
  category: string,
  track: Track,
  stack?: TrackStack,
  stackTracks: Track[] = [],
  busTrack?: Track,
): UserPatch {
  const cleanTrack = (source: Track): SavedTrack => {
    const {
      id: _id,
      regions: _regions,
      stackId: _stackId,
      parentTrackId: _parentTrackId,
      ...rest
    } = source;
    return rest;
  };
  if (!stack) {
    return {
      id: uid(),
      name,
      category,
      kind: "track",
      color: track.color,
      track: cleanTrack(track),
    };
  }
  const { trackIds: _trackIds, folderTrackId: _folderTrackId, busTrackId: _busTrackId, ...definition } = stack;
  return {
    id: uid(),
    name,
    category,
    kind: "stack",
    color: stack.color ?? track.color,
    stack: {
      definition,
      tracks: stackTracks.map(cleanTrack),
      ...(busTrack ? { bus: cleanTrack(busTrack) } : {}),
    },
  };
}

export function makePedalboardPatch(
  name: string,
  pedalboard: PedalInstance[],
  color: string,
): UserPatch {
  return {
    id: uid(),
    name,
    category: "My Instruments",
    kind: "pedalboard",
    color,
    pedalboard: pedalboard.map((pedal) => ({
      ...pedal,
      id: uid(),
      params: { ...pedal.params },
    })),
  };
}

function isUserPatch(value: unknown): value is UserPatch {
  if (!value || typeof value !== "object") return false;
  const patch = value as Partial<UserPatch>;
  return typeof patch.id === "string" &&
    typeof patch.name === "string" &&
    typeof patch.category === "string" &&
    (patch.kind === "track"
      ? !!patch.track && !!patch.track.type
      : patch.kind === "pedalboard"
        ? Array.isArray(patch.pedalboard) &&
          patch.pedalboard.every((pedal) =>
            !!pedal &&
            typeof pedal.id === "string" &&
            typeof pedal.pedalId === "string" &&
            pedal.pedalId in PEDAL_BY_ID &&
            typeof pedal.enabled === "boolean" &&
            !!pedal.params &&
            typeof pedal.params === "object",
          )
        : patch.kind === "stack" &&
        !!patch.stack &&
        patch.stack.tracks.length >= 2 &&
        (patch.stack.definition.type === "folder" || patch.stack.definition.type === "summing"));
}
