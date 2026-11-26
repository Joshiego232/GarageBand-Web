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
export const INSTRUMENT_PREVIEW_IMAGES: Record<string, string> = {
  "string-ensemble": "/instrument-previews/Orchestral String Ensemble (Group).png",
  "string-ensemble-2": "/instrument-previews/Orchestral String Ensemble (Group).png",
  "tremolo-strings": "/instrument-previews/Orchestral String Ensemble (Group).png",
  "pizzicato-strings": "/instrument-previews/Orchestral String Ensemble (Group).png",
  violin: "/instrument-previews/Solo Violin.png",
  viola: "/instrument-previews/Solo Viola.png",
  cello: "/instrument-previews/Solo Cello.png",
  contrabass: "/instrument-previews/Orchestral Double Bass.png",
};

const WORSHIP_GOSPEL_PREVIEW_IMAGES = [
  "/instrument-previews/Yamaha DX7.jpg",
  "/instrument-previews/Yamaha Montage 8.jpg",
  "/instrument-previews/Yamaha MODX7.jpg",
  "/instrument-previews/Roland Phantom keys 61 keys.jpg",
  "/instrument-previews/Roland Fantom 8.jpg",
  "/instrument-previews/NORD Stage 4 piano.jpg",
  "/instrument-previews/Fantom MODX 67.jpg",
  "/instrument-previews/Arturia KeyLab 88.jpg",
  "/instrument-previews/Yamaha P-125.jpg",
] as const;

const GUITAR_PREVIEW_IMAGES = [
  "/instrument-previews/Fender American Professional Classic Telecaster.jpg",
  "/instrument-previews/fender rendezvous Light Brown wood.jpg",
  "/instrument-previews/Fender Rendezvous Red.jpg",
  "/instrument-previews/fender rendezvous Surf Green.jpg",
  "/instrument-previews/fender rendezvous ultramarine blue .jpg",
  "/instrument-previews/Fender Rendezvous Wooden.jpg",
  "/instrument-previews/fender stratocaster white.jpg",
  "/instrument-previews/Ibanez 5 string black.jpg",
  "/instrument-previews/ibanez 5 string.jpg",
] as const;

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getWorshipGospelPreviewImage(patch: Patch): string | undefined {
  if (getInstrumentCategoryName(patch.category) !== "Worship & Gospel") {
    return undefined;
  }
  return WORSHIP_GOSPEL_PREVIEW_IMAGES[
    stableHash(patch.id) % WORSHIP_GOSPEL_PREVIEW_IMAGES.length
  ];
}

function getGuitarPreviewImage(patch: Patch): string | undefined {
  const category = getInstrumentCategoryName(patch.category);
  const text = `${patch.id} ${patch.name} ${patch.category}`.toLowerCase();

  if (
    category !== "Guitar & Bass" ||
    patch.category !== "Guitars" ||
    /(?:\bbass\b|banjo|sitar|synth)/i.test(text)
  ) {
    return undefined;
  }

  return GUITAR_PREVIEW_IMAGES[
    stableHash(patch.id) % GUITAR_PREVIEW_IMAGES.length
  ];
}

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
      INSTRUMENT_PREVIEW_IMAGES[patch.id] ??
      getGuitarPreviewImage(patch) ??
      getWorshipGospelPreviewImage(patch) ??
      getSynthPreviewImageUrl(patch),
    patch,
  };
}
