# Sample and library attribution

This project loads instrument samples at runtime through `smplr`; it does not commit third-party piano/string audio files to this repository.

## Acoustic piano

The Grand Piano and Bright Piano patches use `SplendidGrandPiano` from the `smplr` library. Its source sample set is the Splendid Grand Piano instrument, which identifies its AKAI-derived piano samples as public domain:

- Project: <https://github.com/sfzinstruments/SplendidGrandPiano>
- Library integration: <https://github.com/danigb/smplr>

The wrapper loads a spread of pitches from the sampled instrument and preserves velocity-sensitive sample layers. The browser sampler falls back to the DAW's procedural piano if loading fails.

## Orchestral string ensemble

The String Ensemble patch uses the General MIDI `string_ensemble_1` instrument from the FluidR3 GM soundfont (`FluidR3_GM` kit) via `smplr`.

- Soundfont author/credits: Frank Wen and FluidR3 GM contributors
- License: Creative Commons Attribution 3.0 (CC BY 3.0)
- License text: <https://creativecommons.org/licenses/by/3.0/>
- Distribution/source: <https://github.com/gleitz/midi-js-soundfonts>

The soundfont is fetched at runtime; sample files are not copied into this repository. If deployment changes the sample provider or soundfont version, review the upstream attribution and license terms again.

## Library dependency

`smplr` is used as a runtime sample loader/voice scheduler. Its implementation and license remain with the upstream project: <https://github.com/danigb/smplr>.
