export const TRACK_COLOR_PALETTE = [
  "#E5484D", "#D13438", "#C64B32", "#E07832", "#F08C32", "#E6B422",
  "#D4AC0D", "#8FA834", "#28B463", "#2D9B68", "#17A589", "#168C8C",
  "#2B7DE9", "#3478C7", "#4169A1", "#6256A5", "#8257B5", "#A653A6",
  "#D34F91", "#E45C79", "#A0A0A5", "#73737A", "#505057", "#D0D0D4",
] as const;

export const DEFAULT_TRACK_COLORS = {
  audio: "#2B7DE9",
  midi: "#28B463",
  drummer: "#D4AC0D",
} as const;

export function mixHex(color: string, target: string, amount: number): string {
  const parse = (value: string) => {
    const hex = value.replace("#", "");
    if (!/^[\da-f]{6}$/i.test(hex)) return [40, 40, 45];
    return [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16));
  };
  const from = parse(color);
  const to = parse(target);
  const ratio = Math.max(0, Math.min(1, amount));
  return `#${from.map((channel, index) =>
    Math.round(channel + (to[index] - channel) * ratio)
      .toString(16)
      .padStart(2, "0")
  ).join("")}`;
}

export function hexToRgba(color: string, alpha: number): string {
  const hex = color.replace("#", "");
  if (!/^[\da-f]{6}$/i.test(hex)) return `rgba(40,40,45,${alpha})`;
  const [r, g, b] = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16));
  return `rgba(${r},${g},${b},${alpha})`;
}
