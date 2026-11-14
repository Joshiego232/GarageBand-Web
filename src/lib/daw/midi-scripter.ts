import type { Note } from "./types";
import { uid } from "./types";
import { clamp } from "./utils";

type MidiScriptCommand =
  | { name: "transpose" | "velocityScale" | "velocityAdd" | "lengthScale" | "delay" | "humanize"; args: [number] }
  | { name: "duplicate"; args: [number, number] }
  | { name: "chord"; args: number[] }
  | { name: "repeat"; args: [number, number] }
  | { name: "scaleLock"; args: [] };

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
const MAX_SCRIPT_LENGTH = 4000;
const MAX_COMMANDS = 32;

function inRange(value: number, min: number, max: number) {
  return Number.isFinite(value) && value >= min && value <= max;
}

function parseCommand(line: string, lineNumber: number): MidiScriptCommand {
  const match = line.match(/^([A-Za-z][A-Za-z0-9_]*)\s*\((.*)\)$/);
  if (!match) throw new Error(`Line ${lineNumber}: use a supported function call, e.g. transpose(12)`);

  const name = match[1];
  const rawArgs = match[2].trim();
  const args = rawArgs
    ? rawArgs.split(",").map((value) => value.trim())
    : [];
  const numbers = args.map((value) => {
    if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) {
      throw new Error(`Line ${lineNumber}: arguments must be numeric`);
    }
    return Number(value);
  });
  if (numbers.some((value) => !Number.isFinite(value))) {
    throw new Error(`Line ${lineNumber}: invalid number`);
  }

  const one = (min: number, max: number): [number] => {
    if (numbers.length !== 1 || !inRange(numbers[0], min, max)) {
      throw new Error(`Line ${lineNumber}: ${name} expects one value from ${min} to ${max}`);
    }
    return [numbers[0]];
  };
  const two = (first: [number, number], second: [number, number]): [number, number] => {
    if (
      numbers.length !== 2 ||
      !inRange(numbers[0], ...first) ||
      !inRange(numbers[1], ...second)
    ) {
      throw new Error(`Line ${lineNumber}: ${name} expects two values in the documented ranges`);
    }
    return [numbers[0], numbers[1]];
  };

  switch (name) {
    case "transpose":
      return { name, args: one(-48, 48) };
    case "velocityScale":
      return { name, args: one(0, 2) };
    case "velocityAdd":
      return { name, args: one(-126, 126) };
    case "lengthScale":
      return { name, args: one(0.05, 4) };
    case "delay":
      return { name, args: one(-3840, 3840) };
    case "humanize":
      return { name, args: one(0, 40) };
    case "duplicate":
      return { name, args: two([-48, 48], [0, 1]) };
    case "repeat":
      return { name, args: two([1, 8], [1, 3840]) };
    case "chord":
      if (numbers.length < 1 || numbers.length > 6 || numbers.some((value) => !inRange(value, -24, 24) || value === 0)) {
        throw new Error(`Line ${lineNumber}: chord expects 1–6 non-zero intervals from -24 to 24`);
      }
      return { name, args: numbers };
    case "scaleLock":
      if (numbers.length !== 0) throw new Error(`Line ${lineNumber}: scaleLock takes no arguments`);
      return { name, args: [] };
    default:
      throw new Error(`Line ${lineNumber}: unknown MIDI function "${name}"`);
  }
}

/** Parse the deliberately limited MIDI scripting language; this never executes JavaScript. */
export function parseMidiScript(script: string): MidiScriptCommand[] {
  if (script.length > MAX_SCRIPT_LENGTH) {
    throw new Error(`Script is too long (maximum ${MAX_SCRIPT_LENGTH} characters)`);
  }

  const commands: MidiScriptCommand[] = [];
  const lines = script.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].replace(/\/\/.*$/, "").trim().replace(/;$/, "").trim();
    if (!line) continue;
    commands.push(parseCommand(line, index + 1));
    if (commands.length > MAX_COMMANDS) {
      throw new Error(`A MIDI script can contain at most ${MAX_COMMANDS} commands`);
    }
  }
  return commands;
}

export function validateMidiScript(script: string): string | null {
  try {
    parseMidiScript(script);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid MIDI script";
  }
}

function snapToScale(pitch: number, tonic: number, mode: "major" | "minor") {
  const scale = mode === "minor" ? MINOR_SCALE : MAJOR_SCALE;
  const root = ((Math.round(tonic) % 12) + 12) % 12;
  let best = clamp(Math.round(pitch), 0, 127);
  let bestDistance = Infinity;
  for (let candidate = Math.max(0, Math.floor(pitch) - 6); candidate <= Math.min(127, Math.ceil(pitch) + 6); candidate++) {
    const pitchClass = ((candidate - root) % 12 + 12) % 12;
    if (!scale.includes(pitchClass)) continue;
    const distance = Math.abs(candidate - pitch);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** Apply safe, deterministic note transformations to incoming or arranged MIDI notes. */
export function applyMidiScript(
  source: Note[],
  script: string,
  tonic: number,
  mode: "major" | "minor"
): Note[] {
  let notes = source.map((note) => ({ ...note }));
  let commands: MidiScriptCommand[];
  try {
    commands = parseMidiScript(script);
  } catch {
    // An invalid script must never interrupt the audio transport.
    return notes;
  }

  for (const command of commands) {
    switch (command.name) {
      case "transpose": {
        const [amount] = command.args;
        notes = notes.map((note) => ({ ...note, pitch: clamp(note.pitch + amount, 0, 127) }));
        break;
      }
      case "velocityScale": {
        const [factor] = command.args;
        notes = notes.map((note) => ({ ...note, velocity: clamp(Math.round(note.velocity * factor), 1, 127) }));
        break;
      }
      case "velocityAdd": {
        const [amount] = command.args;
        notes = notes.map((note) => ({ ...note, velocity: clamp(Math.round(note.velocity + amount), 1, 127) }));
        break;
      }
      case "lengthScale": {
        const [factor] = command.args;
        notes = notes.map((note) => ({ ...note, length: Math.max(1, Math.round(note.length * factor)) }));
        break;
      }
      case "delay": {
        const [ticks] = command.args;
        notes = notes.map((note) => ({ ...note, start: Math.max(0, note.start + Math.round(ticks)) }));
        break;
      }
      case "duplicate": {
        const [interval, velocityFactor] = command.args;
        notes = notes.flatMap((note) => [
          note,
          {
            ...note,
            id: uid(),
            pitch: clamp(note.pitch + Math.round(interval), 0, 127),
            velocity: clamp(Math.round(note.velocity * velocityFactor), 1, 127),
          },
        ]);
        break;
      }
      case "chord": {
        const intervals = command.args;
        notes = notes.flatMap((note) => [
          note,
          ...intervals.map((interval) => ({
            ...note,
            id: uid(),
            pitch: clamp(note.pitch + Math.round(interval), 0, 127),
          })),
        ]);
        break;
      }
      case "repeat": {
        const [repeatCount, stepTicks] = command.args;
        const count = Math.round(repeatCount);
        notes = notes.flatMap((note) => Array.from({ length: count }, (_, index) => ({
          ...note,
          id: index === 0 ? note.id : uid(),
          start: note.start + Math.round(stepTicks * index),
          velocity: clamp(Math.round(note.velocity * Math.pow(0.82, index)), 1, 127),
        })));
        break;
      }
      case "scaleLock":
        notes = notes.map((note) => ({ ...note, pitch: snapToScale(note.pitch, tonic, mode) }));
        break;
      case "humanize": {
        const [amount] = command.args;
        notes = notes.map((note) => {
          const seed = Math.abs((note.start * 31 + note.pitch * 17 + note.velocity * 13) % 997) / 997;
          const offset = (seed * 2 - 1) * amount;
          return { ...note, velocity: clamp(Math.round(note.velocity + offset), 1, 127) };
        });
        break;
      }
    }

    if (notes.length > 1024) notes = notes.slice(0, 1024);
  }
  return notes;
}
