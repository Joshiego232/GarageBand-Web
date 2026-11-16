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
    "src/lib/daw/midi-scripter.ts",
    "src/lib/daw/routing.ts",
    "src/lib/daw/sampler.ts",
    "src/lib/daw/morph-synth.ts",
    "src/lib/daw/pitch-correction.ts",
    "src/lib/daw/audio-slicing.ts",
    "src/lib/daw/audio-time-stretch.ts",
    "src/lib/daw/midi-control.ts",
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
  const midiScripter = await import(
    pathToFileURL(path.join(temp, "src/lib/daw/midi-scripter.js")).href
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
  const morphSynth = await import(
    pathToFileURL(path.join(temp, "src/lib/daw/morph-synth.js")).href
  );
  const pitchCorrection = await import(
    pathToFileURL(path.join(temp, "src/lib/daw/pitch-correction.js")).href
  );
  const audioSlicing = await import(
    pathToFileURL(path.join(temp, "src/lib/daw/audio-slicing.js")).href
  );
  const audioTimeStretch = await import(
    pathToFileURL(path.join(temp, "src/lib/daw/audio-time-stretch.js")).href
  );
  const midiControl = await import(
    pathToFileURL(path.join(temp, "src/lib/daw/midi-control.js")).href
  );
  const { useDAW } = await import(
    pathToFileURL(path.join(temp, "src/lib/daw/store.js")).href
  );
  const { projectLengthTicks } = await import(
    pathToFileURL(path.join(temp, "src/lib/daw/utils.js")).href
  );
  const smplr = await import("smplr");

  const lengthProject = {
    lengthBars: 12,
    timeSig: [4, 4],
    tracks: [],
  };
  expect(projectLengthTicks(lengthProject) === 12 * 4 * 960, "Explicit project bar length should set the song end");
  useDAW.getState().setProjectLengthBars(1200);
  expect(useDAW.getState().project.lengthBars === 999, "Project bar length should be capped at 999");
  useDAW.getState().setProjectLengthBars(16);

  // Catalog counts, verified upstream sample IDs, and our original synth engine.
  const categories = new Map();
  let sampledCount = 0;
  const morphSynthPatches = [];
  for (const patch of Object.values(PATCHES)) {
    categories.set(patch.category, (categories.get(patch.category) ?? 0) + 1);

    if (patch.synthEngine === "morph-additive") {
      expect(!patch.sampled, `Morph Synth preset should not pretend to use samples: ${patch.id}`);
      const knobIds = new Set(patch.knobs.map((knob) => knob.id));
      for (const id of ["morph", "harmonics", "cutoff", "resonance", "attack", "decay", "sustain", "release", "detune", "sub", "lfoRate", "lfoDepth", "noise"]) {
        expect(knobIds.has(id), `Morph Synth preset ${patch.id} is missing control ${id}`);
      }
      morphSynthPatches.push(patch);
      continue;
    }

    expect(patch.sampled, `Instrument is not backed by samples or a supported synth engine: ${patch.id}`);
    sampledCount++;
    const source = patch.sampled;

    if (source.engine === "soundfont") {
      expect(
        source.loop === true,
        `SoundFont instrument ${patch.id} should load sustained sample loop data`,
      );
      const soundfontNames = smplr.getSoundfontNames();
      for (const instrument of [
        source.instrument,
        ...(source.layers ?? []).map((layer) => layer.instrument),
      ]) {
        expect(
          soundfontNames.includes(instrument),
          `Unknown SoundFont instrument ID "${instrument}" used by ${patch.id}`,
        );
      }
      for (const layer of source.layers ?? []) {
        expect(
          Number.isFinite(layer.gain) && layer.gain > 0 && layer.gain <= 1,
          `Invalid SoundFont layer gain used by ${patch.id}`,
        );
      }
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
  expect(sampledCount === 120, `Expected 120 sampled instruments, found ${sampledCount}`);
  expect(categories.get("Stage Keys") === 10, "Stage Keys family must contain exactly 10 presets");
  expect(categories.get("Layered Keys") === 10, "Layered Keys family must contain exactly 10 presets");
  const layeredKeys = Object.values(PATCHES).filter((patch) => patch.category === "Layered Keys");
  expect(
    layeredKeys.length === 10 && layeredKeys.every((patch) => (patch.sampled?.layers?.length ?? 0) === 1),
    "Layered Keys presets must each combine two sampled SoundFont instruments",
  );
  expect(morphSynthPatches.length === 10, `Expected 10 original Morph Synth presets, found ${morphSynthPatches.length}`);
  expect(categories.get("Alchemy Synth") === 10, "Alchemy Synth family must contain exactly 10 presets");

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

  expect(
    !sampler.shouldReleaseSamplerOnNoteOff("one-shot"),
    "One-shot sample mode should ignore MIDI note-off",
  );
  expect(
    sampler.shouldReleaseSamplerOnNoteOff("loop"),
    "Loop sample mode should release on MIDI note-off",
  );

  // Verify hardware MIDI CC scaling and pan endpoints.
  expect(
    midiControl.midiCCToValue("master-volume", 0) === 0,
    "MIDI CC zero did not map to zero master volume",
  );
  expect(
    midiControl.midiCCToValue("master-volume", 127) === 1.25,
    "MIDI CC full scale did not map to the DAW master-volume range",
  );
  expect(
    midiControl.midiCCToValue("track-pan", 0) === -1 &&
      midiControl.midiCCToValue("track-pan", 127) === 1,
    "MIDI CC pan endpoints were not mapped to hard left and right",
  );
  expect(
    midiControl.midiCCToValue("track-volume", -20) === 0 &&
      midiControl.midiCCToValue("track-volume", 200) === 1.25,
    "Out-of-range MIDI CC values were not safely clamped",
  );
  expect(
    midiControl.midiCCTargetLabel("track-pan") === "Track Pan",
    "MIDI CC target label is incorrect",
  );

  // Verify the additive spectral engine creates finite, non-silent and morphable spectra.
  const spectrumA = morphSynth.buildMorphSpectrum(0.05, 0.9, 64);
  const spectrumB = morphSynth.buildMorphSpectrum(0.95, 0.9, 64);
  const lowHarmonics = morphSynth.buildMorphSpectrum(0.5, 0.15, 64);
  const highHarmonics = morphSynth.buildMorphSpectrum(0.5, 1, 64);
  expect(spectrumA.length === 64 && spectrumB.length === 64, "Morph Synth spectrum has an unexpected length");
  expect(spectrumA[1] > 0 && spectrumB[1] > 0, "Morph Synth fundamental harmonic is silent");
  expect(
    [...spectrumA, ...spectrumB, ...lowHarmonics, ...highHarmonics].every(Number.isFinite),
    "Morph Synth generated non-finite harmonic coefficients",
  );
  expect(
    spectrumA.some((value, index) => Math.abs(value - (spectrumB[index] ?? 0)) > 1e-5),
    "Spectral morph control does not change the harmonic structure",
  );
  const lowUpperEnergy = lowHarmonics.slice(12).reduce((sum, value) => sum + value * value, 0);
  const highUpperEnergy = highHarmonics.slice(12).reduce((sum, value) => sum + value * value, 0);
  expect(
    highUpperEnergy > lowUpperEnergy,
    "Harmonics control does not increase upper partial energy",
  );

  // Verify monophonic pitch detection, key snapping and non-destructive pitch correction.
  const pitchSampleRate = 44100;
  const vocalSine = new Float32Array(pitchSampleRate);
  for (let i = 0; i < vocalSine.length; i++) {
    vocalSine[i] = Math.sin((2 * Math.PI * 440 * i) / pitchSampleRate) * 0.4;
  }
  const detectedVoice = pitchCorrection.detectMonophonicPitchSegments(
    [vocalSine],
    pitchSampleRate,
    0,
    1,
  );
  expect(detectedVoice.length > 0, "Flex Pitch did not detect a steady A4 tone");
  expect(
    detectedVoice.some((segment) => Math.abs(segment.detectedMidi - 69) <= 1),
    "Flex Pitch identified the wrong MIDI pitch for a 440 Hz tone",
  );
  const snappedPitch = pitchCorrection.snapMidiPitchToScale(70, 0, "major");
  expect(
    [0, 2, 4, 5, 7, 9, 11].includes(((snappedPitch % 12) + 12) % 12),
    "Pitch snapping returned a note outside the requested major key",
  );
  const originalSourceSample = vocalSine[5000];
  const correctionSegment = {
    id: "test-vocal-note",
    startSec: 0.1,
    endSec: 0.9,
    detectedPitch: 69,
    detectedMidi: 69,
    targetMidi: 72,
    confidence: 0.98,
    pitchCurve: [
      { timeSec: 0.1, pitch: 69 },
      { timeSec: 0.5, pitch: 69.2 },
      { timeSec: 0.9, pitch: 69 },
    ],
  };
  const correctedVocal = pitchCorrection.applyMonophonicPitchCorrection(
    [vocalSine],
    pitchSampleRate,
    0,
    1,
    [correctionSegment],
    1,
  );
  expect(
    correctedVocal[0]?.length === vocalSine.length,
    "Flex Pitch changed the duration of the corrected audio range",
  );
  expect(
    correctedVocal[0]?.every(Number.isFinite),
    "Flex Pitch generated non-finite audio samples",
  );
  expect(
    correctedVocal[0]?.some((sample, index) => Math.abs(sample - vocalSine[index]) > 0.001),
    "Flex Pitch did not modify the selected note audio",
  );
  expect(
    vocalSine[5000] === originalSourceSample,
    "Flex Pitch mutated the original source audio",
  );
  expect(
    pitchCorrection.detectMonophonicPitchSegments(
      [new Float32Array(pitchSampleRate)],
      pitchSampleRate,
      0,
      1,
    ).length === 0,
    "Flex Pitch detected a note in silence",
  );

  // Verify transient detection finds separated percussive attacks and ignores silence.
  const transientRate = 22050;
  const transientAudio = new Float32Array(transientRate * 2);
  for (const transientStart of [0.2, 0.8, 1.4]) {
    const start = Math.floor(transientStart * transientRate);
    const duration = Math.floor(0.14 * transientRate);
    for (let index = 0; index < duration; index++) {
      const envelope = Math.exp(-index / (transientRate * 0.035));
      transientAudio[start + index] =
        Math.sin((2 * Math.PI * 180 * index) / transientRate) * envelope * 0.8;
    }
  }
  const transientCuts = audioSlicing.detectTransientCuts(
    [transientAudio],
    transientRate,
    0,
    2,
    -18,
    0.12,
  );
  expect(transientCuts.length === 3, `Expected 3 transient cuts, found ${transientCuts.length}`);
  for (const expectedTime of [0.2, 0.8, 1.4]) {
    expect(
      transientCuts.some((time) => Math.abs(time - expectedTime) < 0.06),
      `Transient slicer missed the attack near ${expectedTime}s`,
    );
  }
  expect(
    audioSlicing.detectTransientCuts([new Float32Array(transientRate)], transientRate, 0, 1).length === 0,
    "Transient slicer created cuts in silence",
  );

  // Verify both pitch-preserving Flex Time modes retain duration targets and source pitch.
  const flexRate = 22050;
  const flexInput = new Float32Array(flexRate);
  for (let index = 0; index < flexInput.length; index++) {
    flexInput[index] = Math.sin((2 * Math.PI * 440 * index) / flexRate) * 0.35;
  }
  const sourceSampleBeforeFlex = flexInput[5000];
  const monoStretched = audioTimeStretch.stretchAudioChannels(
    [flexInput], flexRate, 1.25, "monophonic"
  )[0];
  const polyStretched = audioTimeStretch.stretchAudioChannels(
    [flexInput], flexRate, 1.25, "polyphonic"
  )[0];
  const expectedFlexLength = Math.round(flexInput.length * 1.25);
  expect(
    monoStretched?.length === expectedFlexLength &&
      polyStretched?.length === expectedFlexLength,
    "Flex Time modes did not produce the selected target duration",
  );
  expect(
    monoStretched?.every(Number.isFinite) && polyStretched?.every(Number.isFinite),
    "Flex Time generated non-finite audio samples",
  );
  const estimateTone = (samples) => {
    const start = Math.floor(samples.length * 0.1);
    const end = Math.floor(samples.length * 0.9);
    let crossings = 0;
    for (let index = start + 1; index < end; index++) {
      if ((samples[index - 1] <= 0 && samples[index] > 0) ||
          (samples[index - 1] >= 0 && samples[index] < 0)) crossings++;
    }
    return crossings / (2 * ((end - start) / flexRate));
  };
  expect(
    Math.abs(estimateTone(monoStretched) - 440) < 25,
    "Monophonic Flex Time changed the pitch of a 440 Hz test tone",
  );
  expect(
    Math.abs(estimateTone(polyStretched) - 440) < 25,
    "Polyphonic Flex Time changed the pitch of a 440 Hz test tone",
  );
  expect(
    flexInput[5000] === sourceSampleBeforeFlex,
    "Flex Time modified the original source PCM data",
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
  const legacyHumanizer = {
    id: "legacy-humanizer",
    pluginId: "velocity-humanizer",
    enabled: true,
    params: { amount: 20 },
  };
  const humanized = run(humanizerInput, legacyHumanizer);
  const humanizedAgain = run(humanizerInput, legacyHumanizer);
  expect(
    humanized.every((n, index) =>
      n.velocity >= 70 && n.velocity <= 110 && n.velocity === humanizedAgain[index].velocity
    ),
    "Legacy Velocity Humanizer projects must remain bounded and deterministic",
  );

  const scripterProgram = [
    "transpose(12)",
    "velocityScale(0.8)",
    "lengthScale(0.5)",
  ].join("\n");
  const scripted = run(
    [note(60, 0, 960, 100)],
    { ...instance("scripter"), script: scripterProgram },
  );
  expect(
    scripted.length === 1 &&
      scripted[0].pitch === 72 &&
      scripted[0].velocity === 80 &&
      scripted[0].length === 480,
    "MIDI Scripter did not apply transpose, velocity and length commands",
  );
  const scriptedChord = run(
    [note(60)],
    { ...instance("scripter"), script: "chord(4, 7)" },
  );
  expect(
    scriptedChord.map((item) => item.pitch).sort((a, b) => a - b).join(",") === "60,64,67",
    "MIDI Scripter chord command did not create the expected triad",
  );
  const scriptedRepeat = run(
    [note(60)],
    { ...instance("scripter"), script: "repeat(3, 120)" },
  );
  expect(
    scriptedRepeat.length === 3 &&
      scriptedRepeat.map((item) => item.start).join(",") === "0,120,240",
    "MIDI Scripter repeat command did not create the expected pattern",
  );
  expect(
    midiScripter.validateMidiScript("fetch('https://example.com')") !== null,
    "MIDI Scripter accepted arbitrary JavaScript instead of its safe command syntax",
  );
  expect(
    midiScripter.validateMidiScript("transpose(12)") === null,
    "MIDI Scripter rejected a valid transpose command",
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
    `DAW verification passed: ${sampledCount} sampled instruments and ${morphSynthPatches.length} original Morph Synth presets across ${categories.size} families; 10 MIDI plugins (including Scripter) and 10 audio plugins; MIDI processor behavior checks passed; Aux routing, VCA, track stacks, project alternatives, screensets, audio take comping, sample-zone velocity layers, additive spectral synthesis, monophonic pitch detection/correction, transient audio slicing, WSOLA and phase-vocoder Flex Time, one-shot note-off behavior, MIDI CC mapping and solo checks passed.`,
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
