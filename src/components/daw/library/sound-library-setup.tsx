"use client";

import { useMemo, useState } from "react";
import { AudioWaveform, CheckCircle2, Download, Music2, RefreshCw, Sparkles, ShieldCheck } from "lucide-react";
import { SOUNDFONT_PATCHES } from "@/lib/daw/soundfont-catalog";
import { PATCHES } from "@/lib/daw/instruments";
import {
  clearPersistentSampleCacheIssues,
  getPersistentSampleCacheIssues,
  isPersistentSampleStorageAvailable,
  warmSampledPatch,
} from "@/lib/daw/sampled-instruments";
import { installSoundFontFile } from "@/lib/daw/soundfont-cache";

type Props = { onContinue: () => void };

export function SoundLibrarySetup({ onContinue }: Props) {
  const items = useMemo(() => {
    const byUrl = new Map<string, { name: string; url: string }>();
    for (const patch of Object.values(SOUNDFONT_PATCHES)) {
      const url = patch.soundfont?.url;
      if (url && !byUrl.has(url)) byUrl.set(url, { name: patch.soundfont?.name ?? patch.name, url });
    }
    return [...byUrl.values()];
  }, []);
  const sampledItems = useMemo(
    () => Object.values(PATCHES).filter(
      (patch) => patch.sampled && patch.sampled.engine !== "soundfont-worklet",
    ),
    [],
  );
  const totalTasks = items.length + sampledItems.length;
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const [bytesInstalled, setBytesInstalled] = useState(0);
  const [current, setCurrent] = useState("Ready when you are");
  const percent = totalTasks ? Math.round((completed / totalTasks) * 100) : 100;

  const prepare = async () => {
    if (running) return;
    setRunning(true);
    setDone(false);
    setCompleted(0);
    setBytesInstalled(0);
    setFailed([]);

    if (!isPersistentSampleStorageAvailable()) {
      setFailed([
        "Persistent sample caching requires HTTPS, localhost, or the installed desktop app.",
      ]);
      setCurrent("Persistent sample storage is unavailable");
      setDone(true);
      setRunning(false);
      return;
    }

    clearPersistentSampleCacheIssues();

    const errors: string[] = [];
    const active = new Set<string>();
    let nextIndex = 0;
    let completedCount = 0;
    let totalBytes = 0;
    const markCompleted = (label: (count: number) => string) => {
      completedCount += 1;
      setCompleted(completedCount);
      setBytesInstalled(totalBytes);
      setCurrent(label(completedCount));
    };

    // Download the individual SF2/SF3 banks with a small worker pool.
    const concurrency = Math.min(3, Math.max(1, items.length));
    const worker = async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;

        const item = items[index];
        active.add(item.name);
        setCurrent(`Installing SoundFont: ${item.name}`);
        try {
          const result = await installSoundFontFile(item.url);
          totalBytes += result.byteLength;
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          console.warn("Sound library installation failed for", item.name, error);
          errors.push(`${item.name}: ${detail}`);
        } finally {
          active.delete(item.name);
          markCompleted((count) =>
            active.size
              ? `Installed ${count} of ${totalTasks} · downloading ${[...active].join(", ")}`
              : `Installed ${count} of ${totalTasks} sound assets`,
          );
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    // Warm every other sampled preset so its audio files are already present
    // in CacheStorage before the studio opens. Use short-lived audio contexts
    // in small batches to keep decoded sample memory bounded during setup.
    const batchSize = 3;
    for (let offset = 0; offset < sampledItems.length; offset += batchSize) {
      const batch = sampledItems.slice(offset, offset + batchSize);
      let context: AudioContext | null = null;
      try {
        context = new AudioContext({ latencyHint: "playback" });
        const silentOutput = context.createGain();
        silentOutput.gain.value = 0;
        silentOutput.connect(context.destination);

        await Promise.all(batch.map(async (patch) => {
          setCurrent(`Preloading instrument: ${patch.name}`);
          try {
            await warmSampledPatch(
              context as AudioContext,
              silentOutput,
              patch,
              false,
              `sound-library-preload-${patch.id}`,
            );
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            console.warn("Sampled instrument preload failed for", patch.name, error);
            errors.push(`${patch.name}: ${detail}`);
          } finally {
            markCompleted((count) =>
              `Preloaded ${patch.name} · ${count} of ${totalTasks} sound assets`,
            );
          }
        }));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        for (const patch of batch) {
          errors.push(`${patch.name}: ${detail}`);
          markCompleted((count) =>
            `Could not preload ${patch.name} · ${count} of ${totalTasks} sound assets`,
          );
        }
      } finally {
        if (context && context.state !== "closed") {
          await context.close().catch(() => {});
        }
      }
    }

    const cacheIssues = getPersistentSampleCacheIssues();
    if (cacheIssues.length > 0) {
      errors.push(
        `${cacheIssues.length} sampled audio file(s) could not be saved to persistent offline storage. Free up device storage and retry.`,
      );
    }

    setFailed(errors);
    setCurrent(
      errors.length
        ? "Some sound assets need another attempt"
        : "Your complete built-in sound library is ready",
    );
    setDone(true);
    setRunning(false);
  };

  const finish = () => {
    if (!done || failed.length > 0 || running) return;
    try { localStorage.setItem("webband-sound-library-setup-v2", "done"); } catch {}
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
            <p className="text-xs text-zinc-500">One-time sound installation</p>
          </div>
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-amber-300/20 bg-amber-300/[0.07] px-3 py-1 text-[11px] text-amber-200"><ShieldCheck size={12} /> Required setup</span>
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
              Download and preload the full built-in sound collection before entering the studio: SoundFont banks, sampled pianos, drum machines, orchestral sounds, guitars, basses and layered keys. The sample sets are loaded in small batches and saved to persistent local storage.
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
                {running ? "Installing sound library…" : done && failed.length === 0 ? "Sound library installed" : failed.length ? "Retry missing files" : "Install all sounds"}
              </button>
              <button
                type="button"
                onClick={finish}
                disabled={!done || failed.length > 0 || running}
                className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/15 px-5 text-sm text-zinc-200 transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-35"
              >
                Open Studio
              </button>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-[#1a1b20] p-5 shadow-2xl shadow-black/30 sm:p-7">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">SoundFont installation</p>
                <p className="mt-1 text-xs text-zinc-500">{items.length} unique SF2/SF3 files + {sampledItems.length} sampled instrument presets</p>
              </div>
              <span className="rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-xs tabular-nums text-zinc-300">{percent}%</span>
            </div>
            <div className="mt-6 h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-amber-300 to-rose-400 transition-all duration-300" style={{ width: `${percent}%` }} />
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate text-zinc-400">{current}</span>
              <span className="shrink-0 tabular-nums text-zinc-500">{completed}/{totalTasks} · {(bytesInstalled / (1024 * 1024)).toFixed(1)} MB of banks</span>
            </div>
            {running && <p className="mt-5 text-xs leading-6 text-zinc-500">SoundFont banks download three at a time. Sampled instruments are preloaded in batches of three, with at most four sample requests active at once. Completed files remain cached if the setup is interrupted.</p>}
            {done && failed.length === 0 && (
              <div className="mt-6 flex items-start gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.07] p-4">
                <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-300" size={18} />
                <div><p className="text-sm font-medium text-emerald-200">All built-in sounds are preloaded</p><p className="mt-1 text-xs leading-5 text-zinc-400">{items.length} SoundFont files and {sampledItems.length} sampled instrument presets have been loaded and verified in local storage. You can now enter the studio and work offline.</p></div>
              </div>
            )}
            {done && failed.length > 0 && (
              <div className="mt-6 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-4">
                <p className="text-sm font-medium text-amber-200">{failed.length} sound asset(s) need another attempt</p>
                <p className="mt-1 text-xs leading-5 text-zinc-400">{failed.slice(0, 4).join(", ")}{failed.length > 4 ? "…" : ""}</p>
              </div>
            )}
            <div className="mt-6 border-t border-white/10 pt-5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Good to know</p>
              <p className="mt-2 text-xs leading-6 text-zinc-500">SoundFont banks are RIFF/SF2/SF3 files, not ZIP archives, so there is no extraction step. This setup installs every built-in SF2/SF3 preset file and preloads every built-in sample-based instrument preset. The first installation can be a substantial download and needs enough free device storage. Persistent caching requires a secure origin, which includes HTTPS, localhost and the installed desktop app. Imported SoundFonts are already stored locally when you import them.</p>
            </div>
          </div>
        </section>
        <footer className="border-t border-white/10 pt-4 text-[10px] text-zinc-600">Your projects, SoundFont banks and sampled instrument files stay in this browser profile on this device. The full first-run sound download may be large; keep the app open and connected to the internet until installation finishes.</footer>
      </div>
    </main>
  );
}
