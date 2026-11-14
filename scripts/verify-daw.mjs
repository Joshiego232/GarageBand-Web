#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "garageband-daw-check-"));

function expect(condition, message) {
  assert.ok(condition, message);
}

try {
  await writeFile(path.join(temp, "package.json"), JSON.stringify({ type: "module" }));
  await symlink(path.join(root, "node_modules"), path.join(temp, "node_modules"), "dir");

  const modules = [
    "src/lib/daw/types.ts",
    "src/lib/daw/utils.ts",
    "src/lib/daw/plugins.ts",
    "src/lib/daw/routing.ts",
    "src/lib/daw/sampler.ts",
    "src/lib/daw/loops.ts",
    "src/lib/daw/store.ts",
    "src/lib/daw/sampled-instruments.ts",
    "src/lib/daw/instruments.ts",
  ];

  for (const relativePath of modules) {
    const source = await readFile(path.join(root, relativePath), "utf8");
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
        verbatimModuleSyntax: true,
      },
      fileName: relativePath,
      reportDiagnostics: true,
    });
    const errors = (transpiled.diagnostics ?? []).filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    );
    expect(errors.length === 0, `TypeScript transpilation failed for ${relativePath}`);
    const outputPath = path.join(temp, relativePath.replace(/\.ts$/, ".js"));
    await mkdir(path.dirname(outputPath), { recursive: true });
    const js = transpiled.outputText.replace(
      /(from\s+["']\.\/[^"']+)(["'])/g,
      (_match, specifier, quote) => {
        if (/\.js$/.test(specifier)) return specifier + quote;
        return specifier + ".js" + quote;
      },
    );
    await writeFile(outputPath, js);
  }

  const dawPlugins = await import(
    pathToFileURL(path.join(temp, "src/lib/daw/plugins.js")).href
  );
  const { PATCHES } = await import(
    pathToFileURL(path.join(temp, "src/lib/daw/instruments.js")).href
  );
  const routing = await import(
    pathToFileURL(path.join(temp, "src/lib/daw/routing.js")).href
  );
  const sampler = await import(
    pathToFileURL(path.join(temp, "src/lib/daw/sampler.js")).href
  );
  const { useDAW } = await import(
    pathToFileURL(path.join(temp, "src/lib/daw/store.js")).href
  );
  const smplr = await import("smplr");

  // Catalog counts and actual upstream sample instrument IDs.
  const categories = new Map();
  for (const patch of Object.values(PATCHES)) {
    categories.set(patch.category, (categories.get(patch.category) ?? 0) + 1);
    expect(patch.sampled, `Instrument is not backed by samples: ${patch.id}`);
    const source = patch.sampled;

    if (source.engine === "soundfont") {
      expect(
        smplr.getSoundfontNames().includes(source.instrument),
        `Unknown SoundFont instrument ID "${source.instrument}" used by ${patch.id}`,
      );
      expect(
        smplr.getSoundfontKits().includes(source.kit ?? "MusyngKite"),
        `Unknown SoundFont bank used by ${patch.id}`,
      );
    } else if (source.engine === "electric-piano") {
      expect(
        smplr.getElectricPianoNames().includes(source.instrument),
        `Unknown sampled electric piano "${source.instrument}" used by ${patch.id}`,
      );
    } else if (source.engine === "drum-machine") {
      expect(
        smplr.getDrumMachineNames().includes(source.instrument),
        `Unknown sampled drum machine "${source.instrument}" used by ${patch.id}`,
      );
    } else if (source.engine === "splendid-piano") {
      expect(
        patch.id === "grand-piano",
        `Unexpected Splendid Piano assignment: ${patch.id}`,
      );
    } else {
      throw new Error(`Unsupported sample engine for ${patch.id}: ${source.engine}`);
    }
  }

  for (const [category, count] of categories) {
    expect(count === 10, `Expected 10 instruments in "${category}", found ${count}`);
  }
  expect(categories.size >= 9, `Expected at least 9 instrument families, found ${categories.size}`);

  // Verify stored folder/summing stacks, VCA assignments, alternatives and screensets.
  const daw = useDAW.getState();
  daw.addTrack({ type: "midi", instrument: "grand-piano", name: "Stack Piano" });
  daw.addTrack({ type: "midi", instrument: "warm-pad", name: "Stack Pad" });
  let project = useDAW.getState().project;
  const members = project.tracks.filter((track) => track.role === "track");
  const memberIds = members.slice(0, 2).map((track) => track.id);
  const stackId = useDAW.getState().createTrackStack("Worship Keys", "summing", memberIds);
  expect(!!stackId, "Could not create a summing stack");
  project = useDAW.getState().project;
  const stack = project.stacks?.find((item) => item.id === stackId);
  expect(!!stack?.folderTrackId && !!stack?.busTrackId, "Summing stack is missing its folder or Aux bus");
  const folder = project.tracks.find((track) => track.id === stack.folderTrackId);
  const bus = project.tracks.find((track) => track.id === stack.busTrackId);
  expect(folder?.role === "folder", "Track stack did not create a folder parent row");
  expect(bus?.role === "aux", "Summing stack did not create an Aux bus channel");
  expect(
    project.tracks.filter((track) => memberIds.includes(track.id)).every(
      (track) => track.parentTrackId === folder.id && track.outputBusId === bus.id
    ),
    "Summing stack members were not grouped and routed through the Aux bus",
  );
  useDAW.getState().toggleTrackStack(stackId);
  expect(
    useDAW.getState().project.tracks.find((track) => track.id === folder.id)?.collapsed,
    "Folder stack did not collapse",
  );
  useDAW.getState().removeTrackStack(stackId);
  project = useDAW.getState().project;
  expect(!project.tracks.some((track) => track.id === folder.id || track.id === bus.id), "Removing a stack left its folder or bus behind");
  expect(
    project.tracks.filter((track) => memberIds.includes(track.id)).every(
      (track) => !track.parentTrackId && !track.stackId && !track.outputBusId
    ),
    "Removing a summing stack did not restore member tracks to the main output",
  );

  const vcaId = useDAW.getState().createVca("Keys VCA");
  const targetId = memberIds[0];
  useDAW.getState().setTrackRouting(targetId, null, vcaId);
  expect(
    useDAW.getState().project.tracks.find((track) => track.id === targetId)?.vcaId === vcaId,
    "VCA assignment was not saved on the member track",
  );

  const alternativeId = useDAW.getState().saveAlternative("Clean Arrangement");
  const originalName = useDAW.getState().project.tracks.find((track) => track.id === targetId)?.name;
  useDAW.getState().updateTrack(targetId, { name: "Temporary Edit" });
  useDAW.getState().loadAlternative(alternativeId);
  expect(
    useDAW.getState().project.tracks.find((track) => track.id === targetId)?.name === originalName,
    "Project alternative did not restore the saved arrangement",
  );

  useDAW.getState().setUI({
    panels: { library: false, loops: true, mixer: true, editor: true, keyboard: false, help: false },
    editorMode: "audio",
    trackSize: "L",
    zoom: 88,
  });
  const screensetId = useDAW.getState().saveScreenset("Mix & Edit");
  useDAW.getState().setUI({
    panels: { library: true, loops: false, mixer: false, editor: false, keyboard: false, help: false },
    editorMode: "smart",
    trackSize: "S",
    zoom: 40,
  });
  useDAW.getState().loadScreenset(screensetId);
  expect(
    useDAW.getState().ui.panels.mixer &&
      useDAW.getState().ui.panels.editor &&
      useDAW.getState().ui.editorMode === "audio" &&
      useDAW.getState().ui.trackSize === "L" &&
      useDAW.getState().ui.zoom === 88,
    "Screenset did not restore the saved workspace layout",
  );

  // Verify Quick Swipe comping replaces aligned audio takes atomically.
  useDAW.getState().addTrack({ type: "audio", name: "Comp Test Track" });
  const compTrack = useDAW.getState().project.tracks.find((track) => track.name === "Comp Test Track");
  expect(!!compTrack, "Could not create audio comp test track");
  const takeA = {
    id: "take-a", trackId: compTrack.id, type: "audio", name: "Take A",
    start: 0, length: 3840, bufferId: "take-buffer-a",
    sampleStart: 0, sampleLength: 8, gain: 1,
  };
  const takeB = {
    ...takeA, id: "take-b", name: "Take B", bufferId: "take-buffer-b",
  };
  useDAW.getState().addRegion(takeA);
  useDAW.getState().addRegion(takeB);
  const compSegment = {
    ...takeB, id: "comp-segment-1", name: "Comp 1", start: 0, length: 1920,
    sampleStart: 2, sampleLength: 4,
  };
  useDAW.getState().createAudioComp(compTrack.id, [takeA.id, takeB.id], [compSegment]);
  const compRegions = useDAW.getState().project.tracks.find((track) => track.id === compTrack.id)?.regions ?? [];
  expect(
    compRegions.length === 1 &&
      compRegions[0].id === compSegment.id &&
      compRegions[0].bufferId === takeB.bufferId &&
      compRegions[0].sampleStart === 2,
    "Quick Swipe comp did not replace the take lanes with the selected source segment",
  );

  // Verify deterministic sample-zone key and velocity selection.
  const zone = (id, lowKey, highKey, velocityLow = 1, velocityHigh = 127) => ({
    id,
    bufferId: `buffer-${id}`,
    name: id,
    rootPitch: 60,
    lowKey,
    highKey,
    velocityLow,
    velocityHigh,
    playbackMode: "one-shot",
  });
  const wideZone = zone("wide", 48, 72);
  const narrowZone = zone("narrow", 58, 62);
  const softZone = zone("soft", 58, 62, 1, 63);
  const loudZone = zone("loud", 58, 62, 64, 127);
  expect(
    sampler.selectSamplerZone([wideZone, narrowZone], 60, 100)?.id === "narrow",
    "A narrow key-range sample zone did not override a wider zone",
  );
  expect(
    sampler.selectSamplerZone([softZone, loudZone], 60, 63)?.id === "soft",
    "Velocity-layer lower boundary was not inclusive",
  );
  expect(
    sampler.selectSamplerZone([softZone, loudZone], 60, 64)?.id === "loud",
    "Velocity-layer upper/lower transition was not selected correctly",
  );
  expect(
    sampler.selectSamplerZone([wideZone, narrowZone], 72, 100)?.id === "wide",
    "Key-range upper boundary did not select its zone",
  );
  expect(
    sampler.selectSamplerZone([wideZone], 73, 100) === undefined,
    "Sample zone selected a pitch outside its key range",
  );
  expect(
    sampler.selectSamplerZone(undefined, 60, 100) === undefined,
    "Missing sample-zone lists should not select a zone",
  );

  // Verify Aux routing, nested buses, feedback protection, VCA gain and solo logic.
  const aux2 = { id: "aux-2", name: "Aux 2", role: "aux", type: "audio", outputBusId: null, volume: 0.9, mute: false, solo: false };
  const aux1 = { id: "aux-1", name: "Aux 1", role: "aux", type: "audio", outputBusId: aux2.id, volume: 0.9, mute: false, solo: false };
  const vca = { id: "vca-1", name: "VCA 1", role: "vca", type: "audio", volume: 0.5, mute: false, solo: false };
  const routedTrack = {
    id: "routed-1", name: "Keys", role: "track", type: "midi", volume: 0.8,
    mute: false, solo: false, outputBusId: aux1.id, vcaId: vca.id,
  };
  const routingTracks = [routedTrack, aux1, aux2, vca];
  expect(
    routing.resolveOutputBus(routedTrack, routingTracks)?.id === aux1.id,
    "Track output did not resolve to its first Aux bus",
  );
  expect(
    routing.isRoutedThroughBus(routedTrack, aux2.id, routingTracks),
    "Nested Aux route was not detected",
  );
  expect(
    routing.getEffectiveTrackGain(routedTrack, routingTracks) === 0.4,
    "VCA did not scale the member fader's effective gain without mutating it",
  );
  expect(routedTrack.volume === 0.8, "VCA changed the member track's stored fader level");

  const mutedVca = { ...vca, mute: true };
  expect(
    !routing.isTrackAudible(routedTrack, [routedTrack, aux1, aux2, mutedVca]),
    "Muting a VCA did not mute its assigned channels",
  );
  const soloedAux = { ...aux2, solo: true };
  expect(
    routing.isTrackAudible(routedTrack, [routedTrack, aux1, soloedAux, vca]),
    "Soloing a destination Aux did not pass its routed source channel",
  );
  const cyclicBus = { ...aux2, outputBusId: aux1.id };
  expect(
    routing.resolveOutputBus(routedTrack, [routedTrack, aux1, cyclicBus, vca]) === null,
    "A cyclic Aux route was not rejected",
  );
  const invalidBus = { ...routedTrack, outputBusId: "not-an-aux" };
  expect(
    routing.resolveOutputBus(invalidBus, [invalidBus, aux1, aux2, vca]) === null,
    "A missing Aux destination was not rejected",
  );

  // Both effect racks must contain ten unique, configured processors.
  for (const [name, definitions] of [
    ["MIDI", dawPlugins.MIDI_PLUGIN_DEFS],
    ["Audio", dawPlugins.AUDIO_PLUGIN_DEFS],
  ]) {
    expect(definitions.length === 10, `${name} effects rack must contain exactly 10 plugins`);
    expect(
      new Set(definitions.map((definition) => definition.id)).size === 10,
      `${name} effect IDs must be unique`,
    );
    for (const definition of definitions) {
      for (const item of definition.controls) {
        expect(item.min <= item.max, `Invalid range in ${definition.name} / ${item.label}`);
        expect(
          item.defaultValue >= item.min && item.defaultValue <= item.max,
          `Default outside range in ${definition.name} / ${item.label}`,
        );
      }
    }
  }

  const engineSource = await readFile(path.join(root, "src/lib/daw/engine.ts"), "utf8");
  for (const definition of dawPlugins.AUDIO_PLUGIN_DEFS) {
    expect(
      engineSource.includes(`get("${definition.id}")`),
      `Audio plugin has no engine implementation: ${definition.id}`,
    );
  }

  const { MIDI_PLUGIN_DEFS, applyMidiPlugins } = dawPlugins;
  const definition = (id) => MIDI_PLUGIN_DEFS.find((item) => item.id === id);
  const instance = (id, overrides = {}, enabled = true) => {
    const def = definition(id);
    expect(def, `Missing MIDI plugin definition: ${id}`);
    return {
      id: `test-${id}`,
      pluginId: id,
      enabled,
      params: {
        ...Object.fromEntries(def.controls.map((item) => [item.id, item.defaultValue])),
        ...overrides,
      },
    };
  };
  const note = (pitch, start = 0, length = 960, velocity = 100) => ({
    id: `n-${pitch}-${start}`,
    pitch,
    velocity,
    start,
    length,
  });
  const run = (notes, plugin, tonic = 0, mode = "major") =>
    applyMidiPlugins(notes, [plugin], tonic, mode);

  // Verify each processor changes the MIDI note stream as advertised.
  const transposed = run([note(60)], instance("transposer", { semitones: 2 }));
  expect(transposed[0].pitch === 62, "Transposer did not shift the note by two semitones");

  const scaleLocked = run([note(61)], instance("scale-lock"), 0, "major");
  expect(scaleLocked[0].pitch === 60, "Scale Lock did not snap C-sharp to the nearest C-major note");

  const doubled = run([note(60)], instance("octave-doubler", { semitones: 12 }));
  expect(doubled.length === 2 && doubled.some((n) => n.pitch === 72), "Octave Doubler did not add the octave voice");

  const chord = run([note(60)], instance("chord-maker", { third: 4, fifth: 7 }));
  expect(
    chord.map((n) => n.pitch).sort((a, b) => a - b).join(",") === "60,64,67",
    "Chord Generator did not create a major triad",
  );

  const humanizerInput = [note(60, 0, 960, 90), note(64, 240, 960, 80)];
  const humanized = run(humanizerInput, instance("velocity-humanizer", { amount: 20 }));
  const humanizedAgain = run(humanizerInput, instance("velocity-humanizer", { amount: 20 }));
  expect(
    humanized.every((n, index) =>
      n.velocity >= 70 && n.velocity <= 110 && n.velocity === humanizedAgain[index].velocity
    ),
    "Velocity Humanizer must be bounded and deterministic for repeatable playback",
  );

  const repeated = run(
    [note(60)],
    instance("note-repeater", { repeats: 4, gate: 0.8 }),
  );
  expect(
    repeated.length === 4 && repeated.map((n) => n.start).join(",") === "0,240,480,720",
    "Note Repeater did not produce four evenly spaced notes",
  );

  const strummed = run(
    [note(60), note(64), note(67)],
    instance("strummer", { spreadTicks: 120 }),
  );
  expect(
    strummed.map((n) => n.start).join(",") === "0,60,120",
    "Strummer did not stagger the chord evenly",
  );

  const gated = run([note(60)], instance("gate", { length: 0.65 }));
  expect(gated[0].length === 624, "Gate / Staccato did not shorten the MIDI note");

  const echoed = run(
    [note(60)],
    instance("note-echo", { repeats: 2, delayTicks: 240 }),
  );
  expect(
    echoed.length === 3 && echoed.map((n) => n.start).join(",") === "0,240,480",
    "Note Echo did not create the configured repeats",
  );

  const arpeggiated = run(
    [note(60), note(64), note(67)],
    instance("arpeggiator", { stepTicks: 240, gate: 0.8 }),
  );
  expect(
    arpeggiated.length === 4 &&
      arpeggiated.map((n) => n.pitch).join(",") === "60,64,67,60" &&
      arpeggiated.map((n) => n.start).join(",") === "0,240,480,720",
    "Arpeggiator did not walk through the chord in time",
  );

  const bypassed = run([note(60)], instance("transposer", { semitones: 7 }, false));
  expect(bypassed[0].pitch === 60, "Bypassed MIDI plugin still changed the notes");

  console.log(
    `DAW verification passed: ${Object.values(PATCHES).length} sampled instruments across ${categories.size} families; 10 MIDI plugins and 10 audio plugins; all 10 MIDI processors passed; Aux routing, VCA, track stacks, project alternatives, screensets, audio take comping, sample-zone velocity layers and solo checks passed.`,
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
