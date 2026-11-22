# GarageBand Web Studio

An original browser-based digital audio workstation for Windows, macOS and ChromeOS. It combines the full-stack Next.js studio with selected creative workflows from the Soundstage DAW project in one application.

> This project is not affiliated with Apple. It does not include Apple's proprietary GarageBand/Logic assets or sound packs.

## What is in the merged app

- **Multitrack DAW workspace:** timeline, MIDI and audio regions, transport, loop/cycle, piano roll, mixer, EQ, sends, recording, library, and song management.
- **Soundstage workflow additions:** 16-step drum sequencer for MIDI drum tracks, plus import and export of Soundstage `.soundstage.json` project files.
- **Shared MIDI model:** step-sequencer hits are stored as MIDI notes, so they remain editable in the piano roll and work with playback and WAV rendering.
- **Sampled instruments:** 120 SoundFont and sample-backed patches, including 20 stage-keyboard-inspired presets and layered piano/pad/string combinations, plus 10 original additive synth presets. The stage sounds use the credited MusyngKite General MIDI bank; they are not Nord or Yamaha factory recordings.
- **Local song storage:** projects are saved in IndexedDB in the current browser; audio media also remains on that device.
- **Audio output:** Web Audio playback, microphone recording where the browser permits it, WAV bounce, MIDI export, and audio-file import.

## Technology

- Next.js App Router, React, TypeScript
- Web Audio API and `smplr` sample playback
- Zustand project state
- IndexedDB for local project and audio storage
- Tailwind CSS and shadcn-style UI components

## Run locally

1. Install Node.js 22 or newer.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Start the development server:

   ```bash
   npm run dev
   ```

4. Open `http://localhost:3000`.

Production build:

```bash
npm run lint
npm run typecheck
npm run build
npm start
```

Microphone recording requires HTTPS (or localhost), browser permission and a supported input device. Sampled patches need network access on first load; the sampler caches decoded samples for the current browser audio session. If a sample source cannot be reached, the app falls back to its built-in synthesis patches.

## Soundstage project interchange

Use **File → Import Soundstage Project JSON…** or **File → Export Soundstage Project JSON…**. MIDI tracks, regions, notes, tempo, meter, project key, loop settings, mixer settings and supported drum patterns are translated to the native DAW model.

Soundstage JSON files do not contain their IndexedDB audio blobs. Audio clips therefore cannot be transferred through the JSON bridge; import the original audio files again after moving a session. Native audio assets stay in the browser's local storage and are not uploaded to GitHub.

## Storage and account status

Project JSON and audio media are stored in the browser's IndexedDB. They are not uploaded to the server and are not available across devices or browsers. The saved-song API has been removed; account sign-in and cloud sync are not implemented.

The app is local-first for audio media. GitHub stores application source and documentation only; it should never receive private recordings or project audio.

## Sample credits and licenses

- **Piano:** Splendid Grand Piano, using AKAI piano samples released to the public domain by the Splendid Grand Piano sample project. See [sfzinstruments/SplendidGrandPiano](https://github.com/sfzinstruments/SplendidGrandPiano).
- **Orchestral strings:** FluidR3 GM soundfont, credited to Frank Wen and contributors and distributed under [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/). The sample-loading code requests the `string_ensemble_1` General MIDI program from the FluidR3 GM set.
- **Sampler engine:** [`smplr`](https://github.com/danigb/smplr), used as a Web Audio sample playback library. See its repository for its own license and notices.

The instrument library supports text search, categories, favorites and recently auditioned patches. See [`docs/SAMPLE_ATTRIBUTION.md`](docs/SAMPLE_ATTRIBUTION.md) for the asset-level notes.

## Repository layout

- `src/app` — Next.js application and remaining API routes
- `src/components/daw` — timeline, editor, sequencer, mixer and studio UI
- `src/lib/daw` — project model, state, audio engine, sample-backed instruments, MIDI and Soundstage bridge
- `docs` — architecture, data interchange and audio attribution

## Feature status

The source contains the core DAW workflows listed above. Browser/device support varies for microphone access, MIDI devices and audio codecs. Cloud authentication and multi-user cloud sync are not implemented. For the exact current state of any feature, prefer the implementation and tests over roadmap language.

## Windows desktop installer

The Windows desktop edition is packaged from this same web/DAW source, so the desktop app includes the current instrument library, plugin artwork, pedalboard and performance updates.

To download the latest build:

1. Open the repository's **Actions** tab.
2. Select **Desktop Installers**.
3. Open the newest successful run on the `fix/ci-build` branch.
4. Download the `GarageBand-Windows-x64` artifact and extract the ZIP.
5. Run `GarageBand-Web-Studio-Setup-1.4.0-x64.exe`.

The installer runs the Next.js studio locally inside Electron. It does not require a separately installed Node.js runtime, a Codespace or an always-on hosted website. Project data and audio storage remain local to the desktop app's browser profile.

The installer is not code-signed by default, so Windows SmartScreen may show an unsigned-app warning.
