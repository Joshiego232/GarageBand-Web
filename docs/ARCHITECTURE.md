# Architecture

## Application shape

The application is a Next.js App Router application. The client studio lives in `src/app/page.tsx`; the DAW UI is composed from `src/components/daw`; its shared project model, state, audio engine, commands, and media helpers are in `src/lib/daw`.

The project model is the canonical state for both the arrangement and the lower editors. The Soundstage step editor writes ordinary MIDI notes into the selected MIDI region. This keeps playback, piano-roll editing, undo/redo, project persistence, and offline WAV rendering on the same code path.

## Audio engine

`src/lib/daw/engine.ts` owns the live `AudioContext`, track nodes, master bus, look-ahead scheduler, audio recording, and offline render. `src/lib/daw/instruments.ts` remains the patch registry and procedural fallback engine.

### Automation

`src/lib/daw/AutomationEngine.ts` schedules sorted project automation lanes in the audio engine's look-ahead windows (180 ms horizon, 40 ms scheduler interval). It writes directly to bound `AudioParam`s with timed set/linear/exponential ramps; Bezier segments are sampled into short linear ramps. The arrangement clock is PPQ ticks. Master tempo lanes are integrated into tick-to-audio-time conversion, so note starts, note durations, the playhead, and the metronome follow tempo changes without using React state or animation frames as the audio clock.

Track lanes use absolute ticks; region lanes use ticks relative to their owning clip and are offset/clipped to that region during playback. Clip move, duplicate, split, and removal operations keep region lanes aligned. `Off` bypasses playback; `Read` plays points; `Touch` returns to the pre-touch curve over an eighth note; `Latch` holds the last captured value; and `Write` records the current control value as playback advances. Fader, pan, mute, Smart Control, send, and pedalboard edits feed the recorder. Built-in track/master AudioParams are registered during engine sync; additional effect parameters can use `AutomationEngine.bindParameter`.

### Offline bounce

`src/lib/daw/engine.ts` reconstructs an isolated `OfflineAudioContext` graph for each bounce pass, including track inserts, pedalboards, Aux and summing routes, master processing, SoundFont/procedural voices, audio regions, and scheduled automation. A range is clipped to PPQ ticks and its timeline is rebased to the offline context's start; an optional three-bar extension captures effect tails. Stem mode re-renders each audible track or summing stack with other source tracks muted while retaining its routing and master chain.

`src/lib/daw/BounceEngine.ts` applies sample-peak normalization and packages PCM WAV or MP3 output. WAV interleaving/PCM quantization and MP3 frame encoding run in `src/lib/daw/workers/audio-encoder.worker.ts`; ZIP packaging uses JSZip. The native `OfflineAudioContext` API has no abort operation once `startRendering()` begins, so cancellation is cooperative during loading/scheduling and discards a render after its current pass finishes.

`src/lib/daw/pedalboard-engine.ts` provides the serial stompbox insert after each track's channel processing. Pedal parameters and order live on the track, so instrument voices, audio regions, and monitored inputs share the same insert point. Reordering rebuilds only the pedal subgraph; bypass and parameter changes update live gains and AudioParams. Wet/dry pedals split and recombine their signal inside each pedal, while the pedals themselves remain in series.

Summing-stack headers resolve to their existing Aux bus, so the stack's pedals process the combined child output. Folder-only stacks route child channel outputs into the folder node as a composite bus, then pass that sum through the folder's inserts; child levels and folder mute/solo behavior remain governed by the shared routing model. The same routing is used by offline rendering. User pedalboard chains are saved with the existing browser-backed My Instruments patches.

`src/lib/daw/sampled-instruments.ts` loads SoundFont, piano, electric-piano and drum samples through `smplr`, including multi-player layers for combined keyboard patches:

- `grand-piano` and `bright-piano` use the multi-velocity Splendid Grand Piano sample set.
- `string-ensemble` uses General MIDI `string_ensemble_1` from the FluidR3 GM soundfont.
- Sample loaders are cached per audio context and decoded audio is cached by `smplr`.
- Track sync starts loading after the browser audio context is unlocked. Until a patch is ready or if loading fails, the existing procedural voice is used.
- Offline rendering awaits the same sample-backed patch before scheduling notes, so a WAV bounce uses the sampled sound whenever the sample source is available.
- SoundFont patches may combine additional General MIDI programs. Each layer has its own sample player and gain and receives the same note timing, velocity and release. The library stores favorites and recent auditions locally in the browser.

## Chord analysis

`src/lib/daw/ChordDetector.ts` performs allocation-light pitch-class mask and interval-template scoring for common triads through extended chords. Candidate templates include core tones and treat the fifth as optional for extended voicings; the lowest MIDI note is preserved for slash-chord notation. Key-signature spelling is passed from the project into the detector. Live notes are published by the audio engine and grouped by a short onset debounce and release grace interval in the LCD.

The project stores global chord regions alongside MIDI/audio tracks. Completed MIDI recordings are analyzed by bar, and MIDI regions can be analyzed from their context menu. The timeline chord lane auditions stored notes through the selected live instrument; the LCD key suggester and lane can synchronize the stored scale lock and up to eight custom chord strips on the performance keyboard. The piano-roll chord banner derives its bar labels from the current region notes, so edits refresh the analysis without maintaining a second note model.

## Soundstage compatibility

`src/lib/daw/soundstage-bridge.ts` is a format adapter, not a second project store. It translates Soundstage's `ProjectState` tracks and regions to the native `Project` type and supports exporting the native session to the Soundstage project JSON shape.

Notes are translated in beats to ticks using `PPQ = 960`. Drum pattern velocity arrays become MIDI notes. Audio blobs are not part of Soundstage JSON, and the format adapter does not reach into another app's IndexedDB; audio clip payloads must be re-imported as files.

The command palette is backed by the shared `COMMANDS` registry, so menu actions, shortcuts, and palette actions have one implementation.

## Full-stack persistence

The saved-song API is under `src/app/api/songs`. Prisma uses SQLite for local saved-project JSON metadata/content. The application does not currently provide authenticated multi-user access, per-user authorization, cloud asset storage, or cross-device sync. Those are planned extensions, not implemented features. Do not expose the current API as a shared multi-user service without authentication and authorization.

Audio buffers are kept in browser-managed IndexedDB. They are not committed to this repository and are not uploaded to GitHub.
