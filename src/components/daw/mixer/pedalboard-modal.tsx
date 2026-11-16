"use client";

import { useMemo, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent } from "react";
import {
  AudioLines,
  Check,
  ChevronDown,
  CircleHelp,
  Power,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useDAW } from "@/lib/daw/store";
import { uid, type PedalCategory, type PedalId, type PedalInstance, type Track } from "@/lib/daw/types";
import {
  PEDAL_BY_ID,
  PEDAL_CATEGORIES,
  PEDAL_DEFINITIONS,
  createPedalInstance,
} from "@/lib/daw/pedalboard";
import {
  makePedalboardPatch,
  readUserPatches,
  writeUserPatches,
} from "@/lib/daw/user-patches";

const PEDAL_DRAG_TYPE = "application/x-webband-pedal-instance";
const LIBRARY_DRAG_TYPE = "application/x-webband-pedal-type";

export function PedalboardModal() {
  const modal = useDAW((state) => state.ui.modal);
  const selectedTrackId = useDAW((state) => state.ui.selectedTrackId);
  const project = useDAW((state) => state.project);
  const setModal = useDAW((state) => state.setModal);
  const tracks = project.tracks;
  const selected = tracks.find((track) => track.id === selectedTrackId) ?? null;
  const stack = selected?.role === "folder"
    ? project.stacks?.find((item) => item.folderTrackId === selected.id)
    : undefined;
  const track = stack?.type === "summing" && stack.busTrackId
    ? tracks.find((item) => item.id === stack.busTrackId) ?? null
    : selected;

  if (modal !== "pedalboard") return null;
  return (
    <PedalboardWorkspace
      track={track}
      displayName={stack?.type === "summing" ? stack.name : track?.name ?? "No channel"}
      onClose={() => setModal("none")}
    />
  );
}

function PedalboardWorkspace({
  track,
  displayName,
  onClose,
}: {
  track: Track | null;
  displayName: string;
  onClose: () => void;
}) {
  const updateTrack = useDAW((state) => state.updateTrack);
  const commit = useDAW((state) => state.commit);
  const [category, setCategory] = useState<PedalCategory | "All">("All");
  const [browserOpen, setBrowserOpen] = useState(true);
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [presetRefresh, setPresetRefresh] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const pedals = track?.pedalboard ?? [];
  const slot = track?.audioPlugins?.find((plugin) => plugin.pluginId === "pedalboard");
  const definitions = useMemo(
    () => category === "All"
      ? PEDAL_DEFINITIONS
      : PEDAL_DEFINITIONS.filter((pedal) => pedal.category === category),
    [category],
  );
  const savedPresets = useMemo(
    () => readUserPatches().filter((patch) => patch.kind === "pedalboard"),
    [presetRefresh],
  );

  const updatePedals = (next: PedalInstance[], doCommit = false) => {
    if (!track) return;
    updateTrack(track.id, { pedalboard: next }, doCommit);
  };

  const insertPedal = (pedalId: PedalId, index = pedals.length) => {
    const next = [...pedals];
    next.splice(index, 0, createPedalInstance(pedalId));
    commit();
    updatePedals(next);
  };

  const dropPedal = (event: DragEvent<HTMLElement>, index = pedals.length) => {
    event.preventDefault();
    event.stopPropagation();
    const pedalId = event.dataTransfer.getData(LIBRARY_DRAG_TYPE) as PedalId;
    const instanceId = event.dataTransfer.getData(PEDAL_DRAG_TYPE);
    if (pedalId && PEDAL_BY_ID[pedalId]) {
      insertPedal(pedalId, index);
      return;
    }
    if (!instanceId) return;
    const from = pedals.findIndex((pedal) => pedal.id === instanceId);
    if (from < 0 || from === index || from + 1 === index) return;
    const next = [...pedals];
    const [moving] = next.splice(from, 1);
    const destination = from < index ? index - 1 : index;
    next.splice(destination, 0, moving);
    commit();
    updatePedals(next);
  };

  const handlePedalDragEnd = (event: DragEvent<HTMLElement>, pedalId: string) => {
    const stage = stageRef.current;
    if (!stage || event.clientX === 0 && event.clientY === 0) return;
    const rect = stage.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      commit();
      updatePedals(pedals.filter((pedal) => pedal.id !== pedalId));
    }
  };

  const updatePedal = (id: string, patch: Partial<PedalInstance>, doCommit = false) => {
    updatePedals(pedals.map((pedal) => pedal.id === id ? { ...pedal, ...patch } : pedal), doCommit);
  };

  const toggleSlot = () => {
    if (!track) return;
    const plugins = track.audioPlugins ?? [];
    if (slot) {
      commit();
      updateTrack(track.id, {
        audioPlugins: plugins.map((plugin) =>
          plugin.id === slot.id ? { ...plugin, enabled: !plugin.enabled } : plugin,
        ),
      }, false);
    } else {
      commit();
      updateTrack(track.id, {
        audioPlugins: [...plugins, { id: uid(), pluginId: "pedalboard", enabled: true, params: {} }],
      }, false);
    }
  };

  const savePreset = () => {
    if (!track || !presetName.trim()) return;
    try {
      const current = readUserPatches();
      const patch = makePedalboardPatch(presetName.trim(), pedals, track.color);
      writeUserPatches([patch, ...current]);
      window.dispatchEvent(new Event("webband:user-patches-updated"));
      setPresetName("");
      setSavingPreset(false);
      setPresetRefresh((value) => value + 1);
      toast.success(`Saved ${patch.name} to My Instruments`);
    } catch (error) {
      console.error("Could not save pedalboard preset.", error);
      toast.error(error instanceof Error ? error.message : "Could not save the pedalboard preset.");
    }
  };

  const loadPreset = (patch: ReturnType<typeof readUserPatches>[number]) => {
    if (!track || patch.kind !== "pedalboard" || !patch.pedalboard) return;
    commit();
    const plugins = track.audioPlugins ?? [];
    const currentSlot = plugins.find((plugin) => plugin.pluginId === "pedalboard");
    updateTrack(track.id, {
      pedalboard: patch.pedalboard.map((pedal) => ({ ...pedal, id: uid(), params: { ...pedal.params } })),
      audioPlugins: currentSlot
        ? plugins.map((plugin) => plugin.id === currentSlot.id ? { ...plugin, enabled: true } : plugin)
        : [...plugins, { id: uid(), pluginId: "pedalboard", enabled: true, params: {} }],
    }, false);
    toast.success(`Loaded ${patch.name}`);
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-[#070809]/80 p-3 backdrop-blur-md sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Pedalboard"
        className="pedalboard-window flex h-full max-h-[900px] w-full max-w-[1500px] flex-col overflow-hidden rounded-xl border border-white/10"
      >
        <header className="pedalboard-header flex h-14 shrink-0 items-center gap-3 border-b border-black/70 px-4">
          <div className="pedalboard-badge"><AudioLines size={17} /></div>
          <div className="min-w-0">
            <p className="text-[12px] font-semibold tracking-[.15em] text-zinc-100">PEDALBOARD</p>
            <p className="truncate text-[10px] text-zinc-500">
              {displayName} <span className="text-zinc-700">/</span> {track?.role === "aux" ? "Summing bus insert" : track?.role === "folder" ? "Folder bus insert" : track ? "Channel insert" : "Select a channel"}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {savingPreset ? (
              <form className="flex items-center gap-1.5" onSubmit={(event) => { event.preventDefault(); savePreset(); }}>
                <input
                  autoFocus
                  value={presetName}
                  onChange={(event) => setPresetName(event.target.value)}
                  aria-label="Preset name"
                  placeholder="Preset name"
                  className="h-8 w-36 rounded-md border border-white/10 bg-black/30 px-2 text-[10px] text-zinc-100 outline-none focus:border-amber-300/50"
                />
                <button type="submit" className="pedalboard-header-button" aria-label="Save preset"><Check size={14} /></button>
                <button type="button" className="pedalboard-header-button" onClick={() => setSavingPreset(false)} aria-label="Cancel saving preset"><X size={14} /></button>
              </form>
            ) : (
              <button
                type="button"
                className="pedalboard-header-button hidden sm:inline-flex"
                onClick={() => setSavingPreset(true)}
                disabled={!track}
                title="Save this chain to My Instruments"
              >
                <Save size={13} /> <span>Save chain</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setBrowserOpen((open) => !open)}
              aria-label={browserOpen ? "Hide stompbox browser" : "Show stompbox browser"}
              aria-expanded={browserOpen}
              title={browserOpen ? "Hide stompbox browser" : "Show stompbox browser"}
              className="pedalboard-header-button size-8 justify-center"
            >
              <ChevronDown size={14} className="transition-transform" style={{ transform: `rotate(${browserOpen ? -90 : 90}deg)` }} />
            </button>
            <label className="flex h-8 items-center gap-2 rounded-md border border-black/60 bg-black/20 px-2.5 text-[10px] text-zinc-400">
              <Power size={13} className={slot?.enabled ? "text-emerald-300" : "text-zinc-600"} />
              <span>INSERT</span>
              <input
                type="checkbox"
                aria-label="Pedalboard insert enabled"
                checked={slot?.enabled ?? false}
                onChange={toggleSlot}
                className="accent-emerald-400"
              />
            </label>
            <button type="button" onClick={onClose} aria-label="Close pedalboard" className="pedalboard-header-button size-8 justify-center">
              <X size={15} />
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <main className="flex min-w-0 flex-1 flex-col p-3 sm:p-5">
            <div className="mb-3 flex shrink-0 items-center gap-2">
              <span className="text-[9px] font-semibold uppercase tracking-[.19em] text-zinc-500">Signal chain</span>
              <span className="rounded border border-white/5 bg-black/20 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500">{pedals.length} PEDAL{pedals.length === 1 ? "" : "S"}</span>
              <span className="ml-auto hidden items-center gap-1 text-[9px] text-zinc-600 sm:flex">
                <CircleHelp size={11} /> Drag pedals to reorder · drag off the tray to remove
              </span>
            </div>
            <div
              ref={stageRef}
              className="pedalboard-stage min-h-0 flex-1 overflow-auto rounded-lg p-5 sm:p-8"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => dropPedal(event)}
              aria-label="Pedalboard signal chain"
            >
              {pedals.length === 0 ? (
                <div className="flex h-full min-h-56 flex-col items-center justify-center gap-3 text-center">
                  <div className="rounded-full border border-dashed border-white/10 bg-black/15 p-5 text-zinc-600">
                    <AudioLines size={28} strokeWidth={1.2} />
                  </div>
                  <div>
                    <p className="text-[12px] font-medium text-zinc-400">Your board is quiet</p>
                    <p className="mt-1 text-[10px] text-zinc-600">Drag a stompbox from the browser, or click its Add button.</p>
                  </div>
                </div>
              ) : (
                <div className="pedalboard-chain flex min-h-full min-w-max items-center gap-[94px] py-3">
                  {pedals.map((pedal, index) => (
                    <div key={pedal.id} className="relative z-0">
                      <PedalCard
                        pedal={pedal}
                        index={index}
                        onChange={(key, next) => updatePedal(pedal.id, { params: { ...pedal.params, [key]: next } })}
                        onToggle={() => updatePedal(pedal.id, { enabled: !pedal.enabled }, true)}
                        onRemove={() => { commit(); updatePedals(pedals.filter((item) => item.id !== pedal.id)); }}
                        onDrop={(event) => dropPedal(event, index)}
                        onDragEnd={(event) => handlePedalDragEnd(event, pedal.id)}
                      />
                      {index < pedals.length - 1 && <PatchCable />}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 text-[9px] text-zinc-600">
                <span className={`pedalboard-status-light ${slot?.enabled ? "is-lit" : ""}`} />
                {slot?.enabled ? "INSERT ACTIVE" : "INSERT BYPASSED"}
              </div>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-[9px] uppercase tracking-wider text-zinc-600">My Instruments</span>
                <select
                  aria-label="Load pedalboard preset from My Instruments"
                  defaultValue=""
                  onChange={(event) => {
                    const patch = savedPresets.find((item) => item.id === event.target.value);
                    if (patch) loadPreset(patch);
                    event.target.value = "";
                  }}
                  className="h-8 max-w-48 rounded-md border border-white/10 bg-[#202125] px-2 text-[10px] text-zinc-300 outline-none focus:border-amber-300/50"
                >
                  <option value="">Load user chain…</option>
                  {savedPresets.map((patch) => <option key={patch.id} value={patch.id}>{patch.name}</option>)}
                </select>
                <ChevronDown size={12} className="pointer-events-none -ml-6 mr-2 text-zinc-500" />
              </div>
            </div>
          </main>

          <aside
            aria-hidden={!browserOpen}
            className={`pedalboard-browser flex w-[220px] shrink-0 flex-col border-l border-black/70 sm:w-[270px] ${browserOpen ? "is-open" : "is-closed"}`}
          >
            <div className="border-b border-black/50 px-3 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-zinc-200">Stompbox browser</p>
              <p className="mt-1 text-[9px] text-zinc-600">Eight studio-grade inserts</p>
            </div>
            <div className="flex flex-wrap gap-1 border-b border-black/40 p-2">
              {(["All", ...PEDAL_CATEGORIES] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setCategory(item)}
                  aria-pressed={category === item}
                  className={`rounded px-2 py-1 text-[9px] transition-colors ${category === item ? "bg-white/10 text-zinc-100" : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300"}`}
                >
                  {item}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
              {definitions.map((definition) => (
                <div
                  key={definition.id}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(LIBRARY_DRAG_TYPE, definition.id);
                    event.dataTransfer.effectAllowed = "copy";
                  }}
                  className="group flex items-center gap-2 rounded-md border border-transparent p-2 hover:border-white/10 hover:bg-white/[.035]"
                >
                  <span className="size-2.5 shrink-0 rounded-sm shadow-[0_0_10px_currentColor]" style={{ backgroundColor: definition.face, color: definition.face }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[10px] font-semibold tracking-wide text-zinc-300">{definition.name}</p>
                    <p className="truncate text-[9px] text-zinc-600">{definition.category} · {definition.subtitle}</p>
                  </div>
                  <button
                    type="button"
                    disabled={!track}
                    onClick={() => insertPedal(definition.id)}
                    aria-label={`Add ${definition.name}`}
                    className="rounded border border-white/10 bg-black/20 px-2 py-1 text-[9px] text-zinc-500 opacity-0 transition-all hover:text-zinc-100 group-hover:opacity-100 focus:opacity-100 disabled:opacity-30"
                  >
                    Add
                  </button>
                </div>
              ))}
            </div>
            <div className="border-t border-black/50 p-3 text-[9px] leading-relaxed text-zinc-600">
              Every stompbox has independent true bypass. Reorder the chain to change the sound.
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}

function PedalCard({
  pedal,
  index,
  onChange,
  onToggle,
  onRemove,
  onDrop,
  onDragEnd,
}: {
  pedal: PedalInstance;
  index: number;
  onChange: (id: string, value: number) => void;
  onToggle: () => void;
  onRemove: () => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: (event: DragEvent<HTMLElement>) => void;
}) {
  const definition = PEDAL_BY_ID[pedal.pedalId];
  return (
    <article
      draggable
      onDragStart={(event) => {
        if ((event.target as HTMLElement).closest("button,input")) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.setData(PEDAL_DRAG_TYPE, pedal.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      className={`pedal-case ${pedal.enabled ? "" : "pedal-bypassed"}`}
      style={{ "--pedal-edge": definition.color, "--pedal-face": definition.face, "--pedal-ink": definition.ink } as CSSProperties}
      aria-label={`${definition.name} pedal`}
    >
      <span className="pedal-screw screw-top-left" />
      <span className="pedal-screw screw-top-right" />
      <span className="pedal-screw screw-bottom-left" />
      <span className="pedal-screw screw-bottom-right" />
      <div className="pedal-face">
        <div className="flex items-start justify-between">
          <div>
            <p className="pedal-brand">WEBBAND · SERIES 08</p>
            <p className="pedal-name">{definition.name}</p>
            <p className="pedal-subtitle">{definition.subtitle}</p>
          </div>
          <button type="button" onClick={onRemove} aria-label={`Remove ${definition.name}`} className="pedal-remove">
            <Trash2 size={12} />
          </button>
        </div>
        <div className={`pedal-led-wrap ${pedal.enabled ? "led-on" : ""}`}         style={{ "--pedal-led": definition.led } as CSSProperties}>
          <span className="pedal-led" />
        </div>
        <div className="pedal-controls">
          {definition.controls.map((control) => (
            <RotaryKnob
              key={control.id}
              label={control.label}
              value={pedal.params[control.id] ?? control.defaultValue}
              color={definition.color}
              onChange={(next) => onChange(control.id, next)}
            />
          ))}
        </div>
        <div className="pedal-bottom">
          <span className="pedal-jack"><i /></span>
          <div className="pedal-footswitch-group">
            <span className="pedal-footswitch-ring"><span className="pedal-footswitch-nut"><span className="pedal-footswitch-plunger" /></span></span>
            <button
              type="button"
              onClick={onToggle}
              aria-pressed={pedal.enabled}
              aria-label={`${pedal.enabled ? "Bypass" : "Enable"} ${definition.name}`}
              className="pedal-footswitch-hit"
            />
            <span className="pedal-switch-label">{pedal.enabled ? "ON" : "BYPASS"}</span>
          </div>
          <span className="pedal-jack"><i /></span>
        </div>
        <span className="pedal-index">{String(index + 1).padStart(2, "0")}</span>
      </div>
    </article>
  );
}

function RotaryKnob({
  label,
  value,
  color,
  onChange,
}: {
  label: string;
  value: number;
  color: string;
  onChange: (value: number) => void;
}) {
  const drag = useRef<{ y: number; value: number; pointerId: number } | null>(null);
  const angle = -135 + value * 270;
  const pointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    drag.current = { y: event.clientY, value, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    onChange(Math.max(0, Math.min(1, drag.current.value + (drag.current.y - event.clientY) / 150)));
  };
  const pointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return (
    <div className="pedal-knob-control">
      <div className="pedal-knob-scale" aria-hidden>
        {Array.from({ length: 11 }, (_, i) => (
          <span key={i} style={{ transform: `rotate(${-135 + i * 27}deg)` }} />
        ))}
      </div>
      <button
        type="button"
        className="pedal-knob"
        aria-label={`${label}: ${Math.round(value * 100)} percent`}
        title={`${label} · ${Math.round(value * 100)}%`}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onDoubleClick={() => onChange(0.5)}
        style={{ "--knob-angle": `${angle}deg`, "--knob-accent": color } as CSSProperties}
      >
        <span className="pedal-knob-metal" />
        <span className="pedal-knob-grip" />
        <span className="pedal-knob-indicator" />
      </button>
      <span className="pedal-knob-label">{label}</span>
    </div>
  );
}

function PatchCable() {
  return (
    <svg className="pedal-patch-cable" width="104" height="76" viewBox="0 0 104 76" aria-hidden="true">
      <path d="M2 32 C 18 32, 13 61, 34 61 S 58 12, 79 15 S 88 34, 101 34" className="cable-shadow" />
      <path d="M2 30 C 18 30, 13 59, 34 59 S 58 10, 79 13 S 88 32, 101 32" className="cable-braid" />
      <circle cx="2" cy="30" r="4" className="cable-plug" />
      <circle cx="101" cy="32" r="4" className="cable-plug" />
    </svg>
  );
}

