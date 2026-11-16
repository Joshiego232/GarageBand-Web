# Sample library credits and licenses

GarageBand Web Studio loads sample audio on demand through the open-source
[smplr](https://github.com/danigb/smplr) sampler. The application does not
bundle proprietary sample recordings.

## General MIDI SoundFont instruments

The instrument catalog uses the **MusyngKite** General MIDI SoundFont by
Roberto Giammaria, served in browser-friendly formats by the MIDI.js SoundFonts
project:

- Source and attribution: https://github.com/gleitz/midi-js-soundfonts
- Hosted sample bank: https://gleitz.github.io/midi-js-soundfonts/MusyngKite/
- License: Creative Commons Attribution-ShareAlike 3.0 (CC BY-SA 3.0).
- Attribution: MusyngKite SoundFont by Roberto Giammaria; browser sample
  conversion and hosting by the MIDI.js SoundFonts project.

The project may offer **FluidR3_GM** as an alternate lighter bank in a future
sound-library setting. It is credited separately by its upstream project and
is not the default bank.

The Stage Keys and Layered Keys presets use programs from this same MusyngKite
bank. Layered presets combine two of its General MIDI instruments at runtime;
they do not contain or claim to reproduce Nord or Yamaha factory samples.

## Concert grand piano

The sampled concert grand uses the Splendid Grand Piano recordings hosted by
smpldsnds:

- Source: https://github.com/smpldsnds/sfzinstruments-splendid-grand-piano
- Instrument: AKAI Steinway samples with four velocity layers.
- License reported by the source collection: Public Domain.

## Electric pianos

The CP-80, Pianet T, and Wurlitzer EP200 sample sets are by Greg Sullivan,
with SFZ mapping by kinwie:

- Source: https://github.com/sfzinstruments/GregSullivan.E-Pianos
- Browser-hosted conversion: https://github.com/smpldsnds/sfzinstruments-greg-sullivan-e-pianos
- Attribution: Yamaha CP80 Electric Grand Piano, Hohner Pianet T (type 2),
  and Wurlitzer EP200 Electric Piano by Greg Sullivan; SFZ mapping by kinwie.
- License: Creative Commons Attribution 3.0 Unported (CC BY 3.0), as stated
  by the sample repository. The upstream author also publishes the sample
  instruments under a newer CC BY license; this project retains the original
  source attribution.

The TX81Z electric-piano sample is from the Versilian Community Sample Library
(VCSL):

- Source: https://github.com/smpldsnds/sgossner-vcsl
- License: CC0 1.0 Universal, as reported by the sample collection.

## Drum machines

The sampled TR-808, Casio RZ-1, LM-2, MFB-512 and Roland CR-8000 kits are loaded
from the smpldsnds public-domain drum-machine archive:

- Source: https://github.com/smpldsnds/drum-machines
- Hosted samples: https://smpldsnds.github.io/drum-machines/
- License: Public Domain, as reported by the collection.

## Runtime and third-party software

- [smplr](https://github.com/danigb/smplr) — MIT License.
- Samples are loaded on demand for instruments used by the current project.
  Browser caching is handled by the sampler and the user's browser.

Instrument recordings remain subject to their upstream licenses. The project
does not claim ownership of the sample recordings.
