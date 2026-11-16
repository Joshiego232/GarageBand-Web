// ============================================================
// Central DAW state (zustand). UI reads project + ui; all edits
// flow through actions with automatic undo/redo snapshots.
// ============================================================
"use client";

import { create } from "zustand";
import {
  PPQ,
  DEFAULT_EQ,
  TRACK_SIZES,
  uid,
  type Project,
  type ChordRegion,
  type Track,
  type Region,
  type Note,
  type UIState,
  type TransportState,
  type TrackSize,
  type PanelKey,
  type ModalKind,
  type EditorMode,
  type SnapMode,
  type Tool,
  type EqSettings,
  type TrackStack,
  type ScreenSet,
  type ProjectAlternative,
  type AutomationLane,
  type AutomationMode,
  type AutomationPoint,
} from "./types";
import { automationEngine, automationValueAt, type RecordedAutomationPoint } from "./AutomationEngine";
import { emptyProject, makeTrack } from "./loops";
import { PATCHES, defaultParams } from "./instruments";
import { clamp, barTicks, snapTicks, snapTick } from "./utils";

interface DAWState {
  project: Project;
  ui: UIState;
  transport: TransportState;
  past: Project[];
  future: Project[];

  // history
  commit: () => void;
  undo: () => void;
  redo: () => void;

  // project meta
  loadProject: (p: Project) => void;
  setProjectName: (name: string) => void;
  setProjectLengthBars: (bars: number) => void;
  setTempo: (bpm: number) => void;
  setTimeSig: (n: number, d: number) => void;
  setKey: (tonic: number, mode: "major" | "minor") => void;
  setCycle: (on: boolean, start?: number, end?: number) => void;
  setMasterVolume: (v: number) => void;
  setAutomationMode: (ownerId: string, mode: AutomationMode) => void;
  saveAutomationLane: (lane: AutomationLane) => void;
  appendAutomationPoints: (points: RecordedAutomationPoint[]) => void;
  setAudioOutputDevice: (deviceId: string | null) => void;
  setMidiCCMappings: (mappings: Project["midiCCMappings"]) => void;
  setCountIn: (on: boolean) => void;
  setMetronome: (on: boolean) => void;
  setChordRegions: (regions: ChordRegion[]) => void;

  // transport mirror
  setTransport: (t: Partial<TransportState>) => void;

  // tracks
  addTrack: (partial: Partial<Track> & { type: "midi" | "audio" }) => void;
  addTracks: (tracks: Partial<Track> & { type: "midi" | "audio" }[]) => void;
  removeTrack: (id: string) => void;
  duplicateTrack: (id: string) => void;
  updateTrack: (id: string, patch: Partial<Track>, commit?: boolean) => void;
  setTrackInstrument: (id: string, instrument: string) => void;
  createAuxBus: (name?: string) => string;
  createVca: (name?: string) => string;
  setTrackRouting: (id: string, outputBusId?: string | null, vcaId?: string | null, commit?: boolean) => void;
  createTrackStack: (name: string, type: TrackStack["type"], trackIds: string[]) => string | null;
  removeTrackStack: (id: string) => void;
  toggleTrackStack: (id: string) => void;
  saveAlternative: (name: string) => string;
  loadAlternative: (id: string) => void;
  saveScreenset: (name: string) => string;
  loadScreenset: (id: string) => void;
  selectTrack: (id: string | null, additive?: boolean, rangeIds?: string[]) => void;
  renameTrackStack: (id: string, name: string) => void;
  setTrackStackColor: (id: string, color: string) => void;
  toggleTrackMute: (id: string) => void;
  toggleTrackSolo: (id: string) => void;

  // regions
  addRegion: (region: Region) => void;
  addRegions: (regions: Region[]) => void;
  replaceRegionWithSegments: (regionId: string, segments: Region[]) => void;
  createAudioComp: (trackId: string, takeIds: string[], segments: Region[]) => void;
  removeRegions: (ids: string[]) => void;
  moveRegions: (ids: string[], deltaTick: number, toTrackId?: string) => void;
  setRegionStart: (id: string, start: number, length?: number) => void;
  updateRegion: (id: string, patch: Partial<Region>, commit?: boolean) => void;
  updateRegions: (ids: string[], patch: Partial<Region>) => void;
  duplicateRegions: (ids: string[]) => void;
  splitRegionsAt: (tick: number) => void;
  joinRegions: (ids: string[]) => void;
  toggleRegionLoop: (ids: string[]) => void;
  transposeRegions: (ids: string[], semitones: number) => void;
  shiftRegionVelocity: (ids: string[], delta: number) => void;
  quantizeRegions: (ids: string[], gridTicks: number) => void;

  // notes (piano roll)
  addNote: (regionId: string, note: Omit<Note, "id">) => void;
  updateNotes: (regionId: string, ids: string[], patch: Partial<Note>) => void;
  moveNotes: (regionId: string, ids: string[], deltaTick: number, deltaPitch: number) => void;
  removeNotes: (regionId: string, ids: string[]) => void;
  quantizeNotes: (regionId: string, ids: string[], gridTicks: number) => void;

  // selection + ui
  selectRegion: (id: string | null, additive?: boolean) => void;
  selectRegions: (ids: string[]) => void;
  selectNote: (id: string | null, additive?: boolean) => void;
  setUI: (patch: Partial<UIState>) => void;
  setTool: (tool: Tool) => void;
  setSnap: (snap: SnapMode) => void;
  setZoom: (zoom: number) => void;
  setTrackSize: (size: TrackSize) => void;
  togglePanel: (key: PanelKey) => void;
  setEditorMode: (mode: EditorMode) => void;
  setModal: (modal: ModalKind) => void;
  openRegionInEditor: (regionId: string) => void;
}

function cloneProject(p: Project): Project {
  return JSON.parse(JSON.stringify(p)) as Project;
}

function mapRegions(
  project: Project,
  ids: string[],
  fn: (r: Region) => Region | null
): Project {
  const idSet = new Set(ids);
  const tracks = project.tracks.map((t) => ({
    ...t,
    regions: t.regions.flatMap((r) => {
      if (!idSet.has(r.id)) return [r];
      const next = fn(r);
      return next ? [next] : [];
    }),
  }));
  return { ...project, tracks };
}

function findRegion(project: Project, id: string): { track: Track; region: Region } | null {
  for (const t of project.tracks) {
    for (const r of t.regions) {
      if (r.id === id) return { track: t, region: r };
    }
  }
  return null;
}

const initialUI: UIState = {
  tool: "pointer",
  snap: "smart",
  zoom: 56,
  trackSize: "M",
  selectedTrackId: null,
  selectedTrackIds: [],
  selectedRegionIds: [],
  selectedNoteIds: [],
  panels: {
    library: true,
    loops: false,
    mixer: false,
    editor: false,
    keyboard: false,
    help: false,
    liveLoops: false,
  },
  editorMode: "smart",
  editorRegionId: null,
  modal: "none",
  followPlayhead: true,
  musicalTyping: false,
  octaveBase: 3,
  velocity: 96,
  keyboardScaleLock: false,
  keyboardScaleRoot: 0,
  keyboardScaleMode: "major",
  keyboardChordStrips: [],
  automationView: false,
  showMasterTrack: false,
  automationSelections: {},
  automationExpandedTracks: [],
};

export const useDAW = create<DAWState>((set, get) => ({
  project: emptyProject(),
  ui: initialUI,
  transport: { playing: false, recording: false, countInRemaining: 0 },
  past: [],
  future: [],

  commit: () => {
    const { project, past } = get();
    set({ past: [...past.slice(-59), cloneProject(project)], future: [] });
  },

  undo: () => {
    const { past, future, project } = get();
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    set({
      project: prev,
      past: past.slice(0, -1),
      future: [cloneProject(project), ...future.slice(0, 59)],
    });
  },

  redo: () => {
    const { past, future, project } = get();
    if (future.length === 0) return;
    const next = future[0];
    set({
      project: next,
      past: [...past, cloneProject(project)],
      future: future.slice(1),
    });
  },

  // ---------------- project meta ----------------

  loadProject: (p) => {
    const normalized: Project = {
      ...p,
      lengthBars: p.lengthBars !== undefined && Number.isFinite(p.lengthBars)
        ? clamp(Math.round(p.lengthBars), 1, 999)
        : undefined,
      stacks: p.stacks ?? [],
      alternatives: p.alternatives ?? [],
      screensets: p.screensets ?? [],
      audioOutputDeviceId: p.audioOutputDeviceId ?? null,
      midiCCMappings: p.midiCCMappings ?? [],
      automationLanes: (p.automationLanes ?? []).map((lane) => ({
        ...lane,
        points: [...lane.points].sort((a, b) => a.tick - b.tick),
      })),
      automationModes: p.automationModes ?? {},
      chordRegions: p.chordRegions ?? [],
      tracks: p.tracks.map((track) => ({
        ...track,
        role: track.role ?? "track",
        outputBusId: track.outputBusId ?? null,
        vcaId: track.vcaId ?? null,
        stackId: track.stackId ?? null,
        parentTrackId: track.parentTrackId ?? null,
        collapsed: track.collapsed ?? false,
        sampleZones: track.sampleZones ?? [],
        sampleDrumKit: track.sampleDrumKit ?? false,
        midiPlugins: (track.midiPlugins ?? []).map((plugin) =>
          plugin.pluginId === "velocity-humanizer"
            ? {
                ...plugin,
                pluginId: "scripter",
                script: `humanize(${plugin.params.amount ?? 8})`,
              }
            : plugin
        ),
      })),
    };
    set({
      project: normalized,
      past: [],
      future: [],
      ui: {
        ...get().ui,
        selectedRegionIds: [],
        selectedNoteIds: [],
        selectedTrackId: normalized.tracks[0]?.id ?? null,
        selectedTrackIds: normalized.tracks[0] ? [normalized.tracks[0].id] : [],
        modal: "none",
        editorRegionId: null,
      },
    });
  },

  setProjectName: (name) => set({ project: { ...get().project, name } }),

  setProjectLengthBars: (bars) => {
    if (!Number.isFinite(bars)) return;
    set({
      project: {
        ...get().project,
        lengthBars: clamp(Math.round(bars), 1, 999),
      },
    });
  },

  setTempo: (bpm) => {
    set({ project: { ...get().project, tempo: clamp(Math.round(bpm), 30, 260) } });
  },

  setTimeSig: (n, d) => set({ project: { ...get().project, timeSig: [clamp(n, 1, 12), d] } }),

  setKey: (tonic, mode) => set({ project: { ...get().project, keyTonic: ((tonic % 12) + 12) % 12, keyMode: mode } }),
  setChordRegions: (regions) => {
    const { project, past, future } = get();
    set({
      project: { ...project, chordRegions: regions },
      past: [...past, cloneProject(project)],
      future: [],
    });
  },

  setCycle: (on, start, end) => {
    const p = get().project;
    set({
      project: {
        ...p,
        cycleOn: on,
        cycleStart: start !== undefined ? Math.max(0, start) : p.cycleStart,
        cycleEnd: end !== undefined ? Math.max(end ?? 0, (start ?? p.cycleStart) + PPQ) : p.cycleEnd,
      },
    });
  },

  setAudioOutputDevice: (deviceId) => set({
    project: { ...get().project, audioOutputDeviceId: deviceId },
  }),
  setMidiCCMappings: (mappings) => set({
    project: { ...get().project, midiCCMappings: mappings ?? [] },
  }),
    setMasterVolume: (v) => {
      const project = get().project;
      const masterVolume = clamp(v, 0, 1.25);
      const lane = project.automationLanes?.find(
        (item) => item.ownerId === "master" && item.parameterId === "volume"
      );
      const captured = automationEngine.recordControl(
        lane,
        project.automationModes?.master ?? "off",
        masterVolume
      );
      const automationLanes = captured
        ? (project.automationLanes ?? []).map((item) =>
            item.id === captured.laneId
              ? { ...item, points: captured.replacePoints ?? [...item.points, captured.point] }
              : item
          )
        : project.automationLanes;
      set({ project: { ...project, masterVolume, automationLanes } });
    },
    setAutomationMode: (ownerId, mode) => {
      const project = get().project;
      set({ project: { ...project, automationModes: { ...project.automationModes, [ownerId]: mode } } });
    },
    saveAutomationLane: (lane) => {
      const project = get().project;
      const lanes = project.automationLanes ?? [];
      set({
        project: {
          ...project,
          automationLanes: lanes.some((item) => item.id === lane.id)
            ? lanes.map((item) => item.id === lane.id ? lane : item)
            : [...lanes, lane],
        },
      });
    },
    appendAutomationPoints: (points) => {
      if (!points.length) return;
      const project = get().project;
      const byLane = new Map<string, AutomationPoint[]>();
      for (const item of points) {
        const lane = (project.automationLanes ?? []).find((entry) => entry.id === item.laneId);
        if (!lane) continue;
        const current = byLane.get(item.laneId) ?? lane.points;
        const replacement = item.replacePoints ?? [...current, item.point];
        byLane.set(item.laneId, replacement);
      }
      if (!byLane.size) return;
      set({
        project: {
          ...project,
          automationLanes: (project.automationLanes ?? []).map((lane) => {
            const pointsForLane = byLane.get(lane.id);
            return pointsForLane ? { ...lane, points: pointsForLane } : lane;
          }),
        },
      });
    },

  setCountIn: (on) => set({ project: { ...get().project, countIn: on } }),

  setMetronome: (on) => set({ project: { ...get().project, metronome: on } }),

  setTransport: (t) => set({ transport: { ...get().transport, ...t } }),

  // ---------------- tracks ----------------

  addTrack: (partial) => {
    get().commit();
    const track = makeTrack(partial);
    set({
      project: { ...get().project, tracks: [...get().project.tracks, track] },
      ui: { ...get().ui, selectedTrackId: track.id, selectedTrackIds: [track.id], selectedRegionIds: [] },
    });
  },

  addTracks: (partials) => {
    get().commit();
    const tracks = partials.map((p) => makeTrack(p));
    set({
      project: { ...get().project, tracks: [...get().project.tracks, ...tracks] },
      ui: { ...get().ui, selectedTrackId: tracks[tracks.length - 1]?.id ?? get().ui.selectedTrackId, selectedTrackIds: tracks.length ? [tracks[tracks.length - 1].id] : get().ui.selectedTrackIds },
    });
  },

  removeTrack: (id) => {
    get().commit();
    const project = get().project;
    const removed = project.tracks.find((track) => track.id === id);
    const candidateStacks = (project.stacks ?? []).map((stack) => ({
      ...stack,
      trackIds: stack.trackIds.filter((trackId) => trackId !== id),
    }));
    const removedStackIds = new Set(
      candidateStacks
        .filter((stack) =>
          stack.trackIds.length < 2 || stack.busTrackId === id || stack.folderTrackId === id
        )
        .map((stack) => stack.id)
    );
    const removedFolderIds = new Set(
      candidateStacks.flatMap((stack) =>
        removedStackIds.has(stack.id) ? [stack.folderTrackId] : []
      )
    );
    const removedBusIds = new Set([
      ...(removed?.role === "aux" ? [id] : []),
      ...candidateStacks.flatMap((stack) =>
        removedStackIds.has(stack.id) && stack.busTrackId ? [stack.busTrackId] : []
      ),
    ]);
    const removedVcaId = removed?.role === "vca" ? id : null;
    const tracks = project.tracks
      .filter((track) =>
        track.id !== id && !removedBusIds.has(track.id) && !removedFolderIds.has(track.id)
      )
      .map((track) => ({
        ...track,
        outputBusId: removedBusIds.has(track.outputBusId ?? "") ? null : track.outputBusId,
        vcaId: removedVcaId && track.vcaId === removedVcaId ? null : track.vcaId,
        stackId: removedStackIds.has(track.stackId ?? "") ? null : track.stackId,
        parentTrackId: removedStackIds.has(track.stackId ?? "") ? null : track.parentTrackId,
      }));
    const stacks = candidateStacks.filter((stack) => !removedStackIds.has(stack.id));
    const deletedTrackIds = new Set([id, ...removedBusIds, ...removedFolderIds]);
    const deletedRegionIds = new Set(
      project.tracks
        .filter((track) => deletedTrackIds.has(track.id))
        .flatMap((track) => track.regions.map((region) => region.id))
    );
    set({
      project: {
        ...project,
        tracks,
        stacks,
        automationLanes: (project.automationLanes ?? []).filter(
          (lane) => !deletedTrackIds.has(lane.ownerId) &&
            (lane.scope !== "region" || !lane.regionId || !deletedRegionIds.has(lane.regionId))
        ),
      },
      ui: {
        ...get().ui,
        selectedTrackId: tracks[0]?.id ?? null,
        selectedTrackIds: tracks[0] ? [tracks[0].id] : [],
        selectedRegionIds: get().ui.selectedRegionIds.filter((rid) =>
          tracks.some((track) => track.regions.some((region) => region.id === rid))
        ),
      },
    });
  },

  duplicateTrack: (id) => {
    get().commit();
    const project = get().project;
    const idx = project.tracks.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const src = project.tracks[idx];
    const copy: Track = JSON.parse(JSON.stringify(src));
    copy.id = uid();
    copy.name = `${src.name} Copy`;
    for (const r of copy.regions) {
      r.id = uid();
      r.trackId = copy.id;
      if (r.notes) r.notes = r.notes.map((n) => ({ ...n, id: uid() }));
    }
    const tracks = [...project.tracks];
    tracks.splice(idx + 1, 0, copy);
    const regionIdMap = new Map(src.regions.map((region, index) => [region.id, copy.regions[index].id]));
    const copiedLanes = (project.automationLanes ?? [])
      .filter((lane) => lane.ownerId === id)
      .flatMap((lane) => {
        const regionId = lane.regionId ? regionIdMap.get(lane.regionId) : undefined;
        if (lane.scope === "region" && !regionId) return [];
        return [{ ...JSON.parse(JSON.stringify(lane)), id: uid(), ownerId: copy.id, regionId }];
      });
    set({
      project: { ...project, tracks, automationLanes: [...(project.automationLanes ?? []), ...copiedLanes] },
      ui: { ...get().ui, selectedTrackId: copy.id, selectedTrackIds: [copy.id] },
    });
  },

  updateTrack: (id, patch, doCommit = true) => {
    if (doCommit) get().commit();
    const project = get().project;
    let automationLanes = project.automationLanes ?? [];
    const track = project.tracks.find((item) => item.id === id);
    const selectedRegionId = track?.regions.find((region) =>
      get().ui.selectedRegionIds.includes(region.id)
    )?.id;
    const capture = (parameterId: string, value: number) => {
      const lane = automationLanes.find((item) =>
        item.ownerId === id && item.parameterId === parameterId && item.regionId === selectedRegionId
      ) ?? automationLanes.find((item) =>
        item.ownerId === id && item.parameterId === parameterId && item.scope === "track"
      );
      const tickOffset = lane?.scope === "region" && lane.regionId
        ? track?.regions.find((region) => region.id === lane.regionId)?.start ?? 0
        : 0;
      const point = automationEngine.recordControl(
        lane,
        project.automationModes?.[id] ?? "off",
        value,
        tickOffset
      );
      if (!point) return;
      automationLanes = automationLanes.map((item) =>
        item.id === point.laneId
          ? { ...item, points: point.replacePoints ?? [...item.points, point.point] }
          : item
      );
    };
    if (patch.volume !== undefined && patch.volume !== track?.volume) capture("volume", patch.volume);
    if (patch.pan !== undefined && patch.pan !== track?.pan) capture("pan", patch.pan);
    if (patch.mute !== undefined && patch.mute !== track?.mute) capture("mute", patch.mute ? 1 : 0);
    if (patch.params && track) {
      for (const [parameterId, value] of Object.entries(patch.params)) {
        if (typeof value === "number" && value !== track.params[parameterId]) capture(`param:${parameterId}`, value);
      }
    }
    if (patch.eq && track) {
      for (const [parameterId, value] of Object.entries(patch.eq)) {
        if (typeof value === "number" && value !== track.eq[parameterId as keyof Track["eq"]]) {
          capture(`eq:${parameterId}`, value);
        }
      }
    }
    if (patch.pedalboard && track) {
      for (const pedal of patch.pedalboard) {
        const previousPedal = track.pedalboard?.find((item) => item.id === pedal.id);
        if (!previousPedal) continue;
        for (const [parameterId, value] of Object.entries(pedal.params)) {
          if (value !== previousPedal.params[parameterId]) {
            capture(`pedal:${pedal.id}:${parameterId}`, value);
          }
        }
      }
    }
    set({
      project: {
        ...project,
        automationLanes,
        tracks: project.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      },
    });
  },

  setTrackInstrument: (id, instrument) => {
    get().commit();
    const project = get().project;
    const patch = PATCHES[instrument];
    set({
      project: {
        ...project,
        tracks: project.tracks.map((t) =>
          t.id === id
            ? {
                ...t,
                instrument,
                soundFontPreset: undefined,
                params: { ...defaultParams(instrument) },
                icon: patch?.icon ?? t.icon,
                name: t.type === "midi" ? patch?.name ?? t.name : t.name,
              }
            : t
        ),
      },
    });
  },

  createAuxBus: (name) => {
    get().commit();
    const project = get().project;
    const index = project.tracks.filter((track) => track.role === "aux").length + 1;
    const bus = makeTrack({
      type: "audio",
      role: "aux",
      name: name?.trim() || `Aux ${index}`,
      icon: "audio-lines",
      color: "#4ca8a0",
      volume: 0.9,
      regions: [],
    });
    set({
      project: { ...project, tracks: [...project.tracks, bus] },
      ui: { ...get().ui, selectedTrackId: bus.id, selectedTrackIds: [bus.id] },
    });
    return bus.id;
  },

  createVca: (name) => {
    get().commit();
    const project = get().project;
    const index = project.tracks.filter((track) => track.role === "vca").length + 1;
    const vca = makeTrack({
      type: "audio",
      role: "vca",
      name: name?.trim() || `VCA ${index}`,
      icon: "sliders-horizontal",
      color: "#b38ad9",
      volume: 1,
      regions: [],
    });
    set({
      project: { ...project, tracks: [...project.tracks, vca] },
      ui: { ...get().ui, selectedTrackId: vca.id, selectedTrackIds: [vca.id] },
    });
    return vca.id;
  },

  setTrackRouting: (id, outputBusId, vcaId, doCommit = true) => {
    const project = get().project;
    const source = project.tracks.find((track) => track.id === id);
    if (!source || source.role === "vca") return;

    let safeBusId = outputBusId ?? null;
    if (safeBusId) {
      const seen = new Set([id]);
      let currentId: string | null = safeBusId;
      while (currentId) {
        if (seen.has(currentId)) {
          safeBusId = null;
          break;
        }
        seen.add(currentId);
        const target = project.tracks.find((track) => track.id === currentId);
        if (!target || target.role !== "aux") {
          safeBusId = null;
          break;
        }
        currentId = target.outputBusId ?? null;
      }
    }

    const vca = vcaId ? project.tracks.find((track) => track.id === vcaId) : null;
    const safeVcaId = vca?.role === "vca" && vca.id !== id ? vca.id : null;
    if (doCommit) get().commit();
    set({
      project: {
        ...project,
        tracks: project.tracks.map((track) =>
          track.id === id
            ? { ...track, outputBusId: safeBusId, vcaId: safeVcaId }
            : track
        ),
      },
    });
  },

  createTrackStack: (name, type, trackIds) => {
    const project = get().project;
    const uniqueIds = [...new Set(trackIds)].filter((id) =>
      project.tracks.some((track) => track.id === id && (track.role ?? "track") === "track")
    );
    if (uniqueIds.length < 2) return null;

    get().commit();
    const stackId = uid();
    const stackName = name.trim() || (type === "folder" ? "Track Stack" : "Summing Stack");
    const sharedOutputBusIds = [...new Set(
      uniqueIds.map((id) =>
        project.tracks.find((track) => track.id === id)?.outputBusId ?? null,
      ),
    )];
    const folder = makeTrack({
      type: "audio",
      role: "folder",
      name: stackName,
      icon: "folder",
      color: "#596d8b",
      volume: 1,
      outputBusId: type === "folder" && sharedOutputBusIds.length === 1
        ? sharedOutputBusIds[0]
        : null,
      collapsed: false,
      regions: [],
    });
    let busTrack: Track | undefined;
    if (type === "summing") {
      busTrack = makeTrack({
        type: "audio",
        role: "aux",
        name: `${stackName} Bus`,
        icon: "audio-lines",
        color: "#4ca8a0",
        volume: 0.9,
        regions: [],
      });
    }

    const stack: TrackStack = {
      id: stackId,
      name: stackName,
      type,
      trackIds: uniqueIds,
      folderTrackId: folder.id,
      color: folder.color,
      ...(busTrack ? { busTrackId: busTrack.id } : {}),
    };

    const remainingStacks = (project.stacks ?? []).map((existing) => ({
      ...existing,
      trackIds: existing.trackIds.filter((id) => !uniqueIds.includes(id)),
    }));
    const removedStackIds = new Set(
      remainingStacks
        .filter((existing) => existing.trackIds.length < 2)
        .map((existing) => existing.id)
    );
    const removedFolderIds = new Set(
      remainingStacks.flatMap((existing) =>
        removedStackIds.has(existing.id) ? [existing.folderTrackId] : []
      )
    );
    const removedBusIds = new Set(
      remainingStacks.flatMap((existing) =>
        removedStackIds.has(existing.id) && existing.busTrackId ? [existing.busTrackId] : []
      )
    );
    const stacks = remainingStacks.filter((existing) => !removedStackIds.has(existing.id));

    let tracks = project.tracks
      .filter((track) =>
        !removedFolderIds.has(track.id) && !removedBusIds.has(track.id)
      )
      .map((track) => {
        const belongs = uniqueIds.includes(track.id);
        if (belongs) {
          return {
            ...track,
            stackId,
            parentTrackId: folder.id,
            ...(busTrack ? { outputBusId: busTrack.id } : {}),
          };
        }
        if (removedStackIds.has(track.stackId ?? "")) {
          return {
            ...track,
            stackId: null,
            parentTrackId: null,
            ...(removedBusIds.has(track.outputBusId ?? "") ? { outputBusId: null } : {}),
          };
        }
        return track;
      });

    const firstMemberIndex = tracks.findIndex((track) => uniqueIds.includes(track.id));
    const insertIndex = tracks
      .slice(0, Math.max(0, firstMemberIndex))
      .filter((track) => !uniqueIds.includes(track.id)).length;
    const selectedMembers = tracks.filter((track) => uniqueIds.includes(track.id));
    tracks = tracks.filter((track) => !uniqueIds.includes(track.id));
    tracks.splice(insertIndex, 0, folder, ...selectedMembers);
    if (busTrack) tracks.push(busTrack);

    set({
      project: { ...project, tracks, stacks: [...stacks, stack] },
      ui: { ...get().ui, selectedTrackId: folder.id, selectedTrackIds: [folder.id] },
    });
    return stackId;
  },

  removeTrackStack: (id) => {
    const project = get().project;
    const stack = project.stacks?.find((item) => item.id === id);
    if (!stack) return;
    get().commit();
    set({
      project: {
        ...project,
        tracks: project.tracks
          .filter((track) => track.id !== stack.busTrackId && track.id !== stack.folderTrackId)
          .map((track) => ({
            ...track,
            stackId: track.stackId === id ? null : track.stackId,
            parentTrackId: track.stackId === id ? null : track.parentTrackId,
            outputBusId:
              stack.busTrackId && track.outputBusId === stack.busTrackId
                ? null
                : track.outputBusId,
          })),
        stacks: (project.stacks ?? []).filter((item) => item.id !== id),
      },
    });
  },

  toggleTrackStack: (id) => {
    const project = get().project;
    const stack = project.stacks?.find((item) => item.id === id);
    if (!stack) return;
    set({
      project: {
        ...project,
        tracks: project.tracks.map((track) =>
          track.id === stack.folderTrackId
            ? { ...track, collapsed: !track.collapsed }
            : track
        ),
      },
    });
  },

  renameTrackStack: (id, name) => {
    const stack = get().project.stacks?.find((item) => item.id === id);
    const cleanName = name.trim();
    if (!stack || !cleanName) return;
    get().commit();
    set({
      project: {
        ...get().project,
        stacks: get().project.stacks?.map((item) =>
          item.id === id ? { ...item, name: cleanName } : item
        ),
        tracks: get().project.tracks.map((track) =>
          track.id === stack.folderTrackId
            ? { ...track, name: cleanName }
            : track.id === stack.busTrackId
              ? { ...track, name: `${cleanName} Bus` }
              : track
        ),
      },
    });
  },

  setTrackStackColor: (id, color) => {
    const stack = get().project.stacks?.find((item) => item.id === id);
    if (!stack) return;
    get().commit();
    set({
      project: {
        ...get().project,
        stacks: get().project.stacks?.map((item) => item.id === id ? { ...item, color } : item),
        tracks: get().project.tracks.map((track) =>
          track.id === stack.folderTrackId ? { ...track, color } : track
        ),
      },
    });
  },

  saveAlternative: (name) => {
    const project = get().project;
    const snapshot = { ...project, alternatives: [] };
    const alternative: ProjectAlternative = {
      id: uid(),
      name: name.trim() || `Alternative ${(project.alternatives ?? []).length + 1}`,
      snapshot: JSON.stringify(snapshot),
      savedAt: new Date().toISOString(),
    };
    set({ project: { ...project, alternatives: [...(project.alternatives ?? []), alternative] } });
    return alternative.id;
  },

  loadAlternative: (id) => {
    const project = get().project;
    const alternative = project.alternatives?.find((item) => item.id === id);
    if (!alternative) return;
    let snapshot: Project;
    try {
      snapshot = JSON.parse(alternative.snapshot) as Project;
    } catch {
      return;
    }
    get().commit();
    set({
      project: {
        ...snapshot,
        stacks: snapshot.stacks ?? [],
        alternatives: project.alternatives ?? [],
        screensets: project.screensets ?? [],
      },
      ui: {
        ...get().ui,
        selectedTrackId: snapshot.tracks[0]?.id ?? null,
        selectedTrackIds: snapshot.tracks[0] ? [snapshot.tracks[0].id] : [],
        selectedRegionIds: [],
        selectedNoteIds: [],
        editorRegionId: null,
      },
    });
  },

  saveScreenset: (name) => {
    const project = get().project;
    const currentUI = get().ui;
    const screenset: ScreenSet = {
      id: uid(),
      name: name.trim() || `Screenset ${(project.screensets ?? []).length + 1}`,
      panels: { ...currentUI.panels },
      editorMode: currentUI.editorMode,
      trackSize: currentUI.trackSize,
      zoom: currentUI.zoom,
    };
    set({ project: { ...project, screensets: [...(project.screensets ?? []), screenset] } });
    return screenset.id;
  },

  loadScreenset: (id) => {
    const screenset = get().project.screensets?.find((item) => item.id === id);
    if (!screenset) return;
    set({
      ui: {
        ...get().ui,
        panels: { ...screenset.panels },
        editorMode: screenset.editorMode,
        trackSize: screenset.trackSize,
        zoom: screenset.zoom,
      },
    });
  },

  selectTrack: (id, additive = false, rangeIds) => {
    const ui = get().ui;
    let selectedTrackIds: string[];
    let selectedTrackId = id;
    if (id === null) selectedTrackIds = [];
    else if (rangeIds?.length) selectedTrackIds = [...new Set(rangeIds)];
    else if (additive) {
      selectedTrackIds = ui.selectedTrackIds.includes(id)
        ? ui.selectedTrackIds.filter((trackId) => trackId !== id)
        : [...ui.selectedTrackIds, id];
      if (!selectedTrackIds.length) selectedTrackIds = [id];
      else if (!selectedTrackIds.includes(id)) selectedTrackId = selectedTrackIds[selectedTrackIds.length - 1];
    } else {
      selectedTrackIds = [id];
    }
    set({
      ui: {
        ...ui,
        selectedTrackId,
        selectedTrackIds,
        selectedNoteIds: [],
      },
    });
  },

  toggleTrackMute: (id) => {
    const project = get().project;
    const t = project.tracks.find((x) => x.id === id);
    if (!t) return;
    const childIds = get().project.stacks?.find((stack) => stack.folderTrackId === id)?.trackIds ?? [];
    const memberIds = new Set([id, ...childIds]);
    const mute = !t.mute;
    const lanes = project.automationLanes ?? [];
    const lane = lanes.find((item) => item.ownerId === id && item.parameterId === "mute" && item.scope === "track");
    const point = automationEngine.recordControl(
      lane,
      project.automationModes?.[id] ?? "off",
      mute ? 1 : 0
    );
    set({
      project: {
        ...project,
        automationLanes: point
          ? lanes.map((item) => item.id === point.laneId
              ? { ...item, points: point.replacePoints ?? [...item.points, point.point] }
              : item)
          : project.automationLanes,
        tracks: project.tracks.map((track) =>
          memberIds.has(track.id) ? { ...track, mute } : track
        ),
      },
    });
  },

  toggleTrackSolo: (id) => {
    const t = get().project.tracks.find((x) => x.id === id);
    if (!t) return;
    const childIds = get().project.stacks?.find((stack) => stack.folderTrackId === id)?.trackIds ?? [];
    const memberIds = new Set([id, ...childIds]);
    const solo = !t.solo;
    set({
      project: {
        ...get().project,
        tracks: get().project.tracks.map((track) =>
          memberIds.has(track.id) ? { ...track, solo } : track
        ),
      },
    });
  },

  // ---------------- regions ----------------

  addRegion: (region) => {
    get().commit();
    const project = get().project;
    set({
      project: {
        ...project,
        tracks: project.tracks.map((t) =>
          t.id === region.trackId ? { ...t, regions: [...t.regions, region] } : t
        ),
      },
      ui: { ...get().ui, selectedRegionIds: [region.id], selectedTrackId: region.trackId, selectedTrackIds: [region.trackId], selectedNoteIds: [] },
    });
  },

  addRegions: (regions) => {
    get().commit();
    const project = get().project;
    const trackMap = new Map<string, Region[]>();
    for (const r of regions) {
      const arr = trackMap.get(r.trackId) ?? [];
      arr.push(r);
      trackMap.set(r.trackId, arr);
    }
    set({
      project: {
        ...project,
        tracks: project.tracks.map((t) =>
          trackMap.has(t.id) ? { ...t, regions: [...t.regions, ...(trackMap.get(t.id) ?? [])] } : t
        ),
      },
      ui: { ...get().ui, selectedRegionIds: regions.map((r) => r.id), selectedTrackId: regions[regions.length - 1]?.trackId ?? get().ui.selectedTrackId, selectedTrackIds: regions.length ? [regions[regions.length - 1].trackId] : get().ui.selectedTrackIds },
    });
  },

  replaceRegionWithSegments: (regionId, segments) => {
    const project = get().project;
    const found = findRegion(project, regionId);
    if (!found || segments.some((segment) => segment.trackId !== found.track.id)) return;
    get().commit();
    set({
      project: {
        ...project,
        tracks: project.tracks.map((track) =>
          track.id === found.track.id
            ? {
                ...track,
                regions: [
                  ...track.regions.filter((region) => region.id !== regionId),
                  ...segments,
                ].sort((a, b) => a.start - b.start),
              }
            : track
        ),
      },
      ui: {
        ...get().ui,
        selectedTrackId: found.track.id,
        selectedTrackIds: [found.track.id],
        selectedRegionIds: segments.map((segment) => segment.id),
        selectedNoteIds: [],
        editorRegionId: segments[0]?.id ?? null,
      },
    });
  },

  createAudioComp: (trackId, takeIds, segments) => {
    const project = get().project;
    const track = project.tracks.find((item) => item.id === trackId);
    if (!track || track.type !== "audio" || takeIds.length < 2 || segments.length === 0) return;
    const idSet = new Set(takeIds);
    const takes = track.regions.filter((region) => idSet.has(region.id) && region.type === "audio");
    if (takes.length !== idSet.size || segments.some((segment) => segment.trackId !== trackId || segment.type !== "audio")) return;

    get().commit();
    set({
      project: {
        ...project,
        tracks: project.tracks.map((item) =>
          item.id === trackId
            ? {
                ...item,
                regions: [
                  ...item.regions.filter((region) => !idSet.has(region.id)),
                  ...segments,
                ].sort((a, b) => a.start - b.start),
              }
            : item
        ),
      },
      ui: {
        ...get().ui,
        selectedTrackId: trackId,
        selectedTrackIds: [trackId],
        selectedRegionIds: segments.map((segment) => segment.id),
        selectedNoteIds: [],
        editorRegionId: segments[0]?.id ?? null,
      },
    });
  },

  removeRegions: (ids) => {
    get().commit();
    const project = get().project;
    const regionIds = new Set(ids);
    set({
      project: {
        ...mapRegions(project, ids, () => null),
        automationLanes: (project.automationLanes ?? []).filter(
          (lane) => lane.scope !== "region" || !lane.regionId || !regionIds.has(lane.regionId)
        ),
      },
    });
    set({ ui: { ...get().ui, selectedRegionIds: [], editorRegionId: null } });
  },

  moveRegions: (ids, deltaTick, toTrackId) => {
    const project = get().project;
    const idSet = new Set(ids);
    // collect info
    const moving = new Map<string, { type: string }>();
    for (const t of project.tracks) {
      for (const r of t.regions) if (idSet.has(r.id)) moving.set(r.id, { type: r.type });
    }
    const targetTrack = toTrackId ? project.tracks.find((t) => t.id === toTrackId) : null;
    const tracks = project.tracks.map((t) => {
      const grabbed = t.regions.filter((r) => idSet.has(r.id));
      if (!grabbed.length) {
        return targetTrack && t.id === targetTrack.id
          ? t // target handled below
          : t;
      }
      if (targetTrack && targetTrack.id === t.id) {
        // move within same track
        return {
          ...t,
          regions: t.regions.map((r) => (idSet.has(r.id) ? { ...r, start: Math.max(0, r.start + deltaTick) } : r)),
        };
      }
      // remove from this track
      return { ...t, regions: t.regions.filter((r) => !idSet.has(r.id)) };
    });
    if (targetTrack) {
      const ti = tracks.findIndex((t) => t.id === targetTrack.id);
      const additions = [] as Region[];
      for (const tr of project.tracks) {
        for (const r of tr.regions) {
          if (idSet.has(r.id)) {
            // type check: midi can move to midi; audio to audio
            if (r.type === (targetTrack.type === "audio" ? "audio" : "midi")) {
              additions.push({ ...r, trackId: targetTrack.id, start: Math.max(0, r.start + deltaTick) });
            } else {
              additions.push(r);
            }
          }
        }
      }
      if (ti >= 0) tracks[ti] = { ...tracks[ti], regions: [...tracks[ti].regions, ...additions.filter((a) => a.trackId === targetTrack.id)] };
      // put back regions that couldn't move
      for (const a of additions) {
        if (a.trackId !== targetTrack.id) {
          const oi = tracks.findIndex((t) => t.id === a.trackId);
          if (oi >= 0) tracks[oi] = { ...tracks[oi], regions: [...tracks[oi].regions, a] };
        }
      }
    }
    const regionOwners = new Map(
      tracks.flatMap((track) => track.regions.map((region) => [region.id, track.id] as const))
    );
    set({
      project: {
        ...project,
        tracks,
        automationLanes: (project.automationLanes ?? []).map((lane) => {
          if (lane.scope !== "region" || !lane.regionId) return lane;
          const ownerId = regionOwners.get(lane.regionId);
          return ownerId ? { ...lane, ownerId } : lane;
        }),
      },
    });
  },

  setRegionStart: (id, start, length) => {
    const project = get().project;
    set({ project: mapRegions(project, [id], (r) => ({ ...r, start: Math.max(0, start), length: length ?? r.length })) });
  },

  updateRegion: (id, patch, doCommit = true) => {
    if (doCommit) get().commit();
    const project = get().project;
    set({ project: mapRegions(project, [id], (r) => ({ ...r, ...patch })) });
  },

  updateRegions: (ids, patch) => {
    const project = get().project;
    set({ project: mapRegions(project, ids, (r) => ({ ...r, ...patch })) });
  },

  duplicateRegions: (ids) => {
    get().commit();
    const project = get().project;
    const idSet = new Set(ids);
    const newIds: string[] = [];
    const regionCopies = new Map<string, Region>();
    const tracks = project.tracks.map((t) => {
      const copies: Region[] = [];
      for (const r of t.regions) {
        if (!idSet.has(r.id)) continue;
        const copy: Region = JSON.parse(JSON.stringify(r));
        copy.id = uid();
        copy.start = r.start + r.length;
        if (copy.notes) copy.notes = copy.notes.map((n) => ({ ...n, id: uid() }));
        newIds.push(copy.id);
        regionCopies.set(r.id, copy);
        copies.push(copy);
      }
      return copies.length ? { ...t, regions: [...t.regions, ...copies] } : t;
    });
    const copiedLanes = (project.automationLanes ?? []).flatMap((lane) => {
      if (lane.scope !== "region" || !lane.regionId || !idSet.has(lane.regionId)) return [];
      const region = regionCopies.get(lane.regionId);
      if (!region) return [];
      return [{ ...JSON.parse(JSON.stringify(lane)), id: uid(), ownerId: region.trackId, regionId: region.id }];
    });
    set({
      project: { ...project, tracks, automationLanes: [...(project.automationLanes ?? []), ...copiedLanes] },
      ui: { ...get().ui, selectedRegionIds: newIds },
    });
  },

  splitRegionsAt: (tick) => {
    get().commit();
    const project = get().project;
    const splitMap = new Map<string, { regionId: string; offset: number; trackId: string }>();
    const tracks = project.tracks.map((t) => {
      const out: Region[] = [];
      let changed = false;
      for (const r of t.regions) {
        if (tick > r.start + 8 && tick < r.start + r.length - 8) {
          changed = true;
          const left: Region = { ...r, length: tick - r.start };
          const right: Region = { ...r, id: uid(), start: tick, length: r.start + r.length - tick };
          splitMap.set(r.id, { regionId: right.id, offset: tick - r.start, trackId: t.id });
          if (r.type === "midi" && r.notes) {
            left.notes = r.notes.filter((n) => n.start < tick - r.start).map((n) => ({ ...n, length: Math.min(n.length, tick - r.start - n.start) }));
            const shift = tick - r.start;
            right.notes = r.notes
              .filter((n) => n.start + n.length > shift)
              .map((n) => {
                const cut = Math.max(0, shift - n.start);
                return { ...n, id: uid(), start: n.start - shift, length: n.length - cut };
              });
          }
          if (r.type === "audio") {
            const secPerTick = 60 / project.tempo / PPQ;
            const cutSec = (tick - r.start) * secPerTick;
            left.sampleLength = cutSec;
            left.fadeOut = Math.min(r.fadeOut ?? 0, Math.max(0, cutSec));
            right.sampleStart = (r.sampleStart ?? 0) + cutSec;
            right.sampleLength = (r.sampleLength ?? 0) - cutSec;
            right.fadeIn = Math.min(r.fadeIn ?? 0, Math.max(0, (r.sampleLength ?? 0)));
          }
          out.push(left, right);
        } else {
          out.push(r);
        }
      }
      return changed ? { ...t, regions: out } : t;
    });
    const splitLanes = (project.automationLanes ?? []).flatMap((lane) => {
      if (lane.scope !== "region" || !lane.regionId) return [lane];
      const split = splitMap.get(lane.regionId);
      if (!split) return [lane];
      const splitValue = automationValueAt(lane.points, split.offset, lane.scale);
      const leftPoints = lane.points.filter((point) => point.tick < split.offset);
      const leftBoundary = lane.points.find((point) => point.tick === split.offset);
      const rightPoints = lane.points
        .filter((point) => point.tick > split.offset)
        .map((point) => ({ ...point, tick: point.tick - split.offset }));
      const splitPoint = leftBoundary ?? { id: uid(), tick: split.offset, value: splitValue };
      return [
        { ...lane, points: [...leftPoints, splitPoint] },
        {
          ...lane,
          id: uid(),
          ownerId: split.trackId,
          regionId: split.regionId,
          points: [
            { id: uid(), tick: 0, value: splitValue },
            ...rightPoints,
          ],
        },
      ];
    });
    set({ project: { ...project, tracks, automationLanes: splitLanes } });
  },

  joinRegions: (ids) => {
    get().commit();
    const project = get().project;
    // group by track, must be adjacent midi regions
    const groups = new Map<string, Region[]>();
    for (const t of project.tracks) {
      for (const r of t.regions) {
        if (ids.includes(r.id)) {
          const arr = groups.get(t.id) ?? [];
          arr.push(r);
          groups.set(t.id, arr);
        }
      }
    }
    const tracks = project.tracks.map((t) => {
      const group = groups.get(t.id);
      if (!group || group.length < 2) return t;
      const sorted = [...group].sort((a, b) => a.start - b.start);
      const first = sorted[0];
      const merged: Region = { ...first, length: Math.max(...sorted.map((r) => r.start + r.length)) - first.start };
      merged.length = sorted[sorted.length - 1].start + sorted[sorted.length - 1].length - first.start;
      if (first.type === "midi") {
        const notes: Note[] = [];
        for (const r of sorted) {
          const shift = r.start - first.start;
          for (const n of r.notes ?? []) {
            notes.push({ ...n, start: n.start + shift });
          }
        }
        merged.notes = notes;
        merged.looped = false;
      }
      const idSet = new Set(ids);
      const kept = t.regions.filter((r) => !idSet.has(r.id));
      return { ...t, regions: [...kept, merged] };
    });
    set({ project: { ...project, tracks }, ui: { ...get().ui, selectedRegionIds: [] } });
  },

  toggleRegionLoop: (ids) => {
    get().commit();
    const project = get().project;
    const first = findRegion(project, ids[0])?.region;
    const makeLooped = !(first?.looped ?? false);
    set({
      project: mapRegions(project, ids, (r) => ({
        ...r,
        looped: makeLooped,
        coreLength: makeLooped ? (r.coreLength ?? r.notes ? contentExtent(r) : r.length) : r.coreLength,
      })),
    });
  },

  transposeRegions: (ids, semitones) => {
    const project = get().project;
    set({
      project: mapRegions(project, ids, (r) => ({
        ...r,
        notes: (r.notes ?? []).map((n) => ({ ...n, pitch: clamp(n.pitch + semitones, 0, 127) })),
      })),
    });
  },

  shiftRegionVelocity: (ids, delta) => {
    const project = get().project;
    set({
      project: mapRegions(project, ids, (r) => ({
        ...r,
        notes: (r.notes ?? []).map((n) => ({ ...n, velocity: clamp(n.velocity + delta, 1, 127) })),
      })),
    });
  },

  quantizeRegions: (ids, gridTicks) => {
    const project = get().project;
    set({
      project: mapRegions(project, ids, (r) => ({
        ...r,
        notes: (r.notes ?? []).map((n) => ({ ...n, start: snapTick(n.start, gridTicks) })),
      })),
    });
  },

  // ---------------- notes ----------------

  addNote: (regionId, note) => {
    const project = get().project;
    set({
      project: mapRegions(project, [regionId], (r) => ({
        ...r,
        notes: [...(r.notes ?? []), { ...note, id: uid() }],
      })),
    });
    // select the new note
    const reg = findRegion(get().project, regionId)?.region;
    if (reg?.notes?.length) {
      set({ ui: { ...get().ui, selectedNoteIds: [reg.notes[reg.notes.length - 1].id] } });
    }
  },

  updateNotes: (regionId, ids, patch) => {
    const project = get().project;
    const idSet = new Set(ids);
    set({
      project: mapRegions(project, [regionId], (r) => ({
        ...r,
        notes: (r.notes ?? []).map((n) => (idSet.has(n.id) ? { ...n, ...patch } : n)),
      })),
    });
  },

  moveNotes: (regionId, ids, deltaTick, deltaPitch) => {
    const project = get().project;
    const idSet = new Set(ids);
    set({
      project: mapRegions(project, [regionId], (r) => ({
        ...r,
        notes: (r.notes ?? []).map((n) =>
          idSet.has(n.id)
            ? {
                ...n,
                start: Math.max(0, n.start + deltaTick),
                pitch: clamp(n.pitch + deltaPitch, 0, 127),
              }
            : n
        ),
      })),
    });
  },

  removeNotes: (regionId, ids) => {
    const project = get().project;
    const idSet = new Set(ids);
    set({
      project: mapRegions(project, [regionId], (r) => ({
        ...r,
        notes: (r.notes ?? []).filter((n) => !idSet.has(n.id)),
      })),
    });
    set({ ui: { ...get().ui, selectedNoteIds: [] } });
  },

  quantizeNotes: (regionId, ids, gridTicks) => {
    const project = get().project;
    const idSet = new Set(ids);
    set({
      project: mapRegions(project, [regionId], (r) => ({
        ...r,
        notes: (r.notes ?? []).map((n) => (idSet.has(n.id) ? { ...n, start: snapTick(n.start, gridTicks) } : n)),
      })),
    });
  },

  // ---------------- selection + ui ----------------

  selectRegion: (id, additive) => {
    const ui = get().ui;
    if (id === null) {
      set({ ui: { ...ui, selectedRegionIds: [], selectedNoteIds: [] } });
      return;
    }
    if (additive) {
      const has = ui.selectedRegionIds.includes(id);
      set({
        ui: {
          ...ui,
          selectedRegionIds: has ? ui.selectedRegionIds.filter((x) => x !== id) : [...ui.selectedRegionIds, id],
          selectedNoteIds: [],
        },
      });
    } else {
      const region = findRegion(get().project, id);
      set({
        ui: {
          ...ui,
          selectedRegionIds: [id],
          selectedTrackId: region?.track.id ?? ui.selectedTrackId,
          selectedTrackIds: region ? [region.track.id] : ui.selectedTrackIds,
          selectedNoteIds: [],
        },
      });
    }
  },

  selectRegions: (ids) => set({ ui: { ...get().ui, selectedRegionIds: ids, selectedNoteIds: [] } }),

  selectNote: (id, additive) => {
    const ui = get().ui;
    if (id === null) {
      set({ ui: { ...ui, selectedNoteIds: [] } });
      return;
    }
    if (additive) {
      const has = ui.selectedNoteIds.includes(id);
      set({ ui: { ...ui, selectedNoteIds: has ? ui.selectedNoteIds.filter((x) => x !== id) : [...ui.selectedNoteIds, id] } });
    } else {
      set({ ui: { ...ui, selectedNoteIds: [id] } });
    }
  },

  setUI: (patch) => set({ ui: { ...get().ui, ...patch } }),

  setTool: (tool) => set({ ui: { ...get().ui, tool } }),

  setSnap: (snap) => set({ ui: { ...get().ui, snap } }),

  setZoom: (zoom) => set({ ui: { ...get().ui, zoom: clamp(zoom, 8, 640) } }),

  setTrackSize: (size) => set({ ui: { ...get().ui, trackSize: size } }),

  togglePanel: (key) => {
    const ui = get().ui;
    set({ ui: { ...ui, panels: { ...ui.panels, [key]: !ui.panels[key] } } });
  },

  setEditorMode: (mode) => set({ ui: { ...get().ui, editorMode: mode, panels: { ...get().ui.panels, editor: true } } }),

  setModal: (modal) => set({ ui: { ...get().ui, modal } }),

  openRegionInEditor: (regionId) => {
    const found = findRegion(get().project, regionId);
    if (!found) return;
    set({
      ui: {
        ...get().ui,
        editorRegionId: regionId,
        selectedRegionIds: [regionId],
        selectedTrackId: found.track.id,
        selectedTrackIds: [found.track.id],
        panels: { ...get().ui.panels, editor: true },
        editorMode: found.region.type === "midi" ? "piano" : "audio",
      },
    });
  },
}));

function contentExtent(r: Region): number {
  const notes = r.notes ?? [];
  if (!notes.length) return r.length;
  return Math.max(...notes.map((n) => n.start + n.length));
}

/** Convenience selector: layout constants */
export function trackHeight(size: TrackSize): number {
  return TRACK_SIZES[size];
}
