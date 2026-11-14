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

function close(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: expected ${expected}, received ${actual}`);
}

try {
  await writeFile(path.join(temp, "package.json"), JSON.stringify({ type: "module" }));
  await symlink(path.join(root, "node_modules"), path.join(temp, "node_modules"), "dir");

  const modules = [
    "src/lib/daw/types.ts",
    "src/lib/daw/utils.ts",
    "src/lib/daw/plugins.ts",
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
      /(from\\s+["']\\.\\/[^"']+)(["'])/g,
      (_match, specifier, quote) => {
        if (/\\.js$/.test(specifier)) return specifier + quote;
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
        expect(item.min < item.max, `Invalid range in ${definition.name} / ${item.label}`);
        expect(
          item.defaultValue >= item.min && item.defaultValue <= item.max,
          `Default outside range in ${definition.name} / ${item.label}`,
        );
      }
    }
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
    `DAW verification passed: ${Object.values(PATCHES).length} sampled instruments across ${categories.size} families; 10 MIDI plugins and 10 audio plugins; all 10 MIDI processors passed behavior checks.`,
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
