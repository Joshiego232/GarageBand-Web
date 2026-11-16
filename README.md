# GarageBand Web Studio

An original browser-based digital audio workstation for Windows, macOS and ChromeOS. The project combines a full-stack Next.js studio with selected creative workflows from the Soundstage DAW project. The same application can also be packaged as a local desktop app for Windows and ChromeOS Linux.

> This project is not affiliated with Apple. It does not include Apple's proprietary GarageBand/Logic assets or sound packs.

## Studio features

### Arrangement, editing and performance

- **Multitrack arrangement:** timeline with MIDI and audio regions, transport controls, loop/cycle playback, project tempo and time signature, track organization, and song management.
- **MIDI piano roll:** edit notes, velocities and note positions; MIDI regions share the same project model as the arrangement and step sequencer.
- **Drum step sequencer:** 16-step patterns are stored as editable MIDI notes, so they remain visible in the piano roll and participate in playback and bounce.
- **On-screen keyboard:** playable keyboard with scale locking, chord strips, key suggestions, configurable size and live instrument auditioning.
- **Command palette and shortcuts:** menus, shortcuts and command-palette actions use a shared command registry.

### Sound library and instruments

- **Sound Library drawer:** searchable instrument browser with categories, descriptions, artwork previews, keyboard navigation, favorites/recent sounds, and a personal **My Instruments** collection.
- **Sampled instruments:** the library includes SoundFont-backed and sampled piano, electric-piano, orchestral and drum sounds, plus layered keyboard presets.
- **Original synthesizers:** additive/morph synth patches include adjustable oscillator spectrum, harmonics, filters, envelopes, detune, modulation, chorus, glide, sub and noise controls.
- **SoundFont import:** import `.sf2` and `.sf3` files, scan their bank/program presets, and assign the selected preset to an instrument track.
- **Saved patches:** save instrument/track setups and pedalboard chains locally for reuse.
- **Sample credits:** sampled patches use credited third-party sources. The app does not claim ownership of those recordings; see [SOUNDFONT_CREDITS.md](SOUNDFONT_CREDITS.md) and [docs/SAMPLE_ATTRIBUTION.md](docs/SAMPLE_ATTRIBUTION.md).

### Mixing, automation and audio tools

- **Mixer and routing:** channel strips, faders, meters, pan, EQ, sends, Aux/summing routes, master processing and track effects.
- **Pedalboard:** eight built-in DSP effects across dynamics, distortion, modulation, delay, reverb and filter categories, including compressor, overdrive, chorus, phaser, tape delay, spring reverb, envelope filter and tremolo. Pedals can be reordered, bypassed, adjusted and saved in reusable chains.
- **Automation lanes:** draw and edit track, region and master automation. Supported controls include volume, pan, mute, tempo, EQ, sends, synth controls and pedal parameters. Read, Touch, Latch and Write modes control playback and recording behaviour.
- **Chord analysis:** detect chord names (including extended chords and inversions) from MIDI notes and recordings, display them in the global Chord Track/LCD, suggest project keys, audition chord regions and sync progressions to keyboard chord strips.
- **Audio denoising:** learn a noise print from a section of room tone, process an audio region with adjustable noise reduction, optionally apply a 75 Hz high-pass filter, preview the result and switch between the original and processed audio.
- **Bounce/export:** render a selected range or the project as WAV or MP3; choose 16- or 24-bit WAV, 44.1 or 48 kHz, MP3 bitrates, normalization, stereo mix or individual track stems, and optional effect-tail capture. Multiple output formats and stem exports are packaged as ZIP files.
- **MIDI interchange:** import Standard MIDI File format 0 and 1 tracks, and export project MIDI. Imported tempo and time-signature metadata are applied when starting with an empty project; tempo changes inside an imported file are not merged into the existing project tempo map.

### Soundstage project interchange

Use **File → Import Soundstage Project JSON…** or **File → Export Soundstage Project JSON…**. MIDI tracks, regions, notes, tempo, meter, project key, loop settings, mixer settings and supported drum patterns are translated to the native DAW model.

Soundstage JSON files do not contain their IndexedDB audio blobs. Audio clips therefore cannot be transferred through the JSON bridge; import the original audio files again after moving a session. Native audio assets stay in the browser's local storage and are not uploaded to GitHub.

## Technology

- Next.js App Router, React and TypeScript
- Web Audio API, AudioWorklet and `spessasynth_lib`
- `smplr` sample playback and SoundFont loading
- Web Workers for audio denoising and audio encoding
- Zustand project state
- Prisma + SQLite saved-song API
- Tailwind CSS and shadcn-style UI components
- Electron desktop shell and electron-builder installers for Windows and ChromeOS Linux

## Run locally

Install Node.js 22 or newer. Create a local `.env` file in the project root containing:

```dotenv
DATABASE_URL="file:./dev.db"
```

Then install dependencies, create the local SQLite schema and start the development server:

```bash
npm install
npx prisma generate
npx prisma db push
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Production build:

```bash
npm run lint
npm run test:daw
npm run typecheck
npm run db:push
npm run build
npm start
```

The production build uses Next.js standalone output. The build helper copies the static assets and public files into the standalone server folder and prepares the desktop app's local server bundle.

Microphone recording requires HTTPS (or localhost), browser permission and a supported input device. Browser MIDI input/output depends on browser and device support.

## Desktop installers

The desktop package opens the same Next.js studio in an Electron window and runs the Next.js server locally on the computer. It does not require a Codespace, a hosted website or an always-on internet connection.

The [Desktop Installers workflow](.github/workflows/desktop-build.yml) builds:

| Platform | Installer |
|---|---|
| Windows 10/11, x64 | Interactive `.exe` setup installer |
| Chromebook Linux, x86_64 | Debian `.deb` package |
| Chromebook Linux, ARM64 | Debian `.deb` package |

### Download the installers from GitHub Actions

1. Open the repository on GitHub and select **Actions**.
2. Select **Desktop Installers**.
3. Open the run automatically created by a push to the `codespace-symmetrical-spork-g976wjv9pqph99v6` branch.
4. When all three platform jobs finish, download the Windows or Linux artifact from the run's **Artifacts** section. The Linux artifact is built separately for x86_64 and ARM64.

Pushing a version tag such as `v1.0.0` also creates a GitHub Release containing the installers.

### Install on Windows

Download and run `GarageBand-Web-Studio-Setup-1.0.0-x64.exe`. Follow the installer prompts. A desktop shortcut and Start Menu entry are created.

The installer is not code-signed by default. Windows SmartScreen may therefore show an unsigned-app warning; that is separate from the build itself.

### Install on a Chromebook

1. Enable the Chromebook's **Linux development environment** in ChromeOS settings.
2. Download the Linux `.deb` artifact and place it in the Chromebook's **Linux files** folder.
3. In the Linux Terminal, check the CPU architecture with `uname -m`:
   - `x86_64` uses the x64 package.
   - `aarch64` uses the ARM64 package.
4. Install the downloaded package (replace the example filename with the exact downloaded filename):

```bash
sudo apt update
sudo apt install ./GarageBand-Web-Studio-1.0.0-amd64.deb
```

Use the `...-arm64.deb` file instead on an ARM64 Chromebook. After installation, open **GarageBand Web Studio** from the ChromeOS app launcher under **Linux apps**. To uninstall it later:

```bash
sudo apt remove garageband-web-studio
```

The Chromebook package is a Linux desktop application for devices that support ChromeOS's Linux development environment; it is not a Chrome Web Store extension or a native ChromeOS APK.

### Offline use and local data

- The desktop window and Next.js application server are bundled and run locally, so the studio can open without internet after installation.
- Projects saved through the song API use a SQLite database in the operating system's application-data folder.
- Audio regions, imported SoundFonts and user patches use browser storage (IndexedDB) associated with the desktop app's local address.
- Built-in procedural synth patches work without downloading sample banks. SoundFont bytes fetched from the remote bank loader are saved in IndexedDB after they have been loaded once. Imported `.sf2` and `.sf3` banks are stored locally as well.
- Some other `smplr`-loaded sample instruments fetch their credited sample sets from their upstream hosts. Their availability across app restarts while offline is not guaranteed. For reliable offline sound, use the built-in procedural synth patches or import a local `.sf2`/`.sf3` bank before disconnecting.

Offline availability therefore depends on the sample engine and what has been cached or imported. A fresh installation can launch offline; remote samples that have never been fetched cannot be loaded without a connection.

### Build installers locally

The GitHub Actions workflow is the recommended way to create installers because it builds each native package on its target operating system and CPU architecture. To build on a matching machine, install the packaging tools and use the corresponding script:

```bash
npm install --no-save --no-package-lock electron@45.3.3 electron-builder@26.18.0
npm run db:push
npm run build
npm run desktop:build:windows
# or, on Linux:
npm run desktop:build:linux
```

The Windows command must be run on Windows. The Linux command builds the x64 Debian package on x64 Linux; use the GitHub workflow for ARM64 Chromebook builds.

## Backend and account security status

The current full-stack backend is a **single-instance Prisma/SQLite saved-song API**. It is suitable for local development or a controlled personal deployment, but it does **not** yet include user authentication, per-user ownership, cloud object storage, multi-device sync, or row-level security. Do not expose the saved-song API as a multi-user public service until authentication and authorization are added. Those account/cloud features remain future work rather than being represented as complete.

The app is local-first for audio media. GitHub stores application source and documentation only; it should never receive private recordings or project audio. Desktop app databases and browser storage remain on the local device.

## Repository layout

- `src/app` — Next.js application, worklet endpoint and saved-song API routes
- `src/components/daw` — timeline, piano roll, sequencer, mixer, sound library and studio UI
- `src/lib/daw` — project model, state, audio engine, automation, effects, denoising, MIDI, SoundFont and Soundstage helpers
- `prisma` — SQLite schema
- `docs` — architecture, MIDI scripting, data interchange and audio attribution
- `electron` — local desktop window and runtime launcher
- `scripts` — DAW verification and standalone packaging helpers
- `.github/workflows` — continuous integration and desktop installer builds

## Feature status

The source contains the DAW workflows described above. Browser/device support varies for microphone access, MIDI devices and audio codecs. Remote sample availability depends on the upstream sample hosts and the local cache. Cloud authentication and multi-user cloud sync are not implemented.
