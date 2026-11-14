"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AudioWaveform,
  Music2,
  Play,
  Radio,
  Square,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useDAW } from "@/lib/daw/store";
import { engine } from "@/lib/daw/engine";
import { barTicks } from "@/lib/daw/utils";
import { TrackIcon } from "@/components/daw/mixer/track-icon";
import type { Region, Track } from "@/lib/daw/types";

interface Scene {
  index: number;
  label: string;
  clips: { track: Track; region: Region }[];
}

export function LiveLoopsPanel() {
  const project = useDAW((state) => state.project);
  const setUI = useDAW((state) => state.setUI);
  const [activeByTrack, setActiveByTrack] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => () => engine.stopLiveLoops(), []);

  const tracks = project.tracks.filter(
    (track) => (track.role ?? "track") === "track" && track.type !== undefined
  );
  const ticksPerBar = barTicks(project.timeSig);

  const scenes = useMemo<Scene[]>(() => {
    const sceneIndices = [...new Set(
      tracks.flatMap((track) =>
        track.regions.map((region) => Math.max(0, Math.floor(region.start / ticksPerBar)))
      )
    )].sort((a, b) => a - b).slice(0, 12);

    return sceneIndices.map((index, sceneNumber) => ({
      index,
      label: `Scene ${sceneNumber + 1}`,
      clips: tracks.flatMap((track) => {
        const region = track.regions.find(
          (item) => Math.max(0, Math.floor(item.start / ticksPerBar)) === index
        );
        return region ? [{ track, region }] : [];
      }),
    }));
  }, [tracks, ticksPerBar]);

  const updateActiveFromEngine = () => {
    const next: Record<string, string> = {};
    for (const clip of engine.getLiveClipRefs()) next[clip.trackId] = clip.regionId;
    setActiveByTrack(next);
  };

  const launchScene = async (scene: Scene) => {
    if (!scene.clips.length || busy) return;
    setBusy(true);
    try {
      const refs = scene.clips.map(({ track, region }) => ({
        trackId: track.id,
        regionId: region.id,
      }));
      await engine.launchLiveScene(refs);
      updateActiveFromEngine();
      toast.success(`Launched ${scene.label}`);
    } catch (error) {
      console.error("Live Loops scene launch failed", error);
      toast.error("Could not launch this Live Loops scene");
    } finally {
      setBusy(false);
    }
  };

  const toggleClip = async (track: Track, region: Region) => {
    if (busy) return;
    if (activeByTrack[track.id] === region.id) {
      engine.stopLiveClip(track.id);
      setActiveByTrack((current) => {
        const next = { ...current };
        delete next[track.id];
        return next;
      });
      return;
    }

    setBusy(true);
    try {
      await engine.launchLiveClip(track.id, region.id);
      updateActiveFromEngine();
    } catch (error) {
      console.error("Live Loops clip launch failed", error);
      toast.error(`Could not launch ${region.name}`);
    } finally {
      setBusy(false);
    }
  };

  const stopAll = () => {
    engine.stopLiveLoops();
    setActiveByTrack({});
  };

  return (
    <section className="flex-1 min-h-0 flex flex-col bg-[#19191d] text-zinc-200" aria-label="Live Loops Grid">
      <header className="h-11 shrink-0 flex items-center gap-2 px-4 border-b border-black/60 bg-[#232327]">
        <Radio size={15} className="text-[#ffb648]" />
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-zinc-100">Live Loops</p>
          <p className="text-[9px] text-zinc-500">Launch MIDI and audio clips in synchronized scenes</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden sm:inline text-[9px] tabular-nums text-zinc-500">
            {Object.keys(activeByTrack).length} active
          </span>
          <button
            type="button"
            onClick={stopAll}
            disabled={!Object.keys(activeByTrack).length}
            className="h-7 px-2.5 rounded border border-black/40 bg-[#303036] text-[10px] text-zinc-300 hover:bg-[#3a3a41] disabled:opacity-35 inline-flex items-center gap-1.5"
          >
            <Square size={10} fill="currentColor" /> Stop All
          </button>
          <button
            type="button"
            onClick={() => {
              stopAll();
              setUI({ panels: { ...useDAW.getState().ui.panels, liveLoops: false } });
            }}
            aria-label="Return to arrangement"
            title="Return to arrangement"
            className="h-7 w-7 rounded text-zinc-500 hover:text-zinc-100 hover:bg-white/5 flex items-center justify-center"
          >
            <X size={14} />
          </button>
        </div>
      </header>

      {tracks.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
          <Music2 size={26} className="text-zinc-700" />
          <p className="text-[12px] text-zinc-400">Add tracks and create a few regions first.</p>
          <p className="text-[10px] text-zinc-600">Each arrangement start position becomes a scene column.</p>
          <button
            type="button"
            onClick={() => setUI({ modal: "addTrack" })}
            className="mt-2 h-8 px-3 rounded bg-[#ffb648]/15 border border-[#ffb648]/35 text-[10px] text-[#ffcf8a]"
          >
            Add Track
          </button>
        </div>
      ) : scenes.length === 0 ? (
        <div className="flex-1 grid place-items-center text-[11px] text-zinc-600">
          Create MIDI or audio regions in the arrangement to populate the Live Loops grid.
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="min-w-max">
            <div className="sticky top-0 z-10 flex border-b border-black/50 bg-[#222226]">
              <div className="w-52 shrink-0 px-3 py-2 text-[9px] uppercase tracking-wider text-zinc-500 border-r border-black/40">
                Track
              </div>
              {scenes.map((scene) => (
                <div key={scene.index} className="w-48 shrink-0 p-2 border-r border-black/30 flex flex-col gap-1.5">
                  <div className="text-[10px] font-semibold text-zinc-200">{scene.label}</div>
                  <div className="text-[8px] text-zinc-600">Bar {scene.index + 1}</div>
                  <button
                    type="button"
                    onClick={() => void launchScene(scene)}
                    disabled={busy || scene.clips.length === 0}
                    className="h-7 rounded border border-[#8fb44a]/40 bg-[#8fb44a]/10 text-[9px] font-medium text-[#c6e88a] hover:bg-[#8fb44a]/20 disabled:opacity-35 inline-flex items-center justify-center gap-1.5"
                  >
                    <Play size={10} fill="currentColor" /> Launch Scene
                  </button>
                </div>
              ))}
            </div>

            {tracks.map((track) => (
              <div key={track.id} className="flex border-b border-black/30">
                <div className="w-52 shrink-0 border-r border-black/40 bg-[#222226] px-3 py-2 flex items-center gap-2">
                  <span className="size-7 rounded flex items-center justify-center shrink-0" style={{ backgroundColor: `${track.color}22` }}>
                    <TrackIcon icon={track.icon} size={14} style={{ color: track.color }} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[10px] text-zinc-200 truncate">{track.name}</p>
                    <p className="text-[8px] text-zinc-600">{track.type === "midi" ? (track.sampleBufferId ? "Quick Sampler" : "MIDI") : "Audio"}</p>
                  </div>
                </div>
                {scenes.map((scene) => {
                  const clip = scene.clips.find((item) => item.track.id === track.id);
                  const active = !!clip && activeByTrack[track.id] === clip.region.id;
                  return (
                    <div key={scene.index} className="w-48 shrink-0 border-r border-black/30 p-2">
                      {clip ? (
                        <button
                          type="button"
                          onClick={() => void toggleClip(track, clip.region)}
                          disabled={busy}
                          aria-pressed={active}
                          title={`${active ? "Stop" : "Launch"} ${clip.region.name}`}
                          className={`w-full h-16 rounded-md border p-2 text-left flex flex-col justify-between transition-colors disabled:opacity-50 ${
                            active
                              ? "border-[#ffb648]/60 bg-[#ffb648]/15 shadow-[0_0_14px_rgba(255,182,72,0.08)]"
                              : "border-black/40 bg-[#29292f] hover:border-zinc-600 hover:bg-[#303036]"
                          }`}
                        >
                          <div className="flex items-start gap-2 min-w-0">
                            {clip.region.type === "audio" ? (
                              <AudioWaveform size={12} className="text-[#75b3e8] shrink-0 mt-0.5" />
                            ) : (
                              <Music2 size={12} className="text-[#a4c66d] shrink-0 mt-0.5" />
                            )}
                            <span className="text-[10px] text-zinc-200 truncate">{clip.region.name}</span>
                          </div>
                          <div className="flex items-center justify-between text-[8px] text-zinc-600">
                            <span>{clip.region.type === "midi" ? `${clip.region.notes?.length ?? 0} notes` : `${(clip.region.sampleLength ?? 0).toFixed(1)} s`}</span>
                            <span className={active ? "text-[#ffcf8a]" : "text-zinc-600"}>{active ? "PLAYING" : "LAUNCH"}</span>
                          </div>
                        </button>
                      ) : (
                        <div className="h-16 rounded-md border border-dashed border-[#34343a] bg-[#202024]/60 flex items-center justify-center text-[8px] text-zinc-700">
                          Empty slot
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      <footer className="h-8 shrink-0 px-3 flex items-center border-t border-black/50 bg-[#222226]">
        <p className="text-[9px] text-zinc-600">
          Scene launch starts all available clips together. Individual clip launches quantize to the next bar. Stop All ends the active clips; the arrangement stays untouched.
        </p>
      </footer>
    </section>
  );
}
