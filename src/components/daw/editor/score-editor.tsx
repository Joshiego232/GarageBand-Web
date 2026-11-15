"use client";

import { Printer, Music2 } from "lucide-react";
import { useDAW } from "@/lib/daw/store";
import { PPQ, type Note } from "@/lib/daw/types";
import { barTicks, noteName } from "@/lib/daw/utils";
import { findActiveRegion } from "./piano-roll";

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const NATURAL_PITCH_CLASS: Record<number, { letter: number; accidental: string }> = {
  0: { letter: 0, accidental: "" },
  1: { letter: 0, accidental: "♯" },
  2: { letter: 1, accidental: "" },
  3: { letter: 1, accidental: "♯" },
  4: { letter: 2, accidental: "" },
  5: { letter: 3, accidental: "" },
  6: { letter: 3, accidental: "♯" },
  7: { letter: 4, accidental: "" },
  8: { letter: 4, accidental: "♯" },
  9: { letter: 5, accidental: "" },
  10: { letter: 5, accidental: "♯" },
  11: { letter: 6, accidental: "" },
};

function staffPosition(pitch: number) {
  const octave = Math.floor(pitch / 12) - 1;
  const pitchClass = ((pitch % 12) + 12) % 12;
  const spelling = NATURAL_PITCH_CLASS[pitchClass];
  const diatonic = octave * 7 + spelling.letter;
  const e4 = 4 * 7 + 2;
  return {
    step: diatonic - e4,
    accidental: spelling.accidental,
    label: noteName(pitch),
  };
}

function durationLabel(length: number) {
  if (length >= PPQ * 3.5) return "Whole";
  if (length >= PPQ * 1.75) return "Half";
  if (length >= PPQ * 0.85) return "Quarter";
  if (length >= PPQ * 0.4) return "Eighth";
  return "Sixteenth";
}

function NoteGlyph({
  note,
  x,
  y,
}: {
  note: Note;
  x: number;
  y: number;
}) {
  const open = note.length >= PPQ * 1.75;
  const stemUp = y >= 132;
  const stemX = x + (stemUp ? 9 : -9);
  const stemEnd = y + (stemUp ? -42 : 42);
  const isShort = note.length < PPQ / 2;

  return (
    <g>
      {y < 108 || y > 156 ? (
        <line x1={x - 10} y1={y} x2={x + 10} y2={y} stroke="#a1a1aa" strokeWidth="1.2" />
      ) : null}
      <ellipse
        cx={x}
        cy={y}
        rx="7.8"
        ry="5.4"
        transform={`rotate(-18 ${x} ${y})`}
        fill={open ? "none" : "#e4e4e7"}
        stroke="#e4e4e7"
        strokeWidth="1.5"
      />
      <line
        x1={stemX}
        y1={y + (stemUp ? -1 : 1)}
        x2={stemX}
        y2={stemEnd}
        stroke="#e4e4e7"
        strokeWidth="1.5"
      />
      {isShort ? (
        <path
          d={stemUp
            ? `M ${stemX} ${stemEnd} q 15 7 7 19`
            : `M ${stemX} ${stemEnd} q -15 -7 -7 -19`}
          fill="none"
          stroke="#e4e4e7"
          strokeWidth="1.6"
        />
      ) : null}
      {note.velocity < 55 ? (
        <circle cx={x - 15} cy={y - 12} r="2" fill="#8fb44a" />
      ) : null}
    </g>
  );
}

export function ScoreEditor() {
  const project = useDAW((state) => state.project);
  const ui = useDAW((state) => state.ui);
  const found = useDAW((state) =>
    findActiveRegion(
      state.project,
      state.ui.editorRegionId,
      state.ui.selectedRegionIds,
      state.ui.selectedTrackId,
    ),
  );
  const region = found?.region;
  const track = found?.track;

  if (!region || region.type !== "midi") {
    return (
      <div className="flex-1 grid place-items-center text-xs text-zinc-600">
        Select a MIDI region to view its notation.
      </div>
    );
  }

  const barDuration = barTicks(project.timeSig);
  const bars = Math.max(1, Math.ceil(region.length / barDuration));
  const barWidth = 180;
  const left = 78;
  const top = 60;
  const bottomLine = top + 96;
  const width = left + bars * barWidth + 36;
  const height = 210;
  const notes = [...(region.notes ?? [])].sort((a, b) => a.start - b.start || a.pitch - b.pitch);

  return (
    <div className="score-print flex-1 min-h-0 flex flex-col bg-[#f2f0e8] text-zinc-900">
      <header className="shrink-0 flex flex-wrap items-center gap-2 border-b border-[#d7d2c5] bg-[#e8e5dc] px-3 py-2">
        <Music2 size={14} className="text-zinc-700" />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-zinc-900 truncate">{region.name}</p>
          <p className="text-[9px] text-zinc-600 truncate">
            {track?.name ?? "MIDI"} · {project.tempo} BPM · {project.timeSig[0]}/{project.timeSig[1]} · {notes.length} notes
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="ml-auto h-7 px-2.5 rounded border border-[#bcb6a8] bg-white/70 text-[10px] text-zinc-800 hover:bg-white inline-flex items-center gap-1.5"
        >
          <Printer size={12} /> Print score
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-auto p-3">
        <div className="inline-block rounded border border-[#d4d0c5] bg-[#fffef9] p-3 shadow-sm">
          <div className="mb-2 flex items-baseline gap-3 px-2">
            <h3 className="text-sm font-serif font-semibold text-zinc-900">{project.name}</h3>
            <span className="text-[10px] text-zinc-500">{track?.name}</span>
            <span className="ml-auto text-[9px] text-zinc-500">Concert pitch · Treble clef</span>
          </div>

          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={`MIDI score with ${notes.length} notes in ${bars} bars`}
          >
            <rect width={width} height={height} fill="#fffef9" />
            {[0, 1, 2, 3, 4].map((line) => (
              <line
                key={line}
                x1={left}
                y1={top + line * 24}
                x2={width - 12}
                y2={top + line * 24}
                stroke="#77746c"
                strokeWidth="1"
              />
            ))}
            <text x="12" y={top + 75} fontSize="64" fill="#34332e" fontFamily="serif">𝄞</text>
            <text x="45" y={top + 25} fontSize="18" fill="#34332e" textAnchor="middle">{project.timeSig[0]}</text>
            <text x="45" y={top + 47} fontSize="18" fill="#34332e" textAnchor="middle">{project.timeSig[1]}</text>

            {Array.from({ length: bars + 1 }, (_, bar) => (
              <g key={bar}>
                <line
                  x1={left + bar * barWidth}
                  y1={top}
                  x2={left + bar * barWidth}
                  y2={bottomLine}
                  stroke="#77746c"
                  strokeWidth={bar === 0 || bar === bars ? 1.8 : 1}
                />
                {bar < bars ? (
                  <text
                    x={left + bar * barWidth + 5}
                    y={top - 15}
                    fontSize="10"
                    fill="#77746c"
                  >
                    {bar + 1}
                  </text>
                ) : null}
              </g>
            ))}

            {notes.map((note) => {
              const position = staffPosition(note.pitch);
              const localBar = note.start / barDuration;
              const x = left + localBar * barWidth + 10;
              const y = bottomLine - position.step * 6;
              const accidentalX = x - 18;
              return (
                <g key={note.id}>
                  {position.accidental ? (
                    <text
                      x={accidentalX}
                      y={y + 5}
                      fontSize="16"
                      fill="#34332e"
                      textAnchor="middle"
                    >
                      {position.accidental}
                    </text>
                  ) : null}
                  <NoteGlyph note={note} x={x} y={y} />
                  <title>{`${position.label} · ${durationLabel(note.length)} · velocity ${note.velocity}`}</title>
                </g>
              );
            })}
          </svg>

          <div className="mt-1 flex items-center justify-between border-t border-[#e1ddd2] px-2 pt-2 text-[9px] text-zinc-500">
            <span>Generated from MIDI notes · Sharps shown as accidentals</span>
            <span>{notes.length} notes</span>
          </div>
        </div>
      </div>
      <style jsx global>{`
        @media print {
          body * { visibility: hidden !important; }
          .score-print, .score-print * { visibility: visible !important; }
          .score-print {
            position: absolute !important;
            inset: 0 !important;
            width: 100% !important;
            height: auto !important;
            overflow: visible !important;
            background: white !important;
          }
          .score-print header button { display: none !important; }
          .score-print > div { overflow: visible !important; }
        }
      `}</style>
    </div>
  );
}
