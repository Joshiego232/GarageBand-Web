import type { Patch } from "./types";
import { getSynthPreviewImageUrl } from "./synthCatalog";

export type InstrumentArtworkKind =
  | "piano"
  | "guitar"
  | "drums"
  | "synth"
  | "organ"
  | "brass"
  | "strings"
  | "bass"
  | "bells"
  | "turntable";

export interface InstrumentPreset {
  id: string;
  name: string;
  category: string;
  description: string;
  icon: string;
  artwork: InstrumentArtworkKind;
  /** Optional path to custom PNG, WebP, or SVG artwork in /public. */
  previewImageUrl?: string;
  patch?: Patch;
}

export interface InstrumentCategory {
  id: string;
  name: string;
  icon: string;
}

export const INSTRUMENT_CATEGORIES: InstrumentCategory[] = [
  { id: "my-instruments", name: "My Instruments", icon: "user-round" },
  { id: "worship-gospel", name: "Worship & Gospel", icon: "church" },
  { id: "reggae-dub", name: "Reggae & Dub", icon: "audio-lines" },
  { id: "hip-hop-trap", name: "Hip-Hop & Trap", icon: "disc-3" },
  { id: "fx-transitions", name: "FX & Transitions", icon: "sparkles" },
  { id: "piano-keys", name: "Piano & Keys", icon: "piano" },
  { id: "synthesizer", name: "Synthesizer", icon: "audio-waveform" },
  { id: "drums-percussion", name: "Drums & Percussion", icon: "drum" },
  { id: "guitar-bass", name: "Guitar & Bass", icon: "guitar" },
  { id: "orchestral", name: "Strings & Orchestral", icon: "music-2" },
  { id: "organs", name: "Organs", icon: "church" },
  { id: "bells-mallets", name: "Bells & Mallets", icon: "bell" },
  { id: "brass-winds", name: "Brass & Winds", icon: "wind" },
  { id: "stage-keys", name: "Stage Keys", icon: "piano" },
  { id: "alchemy-synth", name: "Alchemy Synth", icon: "waves" },
  { id: "imported-soundfonts", name: "Imported SoundFonts", icon: "folder-open" },
];

const CATEGORY_ALIASES: Record<string, string> = {
  "Bass": "Guitar & Bass",
  "Guitars": "Guitar & Bass",
  "Drum Kit & Percussion": "Drums & Percussion",
  "Drums & Percussion": "Drums & Percussion",
  "Strings & Orchestral": "Strings & Orchestral",
  "Worship Keys": "Worship & Gospel",
  "Layered Keys": "Worship & Gospel",
};

const ARTWORK_BY_PATCH: Record<string, InstrumentArtworkKind> = {
  "grand-piano": "piano",
  "bright-piano": "piano",
  "stage-epiano": "piano",
  "stage-upright-piano": "piano",
  "tonewheel-organ": "organ",
  "church-organ": "organ",
  "nylon-guitar": "guitar",
  "steel-guitar": "guitar",
  "808-kit": "drums",
  "drum-kit": "drums",
  "vintage-turntable": "turntable",
};

const ARTWORK_BY_ICON: Record<string, InstrumentArtworkKind> = {
  piano: "piano",
  guitar: "guitar",
  drum: "drums",
  "audio-waveform": "synth",
  speaker: "bass",
  bell: "bells",
  wind: "brass",
  music: "strings",
  "grid-3x3": "bells",
  "gamepad-2": "synth",
};

/**
 * Put artwork in public/instruments and add a patch-id mapping here, e.g.
 * "grand-piano": "/instruments/concert-grand.webp".
 * A failed or omitted image always falls back to the inline instrument SVG.
 */
export const INSTRUMENT_PREVIEW_IMAGES: Record<string, string> = {};

export function getInstrumentCategoryName(category: string): string {
  return CATEGORY_ALIASES[category] ?? category;
}

export function getInstrumentArtwork(patch: Pick<Patch, "id" | "icon" | "category">): InstrumentArtworkKind {
  if (ARTWORK_BY_PATCH[patch.id]) return ARTWORK_BY_PATCH[patch.id];
  if (/organ/i.test(patch.category)) return "organ";
  if (/guitar|bass/i.test(patch.category)) return "guitar";
  if (/drum|percussion/i.test(patch.category)) return "drums";
  if (/orchestral|string/i.test(patch.category)) return "strings";
  if (/brass|wind/i.test(patch.category)) return "brass";
  if (/bell|mallet/i.test(patch.category)) return "bells";
  return ARTWORK_BY_ICON[patch.icon] ?? "synth";
}

export function toInstrumentPreset(patch: Patch): InstrumentPreset {
  return {
    id: patch.id,
    name: patch.name,
    category: getInstrumentCategoryName(patch.category),
    description: patch.desc,
    icon: patch.icon,
    artwork: getInstrumentArtwork(patch),
    previewImageUrl:
      INSTRUMENT_PREVIEW_IMAGES[patch.id] ?? getSynthPreviewImageUrl(patch),
    patch,
  };
}
