"use client";

import { useMemo, useState } from "react";
import { ArrowRight, AudioWaveform, CheckCircle2, Download, Music2, RefreshCw, Sparkles } from "lucide-react";
import { PATCHES } from "@/lib/daw/instruments";
import { cacheSoundFont, getCachedSoundFont } from "@/lib/daw/soundfont-cache";

type Props = { onContinue: () => void };

export function SoundLibrarySetup({ onContinue }: Props) {
  const items = useMemo(() => {
    const byUrl = new Map<string, { name: string; url: string }>();
    for (const patch of Object.values(PATCHES)) {
      const url = patch.soundfont?.url;
      if (url && !byUrl.has(url)) byUrl.set(url, { name: patch.soundfont?.name ?? patch.name, url });
    }
    return [...byUrl.values()];
  }, []);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const [current, setCurrent] = useState("Ready when you are");
  const percent = items.length ? Math.round((completed / items.length) * 100) : 100;

  const prepare = async () => {
    if (running) return;
    setRunning(true);
    setDone(false);
    setCompleted(0);
    setFailed([]);
    const errors: string[] = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      setCurrent(item.name);
      try {
        const cached = await getCachedSoundFont(item.url);
        if (!cached) {
          const response = await fetch(item.url);
          if (!response.ok) throw new Error(`Download failed (${response.status})`);
          const bytes = await response.arrayBuffer();
          await cacheSoundFont(item.url, bytes);
        }
      } catch (error) {
        console.warn("Sound library preparation failed for", item.name, error);
        errors.push(item.name);
      }
      setCompleted(index + 1);
    }
    setFailed(errors);
    setCurrent(errors.length ? "Some sounds could not be downloaded" : "Your SoundFont library is ready");
    setDone(true);
    setRunning(false);
  };

  const finish = () => {
    try { localStorage.setItem("webband-sound-library-setup-v1", "done"); } catch {}
    onContinue();
  };

  return (
    <main className="fixed inset-0 z-[100] overflow-y-auto bg-[#101114] text-white">
      <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-5 py-7 sm:px-8 lg:px-12">
        <header className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] text-amber-300">
            <AudioWaveform size={22} />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-wide">GARAGEBAND WEB STUDIO</p>
            <p className="text-xs text-zinc-500">First-time setup</p>
          </div>
          <span className="ml-auto rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] text-emerald-300">Sound library</span>
        </header>

        <section className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[1.05fr_.95fr]">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/[0.07] px-3 py-1.5 text-xs text-amber-200">
              <Sparkles size={13} /> A better first session starts here
            </div>
            <h1 className="max-w-2xl text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl">
              Get your sounds ready.
              <span className="block bg-gradient-to-r from-amber-200 via-orange-300 to-rose-300 bg-clip-text text-transparent">Then just play.</span>
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-7 text-zinc-400 sm:text-base">
              Prepare the built-in SoundFont presets now. They’ll be saved in this app’s local sound cache, so supported instruments can load faster and remain available without downloading them again.
            </p>

            <div className="mt-8 grid grid-cols-3 gap-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <Music2 className="mb-3 text-amber-200" size={20} />
                <p className="text-xs font-medium">Keys & synths</p>
                <p className="mt-1 text-[10px] text-zinc-500">Pianos, pads, organs</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <AudioWaveform className="mb-3 text-rose-200" size={20} />
                <p className="text-xs font-medium">Orchestral</p>
                <p className="mt-1 text-[10px] text-zinc-500">Strings, brass, winds</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <Download className="mb-3 text-sky-200" size={20} />
                <p className="text-xs font-medium">SoundFonts</p>
                <p className="mt-1 text-[10px] text-zinc-500">Saved locally</p>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={prepare}
                disabled={running || done && failed.length === 0}
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-amber-300 px-5 text-sm font-semibold text-[#17130c] transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {running ? <RefreshCw className="animate-spin" size={16} /> : done && failed.length === 0 ? <CheckCircle2 size={16} /> : <Download size={16} />}
                {running ? "Preparing sounds…" : done && failed.length === 0 ? "Sounds prepared" : failed.length ? "Retry failed downloads" : "Prepare sound library"}
              </button>
              <button
                type="button"
                onClick={finish}
                disabled={running}
                className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/15 px-5 text-sm text-zinc-300 transition hover:bg-white/[0.06] disabled:opacity-40"
              >
                {done ? "Open Studio" : "Do this later"} <ArrowRight size={15} />
              </button>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-[#1a1b20] p-5 shadow-2xl shadow-black/30 sm:p-7">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Sound library preparation</p>
                <p className="mt-1 text-xs text-zinc-500">{items.length} unique built-in SoundFont files</p>
              </div>
              <span className="rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-xs tabular-nums text-zinc-300">{percent}%</span>
            </div>
            <div className="mt-6 h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-amber-300 to-rose-400 transition-all duration-300" style={{ width: `${percent}%` }} />
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate text-zinc-400">{current}</span>
              <span className="shrink-0 tabular-nums text-zinc-500">{completed}/{items.length}</span>
            </div>
            {running && <p className="mt-5 text-xs leading-6 text-zinc-500">Keep this window open while the files are saved to your local sound cache. Download time depends on your connection.</p>}
            {done && failed.length === 0 && (
              <div className="mt-6 flex items-start gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.07] p-4">
                <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-300" size={18} />
                <div><p className="text-sm font-medium text-emerald-200">All built-in SoundFont files are ready</p><p className="mt-1 text-xs leading-5 text-zinc-400">They are stored in the app’s IndexedDB cache for this installation.</p></div>
              </div>
            )}
            {done && failed.length > 0 && (
              <div className="mt-6 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-4">
                <p className="text-sm font-medium text-amber-200">{failed.length} file(s) need another attempt</p>
                <p className="mt-1 text-xs leading-5 text-zinc-400">{failed.slice(0, 4).join(", ")}{failed.length > 4 ? "…" : ""}</p>
              </div>
            )}
            <div className="mt-6 border-t border-white/10 pt-5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Good to know</p>
              <p className="mt-2 text-xs leading-6 text-zinc-500">This step caches the built-in SoundFont files. Other sample-based instruments may still need their credited sample sources on first use. Imported SoundFonts are kept separately and are not included in this download.</p>
            </div>
          </div>
        </section>
        <footer className="border-t border-white/10 pt-4 text-[10px] text-zinc-600">Your projects and sound cache stay on this device.</footer>
      </div>
    </main>
  );
}
