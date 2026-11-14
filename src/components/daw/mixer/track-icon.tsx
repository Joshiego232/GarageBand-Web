"use client";

// ============================================================
// TrackIcon - maps track/instrument icon keys to lucide icons.
// Shared by the mixer strips, smart controls and timeline.
// ============================================================

import type { CSSProperties } from "react";
import {
  Piano,
  AudioWaveform,
  Guitar,
  Drum,
  Speaker,
  Bell,
  Music,
  Wind,
  Grid3x3,
  Gamepad2,
  Mic,
  Folder,
  AudioLines,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

const TRACK_ICONS: Record<string, LucideIcon> = {
  piano: Piano,
  "audio-waveform": AudioWaveform,
  guitar: Guitar,
  drum: Drum,
  speaker: Speaker,
  bell: Bell,
  music: Music,
  wind: Wind,
  "grid-3x3": Grid3x3,
  "gamepad-2": Gamepad2,
  mic: Mic,
  folder: Folder,
  "audio-lines": AudioLines,
  "sliders-horizontal": SlidersHorizontal,
};

export function TrackIcon({
  icon,
  size = 14,
  className,
  style,
}: {
  icon: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const Icon = TRACK_ICONS[icon] ?? Music;
  return <Icon size={size} className={className} style={style} aria-hidden="true" />;
}
