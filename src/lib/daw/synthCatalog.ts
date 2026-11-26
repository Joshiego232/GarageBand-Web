import type { Patch } from "./types";

export const SYNTH_PREVIEW_IMAGES: string[] = [
  "/instrument-previews/synth-01.jpg",
  "/instrument-previews/synth-02.jpg",
  "/instrument-previews/synth-03.jpg",
  "/instrument-previews/synth-04.jpg",
  "/instrument-previews/synth-05.jpg",
  "/instrument-previews/synth-06.jpg",
  "/instrument-previews/synth-07.jpg",
  "/instrument-previews/synth-08.jpg",
];

type SynthSettings = {
  morph: number;
  harmonics: number;
  cutoff: number;
  resonance: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  detune: number;
  sub: number;
  lfoRate: number;
  lfoDepth: number;
  noise: number;
  waveform: number;
  chorus: number;
  glide: number;
};

type SynthPresetDefinition = {
  id: string;
  name: string;
  category: "Alchemy Synth" | "Synthesizer";
  subcategory: string;
  description: string;
  settings: SynthSettings;
};

function createSynthPatch(definition: SynthPresetDefinition): Patch {
  const { settings } = definition;
  const knobs: Patch["knobs"] = [
    { id: "morph", label: "Spectral Morph", min: 0, max: 1, def: settings.morph },
    { id: "harmonics", label: "Harmonics", min: 0.1, max: 1, def: settings.harmonics },
    { id: "cutoff", label: "Filter Cutoff", min: 80, max: 16000, def: settings.cutoff, curve: "log", unit: "Hz" },
    { id: "resonance", label: "Resonance", min: 0.1, max: 16, def: settings.resonance },
    { id: "attack", label: "Attack", min: 0.001, max: 4, def: settings.attack, unit: "s" },
    { id: "decay", label: "Decay", min: 0.02, max: 5, def: settings.decay, unit: "s" },
    { id: "sustain", label: "Sustain", min: 0, max: 1, def: settings.sustain },
    { id: "release", label: "Release", min: 0.03, max: 8, def: settings.release, unit: "s" },
    { id: "waveform", label: "Oscillator Wave", min: 0, max: 4, def: settings.waveform, step: 1 },
    { id: "detune", label: "Unison Detune", min: 0, max: 40, def: settings.detune, unit: "ct" },
    { id: "chorus", label: "Chorus", min: 0, max: 1, def: settings.chorus },
    { id: "glide", label: "Glide", min: 0, max: 1, def: settings.glide },
    { id: "sub", label: "Sub Layer", min: 0, max: 1, def: settings.sub },
    { id: "lfoRate", label: "LFO Rate", min: 0.05, max: 12, def: settings.lfoRate, unit: "Hz" },
    { id: "lfoDepth", label: "LFO Depth", min: 0, max: 1, def: settings.lfoDepth },
    { id: "noise", label: "Noise Layer", min: 0, max: 1, def: settings.noise },
    { id: "reverb", label: "Reverb", min: 0, max: 1, def: 0.12 },
    { id: "delay", label: "Delay", min: 0, max: 1, def: 0 },
  ];

  return {
    id: definition.id,
    name: definition.name,
    category: definition.category,
    subcategory: definition.subcategory,
    icon: "audio-waveform",
    desc: definition.description,
    synthEngine: "morph-additive",
    knobs,
  };
}

const PRESETS: SynthPresetDefinition[] = [
  {
    id: "alchemy-glass-orbit", name: "Glass Orbit", category: "Alchemy Synth", subcategory: "Pads & Atmospheres",
    description: "Bright additive shimmer with a soft evolving filter.",
    settings: { morph: 0.82, harmonics: 0.8, cutoff: 9200, resonance: 2.4, attack: 0.08, decay: 1.8, sustain: 0.64, release: 2.4, detune: 7, sub: 0.08, lfoRate: 0.22, lfoDepth: 0.24, noise: 0.02, waveform: 0, chorus: 0.28, glide: 0.04 },
  },
  {
    id: "alchemy-solar-pad", name: "Solar Pad", category: "Alchemy Synth", subcategory: "Pads & Atmospheres",
    description: "Wide evolving pad with a slow attack, soft sub layer and gentle motion.",
    settings: { morph: 0.48, harmonics: 0.58, cutoff: 4200, resonance: 1.2, attack: 1.4, decay: 2.8, sustain: 0.82, release: 3.8, detune: 12, sub: 0.22, lfoRate: 0.16, lfoDepth: 0.34, noise: 0.04, waveform: 2, chorus: 0.58, glide: 0.18 },
  },
  {
    id: "alchemy-prism-keys", name: "Prism Keys", category: "Alchemy Synth", subcategory: "Plucks, Keys & Arps",
    description: "Percussive digital keys with a clear harmonic attack and short release.",
    settings: { morph: 0.72, harmonics: 0.72, cutoff: 11200, resonance: 1.8, attack: 0.004, decay: 0.48, sustain: 0.12, release: 0.42, detune: 3, sub: 0.04, lfoRate: 3.2, lfoDepth: 0.08, noise: 0.015, waveform: 1, chorus: 0.12, glide: 0 },
  },
  {
    id: "alchemy-neon-lead", name: "Neon Lead", category: "Alchemy Synth", subcategory: "Analog & Leads",
    description: "Focused unison lead with bright upper partials and expressive filter motion.",
    settings: { morph: 0.24, harmonics: 0.9, cutoff: 7800, resonance: 4.2, attack: 0.012, decay: 0.52, sustain: 0.76, release: 0.32, detune: 16, sub: 0.12, lfoRate: 5.1, lfoDepth: 0.14, noise: 0.01, waveform: 4, chorus: 0.18, glide: 0.3 },
  },
  {
    id: "alchemy-sub-motion", name: "Sub Motion", category: "Alchemy Synth", subcategory: "Sub & Synth Bass",
    description: "Deep bass synth with restrained harmonics and subtle modulation.",
    settings: { morph: 0.12, harmonics: 0.42, cutoff: 1250, resonance: 1.1, attack: 0.006, decay: 0.34, sustain: 0.7, release: 0.22, detune: 2, sub: 0.9, lfoRate: 0.8, lfoDepth: 0.06, noise: 0, waveform: 3, chorus: 0.03, glide: 0.12 },
  },
  {
    id: "alchemy-crystal-bell", name: "Crystal Bell", category: "Alchemy Synth", subcategory: "Plucks, Keys & Arps",
    description: "Bell-like additive partials with a long, decaying metallic tail.",
    settings: { morph: 0.96, harmonics: 0.94, cutoff: 14800, resonance: 2.8, attack: 0.002, decay: 3.4, sustain: 0.04, release: 2.8, detune: 1.5, sub: 0, lfoRate: 0.12, lfoDepth: 0.16, noise: 0.03, waveform: 1, chorus: 0.08, glide: 0 },
  },
  {
    id: "alchemy-vapor-brass", name: "Vapor Brass", category: "Alchemy Synth", subcategory: "Analog & Leads",
    description: "Layered synthetic brass with a rising filter envelope and mild unison.",
    settings: { morph: 0.34, harmonics: 0.76, cutoff: 5200, resonance: 2.1, attack: 0.035, decay: 0.62, sustain: 0.72, release: 0.48, detune: 9, sub: 0.18, lfoRate: 0.32, lfoDepth: 0.08, noise: 0.035, waveform: 4, chorus: 0.22, glide: 0.08 },
  },
  {
    id: "alchemy-choir-flux", name: "Choir Flux", category: "Alchemy Synth", subcategory: "Pads & Atmospheres",
    description: "Vocal-like additive pad with airy noise and slow spectral movement.",
    settings: { morph: 0.68, harmonics: 0.52, cutoff: 3600, resonance: 1.4, attack: 0.65, decay: 1.5, sustain: 0.84, release: 3.2, detune: 6, sub: 0.08, lfoRate: 0.28, lfoDepth: 0.4, noise: 0.12, waveform: 2, chorus: 0.48, glide: 0.14 },
  },
  {
    id: "alchemy-spectral-dream", name: "Spectral Dream", category: "Alchemy Synth", subcategory: "Pads & Atmospheres",
    description: "Soft ambient texture of evolving partials, subharmonics and filtered noise.",
    settings: { morph: 0.9, harmonics: 0.62, cutoff: 6200, resonance: 0.9, attack: 1.9, decay: 3.4, sustain: 0.72, release: 5.5, detune: 4, sub: 0.14, lfoRate: 0.09, lfoDepth: 0.52, noise: 0.2, waveform: 0, chorus: 0.62, glide: 0.25 },
  },
  {
    id: "alchemy-digital-pluck", name: "Digital Pluck", category: "Alchemy Synth", subcategory: "Plucks, Keys & Arps",
    description: "Fast plucked tone with a bright morphing spectrum and tight bass foundation.",
    settings: { morph: 0.58, harmonics: 0.88, cutoff: 9800, resonance: 3.1, attack: 0.002, decay: 0.26, sustain: 0.06, release: 0.3, detune: 2, sub: 0.28, lfoRate: 2.4, lfoDepth: 0.1, noise: 0.025, waveform: 3, chorus: 0.1, glide: 0 },
  },
  {
    id: "alchemy-analog-saw-lead", name: "Alchemy Analog Saw Lead", category: "Alchemy Synth", subcategory: "Analog & Leads",
    description: "Bright monophonic saw with a resonant, snappy filter envelope.",
    settings: { morph: 0.18, harmonics: 0.96, cutoff: 7200, resonance: 4.8, attack: 0.008, decay: 0.38, sustain: 0.78, release: 0.3, detune: 18, sub: 0.14, lfoRate: 5.6, lfoDepth: 0.12, noise: 0.01, waveform: 4, chorus: 0.24, glide: 0.34 },
  },
  {
    id: "alchemy-west-coast-g-funk-glide", name: "West Coast G-Funk Glide", category: "Alchemy Synth", subcategory: "Analog & Leads",
    description: "Liquid portamento lead with a rounded square core and expressive vibrato.",
    settings: { morph: 0.36, harmonics: 0.68, cutoff: 4800, resonance: 3.2, attack: 0.018, decay: 0.42, sustain: 0.72, release: 0.36, detune: 5, sub: 0.22, lfoRate: 5.2, lfoDepth: 0.18, noise: 0.005, waveform: 3, chorus: 0.2, glide: 0.72 },
  },
  {
    id: "alchemy-warm-tape-brass-synth", name: "Warm Tape Brass Synth", category: "Alchemy Synth", subcategory: "Analog & Leads",
    description: "Soft-edged brass stack with a gentle attack and tape-like chorusing.",
    settings: { morph: 0.4, harmonics: 0.62, cutoff: 3900, resonance: 1.6, attack: 0.045, decay: 0.7, sustain: 0.68, release: 0.58, detune: 10, sub: 0.1, lfoRate: 0.24, lfoDepth: 0.1, noise: 0.025, waveform: 4, chorus: 0.46, glide: 0.05 },
  },
  {
    id: "alchemy-detuned-supersaw-anthem", name: "Detuned Supersaw Anthem", category: "Alchemy Synth", subcategory: "Analog & Leads",
    description: "Wide, bright unison saw stack tuned for soaring chord stabs.",
    settings: { morph: 0.28, harmonics: 1, cutoff: 10800, resonance: 2.2, attack: 0.018, decay: 0.82, sustain: 0.82, release: 0.72, detune: 34, sub: 0.16, lfoRate: 0.42, lfoDepth: 0.06, noise: 0.015, waveform: 4, chorus: 0.72, glide: 0.08 },
  },
  {
    id: "alchemy-liquid-acid-303-lead", name: "Liquid Acid 303 Lead", category: "Alchemy Synth", subcategory: "Analog & Leads",
    description: "Resonant square-saw sequence voice with a quick accent-like filter snap.",
    settings: { morph: 0.2, harmonics: 0.82, cutoff: 2600, resonance: 9.2, attack: 0.002, decay: 0.2, sustain: 0.48, release: 0.12, detune: 1, sub: 0.26, lfoRate: 1.2, lfoDepth: 0.38, noise: 0.012, waveform: 3, chorus: 0.05, glide: 0.16 },
  },
  {
    id: "alchemy-celestial-worship-shimmer-pad", name: "Celestial Worship Shimmer Pad", category: "Alchemy Synth", subcategory: "Pads & Atmospheres",
    description: "Slow, airy pad with a glassy upper spectrum and a long release.",
    settings: { morph: 0.84, harmonics: 0.72, cutoff: 8400, resonance: 1.2, attack: 1.6, decay: 2.8, sustain: 0.84, release: 5.2, detune: 8, sub: 0.12, lfoRate: 0.14, lfoDepth: 0.38, noise: 0.11, waveform: 1, chorus: 0.7, glide: 0.16 },
  },
  {
    id: "alchemy-evolving-glass-choir-pad", name: "Evolving Glass Choir Pad", category: "Alchemy Synth", subcategory: "Pads & Atmospheres",
    description: "A slowly shifting choir-like bed with crystalline overtones.",
    settings: { morph: 0.92, harmonics: 0.86, cutoff: 6800, resonance: 2.1, attack: 1.1, decay: 2.4, sustain: 0.78, release: 4.8, detune: 5, sub: 0.06, lfoRate: 0.11, lfoDepth: 0.48, noise: 0.14, waveform: 0, chorus: 0.62, glide: 0.22 },
  },
  {
    id: "alchemy-midnight-granular-drift", name: "Midnight Granular Drift", category: "Alchemy Synth", subcategory: "Pads & Atmospheres",
    description: "Dark, softly noisy drone with slow stereo-like movement and drifting partials.",
    settings: { morph: 0.76, harmonics: 0.34, cutoff: 2100, resonance: 0.8, attack: 2.2, decay: 3.1, sustain: 0.68, release: 6.4, detune: 3, sub: 0.2, lfoRate: 0.07, lfoDepth: 0.72, noise: 0.42, waveform: 2, chorus: 0.55, glide: 0.38 },
  },
  {
    id: "alchemy-velvet-analog-strings-pad", name: "Velvet Analog Strings Pad", category: "Alchemy Synth", subcategory: "Pads & Atmospheres",
    description: "Rounded string-machine chords with lush unison and a soft filter.",
    settings: { morph: 0.3, harmonics: 0.66, cutoff: 3400, resonance: 1.4, attack: 0.52, decay: 1.8, sustain: 0.82, release: 3.6, detune: 15, sub: 0.1, lfoRate: 0.19, lfoDepth: 0.28, noise: 0.02, waveform: 2, chorus: 0.78, glide: 0.12 },
  },
  {
    id: "alchemy-deep-space-nebula-drone", name: "Deep Space Nebula Drone", category: "Alchemy Synth", subcategory: "Pads & Atmospheres",
    description: "Low, slowly blooming spectral drone with sub weight and evolving filtered noise.",
    settings: { morph: 0.64, harmonics: 0.46, cutoff: 1250, resonance: 1.1, attack: 2.8, decay: 3.5, sustain: 0.74, release: 7, detune: 7, sub: 0.62, lfoRate: 0.055, lfoDepth: 0.62, noise: 0.32, waveform: 0, chorus: 0.32, glide: 0.52 },
  },
  {
    id: "alchemy-crystal-fm-bell-pluck", name: "Crystal FM Bell Pluck", category: "Alchemy Synth", subcategory: "Plucks, Keys & Arps",
    description: "Hard, glassy transient and a bright decaying digital bell tail.",
    settings: { morph: 0.98, harmonics: 1, cutoff: 15300, resonance: 3.8, attack: 0.001, decay: 1.7, sustain: 0.02, release: 1.8, detune: 0.5, sub: 0, lfoRate: 4.8, lfoDepth: 0.04, noise: 0.01, waveform: 1, chorus: 0.08, glide: 0 },
  },
  {
    id: "alchemy-80s-retro-digital-keys", name: "80s Retro Digital Keys", category: "Alchemy Synth", subcategory: "Plucks, Keys & Arps",
    description: "Punchy digital keyboard tone with bright harmonics and a short chorus tail.",
    settings: { morph: 0.68, harmonics: 0.9, cutoff: 9800, resonance: 2.6, attack: 0.003, decay: 0.64, sustain: 0.26, release: 0.62, detune: 2, sub: 0.05, lfoRate: 0.7, lfoDepth: 0.08, noise: 0.02, waveform: 1, chorus: 0.36, glide: 0 },
  },
  {
    id: "alchemy-cyberpunk-arp-sequence", name: "Cyberpunk Arp Sequence", category: "Alchemy Synth", subcategory: "Plucks, Keys & Arps",
    description: "Hard-edged pulsing arpeggio voice with a narrow resonant filter peak.",
    settings: { morph: 0.46, harmonics: 0.94, cutoff: 6200, resonance: 6.8, attack: 0.001, decay: 0.18, sustain: 0.32, release: 0.14, detune: 3, sub: 0.06, lfoRate: 7.5, lfoDepth: 0.22, noise: 0.015, waveform: 3, chorus: 0.12, glide: 0.02 },
  },
  {
    id: "alchemy-marimba-mallet-synth", name: "Marimba Mallet Synth", category: "Alchemy Synth", subcategory: "Plucks, Keys & Arps",
    description: "Woody, hollow mallet-inspired tone with a fast decay and muted upper edge.",
    settings: { morph: 0.56, harmonics: 0.5, cutoff: 4100, resonance: 1.1, attack: 0.001, decay: 0.42, sustain: 0.03, release: 0.24, detune: 0, sub: 0.08, lfoRate: 2.2, lfoDepth: 0.03, noise: 0.005, waveform: 2, chorus: 0.02, glide: 0 },
  },
  {
    id: "alchemy-lo-fi-warped-cassette-keys", name: "Lo-Fi Warped Cassette Keys", category: "Alchemy Synth", subcategory: "Plucks, Keys & Arps",
    description: "Mellow, slightly unstable keys with filtered noise and slow pitch movement.",
    settings: { morph: 0.42, harmonics: 0.48, cutoff: 2800, resonance: 0.9, attack: 0.012, decay: 0.9, sustain: 0.4, release: 0.72, detune: 4, sub: 0.04, lfoRate: 0.34, lfoDepth: 0.3, noise: 0.18, waveform: 2, chorus: 0.28, glide: 0.02 },
  },
  {
    id: "alchemy-808-sub-earthquake", name: "808 Sub Earthquake", category: "Alchemy Synth", subcategory: "Sub & Synth Bass",
    description: "Deep sine-forward sub with a firm fundamental and a long pitch scoop.",
    settings: { morph: 0.04, harmonics: 0.2, cutoff: 480, resonance: 0.6, attack: 0.002, decay: 0.72, sustain: 0.62, release: 0.35, detune: 0, sub: 1, lfoRate: 0.08, lfoDepth: 0.02, noise: 0, waveform: 1, chorus: 0, glide: 0.48 },
  },
  {
    id: "alchemy-reese-neuro-bass", name: "Reese Neuro Bass", category: "Alchemy Synth", subcategory: "Sub & Synth Bass",
    description: "Detuned, snarling bass tone with a moving low-pass and layered sub.",
    settings: { morph: 0.3, harmonics: 0.92, cutoff: 1800, resonance: 4.2, attack: 0.004, decay: 0.48, sustain: 0.72, release: 0.3, detune: 27, sub: 0.62, lfoRate: 0.48, lfoDepth: 0.66, noise: 0.06, waveform: 4, chorus: 0.14, glide: 0.18 },
  },
  {
    id: "alchemy-punchy-fm-slap-bass", name: "Punchy FM Slap Bass", category: "Alchemy Synth", subcategory: "Sub & Synth Bass",
    description: "Short, percussive bass attack with bright harmonics and a tight tail.",
    settings: { morph: 0.72, harmonics: 0.86, cutoff: 6800, resonance: 2.6, attack: 0.001, decay: 0.28, sustain: 0.28, release: 0.14, detune: 1, sub: 0.5, lfoRate: 2.8, lfoDepth: 0.08, noise: 0.04, waveform: 3, chorus: 0.03, glide: 0.03 },
  },
  {
    id: "alchemy-moog-taurus-low-end", name: "Moog Taurus Low-End", category: "Alchemy Synth", subcategory: "Sub & Synth Bass",
    description: "Massive rounded pedal-bass voice with slow filter movement and warm unison.",
    settings: { morph: 0.16, harmonics: 0.48, cutoff: 1450, resonance: 1.8, attack: 0.018, decay: 0.76, sustain: 0.86, release: 0.84, detune: 8, sub: 0.84, lfoRate: 0.16, lfoDepth: 0.12, noise: 0.01, waveform: 4, chorus: 0.12, glide: 0.22 },
  },
  {
    id: "alchemy-dubstep-wobble-growl", name: "Dubstep Wobble Growl", category: "Alchemy Synth", subcategory: "Sub & Synth Bass",
    description: "Aggressive resonant bass with deep LFO-driven filter motion and noise grit.",
    settings: { morph: 0.52, harmonics: 1, cutoff: 2400, resonance: 8.4, attack: 0.003, decay: 0.56, sustain: 0.78, release: 0.24, detune: 12, sub: 0.55, lfoRate: 2.4, lfoDepth: 0.88, noise: 0.1, waveform: 3, chorus: 0.1, glide: 0.14 },
  },
  {
    id: "synth-poly-vi-warm-brass", name: "Poly-VI Warm Brass", category: "Synthesizer", subcategory: "Brass & Poly Leads",
    description: "Classic poly brass with a soft saw stack and a rounded release.",
    settings: { morph: 0.34, harmonics: 0.72, cutoff: 5100, resonance: 1.9, attack: 0.035, decay: 0.64, sustain: 0.7, release: 0.56, detune: 8, sub: 0.14, lfoRate: 0.24, lfoDepth: 0.08, noise: 0.02, waveform: 4, chorus: 0.35, glide: 0.04 },
  },
  {
    id: "synth-dx-80s-electric-piano", name: "DX-80s Electric Piano", category: "Synthesizer", subcategory: "Keys & Plucks",
    description: "Bright, bell-edged electric keyboard sound with a crisp attack and quick decay.",
    settings: { morph: 0.82, harmonics: 0.94, cutoff: 12600, resonance: 2.6, attack: 0.002, decay: 0.72, sustain: 0.18, release: 0.62, detune: 1, sub: 0.03, lfoRate: 1.4, lfoDepth: 0.06, noise: 0.01, waveform: 1, chorus: 0.22, glide: 0 },
  },
  {
    id: "synth-bass-m1-acid-line", name: "Bass-M1 Acid Line", category: "Synthesizer", subcategory: "Synth Bass",
    description: "Compact resonant bass sequence with a bright bite and fast filter snap.",
    settings: { morph: 0.22, harmonics: 0.88, cutoff: 2400, resonance: 8.8, attack: 0.002, decay: 0.26, sustain: 0.45, release: 0.16, detune: 2, sub: 0.32, lfoRate: 0.9, lfoDepth: 0.28, noise: 0.01, waveform: 3, chorus: 0.04, glide: 0.12 },
  },
  {
    id: "synth-mini-m1-chiptune-lead", name: "Mini-M1 Chiptune Lead", category: "Synthesizer", subcategory: "Leads",
    description: "Focused square-wave arcade lead with a quick envelope and a tiny portamento.",
    settings: { morph: 0.14, harmonics: 0.62, cutoff: 7100, resonance: 1.3, attack: 0.001, decay: 0.34, sustain: 0.72, release: 0.18, detune: 0, sub: 0.1, lfoRate: 5.2, lfoDepth: 0.03, noise: 0, waveform: 3, chorus: 0.02, glide: 0.08 },
  },
  {
    id: "synth-keytar-solo-shredder", name: "Keytar Solo Shredder", category: "Synthesizer", subcategory: "Leads",
    description: "High-energy saw lead with saturated harmonics, unison width and pitch glide.",
    settings: { morph: 0.3, harmonics: 1, cutoff: 10400, resonance: 4.6, attack: 0.006, decay: 0.42, sustain: 0.82, release: 0.3, detune: 24, sub: 0.08, lfoRate: 6.2, lfoDepth: 0.16, noise: 0.02, waveform: 4, chorus: 0.32, glide: 0.42 },
  },
  {
    id: "synth-workstation-x-cinematic-strings", name: "Workstation-X Cinematic Strings", category: "Synthesizer", subcategory: "Pads & Strings",
    description: "Broad synthetic string layer with a slow swell and long release.",
    settings: { morph: 0.58, harmonics: 0.64, cutoff: 5100, resonance: 1.4, attack: 0.82, decay: 1.8, sustain: 0.84, release: 3.4, detune: 13, sub: 0.08, lfoRate: 0.16, lfoDepth: 0.24, noise: 0.025, waveform: 2, chorus: 0.64, glide: 0.16 },
  },
  {
    id: "synth-nord-style-stage-brass", name: "Nord-Style Stage Synth Brass", category: "Synthesizer", subcategory: "Brass & Poly Leads",
    description: "Fast, direct stage-brass patch with bright saw harmonics and compact sustain.",
    settings: { morph: 0.42, harmonics: 0.86, cutoff: 8400, resonance: 2.4, attack: 0.012, decay: 0.54, sustain: 0.76, release: 0.38, detune: 7, sub: 0.12, lfoRate: 0.35, lfoDepth: 0.06, noise: 0.015, waveform: 4, chorus: 0.16, glide: 0.06 },
  },
  {
    id: "synth-lush-1984-juno-chorus-pad", name: "Lush 1984 Juno Chorus Pad", category: "Synthesizer", subcategory: "Pads & Strings",
    description: "Warm analog pad with a soft attack, detuned saws and rich chorus.",
    settings: { morph: 0.28, harmonics: 0.58, cutoff: 4600, resonance: 1.1, attack: 0.56, decay: 1.8, sustain: 0.8, release: 2.8, detune: 12, sub: 0.12, lfoRate: 0.2, lfoDepth: 0.22, noise: 0.012, waveform: 4, chorus: 0.86, glide: 0.08 },
  },
  {
    id: "synth-analog-prophet-fifths", name: "Analog Prophet Fifths", category: "Synthesizer", subcategory: "Leads",
    description: "Stacked fifth lead with a bright oscillator blend and assertive filter edge.",
    settings: { morph: 0.5, harmonics: 0.9, cutoff: 7600, resonance: 3.4, attack: 0.012, decay: 0.48, sustain: 0.7, release: 0.42, detune: 9, sub: 0.08, lfoRate: 4.6, lfoDepth: 0.12, noise: 0.01, waveform: 4, chorus: 0.18, glide: 0.26 },
  },
  {
    id: "synth-percussive-organ-synth", name: "Percussive Organ Synth", category: "Synthesizer", subcategory: "Keys & Plucks",
    description: "Harmonic, fast-playing synth organ with a clean attack and little release.",
    settings: { morph: 0.68, harmonics: 0.8, cutoff: 6700, resonance: 1.4, attack: 0.001, decay: 0.22, sustain: 0.76, release: 0.12, detune: 1, sub: 0.06, lfoRate: 3.4, lfoDepth: 0.04, noise: 0, waveform: 2, chorus: 0.08, glide: 0 },
  },
  {
    id: "synth-hollow-square-sub", name: "Hollow Square Sub", category: "Synthesizer", subcategory: "Synth Bass",
    description: "Smooth square sub tone with a restrained low-pass and solid fundamental.",
    settings: { morph: 0.08, harmonics: 0.3, cutoff: 980, resonance: 0.8, attack: 0.004, decay: 0.38, sustain: 0.76, release: 0.2, detune: 0, sub: 0.82, lfoRate: 0.12, lfoDepth: 0.04, noise: 0, waveform: 3, chorus: 0, glide: 0.08 },
  },
  {
    id: "synth-pwm-string-machine", name: "PWM String Machine", category: "Synthesizer", subcategory: "Pads & Strings",
    description: "Bright pulse-like string ensemble with slow, animated spectral movement.",
    settings: { morph: 0.62, harmonics: 0.78, cutoff: 5800, resonance: 1.6, attack: 0.3, decay: 1.4, sustain: 0.82, release: 2.2, detune: 10, sub: 0.04, lfoRate: 0.26, lfoDepth: 0.36, noise: 0.01, waveform: 3, chorus: 0.72, glide: 0.08 },
  },
  {
    id: "synth-rez-sweep-fx", name: "Rez Sweep FX Synth", category: "Synthesizer", subcategory: "FX",
    description: "Resonant rising synth sweep with a long attack and strong filter motion.",
    settings: { morph: 0.38, harmonics: 0.72, cutoff: 9200, resonance: 10.4, attack: 1.2, decay: 1.4, sustain: 0.56, release: 2.8, detune: 5, sub: 0.14, lfoRate: 0.48, lfoDepth: 0.58, noise: 0.08, waveform: 4, chorus: 0.3, glide: 0.24 },
  },
  {
    id: "synth-plucked-pwm-bass", name: "Plucked PWM Bass", category: "Synthesizer", subcategory: "Synth Bass",
    description: "Tight pulse bass with a firm pluck transient and focused low-mid harmonics.",
    settings: { morph: 0.44, harmonics: 0.76, cutoff: 3200, resonance: 2.8, attack: 0.001, decay: 0.3, sustain: 0.36, release: 0.14, detune: 2, sub: 0.5, lfoRate: 1.4, lfoDepth: 0.16, noise: 0.01, waveform: 3, chorus: 0.04, glide: 0.04 },
  },
  {
    id: "synth-ambient-swell-fifths", name: "Ambient Swell Fifths", category: "Synthesizer", subcategory: "Pads & Strings",
    description: "Slow fifth-based pad with a gentle spectrum bloom and generous release.",
    settings: { morph: 0.74, harmonics: 0.7, cutoff: 7200, resonance: 1.2, attack: 1.6, decay: 2.1, sustain: 0.78, release: 4.2, detune: 6, sub: 0.1, lfoRate: 0.11, lfoDepth: 0.42, noise: 0.04, waveform: 2, chorus: 0.58, glide: 0.2 },
  },
  {
    id: "synth-classic-synthwave-arp", name: "Classic Synthwave Arp", category: "Synthesizer", subcategory: "Keys & Arps",
    description: "Steady analog arpeggio voice with a sharp pulse and bright saw edge.",
    settings: { morph: 0.3, harmonics: 0.88, cutoff: 7400, resonance: 3.6, attack: 0.001, decay: 0.22, sustain: 0.42, release: 0.2, detune: 4, sub: 0.08, lfoRate: 5.8, lfoDepth: 0.1, noise: 0.005, waveform: 4, chorus: 0.22, glide: 0.02 },
  },
  {
    id: "synth-dark-industrial-drone", name: "Dark Industrial Drone", category: "Synthesizer", subcategory: "FX & Drones",
    description: "Gritty sustained drone built from dense harmonics, filtered noise and low sub.",
    settings: { morph: 0.56, harmonics: 0.9, cutoff: 2200, resonance: 2.8, attack: 1.1, decay: 2.4, sustain: 0.78, release: 3.8, detune: 8, sub: 0.42, lfoRate: 0.18, lfoDepth: 0.54, noise: 0.36, waveform: 0, chorus: 0.24, glide: 0.42 },
  },
  {
    id: "synth-bright-euro-trance-lead", name: "Bright Euro Trance Lead", category: "Synthesizer", subcategory: "Leads",
    description: "High, cutting unison saw lead with brisk attack and wide chorus.",
    settings: { morph: 0.24, harmonics: 0.98, cutoff: 12400, resonance: 3.2, attack: 0.006, decay: 0.36, sustain: 0.84, release: 0.34, detune: 28, sub: 0.06, lfoRate: 5.4, lfoDepth: 0.1, noise: 0.01, waveform: 4, chorus: 0.46, glide: 0.18 },
  },
  {
    id: "synth-smooth-neo-soul-synth-keys", name: "Smooth Neo-Soul Synth Keys", category: "Synthesizer", subcategory: "Keys & Plucks",
    description: "Rounded, mellow keys with a soft attack, warm filtering and subtle chorus.",
    settings: { morph: 0.46, harmonics: 0.48, cutoff: 2900, resonance: 0.9, attack: 0.018, decay: 0.72, sustain: 0.48, release: 0.8, detune: 3, sub: 0.04, lfoRate: 0.28, lfoDepth: 0.08, noise: 0.02, waveform: 2, chorus: 0.3, glide: 0 },
  },
  {
    id: "synth-reggae-dub-synth-horn", name: "Reggae Dub Synth Horn", category: "Synthesizer", subcategory: "Brass & Poly Leads",
    description: "Compact, punchy synth horn with a warm saw stack and quick filter envelope.",
    settings: { morph: 0.34, harmonics: 0.74, cutoff: 4900, resonance: 2.2, attack: 0.02, decay: 0.46, sustain: 0.64, release: 0.26, detune: 5, sub: 0.1, lfoRate: 0.22, lfoDepth: 0.06, noise: 0.01, waveform: 4, chorus: 0.12, glide: 0.04 },
  },
];

export const SYNTH_PATCHES: Record<string, Patch> = Object.fromEntries(
  PRESETS.map((preset) => [preset.id, createSynthPatch(preset)]),
);

const SECONDARY_SYNTH_CATEGORIES = new Set([
  "Hip-Hop & Trap",
  "Worship & Gospel",
  "Reggae & Dub",
  "FX & Transitions",
]);
const EXCLUDED_CATEGORY = /piano|organ|drum|guitar|bass|orchestral|string|brass|wind|bell|mallet/i;
const SYNTH_TERMS = /synth|pad|lead|electronic|oscillator|sweep|siren|drone|arp/i;

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function getSynthPreviewImageUrl(
  patch: Pick<Patch, "id" | "name" | "category" | "icon" | "desc" | "synthEngine">,
): string | undefined {
  if (!SYNTH_PREVIEW_IMAGES.length || EXCLUDED_CATEGORY.test(patch.category)) {
    return undefined;
  }

  const primarySynthCategory =
    patch.category === "Synthesizer" || patch.category === "Alchemy Synth";
  const secondarySynth =
    SECONDARY_SYNTH_CATEGORIES.has(patch.category) &&
    (patch.synthEngine === "morph-additive" ||
      ((patch.icon === "audio-waveform" || patch.icon === "gamepad-2") &&
        SYNTH_TERMS.test(`${patch.name} ${patch.desc}`)));

  if (!primarySynthCategory && !secondarySynth) return undefined;
  return SYNTH_PREVIEW_IMAGES[stableHash(patch.id) % SYNTH_PREVIEW_IMAGES.length];
}
