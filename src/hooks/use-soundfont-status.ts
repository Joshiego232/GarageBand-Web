"use client";

import { useEffect, useState } from "react";
import {
  getSoundFontStatus,
  type SoundFontStatus,
} from "@/lib/daw/soundfont-engine";

export function useSoundFontStatus(trackId: string): SoundFontStatus | undefined {
  const [snapshot, setSnapshot] = useState(() => ({
    trackId,
    status: getSoundFontStatus(trackId),
  }));
  useEffect(() => {
    const handleStatus = (event: Event) => {
      const next = (event as CustomEvent<SoundFontStatus>).detail;
      if (next.trackId === trackId) setSnapshot({ trackId, status: next });
    };
    window.addEventListener("webband:soundfont-status", handleStatus);
    return () => window.removeEventListener("webband:soundfont-status", handleStatus);
  }, [trackId]);
  return snapshot.trackId === trackId
    ? snapshot.status
    : getSoundFontStatus(trackId);
}
