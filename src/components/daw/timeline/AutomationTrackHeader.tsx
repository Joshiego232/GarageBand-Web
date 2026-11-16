"use client";

import { useCallback, useEffect } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { automationParameters, createAutomationLane } from "@/lib/daw/automation-parameters";
import { useDAW } from "@/lib/daw/store";
import type { AutomationMode, Track } from "@/lib/daw/types";

const modeStyle: Record<AutomationMode, string> = {
  off: "border-zinc-600 bg-zinc-700/70 text-zinc-300",
  read: "border-emerald-500/50 bg-emerald-500/15 text-emerald-300",
  touch: "border-amber-500/50 bg-amber-500/15 text-amber-300",
  latch: "border-orange-500/50 bg-orange-500/15 text-orange-300",
  write: "border-rose-500/50 bg-rose-500/15 text-rose-300",
};

interface AutomationTrackHeaderProps {
  ownerId: string;
  track?: Track;
  master?: boolean;
}

export function AutomationTrackHeader({ ownerId, track, master = false }: AutomationTrackHeaderProps) {
  const project = useDAW((state) => state.project);
  const ui = useDAW((state) => state.ui);
  const mode = project.automationModes?.[ownerId] ?? "off";
  const parameters = automationParameters(track, master);
  const selectedId = ui.automationSelections[ownerId] ?? parameters[0]?.id ?? "";
  const selectedParameter = parameters.find((parameter) => parameter.id === selectedId) ?? parameters[0];
  const lanes = (project.automationLanes ?? []).filter((lane) => lane.ownerId === ownerId);
  const selectedRegionId = track?.regions.find((region) => ui.selectedRegionIds.includes(region.id))?.id;
  const expanded = ui.automationExpandedTracks.includes(ownerId);
  const makeLane = useCallback((
    parameter: NonNullable<typeof selectedParameter>,
    scope: "track" | "region" = "track",
    regionId?: string
  ) => createAutomationLane(ownerId, {
    ...parameter,
    value: master && parameter.id === "volume"
      ? project.masterVolume
      : master && parameter.id === "tempo"
        ? project.tempo
        : parameter.value,
  }, scope, regionId), [master, ownerId, project.masterVolume, project.tempo]);

  useEffect(() => {
    if (!selectedParameter) return;
    if (!ui.automationSelections[ownerId]) {
      useDAW.getState().setUI({
        automationSelections: { ...ui.automationSelections, [ownerId]: selectedParameter.id },
      });
    }
    if (!lanes.some((lane) => lane.parameterId === selectedParameter.id)) {
      const lane = makeLane(selectedParameter);
      useDAW.getState().saveAutomationLane(lane);
    }
  }, [lanes, makeLane, ownerId, selectedParameter, ui.automationSelections]);

  if (!parameters.length) return null;

  return (
    <div
      className="mt-1 flex min-w-0 items-center gap-1.5 border-t border-white/5 pt-1"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <label className="flex items-center gap-1">
        <span className="text-[8px] uppercase tracking-wider text-zinc-600">Mode</span>
        <select
          aria-label={`${master ? "Master" : track?.name} automation mode`}
          value={mode}
          onChange={(event) =>
            useDAW.getState().setAutomationMode(ownerId, event.target.value as AutomationMode)
          }
          className={`h-5 max-w-[74px] rounded border px-1 text-[9px] font-semibold outline-none ${modeStyle[mode]}`}
        >
          <option value="off">Off</option>
          <option value="read">Read</option>
          <option value="touch">Touch</option>
          <option value="latch">Latch</option>
          <option value="write">Write</option>
        </select>
      </label>
      <select
        aria-label={`${master ? "Master" : track?.name} automation parameter`}
        value={selectedParameter?.id ?? ""}
        onChange={(event) => {
          const parameter = parameters.find((item) => item.id === event.target.value);
          if (!parameter) return;
          const state = useDAW.getState();
          state.setUI({
            automationSelections: { ...state.ui.automationSelections, [ownerId]: parameter.id },
          });
          if (!lanes.some((lane) => lane.parameterId === parameter.id)) {
            state.saveAutomationLane(makeLane(parameter));
          }
        }}
        className="h-5 min-w-0 flex-1 rounded border border-black/50 bg-[#202024] px-1 text-[9px] text-zinc-300 outline-none"
      >
        {[...new Set(parameters.map((parameter) => parameter.group))].map((group) => (
          <optgroup key={group} label={group}>
            {parameters.filter((parameter) => parameter.group === group).map((parameter) => (
              <option key={parameter.id} value={parameter.id}>{parameter.label}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <button
        type="button"
        aria-label={expanded ? "Collapse automation lanes" : "Expand automation lanes"}
        aria-expanded={expanded}
        title={expanded ? "Show selected lane only" : `Show all ${lanes.length} automation lanes`}
        onClick={() => {
          const state = useDAW.getState();
          const next = new Set(state.ui.automationExpandedTracks);
          if (next.has(ownerId)) next.delete(ownerId);
          else next.add(ownerId);
          state.setUI({ automationExpandedTracks: [...next] });
        }}
        className="flex h-5 shrink-0 items-center gap-0.5 rounded px-1 text-[8px] text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
      >
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {lanes.length}
      </button>
      {selectedRegionId && selectedParameter && (
        <button
          type="button"
          title="Create region automation for the selected clip"
          aria-label="Create region automation"
          onClick={() => {
            if (lanes.some((lane) => lane.parameterId === selectedParameter.id && lane.regionId === selectedRegionId)) return;
            useDAW.getState().saveAutomationLane(
              makeLane(selectedParameter, "region", selectedRegionId)
            );
          }}
          className="h-5 shrink-0 rounded px-1 text-[8px] text-cyan-300 hover:bg-cyan-300/10"
        >
          Clip
        </button>
      )}
    </div>
  );
}
