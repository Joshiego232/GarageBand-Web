import type { Patch, SoundFontPresetRef } from "./types";

export const SOUNDFONT_CDN = "https://soundfonts.pages.dev";
export const SOUNDFONT_REPOSITORY =
  "https://github.com/marmooo/free-soundfonts";
export const WEBAUDIOFONT_DATA =
  "https://surikov.github.io/webaudiofontdata/sound";

export const GM_FONTS = {
  generalUser: "GeneralUser_GS_v1.472",
  fluidR3: "FluidR3_v3.1",
  sgm: "SGM-V2.01",
  retro: "90's_Retro_Vintage_v1.05",
} as const;

export function resolveMarmoooSoundFontUrl(
  font: string,
  bank: number,
  program: number,
): string {
  if (!Number.isInteger(bank) || bank < 0 || bank > 16383) {
    throw new RangeError(`Invalid SoundFont bank: ${bank}`);
  }
  if (!Number.isInteger(program) || program < 0 || program > 127) {
    throw new RangeError(`Invalid General MIDI program: ${program}`);
  }
  const safeFont = encodeURIComponent(font).replaceAll("'", "%27");
  return `${SOUNDFONT_CDN}/${safeFont}/${String(bank).padStart(3, "0")}/${String(program).padStart(3, "0")}.sf3`;
}

export function resolveWebAudioFontUrl(
  bankName: "FluidR3_GM" | "GeneralUserGS" | "Chaos",
  bank: number,
  program: number,
): string {
  if (!Number.isInteger(program) || program < 0 || program > 127) {
    throw new RangeError(`Invalid General MIDI program: ${program}`);
  }
  const prefix = bank === 0
    ? `${String(program).padStart(3, "0")}0`
    : `${bank}${program}`;
  const bankSuffix = bank === 0 ? "" : "_0";
  const filename = `${prefix}${bankSuffix}_${bankName}_sf2_file.js`;
  return `${WEBAUDIOFONT_DATA}/${filename}`;
}

const SOUND_CONTROLS = [
  { id: "cutoff", label: "Cutoff", min: 20, max: 20000, def: 18000, curve: "log" as const, unit: "Hz" },
  { id: "resonance", label: "Resonance", min: 0, max: 10, def: 0.7 },
  { id: "attack", label: "Attack", min: 0.001, max: 3, def: 0.02, curve: "log" as const, unit: "s" },
  { id: "release", label: "Release", min: 0.01, max: 4, def: 0.28, curve: "log" as const, unit: "s" },
  { id: "chorus", label: "Chorus", min: 0, max: 1, def: 0.12 },
  { id: "reverb", label: "Reverb", min: 0, max: 1, def: 0.12 },
];

type CuratedPreset = {
  id: string;
  name: string;
  category: string;
  icon: string;
  desc: string;
  bank: number;
  program: number;
  font?: string;
  defaults?: Partial<Record<(typeof SOUND_CONTROLS)[number]["id"], number>>;
  stereoWidth?: number;
  highShelfDb?: number;
};

const curatedPresets: CuratedPreset[] = [
  { id: "sf-worship-drawbar", name: "Drawbar Organ (B3 Gospel)", category: "Worship & Gospel", icon: "music", desc: "GM program 16 · Drawbar Organ with a subtle rotary-style chorus send.", bank: 0, program: 16, defaults: { chorus: 0.24 } },
  { id: "sf-worship-swell-pad", name: "Warm Ambient Swell Pad", category: "Worship & Gospel", icon: "audio-waveform", desc: "GM program 89 · Pad 2 (Warm), with a slow 0.6 s attack and 1.5 s release.", bank: 0, program: 89, defaults: { attack: 0.6, release: 1.5, reverb: 0.28 } },
  { id: "sf-worship-cathedral-piano", name: "Grand Cathedral Piano", category: "Worship & Gospel", icon: "piano", desc: "GM program 0 · Acoustic Grand Piano with a hall reverb send.", bank: 0, program: 0, defaults: { reverb: 0.38 } },
  { id: "sf-worship-choir", name: "Lush Choir Aahs", category: "Worship & Gospel", icon: "music", desc: "GM program 52 · Choir Aahs with a widened stereo image.", bank: 0, program: 52, stereoWidth: 1.2, defaults: { reverb: 0.25 } },
  { id: "sf-worship-strings", name: "Shimmer Strings Ensemble", category: "Worship & Gospel", icon: "music", desc: "GM program 48 · String Ensemble 1 with a high-shelf air boost.", bank: 0, program: 48, highShelfDb: 2.5, defaults: { chorus: 0.2, reverb: 0.2 } },
  { id: "sf-worship-tubular-bells", name: "Orchestral Chimes & Bells", category: "Worship & Gospel", icon: "bell", desc: "GM program 14 · Tubular Bells.", bank: 0, program: 14, defaults: { release: 1.2, reverb: 0.2 } },

  { id: "sf-reggae-percussive-organ", name: "Bubbling Percussive Organ", category: "Reggae & Dub", icon: "music", desc: "GM program 17 · Percussive Organ with a crisp attack.", bank: 0, program: 17, defaults: { attack: 0.005 } },
  { id: "sf-reggae-sub-bass", name: "Deep Dub Sub-Bass", category: "Reggae & Dub", icon: "audio-waveform", desc: "GM program 33 · Electric Bass (finger) with a 220 Hz cutoff.", bank: 0, program: 33, defaults: { cutoff: 220, resonance: 0.4 } },
  { id: "sf-reggae-skank-guitar", name: "Clean Skank Guitar", category: "Reggae & Dub", icon: "guitar", desc: "GM program 27 · Electric Guitar (clean) with a tight release.", bank: 0, program: 27, defaults: { release: 0.12 } },
  { id: "sf-reggae-brass", name: "Roots Dub Brass Section", category: "Reggae & Dub", icon: "wind", desc: "GM program 61 · Brass Section with a tape-style delay send.", bank: 0, program: 61, defaults: { reverb: 0.2, chorus: 0.18 } },
  { id: "sf-reggae-nyabinghi-kit", name: "Nyabinghi & Rimshot Kit", category: "Reggae & Dub", icon: "drum", desc: "Bank 128, program 0 · Standard kit; MIDI drum notes select individual pieces.", bank: 128, program: 0, defaults: { release: 0.08 } },
  { id: "sf-reggae-melodica", name: "Augustus Melodica Lead", category: "Reggae & Dub", icon: "wind", desc: "GM program 22 · Harmonica with a spring-reverb-style send.", bank: 0, program: 22, defaults: { reverb: 0.3 } },

  { id: "sf-trap-808-kit", name: "TR-808 Sub & Boom Kit", category: "Hip-Hop & Trap", icon: "drum", desc: "Bank 128, program 25 · Electronic kit; exact kit content depends on the selected font.", bank: 128, program: 25, defaults: { release: 0.08 } },
  { id: "sf-trap-909-kit", name: "TR-909 Punch Kit", category: "Hip-Hop & Trap", icon: "drum", desc: "Bank 128, program 24 · Electronic kit; exact kit content depends on the selected font.", bank: 128, program: 24, defaults: { release: 0.08 } },
  { id: "sf-trap-rhodes", name: "Dusty 90s Rhodes EP", category: "Hip-Hop & Trap", icon: "piano", desc: "GM program 4 · Electric Piano 1 from 90's Retro Vintage.", bank: 0, program: 4, font: GM_FONTS.retro, defaults: { chorus: 0.14, reverb: 0.1 } },
  { id: "sf-trap-upright-bass", name: "Boom-Bap Upright Bass", category: "Hip-Hop & Trap", icon: "audio-waveform", desc: "GM program 32 · Acoustic Bass.", bank: 0, program: 32, defaults: { cutoff: 9000 } },
  { id: "sf-trap-vinyl-piano", name: "Lo-Fi Vinyl Upright Piano", category: "Hip-Hop & Trap", icon: "piano", desc: "GM program 2 · Electric Grand Piano with subtle modulation.", bank: 0, program: 2, defaults: { chorus: 0.08, reverb: 0.08 } },
  { id: "sf-trap-square-lead", name: "West Coast G-Synth Lead", category: "Hip-Hop & Trap", icon: "audio-waveform", desc: "GM program 80 · Lead 1 (square).", bank: 0, program: 80, defaults: { release: 0.18 } },

  { id: "sf-fx-sub-drop", name: "Sub Drop & Sci-Fi Sweep", category: "FX & Transitions", icon: "audio-waveform", desc: "GM program 127 · Gunshot; use pitch bend for a falling impact.", bank: 0, program: 127 },
  { id: "sf-fx-reverse-cymbal", name: "Reverse Cymbal Riser", category: "FX & Transitions", icon: "drum", desc: "GM program 119 · Reverse Cymbal.", bank: 0, program: 119, defaults: { reverb: 0.2 } },
  { id: "sf-fx-siren", name: "Dub Siren & Laser Zap", category: "FX & Transitions", icon: "audio-waveform", desc: "GM program 125 · Helicopter; a tonal sweep, not a dedicated laser sample.", bank: 0, program: 125 },
  { id: "sf-fx-seashore", name: "Vinyl Crackle & Tape Noise", category: "FX & Transitions", icon: "audio-waveform", desc: "GM program 122 · Seashore noise texture.", bank: 0, program: 122, defaults: { cutoff: 6500, reverb: 0.08 } },
  { id: "sf-fx-orchestra-hit", name: "90s Orchestral Hit", category: "FX & Transitions", icon: "music", desc: "GM program 55 · Orchestra Hit.", bank: 0, program: 55, defaults: { reverb: 0.18 } },
  { id: "sf-fx-thunder-rain", name: "Thunder & Rain Ambience", category: "FX & Transitions", icon: "audio-waveform", desc: "GM program 122 · Seashore noise; the source is not a dedicated thunder recording.", bank: 0, program: 122, defaults: { cutoff: 4500, reverb: 0.3 } },
];

function makePatch(item: CuratedPreset): Patch {
  const font = item.font ?? GM_FONTS.generalUser;
  const ref: SoundFontPresetRef = {
    source: "marmooo",
    bank: item.bank,
    program: item.program,
    name: item.name,
    font,
    url: resolveMarmoooSoundFontUrl(font, item.bank, item.program),
    stereoWidth: item.stereoWidth,
    highShelfDb: item.highShelfDb,
  };
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    icon: item.icon,
    desc: item.desc,
    knobs: SOUND_CONTROLS.map((control) => ({
      ...control,
      def: item.defaults?.[control.id as keyof typeof item.defaults] ?? control.def,
    })),
    sampled: { engine: "soundfont-worklet", instrument: `gm-${item.bank}-${item.program}` },
    soundfont: ref,
    isDrum: item.bank === 128,
  };
}

export const SOUNDFONT_PATCHES: Record<string, Patch> = Object.fromEntries(
  curatedPresets.map((item) => [item.id, makePatch(item)]),
);

export const SOUNDFONT_CATEGORIES = [
  "Worship & Gospel",
  "Reggae & Dub",
  "Hip-Hop & Trap",
  "FX & Transitions",
] as const;

export interface ImportedSoundFontPreset {
  fileId: string;
  fileName: string;
  presetName: string;
  bank: number;
  program: number;
}

export function makeImportedSoundFontPatch(
  preset: ImportedSoundFontPreset,
): Patch {
  return {
    id: `imported-sf-${preset.fileId}-${preset.bank}-${preset.program}`,
    name: preset.presetName,
    category: "Imported SoundFonts",
    icon: "music",
    desc: `${preset.fileName} · Bank ${preset.bank}, Program ${preset.program + 1}`,
    knobs: SOUND_CONTROLS,
    sampled: {
      engine: "soundfont-worklet",
      instrument: `sf-${preset.fileId}-${preset.bank}-${preset.program}`,
    },
    soundfont: {
      source: "imported",
      bank: preset.bank,
      program: preset.program,
      name: preset.presetName,
      fileId: preset.fileId,
      fileName: preset.fileName,
    },
  };
}
