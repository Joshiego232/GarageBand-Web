// ============================================================
// Command registry: every command in the app (menus + shortcuts)
// Shortcuts use Cmd on macOS, Ctrl on Windows/Chromebook/Linux
// ============================================================
"use client";

import { engine } from "./engine";
import { useDAW } from "./store";
import { PPQ, uid } from "./types";
import { snapTicks, barTicks, projectLengthTicks, clamp } from "./utils";
import { toast } from "sonner";
import { exportSoundstageProject, importSoundstageProject } from "./soundstage-bridge";
import { analyzeMidiNotesByBar } from "./ChordDetector";
import { importMidiFiles } from "./midi-import";

export interface Command {
  id: string;
  label: string;
  menu: string;
  shortcut?: string; // display label like "Cmd+S"
  keys?: { key: string; mod?: boolean; shift?: boolean; alt?: boolean };
  separatorBefore?: boolean;
  run: () => void;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? "Cmd" : "Ctrl";

function cmd(
  id: string,
  label: string,
  menu: string,
  key: string,
  run: () => void,
  opts?: { mod?: boolean; shift?: boolean; alt?: boolean; separatorBefore?: boolean }
): Command {
  const keys = { key, mod: opts?.mod, shift: opts?.shift, alt: opts?.alt };
  let shortcut = "";
  if (key) {
    if (opts?.mod) shortcut += isMac ? "⌘" : "Ctrl+";
    if (opts?.shift) shortcut += isMac ? "⇧" : "Shift+";
    if (opts?.alt) shortcut += isMac ? "⌥" : "Alt+";
    shortcut += key.length === 1 ? key.toUpperCase() : key;
  }
  return { id, label, menu, shortcut: shortcut || undefined, keys, run, separatorBefore: opts?.separatorBefore };
}

// ---------- import/export helpers ----------

async function importAudioFiles() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "audio/*,.wav,.mp3,.ogg,.m4a,.aiff,.flac";
  input.multiple = true;
  input.onchange = async () => {
    const files = Array.from(input.files ?? []);
    if (!files.length) return;
    const { toast } = await import("sonner").then((m) => ({ toast: m.toast }));
    for (const file of files) {
      try {
        const stored = await engine.decodeAudioFile(file);
        const bufferId = uid();
        await engine.storeBuffer(bufferId, stored);
        const st = useDAW.getState();
        const project = st.project;
        const secPerTick = 60 / project.tempo / PPQ;
        const lengthTicks = Math.ceil(stored.channels[0].length / stored.sampleRate / secPerTick);
        const color = "#4a90d9";
        st.addTrack({
          type: "audio",
          name: stored.name.replace(/\.[^.]+$/, "").slice(0, 24) || "Audio",
          icon: "mic",
          color,
        });
        const track = useDAW.getState().project.tracks.slice(-1)[0];
        useDAW.getState().addRegion({
          id: uid(),
          trackId: track.id,
          type: "audio",
          name: stored.name.replace(/\.[^.]+$/, "").slice(0, 24) || "Audio",
          start: 0,
          length: Math.max(barTicks(project.timeSig), lengthTicks),
          bufferId,
          sampleStart: 0,
          sampleLength: stored.channels[0].length / stored.sampleRate,
          gain: 1,
          fadeIn: 0.005,
          fadeOut: 0.01,
        });
        toast.success(`Imported "${stored.name}"`);
      } catch (e) {
        toast.error(`Could not import ${file.name}: unsupported format`);
      }
    }
  };
  input.click();
}

function importMidiFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".mid,.midi,audio/midi,audio/x-midi";
  input.multiple = true;
  input.onchange = () => {
    const files = Array.from(input.files ?? []);
    if (files.length) void importMidiFiles(files);
  };
  input.click();
}

async function importSoundstageJson() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const result = importSoundstageProject(parsed);
      useDAW.getState().loadProject(result.project);
      toast.success(`Imported ${result.project.name} (${result.project.tracks.length} tracks)`);
      if (result.omittedAudioRegions) {
        toast.warning(`${result.omittedAudioRegions} audio clip(s) need their source files re-imported; audio files are not included in Soundstage JSON exports.`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read this Soundstage project file");
    }
  };
  input.click();
}

function exportSoundstageJson() {
  const project = useDAW.getState().project;
  const payload = exportSoundstageProject(project);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${project.name.replace(/[^a-z0-9-_]+/gi, "_") || "session"}.soundstage.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  const audioCount = project.tracks.reduce((count, track) => count + (track.type === "audio" ? track.regions.length : 0), 0);
  toast.success(audioCount ? `Project JSON exported. ${audioCount} audio clip(s) are metadata-only; their media is not embedded.` : "Soundstage project JSON exported");
}

async function exportWav() {
  const { toast } = await import("sonner").then((m) => ({ toast: m.toast }));
  const st = useDAW.getState();
  if (!st.project.tracks.some((t) => t.regions.length)) {
    toast.error("Nothing to export yet - add some regions first");
    return;
  }
  st.setModal("export");
}

async function exportMidi() {
  const { toast } = await import("sonner").then((m) => ({ toast: m.toast }));
  const { encodeWav } = await import("./wav");
  const st = useDAW.getState();
  const project = st.project;
  const projectEndTick = projectLengthTicks(project);
  // build a type-1 MIDI file from all MIDI tracks
  const tracksData: { notes: { pitch: number; vel: number; startTick: number; lenTick: number }[] }[] = [];
  for (const t of project.tracks) {
    if (t.type !== "midi") continue;
    const notes: { pitch: number; vel: number; startTick: number; lenTick: number }[] = [];
    for (const r of t.regions) {
      const regionEnd = Math.min(r.start + r.length, projectEndTick);
      if (r.start >= projectEndTick) continue;
      const period = r.looped && r.coreLength ? r.coreLength : 0;
      const reps = period ? Math.ceil((regionEnd - r.start) / period) + 1 : 1;
      for (let k = 0; k < reps; k++) {
        for (const n of r.notes ?? []) {
          const abs = r.start + k * period + n.start;
          if (abs >= regionEnd) continue;
          notes.push({ pitch: n.pitch, vel: n.velocity, startTick: abs, lenTick: Math.min(n.length, regionEnd - abs) });
        }
      }
    }
    if (notes.length) tracksData.push({ notes });
  }
  if (!tracksData.length) {
    toast.error("No MIDI regions to export");
    return;
  }
  // SMF encoding
  const ppq = PPQ;
  const chunks: Uint8Array[] = [];
  const str = (s: string) => Array.from(s).map((c) => c.charCodeAt(0));
  const u32 = (v: number) => [(v >> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255];
  const u16 = (v: number) => [(v >> 8) & 255, v & 255];
  const vlq = (v: number) => {
    const bytes = [v & 0x7f];
    v >>= 7;
    while (v > 0) {
      bytes.unshift((v & 0x7f) | 0x80);
      v >>= 7;
    }
    return bytes;
  };
  const header = new Uint8Array([
    ...str("MThd"), ...u32(6), ...u16(1), ...u16(tracksData.length + 1), ...u16(ppq),
  ]);
  chunks.push(header);
  // tempo track
  const micros = Math.round(60000000 / project.tempo);
  const tempoBytes = [0x00, 0xff, 0x51, 0x03, (micros >> 16) & 255, (micros >> 8) & 255, micros & 255];
  const timeSigBytes = [0x00, 0xff, 0x58, 0x04, project.timeSig[0], Math.round(Math.log2(project.timeSig[1])), 24, 8];
  const trackLen = tempoBytes.length + timeSigBytes.length;
  chunks.push(new Uint8Array([...str("MTrk"), ...u32(trackLen), ...tempoBytes, ...timeSigBytes]));
  for (const td of tracksData) {
    const evs: number[] = [];
    const sorted = [...td.notes].sort((a, b) => a.startTick - b.startTick);
    const onOff: { tick: number; on: boolean; pitch: number; vel: number }[] = [];
    for (const n of sorted) {
      onOff.push({ tick: n.startTick, on: true, pitch: n.pitch, vel: n.vel });
      onOff.push({ tick: n.startTick + Math.max(1, n.lenTick), on: false, pitch: n.pitch, vel: 0 });
    }
    onOff.sort((a, b) => a.tick - b.tick || (a.on === b.on ? a.pitch - b.pitch : a.on ? -1 : 1));
    let last = 0;
    for (const e of onOff) {
      evs.push(...vlq(e.tick - last));
      last = e.tick;
      evs.push(e.on ? 0x90 : 0x80, e.pitch, e.vel);
    }
    evs.push(0x00, 0xff, 0x2f, 0x00);
    chunks.push(new Uint8Array([...str("MTrk"), ...u32(evs.length), ...evs]));
  }
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  const blob = new Blob([out], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${project.name || "song"}.mid`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  toast.success("MIDI file exported");
  void encodeWav; // keep import warm
}

async function saveProject() {
  const { toast } = await import("sonner").then((m) => ({ toast: m.toast }));
  const st = useDAW.getState();
  const project = st.project;
  try {
    const body = JSON.stringify({ id: project.id, name: project.name, data: JSON.stringify(project) });
    const res = await fetch("/api/songs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) throw new Error("save failed");
    const json = await res.json();
    useDAW.setState({ project: { ...project, id: json.id } });
    toast.success(`Saved "${project.name}"`);
  } catch {
    toast.error("Could not save the project");
  }
}

function playSelectedRegionSolo(regionId?: string | null) {
  const st = useDAW.getState();
  const rid = regionId ?? st.ui.selectedRegionIds[0];
  if (!rid) return;
  // find region
  for (const t of st.project.tracks) {
    for (const r of t.regions) {
      if (r.id === rid) {
        engine.setPlayhead(r.start);
        const origEnd = r.start + r.length;
        st.setCycle(true, r.start, origEnd);
        engine.play(r.start);
        return;
      }
    }
  }
}

// ============================================================
// Registry
// ============================================================

export const COMMANDS: Command[] = [
  // ---------------- File ----------------
  cmd("file.new", "New Project", "File", "N", () => useDAW.getState().setModal("newProject"), { mod: true }),
  cmd("file.open", "My Songs", "File", "O", () => useDAW.getState().setModal("mySongs"), { mod: true }),
  cmd("file.save", "Save", "File", "S", () => void saveProject(), { mod: true }),
  cmd("file.saveAlternative", "Save Project Alternative…", "File", "", () => {
    const st = useDAW.getState();
    const name = window.prompt("Name this project alternative", `${st.project.name} Version ${(st.project.alternatives ?? []).length + 1}`);
    if (name === null) return;
    st.saveAlternative(name);
    toast.success("Project alternative saved");
  }, { separatorBefore: true }),
  cmd("file.loadAlternative", "Recall Project Alternative…", "File", "", () => {
    const st = useDAW.getState();
    const alternatives = st.project.alternatives ?? [];
    if (!alternatives.length) {
      toast.info("No saved project alternatives yet");
      return;
    }
    const choice = window.prompt(
      `Enter the number of the alternative to recall:\\n${alternatives.map((item, index) => `${index + 1}. ${item.name}`).join("\\n")}`
    );
    if (choice === null) return;
    const selected = alternatives[Number(choice) - 1];
    if (!selected) {
      toast.error("That alternative number was not found");
      return;
    }
    st.loadAlternative(selected.id);
    toast.success(`Loaded alternative: ${selected.name}`);
  }),
  cmd("file.saveAs", "Save As", "File", "S", () => {
    const st = useDAW.getState();
    const name = window.prompt("Song name", st.project.name);
    if (name) {
      useDAW.setState({ project: { ...st.project, id: undefined, name } });
      void saveProject();
    }
  }, { mod: true, shift: true }),
  cmd("file.import", "Import Audio File", "File", "I", () => void importAudioFiles(), { mod: true, shift: true, separatorBefore: true }),
  cmd("file.importMidi", "Import MIDI File…", "File", "", importMidiFile),
  cmd("file.importSoundstage", "Import Soundstage Project JSON…", "File", "", () => importSoundstageJson()),
  cmd("file.exportSoundstage", "Export Soundstage Project JSON…", "File", "", () => exportSoundstageJson()),
  cmd("file.bounce", "Bounce Project or Section…", "File", "B", () => useDAW.getState().setModal("export"), { mod: true, separatorBefore: true }),
  cmd("file.exportWav", "Export Song as WAV", "File", "E", () => void exportWav(), { mod: true, separatorBefore: true }),
  cmd("file.exportMidi", "Export MIDI File", "File", "M", () => void exportMidi(), { mod: true, shift: true }),

  // ---------------- Edit ----------------
  cmd("edit.commandPalette", "Search Commands…", "Edit", "K", () => window.dispatchEvent(new CustomEvent("daw:command-palette")), { mod: true }),
  cmd("edit.undo", "Undo", "Edit", "Z", () => useDAW.getState().undo(), { mod: true }),
  cmd("edit.redo", "Redo", "Edit", "Z", () => useDAW.getState().redo(), { mod: true, shift: true }),
  cmd("edit.cut", "Cut", "Edit", "X", () => {
    const st = useDAW.getState();
    window.sessionStorage.setItem("daw-clipboard", JSON.stringify(st.project.tracks.flatMap((t) => t.regions.filter((r) => st.ui.selectedRegionIds.includes(r.id)))));
    st.removeRegions(st.ui.selectedRegionIds);
  }, { mod: true, separatorBefore: true }),
  cmd("edit.copy", "Copy", "Edit", "C", () => {
    const st = useDAW.getState();
    window.sessionStorage.setItem("daw-clipboard", JSON.stringify(st.project.tracks.flatMap((t) => t.regions.filter((r) => st.ui.selectedRegionIds.includes(r.id)))));
  }, { mod: true }),
  cmd("edit.paste", "Paste", "Edit", "V", () => {
    const st = useDAW.getState();
    try {
      const clip = JSON.parse(window.sessionStorage.getItem("daw-clipboard") ?? "[]") as import("./types").Region[];
      if (!clip.length) return;
      st.commit();
      const pasted = clip.map((r) => ({ ...JSON.parse(JSON.stringify(r)), id: uid(), start: engine.currentTick() }));
      st.addRegions(pasted);
    } catch { /* invalid clipboard */ }
  }, { mod: true }),
  cmd("edit.delete", "Delete", "Edit", "Delete", () => {
    const st = useDAW.getState();
    if (st.ui.selectedRegionIds.length) st.removeRegions(st.ui.selectedRegionIds);
  }),
  cmd("edit.duplicate", "Duplicate", "Edit", "D", () => {
    const st = useDAW.getState();
    if (st.ui.selectedRegionIds.length) st.duplicateRegions(st.ui.selectedRegionIds);
  }, { mod: true }),
  cmd("edit.selectAll", "Select All", "Edit", "A", () => {
    const st = useDAW.getState();
    st.selectRegions(st.project.tracks.flatMap((t) => t.regions.map((r) => r.id)));
  }, { mod: true, separatorBefore: true }),
  cmd("edit.deselectAll", "Deselect All", "Edit", "A", () => useDAW.getState().selectRegion(null), { mod: true, shift: true }),

  // ---------------- Track ----------------
  cmd("track.new", "New Track", "Track", "N", () => useDAW.getState().setModal("addTrack"), { mod: true, shift: true }),
  cmd("track.showMaster", "Show Master Track", "Track", "M", () => {
    const state = useDAW.getState();
    state.setUI({ showMasterTrack: !state.ui.showMasterTrack });
  }, { mod: true, shift: true }),
  cmd("track.newAux", "New Aux Bus", "Track", "", () => {
    useDAW.getState().createAuxBus();
    useDAW.getState().setUI({ panels: { ...useDAW.getState().ui.panels, mixer: true } });
    toast.success("Aux bus created");
  }),
  cmd("track.newVca", "New VCA Fader", "Track", "", () => {
    useDAW.getState().createVca();
    useDAW.getState().setUI({ panels: { ...useDAW.getState().ui.panels, mixer: true } });
    toast.success("VCA fader created");
  }),
  cmd("track.duplicate", "Duplicate Track", "Track", "D", () => {
    const st = useDAW.getState();
    if (st.ui.selectedTrackId) st.duplicateTrack(st.ui.selectedTrackId);
  }, { mod: true, shift: true, separatorBefore: true }),
  cmd("track.delete", "Delete Track", "Track", "Backspace", () => {
    const st = useDAW.getState();
    if (st.ui.selectedTrackId && st.project.tracks.length > 1) st.removeTrack(st.ui.selectedTrackId);
  }, { mod: true }),
  cmd("track.mute", "Mute Track", "Track", "M", () => {
    const st = useDAW.getState();
    if (st.ui.selectedTrackId) st.toggleTrackMute(st.ui.selectedTrackId);
  }, { separatorBefore: true }),
  cmd("track.solo", "Solo Track", "Track", "S", () => {
    const st = useDAW.getState();
    if (st.ui.selectedTrackId) st.toggleTrackSolo(st.ui.selectedTrackId);
  }),
  cmd("track.showMixer", "Show Mixer", "Track", "M", () => useDAW.getState().togglePanel("mixer"), { mod: true, separatorBefore: true }),

  // ---------------- Region ----------------
  cmd("region.split", "Split at Playhead", "Region", "T", () => {
    useDAW.getState().splitRegionsAt(engine.currentTick());
  }, { mod: true }),
  cmd("region.join", "Join Regions", "Region", "J", () => {
    const st = useDAW.getState();
    if (st.ui.selectedRegionIds.length > 1) st.joinRegions(st.ui.selectedRegionIds);
  }, { mod: true }),
  cmd("region.loop", "Loop On/Off", "Region", "L", () => {
    const st = useDAW.getState();
    if (st.ui.selectedRegionIds.length) st.toggleRegionLoop(st.ui.selectedRegionIds);
  }, { separatorBefore: true }),
  cmd("region.transposeUp", "Transpose Up 1 Semitone", "Region", "ArrowUp", () => {
    const st = useDAW.getState();
    st.transposeRegions(st.ui.selectedRegionIds, 1);
  }, { alt: true }),
  cmd("region.transposeDown", "Transpose Down 1 Semitone", "Region", "ArrowDown", () => {
    const st = useDAW.getState();
    st.transposeRegions(st.ui.selectedRegionIds, -1);
  }, { alt: true }),
  cmd("region.octaveUp", "Transpose Up 1 Octave", "Region", "ArrowUp", () => {
    const st = useDAW.getState();
    st.transposeRegions(st.ui.selectedRegionIds, 12);
  }, { alt: true, shift: true }),
  cmd("region.octaveDown", "Transpose Down 1 Octave", "Region", "ArrowDown", () => {
    const st = useDAW.getState();
    st.transposeRegions(st.ui.selectedRegionIds, -12);
  }, { alt: true, shift: true }),
  cmd("region.velUp", "Velocity +5", "Region", "ArrowUp", () => {
    const st = useDAW.getState();
    st.shiftRegionVelocity(st.ui.selectedRegionIds, 5);
  }, { mod: true }),
  cmd("region.velDown", "Velocity -5", "Region", "ArrowDown", () => {
    const st = useDAW.getState();
    st.shiftRegionVelocity(st.ui.selectedRegionIds, -5);
  }, { mod: true }),
  cmd("region.quantize", "Quantize", "Region", "Q", () => {
    const st = useDAW.getState();
    const grid = snapTicks(st.ui.snap, st.ui.zoom, st.project.timeSig);
    st.quantizeRegions(st.ui.selectedRegionIds, grid);
  }, { separatorBefore: true }),
  cmd("region.solo", "Play Region Solo", "Region", " ", () => {
    playSelectedRegionSolo();
  }, { mod: true, alt: true }),

  // ---------------- Mix ----------------
  cmd("mix.showConsole", "Open Full Mixer Console", "Mix", "", () => {
    const st = useDAW.getState();
    st.setUI({ panels: { ...st.ui.panels, mixer: true } });
    window.dispatchEvent(new CustomEvent("daw:mixer-expand"));
  }, { separatorBefore: true }),
  cmd("mix.masterVolumeUp", "Master Volume Up", "Mix", "ArrowUp", () => {
    const p = useDAW.getState().project;
    useDAW.getState().setMasterVolume(clamp(p.masterVolume + 0.05, 0, 1.25));
  }, { mod: true, alt: true, shift: true }),
  cmd("mix.masterVolumeDown", "Master Volume Down", "Mix", "ArrowDown", () => {
    const p = useDAW.getState().project;
    useDAW.getState().setMasterVolume(clamp(p.masterVolume - 0.05, 0, 1.25));
  }, { mod: true, alt: true, shift: true }),

  // ---------------- View ----------------
  cmd("view.saveScreenset", "Save Screenset…", "View", "", () => {
    const st = useDAW.getState();
    const name = window.prompt("Name this workspace layout", `Screenset ${(st.project.screensets ?? []).length + 1}`);
    if (name === null) return;
    st.saveScreenset(name);
    toast.success("Screenset saved");
  }, { separatorBefore: true }),
  cmd("view.automation", "Show Automation", "View", "A", () => {
    const state = useDAW.getState();
    state.setUI({ automationView: !state.ui.automationView });
  }),
  cmd("view.loadScreenset", "Recall Screenset…", "View", "", () => {
    const st = useDAW.getState();
    const screensets = st.project.screensets ?? [];
    if (!screensets.length) {
      toast.info("No saved screensets yet");
      return;
    }
    const choice = window.prompt(
      `Enter the number of the screenset to recall:\\n${screensets.map((item, index) => `${index + 1}. ${item.name}`).join("\\n")}`
    );
    if (choice === null) return;
    const selected = screensets[Number(choice) - 1];
    if (!selected) {
      toast.error("That screenset number was not found");
      return;
    }
    st.loadScreenset(selected.id);
    toast.success(`Loaded screenset: ${selected.name}`);
  }),
  cmd("view.zoomIn", "Zoom In", "View", "=", () => useDAW.getState().setZoom(useDAW.getState().ui.zoom * 1.3), { mod: true }),
  cmd("view.zoomOut", "Zoom Out", "View", "-", () => useDAW.getState().setZoom(useDAW.getState().ui.zoom / 1.3), { mod: true }),
  cmd("view.zoomFit", "Zoom to Fit Song", "View", "0", () => {
    const st = useDAW.getState();
    const len = Math.max(projectLengthTicks(st.project), barTicks(st.project.timeSig) * 8);
    st.setZoom(900 / (len / PPQ));
  }, { mod: true }),
  cmd("view.trackSizeUp", "Bigger Track Height", "View", "ArrowUp", () => {
    const st = useDAW.getState();
    const order: ("S" | "M" | "L")[] = ["S", "M", "L"];
    st.setTrackSize(order[Math.min(2, order.indexOf(st.ui.trackSize) + 1)]);
  }, { mod: true, shift: true, separatorBefore: true }),
  cmd("view.trackSizeDown", "Smaller Track Height", "View", "ArrowDown", () => {
    const st = useDAW.getState();
    const order: ("S" | "M" | "L")[] = ["S", "M", "L"];
    st.setTrackSize(order[Math.max(0, order.indexOf(st.ui.trackSize) - 1)]);
  }, { mod: true, shift: true }),
  cmd("view.liveLoops", "Open Live Loops Grid", "View", "", () => {
    const st = useDAW.getState();
    st.setUI({ panels: { ...st.ui.panels, liveLoops: !st.ui.panels.liveLoops } });
  }, { separatorBefore: true }),
  cmd("view.library", "Show Library", "View", "Y", () => useDAW.getState().togglePanel("library"), { separatorBefore: true }),
  cmd("view.loops", "Show Loop Browser", "View", "O", () => useDAW.getState().togglePanel("loops")),
  cmd("view.editor", "Show Editor", "View", "E", () => useDAW.getState().togglePanel("editor")),
  cmd("view.smartControls", "Show Smart Controls", "View", "B", () => {
    const st = useDAW.getState();
    st.setUI({ panels: { ...st.ui.panels, editor: true }, editorMode: "smart" });
  }),
  cmd("view.keyboard", "Musical Typing Keyboard", "View", "K", () => useDAW.getState().togglePanel("keyboard"), { alt: true }),
  cmd("view.help", "Keyboard Shortcuts", "View", "?", () => useDAW.getState().togglePanel("help")),

  // ---------------- Transport (not in menu bar, shown in Help) ----------------
  cmd("transport.play", "Play / Stop", "Transport", "Space", () => engine.togglePlay()),
  cmd("transport.record", "Record", "Transport", "R", () => {
    const st = useDAW.getState();
    if (engine.recording) {
      handleStopRecording();
    } else if (engine.recordPending) {
      toast.info("Waiting for audio input permissions...");
    } else {
      void engine.startRecording().catch((error: unknown) => {
        console.error("Could not start recording.", error);
        toast.error("Could not start recording. Check the selected input and microphone permissions.");
      });
    }
  }),
  cmd("transport.stop", "Stop and Go to Beginning", "Transport", "Enter", () => {
    if (engine.recording) handleStopRecording();
    else if (engine.playing) engine.stop();
    engine.setPlayhead(0);
    useDAW.setState({ transport: { ...useDAW.getState().transport, playing: false } });
  }),
  cmd("transport.cycle", "Cycle On/Off", "Transport", "C", () => {
    const st = useDAW.getState();
    if (!st.project.cycleOn) {
      // default: 4 bars from playhead or existing range
      const bt = barTicks(st.project.timeSig);
      const start = Math.floor(engine.currentTick() / bt) * bt;
      st.setCycle(true, start, start + bt * 4);
    } else {
      st.setCycle(false);
    }
  }),
  cmd("transport.metronome", "Metronome", "Transport", "K", () => {
    const st = useDAW.getState();
    st.setMetronome(!st.project.metronome);
  }),
  cmd("transport.countIn", "Count-in", "Transport", " ", () => {
    const st = useDAW.getState();
    st.setCountIn(!st.project.countIn);
  }, { mod: true, shift: true }),
  cmd("transport.rewind", "Rewind", "Transport", "ArrowLeft", () => {
    const st = useDAW.getState();
    const bt = barTicks(st.project.timeSig);
    engine.setPlayhead(Math.max(0, engine.currentTick() - bt));
  }, { mod: true }),
  cmd("transport.forward", "Forward", "Transport", "ArrowRight", () => {
    const st = useDAW.getState();
    const bt = barTicks(st.project.timeSig);
    engine.setPlayhead(engine.currentTick() + bt);
  }, { mod: true }),
  cmd("transport.tapTempo", "Tap Tempo", "Transport", "T", () => {
    tapTempo();
  }),
];

function handleStopRecording() {
  const result = engine.stopRecording();
  const st = useDAW.getState();
  const notesByTrack = new Map<string, typeof result.midi>();
  for (const note of result.midi) {
    const notes = notesByTrack.get(note.trackId) ?? [];
    notes.push(note);
    notesByTrack.set(note.trackId, notes);
  }
  const recordedRegions = new Map<string, { id: string; start: number; length: number; notes: typeof result.midi }>();
  for (const [trackId, recordedNotes] of notesByTrack) {
    const notes = recordedNotes.map((n) => ({
      id: uid(),
      pitch: n.pitch,
      velocity: n.velocity,
      start: n.start - result.startTick,
      length: n.length,
    }));
    const recordedEnd = notes.reduce((end, note) => Math.max(end, note.start + note.length), 0);
    const regionId = uid();
    const start = Math.max(0, result.startTick);
    const length = Math.max(result.endTick - result.startTick, recordedEnd, PPQ);
    st.addRegion({
      id: regionId,
      trackId,
      type: "midi",
      name: "Recording",
      start,
      length,
      notes,
    });
    recordedRegions.set(trackId, { id: regionId, start, length, notes: recordedNotes });
  }
  if (notesByTrack.size) {
    const project = useDAW.getState().project;
    const ticksPerBar = barTicks(project.timeSig);
    const extracted = [...recordedRegions.values()].flatMap((region) => {
      const regionNotes = region.notes.map((note) => ({
        pitch: note.pitch,
        start: note.start - result.startTick,
        length: note.length,
      }));
      return analyzeMidiNotesByBar(
        regionNotes,
        region.start,
        region.length,
        ticksPerBar,
        { tonic: project.keyTonic, mode: project.keyMode },
      ).map((chord) => ({ ...chord, id: uid(), sourceRegionId: region.id }));
    });
    if (extracted.length) {
      useDAW.getState().setChordRegions([
        ...(useDAW.getState().project.chordRegions ?? []),
        ...extracted,
      ]);
    }
  }
  if (notesByTrack.size) {
    toast.success(`Recorded ${result.midi.length} MIDI notes on ${notesByTrack.size} track${notesByTrack.size === 1 ? "" : "s"}`);
  }
  if (result.audio.length) {
    void (async () => {
      for (const audio of result.audio) {
        const bufferId = uid();
        await engine.storeBuffer(bufferId, audio.stored);
        const project = useDAW.getState().project;
        const secPerTick = 60 / project.tempo / PPQ;
        const lengthTicks = Math.max(PPQ, Math.ceil(audio.durationSec / secPerTick));
        useDAW.getState().addRegion({
          id: uid(),
          trackId: audio.trackId,
          type: "audio",
          name: "Recording",
          start: Math.max(0, result.startTick),
          length: lengthTicks,
          bufferId,
          sampleStart: audio.offsetSec,
          sampleLength: audio.durationSec,
          gain: 1,
          fadeIn: 0.005,
          fadeOut: 0.01,
        });
      }
      toast.success(`Audio recorded on ${result.audio.length} track${result.audio.length === 1 ? "" : "s"}`);
    })();
  }
  if (!result.midi.length && !result.audio.length) {
    toast.info("Recording stopped");
  }
}

let tapTimes: number[] = [];
function tapTempo() {
  const now = performance.now();
  tapTimes = tapTimes.filter((t) => now - t < 2500);
  tapTimes.push(now);
  if (tapTimes.length >= 2) {
    const intervals = tapTimes.slice(1).map((t, i) => t - tapTimes[i]);
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    useDAW.getState().setTempo(60000 / avg);
  }
}

export function runCommandById(id: string) {
  const c = COMMANDS.find((x) => x.id === id);
  if (c) c.run();
}

export const MENU_ORDER = ["File", "Edit", "Track", "Region", "Mix", "View"];
