# On-screen keyboard instrument overlay artwork

This document describes the current artwork inventory and the image-generation brief for the on-screen keyboard.

## Current artwork inventory

The repository currently contains these usable on-screen instrument images:

- `/concert-grand-piano.svg` — concert grand piano artwork.
- `/nord-stage-keyboard.svg` — stage keyboard artwork.
- `/instrument-previews/synth-01.jpg` through `synth-08.jpg` — eight synth-preview images. The synth catalogue assigns these to its 50 synth presets.

The instrument artwork resolver also classifies every patch into one of these fallback families: piano, guitar, drums, synth, organ, brass, strings, bass, bells, and turntable. Until a dedicated image is supplied, the keyboard uses a matching icon/graphic fallback for that family rather than a broken image URL.

The image map in `src/lib/daw/instrumentPresets.ts` currently connects Concert Grand Piano, Bright Acoustic Piano, and Wurlitzer EP-200 to existing artwork. The eight synth preview paths are resolved by `src/lib/daw/synthCatalog.ts`.

The three reference photos previously supplied for the guitar headstock, orchestral strings, and saxophone are not currently present as files in this repository's `public/` directory. Add those image files there before mapping them to instrument IDs.

## Master image-generation prompt

Use this prompt for each instrument or instrument family. Replace the bracketed fields with the target patch name and its family.

> Create a premium, photorealistic, cinematic instrument artwork panel for a professional desktop music-production keyboard. Subject: **[INSTRUMENT NAME]**, from the **[INSTRUMENT FAMILY]** family. Compose the instrument as a dramatic horizontal hero image, viewed at a natural three-quarter angle, with realistic materials, accurate instrument construction, refined studio lighting, and a deep charcoal/black studio background. The instrument should be instantly recognizable and occupy the upper half to upper two-thirds of the frame. Use tasteful highlights and subtle depth; avoid clutter.
>
> **Critical layout requirement:** reserve the entire lower 38–42 percent of the image as a dark, uncluttered control deck. Place exactly six evenly spaced, empty circular recessed wells across this lower area, aligned in one straight horizontal row. Each well must be the same size, have enough clear space around it for a real rotary control to be placed over it, and remain completely empty. These are placeholders for six live application controls: Compression, High, Mid, Low, Reverb, and Velocity. Do not draw knobs, pointers, numeric values, labels, text, lettering, logos, buttons, sliders, or any other controls inside the wells. The real controls will be rendered by the application on top of the image.
>
> Keep the upper instrument artwork separate from the six lower control wells. Do not let strings, keys, instrument parts, reflections, cables, shadows, or decorative lines cross into the wells. Preserve the six-well row clearly at small on-screen sizes. No borders, no watermark, no extra text. Wide 4:1 landscape composition, designed to crop cleanly inside a compact DAW keyboard panel.

## Family-specific subject directions

- **Piano & electric keys:** grand piano, upright piano, Rhodes/Wurlitzer electric piano, or stage keyboard; show the keyboard and a recognizable portion of the instrument body while keeping all six wells unobstructed.
- **Guitar & bass:** use the supplied red Fender-style headstock photograph as the visual reference for electric-guitar patches; use a suitable acoustic or bass guitar for other patches. Keep strings and tuning hardware away from the lower wells.
- **Strings & orchestral:** use the supplied violin/viola/cello group photograph as the reference. Keep bows, bridges, and instrument bodies in the upper image region.
- **Brass & winds:** use the supplied gold saxophone photograph as the reference for saxophone patches; choose accurate brass or woodwind instruments for other patches.
- **Drums & percussion:** use a realistic acoustic drum kit, hand percussion, or orchestral percussion appropriate to the selected patch.
- **Organs:** show a tonewheel organ, drawbars, or church-organ console appropriate to the patch.
- **Synthesizers:** show a premium analog/digital synthesizer, tasteful oscillator/waveform lighting, and a clean dark studio scene.
- **Bells & mallets:** show a celesta, vibraphone, marimba, chimes, or other correct pitched-percussion instrument.
- **Turntable & DJ:** show a vinyl turntable or DJ deck with a recognizable platter and tonearm.

## Asset naming and mapping

Save generated artwork as WebP files in `public/instrument-previews/`, using the patch ID as the filename, for example:

- `grand-piano.webp`
- `red-electric-guitar.webp`
- `orchestral-strings.webp`
- `gold-saxophone.webp`

Then map each exact patch ID to its public path in `INSTRUMENT_PREVIEW_IMAGES` in `src/lib/daw/instrumentPresets.ts`. Do not map an image to a patch whose instrument does not match the artwork. When no dedicated image is available, keep the category fallback.
