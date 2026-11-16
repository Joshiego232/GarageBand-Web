"use client";

import { toast } from "sonner";
import { useDAW } from "./store";
import { barTicks, clamp } from "./utils";
import { createImportedMidiNotes, parseStandardMidiFile } from "./midi-file";
import { PPQ, uid } from "./types";

const isMidiFile = (file: File) => /\.(mid|midi)$/i.test(file.name);

export async function importMidiFiles(files: File[], startTick = 0): Promise<void> {
  for (const file of files) {
    if (!isMidiFile(file)) {
      toast.error(`"${file.name}" is not a MIDI file`);
      continue;
    }

    try {
      const parsed = parseStandardMidiFile(new Uint8Array(await file.arrayBuffer()));
      const st = useDAW.getState();
      const project = st.project;
      const projectIsEmpty = project.tracks.every((track) => track.regions.length === 0);

      if (projectIsEmpty) {
        if (parsed.tempo !== null) st.setTempo(clamp(parsed.tempo, 30, 260));
        if (parsed.timeSig) st.setTimeSig(parsed.timeSig[0], parsed.timeSig[1]);
      }

      const sourceName = file.name.replace(/\.(mid|midi)$/i, "").slice(0, 24) || "MIDI";
      const importedTracks = parsed.tracks.flatMap((midiTrack, index) => {
        const byChannel = new Map<number, typeof midiTrack.notes>();
        for (const note of midiTrack.notes) {
          const channelNotes = byChannel.get(note.channel) ?? [];
          channelNotes.push(note);
          byChannel.set(note.channel, channelNotes);
        }
        return Array.from(byChannel, ([channel, notes]) => {
          const multipleChannels = byChannel.size > 1;
          const fallbackName = parsed.tracks.length > 1
            ? `${sourceName} ${index + 1}`
            : sourceName;
          const trackName = midiTrack.name.startsWith("MIDI Track ")
            ? fallbackName
            : midiTrack.name;
          const name = (multipleChannels
            ? `${trackName} Ch ${channel + 1}`
            : trackName).slice(0, 40);
          const endTick = notes.reduce(
            (end, note) => Math.max(end, note.start + note.length),
            0
          );
          return {
            partial: {
              type: "midi" as const,
              name,
              instrument: channel === 9 ? "drum-kit" : "grand-piano",
            },
            region: {
              id: uid(),
              type: "midi" as const,
              name,
              start: Math.max(0, startTick),
              length: Math.max(barTicks(project.timeSig), endTick),
              notes: createImportedMidiNotes(notes),
            },
          };
        });
      });

      st.addTracks(importedTracks.map(({ partial }) => partial));
      const tracks = useDAW.getState().project.tracks.slice(-importedTracks.length);
      st.addRegions(importedTracks.map(({ region }, index) => ({
        ...region,
        trackId: tracks[index].id,
      })));

      toast.success(`Imported "${file.name}" (${importedTracks.length} MIDI track${importedTracks.length === 1 ? "" : "s"})`);
      if (parsed.hasTempoChanges) {
        toast.warning("MIDI tempo changes are not imported; note timing follows the project tempo.");
      }
      if (!projectIsEmpty && parsed.tempo !== null && Math.round(parsed.tempo) !== project.tempo) {
        toast.info("The project tempo was kept; imported MIDI note positions are measured in beats.");
      }
    } catch (error) {
      toast.error(
        `Could not import ${file.name}: ${
          error instanceof Error ? error.message : "invalid MIDI file"
        }`
      );
    }
  }
}

export function isMidiFileForImport(file: File): boolean {
  return isMidiFile(file);
}
