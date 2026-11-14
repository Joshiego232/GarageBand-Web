// ============================================================
// GarageBand-inspired visual theme
// ============================================================

export const C = {
  appBg: "#19191b",
  panel: "#232327",
  panelDeep: "#1d1d20",
  panelHeader: "#2a2a2f",
  border: "#0e0e10",
  borderLight: "#3a3a41",
  text: "#d4d4d8",
  textDim: "#8e8e96",
  textFaint: "#5c5c64",
  accent: "#ffb648", // LCD amber
  accentDim: "#b97f2a",
  record: "#e5484d",
  play: "#ffffff",
  selected: "#f5c15c",
};

// GarageBand track color palette
export const TRACK_COLORS = [
  "#e0533d", // red
  "#e08e3c", // orange
  "#d9b13b", // yellow
  "#8fb44a", // green (midi default)
  "#3f9d8b", // teal
  "#4a90d9", // blue (audio default)
  "#7a6fd0", // violet
  "#c65cb8", // pink
];

export const MIDI_DEFAULT_COLOR = "#8fb44a";
export const AUDIO_DEFAULT_COLOR = "#4a90d9";

export function defaultColorFor(type: "midi" | "audio"): string {
  return type === "midi" ? MIDI_DEFAULT_COLOR : AUDIO_DEFAULT_COLOR;
}

/** Region body / header colors derived from a track color (canvas drawing) */
export function regionColors(trackColor: string, type: "midi" | "audio") {
  const base = type === "midi" ? "#69a94e" : "#4a90d9";
  return {
    bodyTop: type === "midi" ? "#7cbf5e" : "#5ca1e6",
    bodyBottom: type === "midi" ? "#55913c" : "#3a78bd",
    header: type === "midi" ? "#3e7530" : "#2d5f96",
    headerText: "#eaf3e4",
    edge: trackColor,
  };
}
