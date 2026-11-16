import { uid, type PedalCategory, type PedalId, type PedalInstance } from "./types";

export interface PedalControl {
  id: string;
  label: string;
  defaultValue: number;
}

export interface PedalDefinition {
  id: PedalId;
  name: string;
  subtitle: string;
  category: PedalCategory;
  color: string;
  face: string;
  ink: string;
  led: string;
  controls: PedalControl[];
  automationControls: string[];
}

const knob = (id: string, label: string, value: number): PedalControl => ({
  id,
  label,
  defaultValue: value,
});

export const PEDAL_CATEGORIES: PedalCategory[] = [
  "Distortion",
  "Modulation",
  "Delay",
  "Reverb",
  "Filter",
  "Dynamics",
];

export const PEDAL_DEFINITIONS: PedalDefinition[] = [
  {
    id: "squash-compressor",
    name: "SQUASH",
    subtitle: "Optical compressor",
    category: "Dynamics",
    color: "#858b90",
    face: "#c5c6c2",
    ink: "#202326",
    led: "#ff3c39",
    controls: [knob("sustain", "Sustain", 0.48), knob("attack", "Attack", 0.28), knob("level", "Level", 0.62)],
    automationControls: ["sustain", "attack", "level"],
  },
  {
    id: "vintage-drive",
    name: "VINTAGE DRIVE",
    subtitle: "Valve overdrive",
    category: "Distortion",
    color: "#a84d24",
    face: "#df7136",
    ink: "#27150f",
    led: "#ffb13b",
    controls: [knob("drive", "Drive", 0.4), knob("tone", "Tone", 0.56), knob("output", "Output", 0.68)],
    automationControls: ["tone", "output"],
  },
  {
    id: "retro-chorus",
    name: "RETRO CHORUS",
    subtitle: "Analog modulation",
    category: "Modulation",
    color: "#116a70",
    face: "#278e91",
    ink: "#071c20",
    led: "#59f7eb",
    controls: [knob("rate", "Rate", 0.3), knob("depth", "Depth", 0.52), knob("intensity", "Intensity", 0.55)],
    automationControls: ["rate", "depth", "intensity"],
  },
  {
    id: "phase-tripper",
    name: "PHASE TRIPPER",
    subtitle: "Four-stage phaser",
    category: "Modulation",
    color: "#482d76",
    face: "#7854b5",
    ink: "#160c26",
    led: "#ff6dcd",
    controls: [knob("speed", "Speed", 0.26), knob("feedback", "Feedback", 0.28), knob("color", "Color", 0.5)],
    automationControls: ["speed", "feedback", "color"],
  },
  {
    id: "blue-echo",
    name: "BLUE ECHO",
    subtitle: "Tape delay",
    category: "Delay",
    color: "#214caa",
    face: "#3673d0",
    ink: "#0b1835",
    led: "#61d9ff",
    controls: [knob("time", "Time", 0.32), knob("feedback", "Feedback", 0.34), knob("mix", "Mix", 0.32), knob("flutter", "Flutter", 0.14)],
    automationControls: ["time", "feedback", "mix", "flutter"],
  },
  {
    id: "spring-box",
    name: "SPRING BOX",
    subtitle: "Mechanical spring reverb",
    category: "Reverb",
    color: "#705139",
    face: "#9b7952",
    ink: "#25180f",
    led: "#ffb34e",
    controls: [knob("decay", "Decay", 0.46), knob("tone", "Tone", 0.58), knob("mix", "Mix", 0.3)],
    automationControls: ["tone", "mix"],
  },
  {
    id: "auto-funk",
    name: "AUTO-FUNK",
    subtitle: "Envelope filter",
    category: "Filter",
    color: "#a58116",
    face: "#e5c846",
    ink: "#1d1b0e",
    led: "#ffec73",
    controls: [knob("sensitivity", "Sensitivity", 0.55), knob("resonance", "Resonance", 0.62), knob("range", "Range", 0.54)],
    automationControls: ["resonance"],
  },
  {
    id: "total-tremolo",
    name: "TOTAL TREMOLO",
    subtitle: "Optical amplitude modulator",
    category: "Modulation",
    color: "#a33532",
    face: "#d6534a",
    ink: "#260d0b",
    led: "#ff4c3f",
    controls: [knob("rate", "Rate", 0.32), knob("depth", "Depth", 0.48), knob("shape", "Wave shape", 0.12)],
    automationControls: ["rate", "depth"],
  },
];

export const PEDAL_BY_ID: Record<PedalId, PedalDefinition> = Object.fromEntries(
  PEDAL_DEFINITIONS.map((definition) => [definition.id, definition]),
) as Record<PedalId, PedalDefinition>;

export function createPedalInstance(pedalId: PedalId): PedalInstance {
  const definition = PEDAL_BY_ID[pedalId];
  return {
    id: uid(),
    pedalId,
    enabled: true,
    params: Object.fromEntries(definition.controls.map((control) => [control.id, control.defaultValue])),
  };
}
