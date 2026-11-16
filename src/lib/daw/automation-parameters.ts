import { PEDAL_BY_ID } from "./pedalboard";
import { uid, type AutomationLane, type Track } from "./types";

export interface AutomationParameter {
  id: string;
  label: string;
  group: string;
  min: number;
  max: number;
  value: number;
  unit?: string;
  color: string;
  step?: boolean;
  scale?: "linear" | "log";
}

const colors = {
  volume: "#f4d44d",
  pan: "#49d69a",
  mute: "#58a6ff",
  synth: "#c58cff",
  fx: "#ff9b61",
  master: "#63d9ef",
};

export function automationParameters(track?: Track, master = false): AutomationParameter[] {
  if (master) {
    return [
      { id: "volume", label: "Volume", group: "Master", min: 0.0001, max: 1.25, value: 1, unit: "dB", color: colors.volume, scale: "log" },
      { id: "pan", label: "Pan / Balance", group: "Master", min: -1, max: 1, value: 0, unit: "L/R", color: colors.pan },
      { id: "tempo", label: "Tempo", group: "Master", min: 30, max: 260, value: 100, unit: "BPM", color: colors.master },
      { id: "filterCutoff", label: "Master Low-Pass Cutoff", group: "Master FX", min: 20, max: 20000, value: 20000, unit: "Hz", color: colors.fx, scale: "log" },
      { id: "reverbWet", label: "Master Reverb Wet", group: "Master FX", min: 0, max: 1, value: 0.8, unit: "%", color: colors.fx },
    ];
  }
  if (!track) return [];
  const parameters: AutomationParameter[] = [
    { id: "volume", label: "Volume", group: "Main", min: 0.0001, max: 1.25, value: track.volume, unit: "dB", color: colors.volume, scale: "log" },
    { id: "pan", label: "Pan", group: "Main", min: -1, max: 1, value: track.pan, unit: "L/R", color: colors.pan },
    { id: "mute", label: "Mute", group: "Main", min: 0, max: 1, value: track.mute ? 1 : 0, step: true, color: colors.mute },
    { id: "param:cutoff", label: "Filter Cutoff", group: "Smart Controls", min: 80, max: 16000, value: track.params.cutoff ?? 12000, unit: "Hz", color: colors.synth, scale: "log" },
    { id: "param:resonance", label: "Resonance", group: "Smart Controls", min: 0.1, max: 16, value: track.params.resonance ?? 0.7, color: colors.synth },
    { id: "param:chorusDepth", label: "Chorus Depth", group: "Smart Controls", min: 0, max: 1, value: track.params.chorusDepth ?? 0.5, unit: "%", color: colors.synth },
    { id: "eq:lowGain", label: "EQ Low Gain", group: "Track EQ", min: -12, max: 12, value: track.eq.lowGain, unit: "dB", color: colors.fx },
    { id: "eq:midGain", label: "EQ Mid Gain", group: "Track EQ", min: -12, max: 12, value: track.eq.midGain, unit: "dB", color: colors.fx },
    { id: "eq:highGain", label: "EQ High Gain", group: "Track EQ", min: -12, max: 12, value: track.eq.highGain, unit: "dB", color: colors.fx },
    { id: "param:reverb", label: "Bus 1 (Reverb) Send", group: "Sends", min: 0, max: 1, value: track.params.reverb ?? 0, unit: "%", color: colors.fx },
    { id: "param:delay", label: "Bus 2 (Delay) Send", group: "Sends", min: 0, max: 1, value: track.params.delay ?? 0, unit: "%", color: colors.fx },
  ];
  for (const pedal of track.pedalboard ?? []) {
    const definition = PEDAL_BY_ID[pedal.pedalId];
    if (!pedal.enabled || !definition) continue;
    for (const control of definition.controls) {
      if (!definition.automationControls.includes(control.id)) continue;
      parameters.push({
        id: `pedal:${pedal.id}:${control.id}`,
        label: `${definition.name} > ${control.label}`,
        group: "Pedalboard",
        min: 0,
        max: 1,
        value: pedal.params[control.id] ?? control.defaultValue,
        unit: "%",
        color: colors.fx,
      });
    }
  }
  return parameters;
}

export function createAutomationLane(
  ownerId: string,
  parameter: AutomationParameter,
  scope: "track" | "region" = "track",
  regionId?: string
): AutomationLane {
  return {
    id: uid(),
    ownerId,
    scope,
    regionId,
    parameterId: parameter.id,
    name: parameter.label,
    unit: parameter.unit,
    min: parameter.min,
    max: parameter.max,
    color: parameter.color,
    step: parameter.step,
    scale: parameter.scale,
    points: [{ id: uid(), tick: 0, value: parameter.value }],
  };
}

export function displayAutomationValue(value: number, unit?: string): string {
  if (unit === "dB") {
    if (value <= 0.001) return "-∞ dB";
    return `${(20 * Math.log10(value)).toFixed(1)} dB`;
  }
  if (unit === "%") return `${Math.round(value * 100)}%`;
  if (unit === "Hz") return `${Math.round(value).toLocaleString()} Hz`;
  if (unit === "L/R") return value < 0
    ? `${Math.round(Math.abs(value) * 100)}% L`
    : `${Math.round(value * 100)}% R`;
  if (unit === "BPM") return `${Math.round(value)} BPM`;
  return `${Number(value.toFixed(2))}${unit ? ` ${unit}` : ""}`;
}
