"use client";

import { useEffect, useState } from "react";
import {
  FolderPlus,
  Layers3,
  Maximize2,
  Minimize2,
  Plus,
  SlidersHorizontal,
  Speaker,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useDAW } from "@/lib/daw/store";
import { engine } from "@/lib/daw/engine";
import { Fader } from "@/components/daw/controls/fader";
import { Meter } from "@/components/daw/controls/meter";
import { ChannelStrip } from "./channel-strip";

// Re-exported for timeline track headers and dialogs.
export { TrackIcon } from "./track-icon";

export function MixerPanel() {
  const [expanded, setExpanded] = useState(false);
  const [stackName, setStackName] = useState("");
  const [selectedForStack, setSelectedForStack] = useState<string[]>([]);
  const [masteringOpen, setMasteringOpen] = useState(false);

  useEffect(() => {
    const expand = () => setExpanded(true);
    window.addEventListener("daw:mixer-expand", expand);
    return () => window.removeEventListener("daw:mixer-expand", expand);
  }, []);

  const project = useDAW((state) => state.project);
  const selectedTrackId = useDAW((state) => state.ui.selectedTrackId);
  const togglePanel = useDAW((state) => state.togglePanel);
  const createAuxBus = useDAW((state) => state.createAuxBus);
  const createVca = useDAW((state) => state.createVca);
  const createTrackStack = useDAW((state) => state.createTrackStack);
  const removeTrackStack = useDAW((state) => state.removeTrackStack);
  const tracks = project.tracks.filter((track) => track.role !== "folder");
  const selectedTrack = tracks.find((track) => track.id === selectedTrackId) ?? null;
  const buses = tracks.filter((track) => track.role === "aux");
  const vcas = tracks.filter((track) => track.role === "vca");
  const stacks = project.stacks ?? [];

  const addBus = () => {
    const id = createAuxBus();
    useDAW.getState().selectTrack(id);
    toast.success("Aux bus added");
  };

  const addVca = () => {
    const id = createVca();
    useDAW.getState().selectTrack(id);
    toast.success("VCA fader added");
  };

  const makeStack = (type: "folder" | "summing") => {
    const result = createTrackStack(stackName, type, selectedForStack);
    if (!result) {
      toast.error("Select at least two regular tracks to create a stack");
      return;
    }
    setSelectedForStack([]);
    setStackName("");
    toast.success(type === "summing" ? "Summing stack created and routed to its bus" : "Folder stack created");
  };

  const toggleStackMember = (id: string, checked: boolean) => {
    setSelectedForStack((current) =>
      checked ? [...new Set([...current, id])] : current.filter((item) => item !== id)
    );
  };

  return (
    <section
      className={
        expanded
          ? "fixed inset-0 z-[80] h-screen w-screen bg-[#151518] text-zinc-200 flex flex-col"
          : "h-[290px] w-full border-t border-black/60 bg-[#1d1d20] text-zinc-200 flex flex-col shrink-0"
      }
      aria-label="Mixer console"
    >
      <header className="min-h-9 shrink-0 flex flex-wrap items-center gap-2 px-3 py-1.5 border-b border-black/50 bg-[#212124]">
        <Speaker size={13} className="text-[#ffb648]" aria-hidden="true" />
        <span className="text-[11px] font-semibold tracking-wide text-zinc-200">Mixer Console</span>
        <span className="text-[10px] text-zinc-500 truncate max-w-[180px]">{project.name}</span>
        <span className="text-[10px] text-zinc-600">
          {tracks.length} channels · {buses.length} aux · {vcas.length} VCA
        </span>
        <AudioOutputSelector />
        <button
          type="button"
          onClick={() => setMasteringOpen(true)}
          className="hidden sm:inline-flex h-7 px-2 rounded border border-[#ffb648]/30 bg-[#ffb648]/10 text-[10px] text-[#ffcf8a] hover:bg-[#ffb648]/15"
        >
          Mastering Assistant
        </button>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={addBus} className="h-7 px-2 rounded border border-[#4ca8a0]/35 bg-[#4ca8a0]/10 text-[10px] text-[#8bd4c9] hover:bg-[#4ca8a0]/20 inline-flex items-center gap-1">
            <Plus size={11} /> Aux
          </button>
          <button type="button" onClick={addVca} className="h-7 px-2 rounded border border-[#b38ad9]/35 bg-[#b38ad9]/10 text-[10px] text-[#d5b7f3] hover:bg-[#b38ad9]/20 inline-flex items-center gap-1">
            <SlidersHorizontal size={11} /> VCA
          </button>
          <button type="button" onClick={() => setExpanded((value) => !value)} aria-label={expanded ? "Exit full mixer" : "Open full mixer"} title={expanded ? "Exit full mixer" : "Open full mixer"} className="h-7 w-7 rounded flex items-center justify-center border border-black/40 text-zinc-400 hover:bg-[#34343b] hover:text-zinc-100">
            {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <button type="button" onClick={() => expanded ? setExpanded(false) : togglePanel("mixer")} aria-label="Close mixer" title="Close mixer" className="h-7 w-7 rounded flex items-center justify-center text-zinc-500 hover:text-zinc-100 hover:bg-[#34343b]">
            <X size={13} />
          </button>
        </div>
      </header>

      <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-1.5 border-b border-black/30 bg-[#1b1b1e]">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Track stacks</span>
        <input
          value={stackName}
          onChange={(event) => setStackName(event.target.value)}
          placeholder="Stack name"
          aria-label="New track stack name"
          className="h-7 w-32 rounded border border-black/50 bg-[#29292f] px-2 text-[10px] text-zinc-200 outline-none focus:border-[#ffb648]/50"
        />
        <button type="button" disabled={selectedForStack.length < 2} onClick={() => makeStack("folder")} className="h-7 px-2 rounded border border-black/40 bg-[#29292f] text-[10px] text-zinc-300 disabled:opacity-35 hover:bg-[#36363d] inline-flex items-center gap-1">
          <FolderPlus size={11} /> Folder
        </button>
        <button type="button" disabled={selectedForStack.length < 2} onClick={() => makeStack("summing")} className="h-7 px-2 rounded border border-black/40 bg-[#29292f] text-[10px] text-zinc-300 disabled:opacity-35 hover:bg-[#36363d] inline-flex items-center gap-1">
          <Layers3 size={11} /> Summing
        </button>
        <span className="text-[9px] text-zinc-600">{selectedForStack.length} selected</span>
        <div className="flex flex-wrap items-center gap-1 ml-auto">
          {stacks.map((stack) => (
            <span key={stack.id} className="inline-flex items-center gap-1 rounded border border-[#596d8b]/40 bg-[#596d8b]/10 px-2 py-1 text-[9px] text-[#a8bad7]">
              {stack.type === "summing" ? "SUM" : "FOLDER"} · {stack.name} ({stack.trackIds.length})
              <button type="button" onClick={() => removeTrackStack(stack.id)} aria-label={`Remove ${stack.name}`} title="Remove stack" className="text-zinc-500 hover:text-red-300">
                <Trash2 size={10} />
              </button>
            </span>
          ))}
        </div>
      </div>

      {masteringOpen && <MasteringAssistant onClose={() => setMasteringOpen(false)} />}

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 flex overflow-x-auto overflow-y-hidden [scrollbar-width:thin] [&::-webkit-scrollbar]:h-[7px] [&::-webkit-scrollbar-track]:bg-[#161619] [&::-webkit-scrollbar-thumb]:bg-[#3a3a41] [&::-webkit-scrollbar-thumb]:rounded-full">
            {tracks.length === 0 && (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-xs text-zinc-600">Add a track to start mixing</p>
              </div>
            )}
            {tracks.map((track) => (
              <div key={track.id} className="relative shrink-0">
                {track.role === "track" || !track.role ? (
                  <label className="absolute z-10 top-1 right-1 flex items-center gap-1 rounded bg-black/50 px-1 py-0.5 text-[8px] text-zinc-400" title="Select this track for a stack">
                    <input type="checkbox" checked={selectedForStack.includes(track.id)} onChange={(event) => toggleStackMember(track.id, event.target.checked)} className="h-3 w-3 accent-[#ffb648]" />
                    Stack
                  </label>
                ) : null}
                <ChannelStrip track={track} selected={track.id === selectedTrackId} />
              </div>
            ))}
            <MasterStrip />
          </div>
          <p className="shrink-0 border-t border-black/30 px-3 py-1 text-[9px] text-zinc-600">
            Select two or more tracks, then create a folder or summing stack. Summing stacks create a real Aux channel and route the member tracks through it.
          </p>
        </div>

        {expanded && (
          <RoutingInspector
            track={selectedTrack}
            buses={buses}
            vcas={vcas}
          />
        )}
      </div>
    </section>
  );
}

function RoutingInspector({
  track,
  buses,
  vcas,
}: {
  track: ReturnType<typeof useDAW.getState>["project"]["tracks"][number] | null;
  buses: ReturnType<typeof useDAW.getState>["project"]["tracks"];
  vcas: ReturnType<typeof useDAW.getState>["project"]["tracks"];
}) {
  const setTrackRouting = useDAW((state) => state.setTrackRouting);
  if (!track) {
    return <aside className="w-64 shrink-0 border-l border-black/40 bg-[#1c1c20] p-3 text-[10px] text-zinc-600">Select a channel to edit its routing.</aside>;
  }
  if (track.role === "vca") {
    return (
      <aside className="w-64 shrink-0 border-l border-black/40 bg-[#1c1c20] p-3 space-y-3">
        <p className="text-[11px] font-semibold text-zinc-200">VCA Control</p>
        <p className="text-[10px] leading-relaxed text-zinc-500">This fader scales assigned channel levels without changing their individual volume values or send settings.</p>
        <div className="rounded border border-[#b38ad9]/30 bg-[#b38ad9]/10 p-2 text-[10px] text-[#d5b7f3]">VCA: {track.name}</div>
      </aside>
    );
  }
  return (
    <aside className="w-64 shrink-0 border-l border-black/40 bg-[#1c1c20] p-3 space-y-4">
      <div>
        <p className="text-[11px] font-semibold text-zinc-200">Channel Routing</p>
        <p className="text-[9px] text-zinc-500 mt-0.5 truncate">{track.name}</p>
      </div>
      <label className="block space-y-1.5">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Audio output</span>
        <select
          value={track.outputBusId ?? ""}
          onChange={(event) => setTrackRouting(track.id, event.target.value || null, track.vcaId ?? null)}
          className="w-full h-8 rounded border border-black/50 bg-[#29292f] px-2 text-[10px] text-zinc-200 outline-none focus:border-[#4ca8a0]/60"
        >
          <option value="">Stereo Out</option>
          {buses.filter((bus) => bus.id !== track.id).map((bus) => (
            <option key={bus.id} value={bus.id}>{bus.name}</option>
          ))}
        </select>
      </label>
      <label className="block space-y-1.5">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">VCA assignment</span>
        <select
          value={track.vcaId ?? ""}
          onChange={(event) => setTrackRouting(track.id, track.outputBusId ?? null, event.target.value || null)}
          className="w-full h-8 rounded border border-black/50 bg-[#29292f] px-2 text-[10px] text-zinc-200 outline-none focus:border-[#b38ad9]/60"
        >
          <option value="">No VCA</option>
          {vcas.map((vca) => <option key={vca.id} value={vca.id}>{vca.name}</option>)}
        </select>
      </label>
      <div className="rounded border border-black/40 bg-[#232327] p-2">
        <p className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1">Signal path</p>
        <p className="text-[10px] text-zinc-300">{track.name} → {buses.find((bus) => bus.id === track.outputBusId)?.name ?? "Stereo Out"}</p>
        <p className="mt-1 text-[9px] text-zinc-600">{track.vcaId ? `VCA controlled by ${vcas.find((vca) => vca.id === track.vcaId)?.name ?? "VCA"}` : "No VCA control assigned"}</p>
      </div>
      <p className="text-[9px] leading-relaxed text-zinc-600">Aux routing is post-channel processing. Invalid routes and feedback loops are rejected by the mixer engine.</p>
    </aside>
  );
}

function MasterStrip() {
  const masterVolume = useDAW((state) => state.project.masterVolume);
  const setMasterVolume = useDAW((state) => state.setMasterVolume);
  const commit = useDAW((state) => state.commit);
  const getLevel = () => engine.getMasterLevel()[0];

  return (
    <div className="w-[100px] shrink-0 bg-[#222226] border-l-2 border-[#3a3a41] flex flex-col items-center px-2 py-1.5 gap-1.5">
      <div className="h-5 flex items-center gap-1.5 shrink-0">
        <Speaker size={12} className="text-zinc-400" aria-hidden="true" />
        <span className="text-[10px] font-semibold text-zinc-200">Master</span>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center gap-2">
        <Fader value={masterVolume} onChange={setMasterVolume} onCommitStart={commit} height={150} />
        <Meter getLevel={getLevel} vertical width={8} height={140} />
      </div>
      <span className="text-[9px] text-zinc-500 shrink-0">Stereo Out</span>
    </div>
  );
}


function AudioOutputSelector() {
  const outputDeviceId = useDAW((state) => state.project.audioOutputDeviceId ?? "");
  const setAudioOutputDevice = useDAW((state) => state.setAudioOutputDevice);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        if (active) setDevices(list.filter((device) => device.kind === "audiooutput"));
      } catch (error) {
        console.warn("Could not enumerate audio output devices", error);
      }
    };
    void refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => {
      active = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
    };
  }, []);

  return (
    <label className="hidden md:flex h-7 items-center gap-1.5 rounded border border-black/40 bg-[#19191c] px-2">
      <Speaker size={11} className="text-zinc-500" />
      <span className="text-[9px] text-zinc-500">Output</span>
      <select
        value={outputDeviceId}
        onChange={(event) => setAudioOutputDevice(event.target.value || null)}
        aria-label="Master audio output device"
        className="max-w-32 bg-transparent text-[9px] text-zinc-300 outline-none"
      >
        <option value="">System default</option>
        {devices.map((device, index) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || `Audio output ${index + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}


function MasteringAssistant({ onClose }: { onClose: () => void }) {
  const project = useDAW((state) => state.project);
  const setMasterVolume = useDAW((state) => state.setMasterVolume);
  const [targetRmsDb, setTargetRmsDb] = useState(-14);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<{
    peakDb: number;
    rmsDb: number;
    crestDb: number;
    suggestedVolume: number;
    gainDb: number;
  } | null>(null);

  const analyze = async () => {
    setBusy(true);
    setProgress(0);
    setAnalysis(null);
    try {
      const rendered = await engine.renderProject(project, (value) => setProgress(Math.round(value * 100)));
      if (!rendered?.channels.length) throw new Error("The project did not produce any audio");
      let sumSquares = 0;
      let count = 0;
      let peak = 0;
      for (const channel of rendered.channels) {
        for (let i = 0; i < channel.length; i++) {
          const sample = channel[i] ?? 0;
          const magnitude = Math.abs(sample);
          peak = Math.max(peak, magnitude);
          sumSquares += sample * sample;
          count++;
        }
      }
      const rms = count ? Math.sqrt(sumSquares / count) : 0;
      if (peak < 1e-7 || rms < 1e-7) throw new Error("The rendered mix is silent or too quiet to analyze");

      const peakDb = 20 * Math.log10(peak);
      const rmsDb = 20 * Math.log10(rms);
      const crestDb = peakDb - rmsDb;
      const peakLimitedGain = -1 - peakDb;
      const targetGain = targetRmsDb - rmsDb;
      const availableGain = project.masterVolume > 0
        ? 20 * Math.log10(1.25 / project.masterVolume)
        : 6;
      const gainDb = Math.max(-12, Math.min(6, targetGain, peakLimitedGain, availableGain));
      const suggestedVolume = Math.max(
        0,
        Math.min(1.25, project.masterVolume * Math.pow(10, gainDb / 20))
      );
      setAnalysis({ peakDb, rmsDb, crestDb, suggestedVolume, gainDb });
    } catch (error) {
      console.error("Mastering analysis failed", error);
      toast.error(error instanceof Error ? error.message : "Could not analyze this mix");
    } finally {
      setBusy(false);
      setProgress(100);
    }
  };

  const apply = () => {
    if (!analysis) return;
    setMasterVolume(analysis.suggestedVolume);
    toast.success("Suggested master level applied");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-label="Mastering Assistant">
      <div className="w-full max-w-lg rounded-xl border border-[#45454d] bg-[#202024] shadow-2xl text-zinc-200 overflow-hidden">
        <header className="flex items-center gap-2 px-4 py-3 border-b border-black/50 bg-[#29292f]">
          <SlidersHorizontal size={15} className="text-[#ffb648]" />
          <div>
            <p className="text-[12px] font-semibold">Mastering Assistant</p>
            <p className="text-[9px] text-zinc-500">Offline mix analysis · level and peak recommendation</p>
          </div>
          <button type="button" onClick={onClose} className="ml-auto h-7 w-7 rounded text-zinc-500 hover:text-zinc-100 hover:bg-white/5" aria-label="Close mastering assistant">
            <X size={14} className="mx-auto" />
          </button>
        </header>

        <div className="p-4 space-y-4">
          <label className="block rounded-lg border border-black/40 bg-[#18181b] p-3">
            <span className="flex items-center justify-between text-[10px] text-zinc-400">
              <span>Target average RMS</span>
              <strong className="font-mono text-[#ffcf8a]">{targetRmsDb} dBFS</strong>
            </span>
            <input
              type="range"
              min={-20}
              max={-8}
              step={1}
              value={targetRmsDb}
              onChange={(event) => setTargetRmsDb(Number(event.target.value))}
              className="mt-3 w-full accent-[#ffb648]"
              aria-label="Target average RMS level"
            />
            <span className="mt-1 block text-[9px] text-zinc-600">Peak ceiling: -1.0 dBFS · Master gain is limited to the app's output range</span>
          </label>

          {busy ? (
            <div className="rounded-lg border border-black/40 bg-[#18181b] p-4">
              <div className="flex items-center justify-between text-[10px] text-zinc-400">
                <span>Rendering and analyzing project…</span>
                <span className="font-mono">{progress}%</span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-[#303036] overflow-hidden">
                <div className="h-full bg-[#ffb648] transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          ) : analysis ? (
            <div className="rounded-lg border border-black/40 bg-[#18181b] p-3 space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <Metric label="Sample peak" value={`${analysis.peakDb.toFixed(1)} dBFS`} />
                <Metric label="Average RMS" value={`${analysis.rmsDb.toFixed(1)} dBFS`} />
                <Metric label="Crest factor" value={`${analysis.crestDb.toFixed(1)} dB`} />
              </div>
              <div className="border-t border-black/40 pt-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] text-zinc-500">Suggested master gain</p>
                  <p className="text-lg font-semibold text-[#ffcf8a] tabular-nums">
                    {analysis.gainDb >= 0 ? "+" : ""}{analysis.gainDb.toFixed(1)} dB
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[9px] text-zinc-600">New master fader</p>
                  <p className="text-[13px] font-mono text-zinc-200">{Math.round(analysis.suggestedVolume * 100)}%</p>
                </div>
              </div>
              <p className="text-[9px] leading-relaxed text-zinc-600">
                RMS is a simple broadband estimate, not standards-compliant LUFS. This assistant changes the master level only; it does not automatically EQ, compress individual stems, or create spatial audio.
              </p>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-[#45454d] p-4 text-[10px] leading-relaxed text-zinc-500">
              The assistant will render the whole project, measure its peak and average RMS level, and calculate a conservative master-fader adjustment. Your tracks and their individual faders remain unchanged.
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="h-8 px-3 rounded border border-black/40 bg-[#303036] text-[10px] text-zinc-300 hover:bg-[#3a3a41]">
              Close
            </button>
            {analysis ? (
              <button type="button" onClick={apply} className="h-8 px-3 rounded border border-[#ffb648]/40 bg-[#ffb648]/15 text-[10px] font-medium text-[#ffcf8a] hover:bg-[#ffb648]/20">
                Apply Suggested Level
              </button>
            ) : (
              <button type="button" onClick={() => void analyze()} disabled={busy} className="h-8 px-3 rounded border border-[#ffb648]/40 bg-[#ffb648]/15 text-[10px] font-medium text-[#ffcf8a] hover:bg-[#ffb648]/20 disabled:opacity-40">
                {busy ? "Analyzing…" : "Analyze Mix"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-black/30 bg-[#222226] p-2">
      <p className="text-[8px] text-zinc-600">{label}</p>
      <p className="mt-1 text-[11px] font-mono text-zinc-200 tabular-nums">{value}</p>
    </div>
  );
}
