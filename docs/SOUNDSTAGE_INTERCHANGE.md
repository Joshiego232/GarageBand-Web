# Soundstage project interchange

Use the application File menu to import or export a Soundstage project JSON file.

## Imported fields

The bridge reads project title, BPM, time signature, key signature, cycle range, count-in, metronome, master level, track names/types/colors, mute/solo/arm state, pan/volume, basic EQ/sends, MIDI note regions, loop counts, and drum-step velocity patterns.

Track presets are mapped to the closest native patch where a direct equivalent exists. Unknown presets use a warm pad fallback. Beat values are converted to the native 960-tick quarter-note grid.

## Exported fields

The exporter writes the corresponding Soundstage project metadata, track records, region positions and lengths, MIDI notes, supported mixer values, and loop counts. Audio clip duration metadata is included as a hint but not the binary media.

## Media limitation

Soundstage project JSON references audio by local IndexedDB IDs. Those IDs do not grant access to the original browser's private IndexedDB blobs, so JSON interchange cannot copy the audio. The importer skips those clip payloads and reports how many audio clips need their original source files re-imported.
