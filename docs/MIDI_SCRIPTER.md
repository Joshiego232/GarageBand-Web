# MIDI Scripter

MIDI Scripter is the editable note processor in the MIDI FX rack. It runs on live keyboard input, MIDI regions, Live Loops and offline exports.

The editor uses a small, safe MIDI command language rather than executing arbitrary JavaScript. Put one command on each line. Blank lines and `// comments` are ignored.

## Commands

| Command | Effect |
|---|---|
| `transpose(12)` | Move notes up 12 semitones. Accepts -48 to 48. |
| `chord(4, 7)` | Add notes at the specified semitone intervals above each note. Accepts 1–6 intervals from -24 to 24. |
| `duplicate(12, 0.7)` | Add an octave-up note at 70% of the source velocity. |
| `repeat(3, 120)` | Create 3 notes, each 120 MIDI ticks apart. |
| `scaleLock()` | Snap notes to the project's current key and mode. |
| `velocityScale(0.85)` | Scale note velocity to 85%. |
| `velocityAdd(8)` | Add 8 velocity units. |
| `lengthScale(0.5)` | Make note lengths half as long. |
| `delay(120)` | Move notes forward by 120 MIDI ticks. Negative values move earlier. |
| `humanize(12)` | Apply deterministic velocity variation up to 12 units. |

## Example: worship pad chord spread

```text
// Raise the incoming notes an octave, then add a chord tone.
transpose(12)
chord(7)
velocityScale(0.82)
lengthScale(1.5)
```

## Example: rhythmic pluck

```text
repeat(4, 240)
velocityScale(0.9)
lengthScale(0.55)
```

Commands are applied from top to bottom. For example, `transpose(12)` followed by `chord(7)` adds the fifth above the already transposed note. The script is checked before it is used; invalid commands leave the incoming MIDI notes unchanged.
