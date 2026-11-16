# Architecture

## Application shape

The application is a Next.js App Router application. The client studio lives in `src/app/page.tsx`; the DAW UI is composed from `src/components/daw`; its shared project model, state, audio engine, commands, and media helpers are in `src/lib/daw`.

The project model is the canonical state for both the arrangement and the lower editors. The Soundstage step editor writes ordinary MIDI notes into the selected MIDI region. This keeps playback, piano-roll editing, undo/redo, project persistence, and offline WAV rendering on the same code path.

## Audio engine

`src/lib/daw/engine.ts` owns the live `AudioContext`, track nodes, master bus, look-ahead scheduler, audio recording, and offline render. `src/lib/daw/instruments.ts` remains the patch registry and procedural fallback engine.

`src/lib/daw/sampled-instruments.ts` loads SoundFont, piano, electric-piano and drum samples through `smplr`, including multi-player layers for combined keyboard patches:

- `grand-piano` and `bright-piano` use the multi-velocity Splendid Grand Piano sample set.
- `string-ensemble` uses General MIDI `string_ensemble_1` from the FluidR3 GM soundfont.
- Sample loaders are cached per audio context and decoded audio is cached by `smplr`.
- Track sync starts loading after the browser audio context is unlocked. Until a patch is ready or if loading fails, the existing procedural voice is used.
- Offline rendering awaits the same sample-backed patch before scheduling notes, so a WAV bounce uses the sampled sound whenever the sample source is available.
- SoundFont patches may combine additional General MIDI programs. Each layer has its own sample player and gain and receives the same note timing, velocity and release. The library stores favorites and recent auditions locally in the browser.

## Soundstage compatibility

`src/lib/daw/soundstage-bridge.ts` is a format adapter, not a second project store. It translates Soundstage's `ProjectState` tracks and regions to the native `Project` type and supports exporting the native session to the Soundstage project JSON shape.

Notes are translated in beats to ticks using `PPQ = 960`. Drum pattern velocity arrays become MIDI notes. Audio blobs are not part of Soundstage JSON, and the format adapter does not reach into another app's IndexedDB; audio clip payloads must be re-imported as files.

The command palette is backed by the shared `COMMANDS` registry, so menu actions, shortcuts, and palette actions have one implementation.

## Full-stack persistence

The saved-song API is under `src/app/api/songs`. Prisma uses SQLite for local saved-project JSON metadata/content. The application does not currently provide authenticated multi-user access, per-user authorization, cloud asset storage, or cross-device sync. Those are planned extensions, not implemented features. Do not expose the current API as a shared multi-user service without authentication and authorization.

Audio buffers are kept in browser-managed IndexedDB. They are not committed to this repository and are not uploaded to GitHub.
