"use client";

import { useMemo, useState } from "react";
import { Plus, Power, Trash2 } from "lucide-react";
import { useDAW } from "@/lib/daw/store";
import type { Track } from "@/lib/daw/types";
import {
  AUDIO_PLUGIN_DEFS,
  MIDI_PLUGIN_DEFS,
  createPluginInstance,
  type PluginDefinition,
  type TrackPluginInstance,
} from "@/lib/daw/plugins";

export function PluginRack({ track }: { track: Track }) {
  const updateTrack = useDAW((state) => state.updateTrack);
  const isMidi = track.type === "midi";
  const definitions = isMidi ? MIDI_PLUGIN_DEFS : AUDIO_PLUGIN_DEFS;
  const plugins = isMidi ? (track.midiPlugins ?? []) : (track.audioPlugins ?? []);
  const [selectedPlugin, setSelectedPlugin] = useState("");

  const available = useMemo(
    () => definitions.filter((definition) => !plugins.some((plugin) => plugin.pluginId === definition.id)),
    [definitions, plugins]
  );

  const updatePlugins = (next: TrackPluginInstance[], commit = true) => {
    updateTrack(
      track.id,
      isMidi ? { midiPlugins: next } : { audioPlugins: next },
      commit
    );
  };

  const addPlugin = () => {
    const instance = createPluginInstance(selectedPlugin, definitions);
    if (!instance) return;
    updatePlugins([...plugins, instance]);
    setSelectedPlugin("");
  };

  const togglePlugin = (pluginId: string) => {
    updatePlugins(
      plugins.map((plugin) =>
        plugin.id === pluginId ? { ...plugin, enabled: !plugin.enabled } : plugin
      )
    );
  };

  const removePlugin = (pluginId: string) => {
    updatePlugins(plugins.filter((plugin) => plugin.id !== pluginId));
  };

  const changeParameter = (pluginId: string, key: string, value: number) => {
    updatePlugins(
      plugins.map((plugin) =>
        plugin.id === pluginId
          ? { ...plugin, params: { ...plugin.params, [key]: value } }
          : plugin
      ),
      false
    );
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#1d1d20]">
      <div className="shrink-0 px-3 py-2 flex items-center gap-2 border-b border-black/40 bg-[#202024]">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-zinc-200">
            {isMidi ? "MIDI Effects" : "Vocal & Audio Effects"}
          </p>
          <p className="text-[9px] text-zinc-500">
            {isMidi ? "Process notes before they reach the instrument." : "Insert processors into this track's audio signal."}
          </p>
        </div>
        <span className="ml-auto text-[10px] tabular-nums text-zinc-500">
          {plugins.length}/{definitions.length}
        </span>
      </div>

      <div className="shrink-0 px-3 py-2 flex items-center gap-2 border-b border-black/30">
        <select
          value={selectedPlugin}
          onChange={(event) => setSelectedPlugin(event.target.value)}
          className="h-8 min-w-0 flex-1 rounded-md border border-black/50 bg-[#29292f] px-2 text-[10px] text-zinc-200 outline-none focus:border-[#ffb648]/60"
          aria-label="Choose a plugin to add"
        >
          <option value="">Choose a plugin…</option>
          {available.map((definition) => (
            <option key={definition.id} value={definition.id}>
              {definition.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={addPlugin}
          disabled={!selectedPlugin}
          className="h-8 px-3 rounded-md bg-[#8fb44a]/15 border border-[#8fb44a]/35 text-[10px] font-semibold text-[#c6e88a] disabled:opacity-35 disabled:cursor-not-allowed hover:bg-[#8fb44a]/25 transition-colors inline-flex items-center gap-1.5"
        >
          <Plus size={12} /> Add
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2 [scrollbar-width:thin]">
        {plugins.length === 0 && (
          <div className="h-full min-h-24 flex flex-col items-center justify-center gap-1 text-center">
            <p className="text-[11px] text-zinc-400">No plugins inserted</p>
            <p className="max-w-64 text-[9px] leading-relaxed text-zinc-600">
              Add one of the {definitions.length} available {isMidi ? "MIDI processors" : "audio effects"} to this track.
            </p>
          </div>
        )}

        {plugins.map((plugin) => {
          const definition = definitions.find((item) => item.id === plugin.pluginId);
          if (!definition) return null;
          return (
            <PluginCard
              key={plugin.id}
              definition={definition}
              instance={plugin}
              onToggle={() => togglePlugin(plugin.id)}
              onRemove={() => removePlugin(plugin.id)}
              onChange={(key, value) => changeParameter(plugin.id, key, value)}
            />
          );
        })}
      </div>
    </div>
  );
}

function PluginCard({
  definition,
  instance,
  onToggle,
  onRemove,
  onChange,
}: {
  definition: PluginDefinition;
  instance: TrackPluginInstance;
  onToggle: () => void;
  onRemove: () => void;
  onChange: (key: string, value: number) => void;
}) {
  return (
    <section className={`rounded-md border p-2 transition-colors ${instance.enabled ? "border-[#4d6235]/60 bg-[#24272a]" : "border-black/40 bg-[#222226] opacity-70"}`}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={instance.enabled}
          title={instance.enabled ? "Bypass plugin" : "Enable plugin"}
          className={`h-6 w-6 rounded flex items-center justify-center border ${instance.enabled ? "border-[#8fb44a]/50 bg-[#8fb44a]/15 text-[#c6e88a]" : "border-black/50 bg-[#29292f] text-zinc-500"}`}
        >
          <Power size={12} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold text-zinc-200">{definition.name}</p>
          <p className="text-[9px] text-zinc-500 truncate">{definition.description}</p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${definition.name}`}
          title="Remove plugin"
          className="h-6 w-6 rounded flex items-center justify-center text-zinc-600 hover:text-[#e58a8a] hover:bg-white/5"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {definition.controls.length > 0 && (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2">
          {definition.controls.map((item) => {
            const value = instance.params[item.id] ?? item.defaultValue;
            return (
              <label key={item.id} className="min-w-0 flex flex-col gap-1">
                <span className="flex items-center justify-between text-[9px] text-zinc-400">
                  <span>{item.label}</span>
                  <span className="tabular-nums text-zinc-500">{Number(value.toFixed(2))}</span>
                </span>
                <input
                  type="range"
                  min={item.min}
                  max={item.max}
                  step={item.step ?? 1}
                  value={value}
                  disabled={!instance.enabled}
                  onPointerDown={() => useDAW.getState().commit()}
                  onChange={(event) => onChange(item.id, Number(event.target.value))}
                  className="w-full h-1.5 accent-[#a4c66d] disabled:opacity-40"
                />
              </label>
            );
          })}
        </div>
      )}
    </section>
  );
}
