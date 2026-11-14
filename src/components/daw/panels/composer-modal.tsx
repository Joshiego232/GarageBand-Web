"use client";

// ============================================================
// AI Smart Composer - describe a song, get a full arrangement
// ============================================================

import { useState } from "react";
import { Sparkles, Loader2, Music } from "lucide-react";
import { useDAW } from "@/lib/daw/store";
import { LOOPS, loopToRegion, makeTrack, emptyProject } from "@/lib/daw/loops";
import { defaultParams } from "@/lib/daw/instruments";
import { PPQ, uid, type Project, type Region, type Track } from "@/lib/daw/types";
import { toast } from "sonner";

const IDEAS = [
  "dreamy synthwave at midnight",
  "sunny pop song for a road trip",
  "dark trap beat with heavy 808s",
  "lo-fi jazz for a rainy cafe",
  "epic rock anthem with a big chorus",
  "latin summer groove",
];

interface ArrangementEntry {
  loopId: string;
  trackName: string;
  startBar: number;
  lengthBars: number;
}

interface Arrangement {
  name: string;
  tempo: number;
  keyTonic: number;
  keyMode: "major" | "minor";
  arrangement: ArrangementEntry[];
}

/** Local fallback composer - keyword based */
function localCompose(prompt: string): Arrangement {
  const p = prompt.toLowerCase();
  const pick = (id: string) => LOOPS.find((l) => l.id === id)!;
  let drums = "dr-pop";
  let bass = "bs-pop";
  let chords = "ch-epiano";
  let melody = "me-hook-min";
  let tempo = 100;
  let mode: "major" | "minor" = "minor";
  let tonic = 9;
  if (/trap|hip.?hop|808|rap|dark/.test(p)) {
    drums = "dr-trap";
    bass = "bs-808";
    chords = "ch-pad";
    melody = "me-sparse";
    tempo = 140;
  } else if (/edm|house|dance|club|electro/.test(p)) {
    drums = "dr-house";
    bass = "bs-sub";
    chords = "ch-stab";
    melody = "me-hook-min";
    tempo = 124;
  } else if (/rock|punk|guitar|band/.test(p)) {
    drums = "dr-rock-drive";
    bass = "bs-pop";
    chords = "ch-guitar";
    melody = "me-hook";
    tempo = 120;
    mode = "major";
    tonic = 2;
  } else if (/jazz|lounge|lo.?fi|cafe/.test(p)) {
    drums = "dr-shuffle";
    bass = "bs-walk";
    chords = "ch-epiano";
    melody = "me-flute";
    tempo = 84;
    mode = "major";
    tonic = 5;
  } else if (/latin|summer|salsa|beach/.test(p)) {
    drums = "dr-latin";
    bass = "bs-funk";
    chords = "ch-guitar";
    melody = "me-flute";
    tempo = 104;
    mode = "major";
    tonic = 7;
  } else if (/sad|emotional|ballad|slow/.test(p)) {
    drums = "dr-ballad";
    bass = "bs-sub";
    chords = "ch-broken";
    tempo = 72;
  } else if (/happy|pop|sunny|bright/.test(p)) {
    mode = "major";
    tonic = 0;
    melody = "me-hook";
  }
  return {
    name: prompt.split(/[,.]/)[0].slice(0, 22).trim() || "New Idea",
    tempo,
    keyTonic: tonic,
    keyMode: mode,
    arrangement: [
      { loopId: drums, trackName: "Drums", startBar: 0, lengthBars: 24 },
      { loopId: bass, trackName: "Bass", startBar: 4, lengthBars: 20 },
      { loopId: chords, trackName: "Chords", startBar: 0, lengthBars: 24 },
      { loopId: melody, trackName: "Melody", startBar: 12, lengthBars: 12 },
    ],
  };
}

function buildProject(a: Arrangement): Project {
  const project = emptyProject(a.name || "AI Song");
  project.tempo = Math.min(200, Math.max(60, Math.round(a.tempo) || 100));
  project.keyTonic = ((Math.round(a.keyTonic) || 0) + 12) % 12;
  project.keyMode = a.keyMode === "major" ? "major" : "minor";
  const bt = 4 * PPQ;
  const tracks: Track[] = [];
  for (const entry of a.arrangement) {
    const def = LOOPS.find((l) => l.id === entry.loopId);
    if (!def) continue;
    const track = makeTrack({
      type: "midi",
      instrument: def.instrument,
      name: (entry.trackName || def.name).slice(0, 18),
    });
    const startBar = Math.max(0, Math.round(entry.startBar) || 0);
    const lengthBars = Math.min(64, Math.max(2, Math.round(entry.lengthBars) || 8));
    const region: Region = loopToRegion(def, track.id, startBar * bt, project);
    region.looped = true;
    region.coreLength = def.bars * bt;
    region.length = lengthBars * bt;
    region.name = def.name;
    track.regions.push(region);
    track.params = { ...defaultParams(def.instrument) };
    if (def.category === "Pads") track.params.reverb = 0.35;
    if (def.category === "Melody") {
      track.params.reverb = 0.25;
      track.params.delay = 0.15;
    }
    tracks.push(track);
  }
  if (!tracks.length) {
    // ultra fallback
    const t = makeTrack({ type: "midi", instrument: "grand-piano" });
    t.regions.push(loopToRegion(LOOPS[3], t.id, 0, project));
    tracks.push(t);
  }
  project.tracks = tracks;
  return project;
}

export function ComposerModal() {
  const setModal = useDAW((s) => s.setModal);
  const loadProject = useDAW((s) => s.loadProject);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  const compose = async (useLocal = false) => {
    const text = prompt.trim();
    if (!text) {
      toast.info("Describe the song you want first");
      return;
    }
    setBusy(true);
    let arrangement: Arrangement | null = null;
    if (!useLocal) {
      try {
        const res = await fetch("/api/compose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: text }),
        });
        if (res.ok) {
          const json = await res.json();
          arrangement = json.arrangement as Arrangement;
        }
      } catch {
        /* fall back below */
      }
    }
    if (!arrangement) {
      arrangement = localCompose(text);
    }
    const project = buildProject(arrangement);
    loadProject(project);
    setModal("none");
    setBusy(false);
    toast.success(`Composed "${project.name}" - press Space to play`);
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#232327] border border-black/70 rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2.5 px-5 py-4 bg-gradient-to-r from-[#2c2620] to-[#232327] border-b border-black/50">
          <div className="size-9 rounded-lg bg-gradient-to-br from-[#ffb648] to-[#d98b1f] flex items-center justify-center">
            <Sparkles className="size-4.5 text-[#19191b]" />
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-100">Smart Composer</div>
            <div className="text-[10px] text-zinc-500">Describe a song - AI arranges it for you</div>
          </div>
          <button
            onClick={() => !busy && setModal("none")}
            className="ml-auto p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-white/10 text-sm"
          >
            ✕
          </button>
        </div>
        <div className="p-5 space-y-4">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void compose();
              }
            }}
            rows={3}
            autoFocus
            placeholder="e.g. a dreamy synthwave night drive with a punchy beat..."
            className="w-full bg-[#101013] border border-black/60 focus:border-[#ffb648]/50 rounded-lg px-3 py-2.5 text-[13px] text-zinc-200 placeholder:text-zinc-600 outline-none resize-none"
          />
          <div className="flex flex-wrap gap-1.5">
            {IDEAS.map((idea) => (
              <button
                key={idea}
                onClick={() => setPrompt(idea)}
                className="text-[10px] px-2 py-1 rounded-full bg-[#2a2a2f] border border-black/40 text-zinc-400 hover:text-[#ffb648] hover:border-[#ffb648]/40 transition-colors"
              >
                {idea}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-zinc-500 px-1">
            <Music className="size-3" />
            The composer picks from the built-in loop library and follows your project key and tempo after loading.
          </div>
        </div>
        <div className="px-5 pb-5 flex items-center gap-2">
          <button
            onClick={() => void compose(true)}
            disabled={busy}
            className="text-[11px] px-3 py-2 rounded-md border border-black/50 bg-[#2a2a2f] text-zinc-400 hover:text-zinc-200 disabled:opacity-40"
          >
            Quick Sketch
          </button>
          <button
            onClick={() => void compose()}
            disabled={busy}
            className="flex-1 flex items-center justify-center gap-2 text-[12px] font-medium px-4 py-2.5 rounded-md bg-gradient-to-b from-[#ffc466] to-[#eda23c] text-[#19191b] hover:brightness-105 disabled:opacity-50 transition"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {busy ? "Composing..." : "Compose Song"}
          </button>
        </div>
      </div>
    </div>
  );
}
