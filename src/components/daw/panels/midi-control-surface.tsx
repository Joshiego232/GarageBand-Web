"use client";

import { useEffect, useMemo, useState } from "react";
import { Cable, Circle, SlidersHorizontal, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useDAW } from "@/lib/daw/store";
import { engine } from "@/lib/daw/engine";
import { uid, type MidiCCMapping, type MidiCCTarget } from "@/lib/daw/types";
import { midiCCToValue, midiCCTargetLabel } from "@/lib/daw/midi-control";

interface MidiInputPortLike extends EventTarget {
  id: string;
  name?: string;
  manufacturer?: string;
  state?: string;
}

interface MidiAccessLike extends EventTarget {
  inputs: {
    get(id: string): MidiInputPortLike | undefined;
    values(): IterableIterator<MidiInputPortLike>;
  };
}

interface MidiMessageEventLike extends Event {
  data: Uint8Array;
}

interface LearningTarget {
  target: MidiCCTarget;
  trackId?: string;
}

export function MidiControlSurface({ onClose }: { onClose: () => void }) {
  const project = useDAW((state) => state.project);
  const selectedTrackId = useDAW((state) => state.ui.selectedTrackId);
  const setMidiCCMappings = useDAW((state) => state.setMidiCCMappings);
  const [access, setAccess] = useState<MidiAccessLike | null>(null);
  const [inputs, setInputs] = useState<MidiInputPortLike[]>([]);
  const [selectedInputId, setSelectedInputId] = useState("");
  const [learningTarget, setLearningTarget] = useState<LearningTarget | null>(null);
  const [connecting, setConnecting] = useState(false);

  const mappings = project.midiCCMappings ?? [];
  const selectedTrack = project.tracks.find((track) => track.id === selectedTrackId) ?? null;
  const selectedInput = access?.inputs.get(selectedInputId);

  const connectMidi = async () => {
    const nav = navigator as Navigator & {
      requestMIDIAccess?: () => Promise<MidiAccessLike>;
    };
    if (!nav.requestMIDIAccess) {
      toast.error("Web MIDI is not available in this browser. Try Chrome or Edge on HTTPS.");
      return;
    }
    setConnecting(true);
    try {
      const midiAccess = await nav.requestMIDIAccess.call(navigator);
      setAccess(midiAccess);
      const available = Array.from(midiAccess.inputs.values());
      setInputs(available);
      setSelectedInputId(available[0]?.id ?? "");
      if (available.length) {
        toast.success(`Connected to MIDI: ${available.length} input device${available.length === 1 ? "" : "s"}`);
      } else {
        toast.info("MIDI access granted. Connect a MIDI keyboard or controller.");
      }
    } catch (error) {
      console.error("Web MIDI permission failed", error);
      toast.error("MIDI access was denied or the device could not be opened.");
    } finally {
      setConnecting(false);
    }
  };

  useEffect(() => {
    if (!access) return;
    const onStateChange = () => {
      const next = Array.from(access.inputs.values());
      setInputs(next);
      if (!next.some((input) => input.id === selectedInputId)) {
        setSelectedInputId(next[0]?.id ?? "");
      }
    };
    access.addEventListener("statechange", onStateChange);
    return () => {
      access.removeEventListener("statechange", onStateChange);
    };
  }, [access, selectedInputId]);

  useEffect(() => {
    if (!selectedInput) return;
    const activeNotes = new Set<number>();

    const handleMessage = (event: { data: Uint8Array }) => {
      const statusByte = event.data[0] ?? 0;
      const command = statusByte & 0xf0;
      const data1 = event.data[1] ?? 0;
      const data2 = event.data[2] ?? 0;

      if (command === 0x90 && data2 > 0) {
        engine.noteOn(data1, data2);
        activeNotes.add(data1);
        return;
      }
      if (command === 0x80 || (command === 0x90 && data2 === 0)) {
        engine.noteOff(data1);
        activeNotes.delete(data1);
        return;
      }

      if (command !== 0xb0) return;

      if (learningTarget) {
        const mapping: MidiCCMapping = {
          id: uid(),
          deviceId: selectedInput.id,
          deviceName: selectedInput.name || "MIDI Controller",
          cc: data1,
          target: learningTarget.target,
          ...(learningTarget.trackId ? { trackId: learningTarget.trackId } : {}),
        };
        const current = useDAW.getState().project.midiCCMappings ?? [];
        const next = current.filter(
          (item) =>
            !(item.deviceId === mapping.deviceId && item.cc === mapping.cc)
        );
        setMidiCCMappings([...next, mapping]);
        setLearningTarget(null);
        toast.success(`Learned CC ${data1} for ${midiCCTargetLabel(mapping.target)}`);
        return;
      }

      const mapping = (useDAW.getState().project.midiCCMappings ?? []).find(
        (item) => item.deviceId === selectedInput.id && item.cc === data1
      );
      if (!mapping) return;

      const value = midiCCToValue(mapping.target, data2);
      if (mapping.target === "master-volume") {
        useDAW.getState().setMasterVolume(value);
      } else if (mapping.trackId) {
        const trackExists = useDAW.getState().project.tracks.some(
          (track) => track.id === mapping.trackId
        );
        if (!trackExists) return;
        useDAW.getState().updateTrack(
          mapping.trackId,
          mapping.target === "track-volume" ? { volume: value } : { pan: value },
          false
        );
      }
    };

    const onMidiMessage: EventListener = (event) => handleMessage(event as MidiMessageEventLike);
    selectedInput.addEventListener("midimessage", onMidiMessage);
    return () => {
      selectedInput.removeEventListener("midimessage", onMidiMessage);
      for (const pitch of activeNotes) engine.noteOff(pitch);
    };
  }, [selectedInput, learningTarget]);

  const removeMapping = (id: string) => {
    setMidiCCMappings(mappings.filter((mapping) => mapping.id !== id));
  };

  const beginLearn = (target: MidiCCTarget, trackId?: string) => {
    if (!selectedInput) {
      toast.error("Connect and select a MIDI input first");
      return;
    }
    if ((target === "track-volume" || target === "track-pan") && !trackId) {
      toast.error("Select a track before learning its controls");
      return;
    }
    setLearningTarget({ target, ...(trackId ? { trackId } : {}) });
    toast.info("Move a hardware knob, slider, or fader to learn its MIDI CC");
  };

  const currentDeviceMappings = useMemo(
    () => mappings.filter((mapping) => mapping.deviceId === selectedInputId),
    [mappings, selectedInputId]
  );

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/75 p-3" role="dialog" aria-modal="true" aria-label="MIDI Control Surface">
      <section className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-xl border border-[#45454d] bg-[#202024] text-zinc-200 shadow-2xl flex flex-col">
        <header className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-black/50 bg-[#29292f]">
          <div className="size-9 rounded-lg bg-[#8c75c8]/15 border border-[#8c75c8]/30 flex items-center justify-center">
            <Cable size={17} className="text-[#c1a9f5]" />
          </div>
          <div>
            <p className="text-[12px] font-semibold">MIDI Control Surface</p>
            <p className="text-[9px] text-zinc-500">Hardware keyboard input and learnable CC controls</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close MIDI control surface" className="ml-auto h-8 w-8 rounded text-zinc-500 hover:text-zinc-100 hover:bg-white/5">
            <X size={15} className="mx-auto" />
          </button>
        </header>

        <div className="min-h-0 overflow-y-auto p-4 space-y-4">
          <div className="rounded-lg border border-black/40 bg-[#18181b] p-3 flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-36">
              <p className="text-[10px] font-medium text-zinc-200">MIDI input</p>
              <p className="text-[9px] text-zinc-600">
                {access ? `${inputs.length} input device${inputs.length === 1 ? "" : "s"} available` : "Connect a USB or Bluetooth MIDI keyboard/controller"}
              </p>
            </div>
            {access && inputs.length > 0 ? (
              <select
                value={selectedInputId}
                onChange={(event) => setSelectedInputId(event.target.value)}
                aria-label="MIDI input device"
                className="h-8 max-w-52 rounded border border-black/50 bg-[#29292f] px-2 text-[10px] text-zinc-200"
              >
                {inputs.map((input) => (
                  <option key={input.id} value={input.id}>{input.name || input.id}</option>
                ))}
              </select>
            ) : null}
            <button type="button" onClick={() => void connectMidi()} disabled={connecting} className="h-8 px-3 rounded border border-[#8c75c8]/40 bg-[#8c75c8]/15 text-[10px] text-[#c1a9f5] hover:bg-[#8c75c8]/20 disabled:opacity-40">
              {connecting ? "Connecting…" : access ? "Refresh Access" : "Connect MIDI"}
            </button>
          </div>

          {access && selectedInput ? (
            <div className="rounded-lg border border-[#8c75c8]/30 bg-[#8c75c8]/[0.06] p-3">
              <div className="flex items-center gap-2">
                <Circle size={8} fill="#8fd17e" className="text-[#8fd17e]" />
                <p className="text-[10px] text-zinc-200">{selectedInput.name || "MIDI Input"} connected</p>
                <span className="ml-auto text-[9px] text-zinc-600">Channel 1–16 · Notes + CC</span>
              </div>
              <p className="mt-2 text-[9px] text-zinc-500">
                Play notes to perform or record the selected MIDI instrument. CC messages can control the master and selected track.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-[#45454d] p-4 text-[10px] leading-relaxed text-zinc-600">
              Connect MIDI to enable hardware note input and CC learning. Your browser will ask for permission before exposing connected devices.
            </div>
          )}

          <div className="space-y-2">
            <div>
              <p className="text-[11px] font-semibold text-zinc-200">Learn hardware controls</p>
              <p className="text-[9px] text-zinc-600">Press Learn, then move the physical fader or knob you want to assign.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <LearnCard label="Master Volume" detail="Controls the main output level" onLearn={() => beginLearn("master-volume")} learning={learningTarget?.target === "master-volume"} disabled={!selectedInput} />
              <LearnCard label="Track Volume" detail={selectedTrack?.name ?? "Select a track first"} onLearn={() => beginLearn("track-volume", selectedTrackId ?? undefined)} learning={learningTarget?.target === "track-volume"} disabled={!selectedInput || !selectedTrack} />
              <LearnCard label="Track Pan" detail={selectedTrack?.name ?? "Select a track first"} onLearn={() => beginLearn("track-pan", selectedTrackId ?? undefined)} learning={learningTarget?.target === "track-pan"} disabled={!selectedInput || !selectedTrack} />
            </div>
            {learningTarget ? (
              <p className="rounded border border-[#ffb648]/30 bg-[#ffb648]/[0.07] px-3 py-2 text-[9px] text-[#ffcf8a]">
                Waiting for a CC message for {midiCCTargetLabel(learningTarget.target)}…
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold text-zinc-200">Learned mappings</p>
                <p className="text-[9px] text-zinc-600">Saved with this project</p>
              </div>
              <span className="text-[9px] text-zinc-600">{currentDeviceMappings.length} for this device</span>
            </div>
            {mappings.length === 0 ? (
              <p className="rounded border border-dashed border-[#45454d] p-3 text-[9px] text-zinc-600">No CC mappings yet.</p>
            ) : (
              <div className="space-y-1.5">
                {mappings.map((mapping) => (
                  <div key={mapping.id} className="flex items-center gap-2 rounded border border-black/35 bg-[#19191d] px-3 py-2">
                    <SlidersHorizontal size={12} className="text-[#a995d9] shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] text-zinc-200">{midiCCTargetLabel(mapping.target)}</p>
                      <p className="text-[8px] text-zinc-600 truncate">{mapping.deviceName} · CC {mapping.cc}{mapping.trackId ? ` · ${project.tracks.find((track) => track.id === mapping.trackId)?.name ?? "Track removed"}` : ""}</p>
                    </div>
                    <button type="button" onClick={() => removeMapping(mapping.id)} aria-label="Remove MIDI mapping" title="Remove mapping" className="h-7 w-7 rounded text-zinc-600 hover:text-red-300 hover:bg-white/5">
                      <Trash2 size={12} className="mx-auto" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <footer className="shrink-0 border-t border-black/50 px-4 py-2 text-[9px] text-zinc-600">
          Supports MIDI note input and CC 7-bit continuous controls. Motorized fader feedback, SysEx scripting, and Logic Remote networking are not included.
        </footer>
      </section>
    </div>
  );
}

function LearnCard({
  label,
  detail,
  onLearn,
  learning,
  disabled,
}: {
  label: string;
  detail: string;
  onLearn: () => void;
  learning: boolean;
  disabled: boolean;
}) {
  return (
    <div className="rounded-lg border border-black/40 bg-[#18181b] p-3 flex flex-col gap-2">
      <div>
        <p className="text-[10px] font-medium text-zinc-200">{label}</p>
        <p className="mt-0.5 text-[8px] text-zinc-600 truncate">{detail}</p>
      </div>
      <button type="button" onClick={onLearn} disabled={disabled} className={`h-7 rounded border text-[9px] disabled:opacity-30 ${learning ? "border-[#ffb648]/50 bg-[#ffb648]/15 text-[#ffcf8a]" : "border-[#8c75c8]/35 bg-[#8c75c8]/10 text-[#c1a9f5] hover:bg-[#8c75c8]/20"}`}>
        {learning ? "Listening…" : "Learn CC"}
      </button>
    </div>
  );
}
